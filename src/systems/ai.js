/**
 * OPTIONAL AI NARRATOR — bring-your-own-key.
 *
 * The game is fully playable with zero AI; this layer only *rewrites flavor
 * text* for random encounters when the player has supplied an API key. It
 * never changes mechanics. Config lives in localStorage (client-only — fine
 * for a personal static game; do not ship a shared key).
 *
 * Supported free-tier providers: Google Gemini, Groq, OpenRouter.
 */
const LS_KEY = "damascus_reign_ai";

const PROVIDERS = {
  gemini: { label: "Google Gemini", defaultModel: "gemini-2.0-flash" },
  groq: { label: "Groq", defaultModel: "llama-3.3-70b-versatile" },
  openrouter: { label: "OpenRouter", defaultModel: "meta-llama/llama-3.3-70b-instruct:free" },
};

export class AINarrator {
  constructor() {
    this.config = this._load();
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "null") || { provider: null, key: "", model: "" };
    } catch {
      return { provider: null, key: "", model: "" };
    }
  }

  _save() {
    localStorage.setItem(LS_KEY, JSON.stringify(this.config));
  }

  isEnabled() {
    return !!(this.config.provider && this.config.key);
  }

  status() {
    if (!this.isEnabled()) return "AI narrator: OFF (procedural flavor only).";
    const p = PROVIDERS[this.config.provider];
    return `AI narrator: ON — ${p?.label ?? this.config.provider}, model ${this.config.model || p?.defaultModel}.`;
  }

  configure({ provider, key, model }) {
    if (provider && !PROVIDERS[provider]) {
      return { ok: false, message: `Unknown provider "${provider}". Choose: ${Object.keys(PROVIDERS).join(", ")}.` };
    }
    if (provider) this.config.provider = provider;
    if (key !== undefined) this.config.key = key;
    if (model !== undefined) this.config.model = model;
    if (!this.config.model && this.config.provider) this.config.model = PROVIDERS[this.config.provider].defaultModel;
    this._save();
    return { ok: true, message: this.status() };
  }

  disable() {
    this.config = { provider: null, key: "", model: "" };
    this._save();
  }

  /** Returns rewritten flavor text, or null on any failure (caller falls back). */
  async narrate(systemPrompt, userPrompt) {
    if (!this.isEnabled()) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const text = await this._call(systemPrompt, userPrompt, ctrl.signal);
      return text?.trim() || null;
    } catch (err) {
      console.warn("[ai] narration failed, using fallback:", err.message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async _call(system, user, signal) {
    const { provider, key } = this.config;
    const model = this.config.model || PROVIDERS[provider].defaultModel;

    if (provider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 1.0, maxOutputTokens: 220 },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json?.candidates?.[0]?.content?.parts?.[0]?.text;
    }

    // OpenAI-compatible (groq, openrouter)
    const base = provider === "groq"
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions";
    const res = await fetch(base, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 1.0,
        max_tokens: 220,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json?.choices?.[0]?.message?.content;
  }
}

export { PROVIDERS };
