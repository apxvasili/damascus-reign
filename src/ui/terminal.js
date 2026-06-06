/**
 * THE SCRIBE — owns the terminal output stream and the command input line,
 * including history navigation and the prompt label.
 */
export class Terminal {
  constructor() {
    this.output = document.getElementById("output");
    this.input = document.getElementById("cmd-input");
    this.promptEl = document.getElementById("prompt");
    this.history = [];
    this.historyIdx = -1;
  }

  /** Append a line. `cls` maps to a .msg-<cls> style. HTML is allowed. */
  print(html = "", cls = "") {
    const div = document.createElement("div");
    div.className = `line line-in${cls ? ` msg-${cls}` : ""}`;
    div.innerHTML = html;
    this.output.appendChild(div);
    this._scroll();
    return div;
  }

  printLines(lines) {
    for (const l of lines) this.print(l.msg, l.cls);
  }

  echo(text) {
    this.print(`<span class="echo-prompt">${this.promptEl?.textContent ?? "&gt;"}</span> ${escapeText(text)}`, "echo");
  }

  art(text) {
    const pre = document.createElement("pre");
    pre.className = "header-art line-in";
    pre.textContent = text;
    this.output.appendChild(pre);
    this._scroll();
  }

  rule(label = "") {
    this.print(`<span class="rule">${label ? `── ${label} ` : ""}${"─".repeat(Math.max(4, 40 - label.length))}</span>`, "system");
  }

  blank() {
    this.print("&nbsp;");
  }

  clear() {
    this.output.innerHTML = "";
  }

  setPrompt(text) {
    if (this.promptEl) this.promptEl.textContent = text;
  }

  focus() {
    this.input.focus();
  }

  _scroll() {
    this.output.scrollTop = this.output.scrollHeight;
  }

  /** Provide a completion function: completer(line) -> array of full-line candidates. */
  setCompleter(fn) {
    this.completer = fn;
  }

  _handleTab() {
    if (!this.completer) return;
    const line = this.input.value;
    // Repeated Tab on an unchanged, already-completed line cycles candidates.
    if (this._comp && this._comp.applied === line && this._comp.matches.length > 1) {
      this._comp.idx = (this._comp.idx + 1) % this._comp.matches.length;
      this.input.value = this._comp.matches[this._comp.idx];
      this._comp.applied = this.input.value;
      return;
    }
    const matches = this.completer(line) ?? [];
    if (!matches.length) return;
    this._comp = { matches, idx: 0, applied: matches[0] };
    this.input.value = matches[0];
  }

  /** Wire the input line. `handler(line)` is called on Enter. */
  bind(handler) {
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        this._handleTab();
        return;
      }
      // Any other key invalidates the active completion cycle.
      if (e.key !== "Shift" && e.key !== "Control" && e.key !== "Meta" && e.key !== "Alt") {
        this._comp = null;
      }
      if (e.key === "Enter") {
        const value = this.input.value;
        this.input.value = "";
        const trimmed = value.trim();
        if (trimmed) {
          this.history.push(trimmed);
          this.historyIdx = this.history.length;
          handler(trimmed);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (this.history.length && this.historyIdx > 0) {
          this.historyIdx--;
          this.input.value = this.history[this.historyIdx];
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (this.historyIdx < this.history.length - 1) {
          this.historyIdx++;
          this.input.value = this.history[this.historyIdx];
        } else {
          this.historyIdx = this.history.length;
          this.input.value = "";
        }
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("a,button,input")) this.focus();
    });
  }

  /**
   * Cinematic, tiered drop celebration. `level` (1–5) scales the spectacle:
   *   1 — color flash            (C/B)
   *   2 — flash + banner          (A)
   *   3 — soft dim + shockwave + sparks + banner   (S/SS)
   *   4 — hard dim + god-rays + dense sparks + shake (SSS)
   *   5 — all of the above + rainbow + chromatic aberration (X)
   * Effects are composed from discrete layers and cleaned up automatically.
   */
  dropFx({ tier, label, color, name, level = 1 }) {
    // Always a quick screen tint.
    const flash = document.createElement("div");
    flash.className = "drop-flash";
    flash.style.setProperty("--c", color);
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 1300);
    if (level <= 1) return;

    const dur = level >= 5 ? 3800 : level >= 4 ? 3200 : 2600;
    const stage = document.createElement("div");
    stage.className = `celebration cele-l${level}${tier === "X" ? " cele-x" : ""}`;
    stage.style.setProperty("--c", color);

    const parts = [];
    if (level >= 3) parts.push(`<div class="cele-backdrop"></div>`);
    if (level >= 4) parts.push(`<div class="cele-rays"></div>`);
    if (level >= 3) parts.push(`<div class="cele-shock"></div><div class="cele-shock cele-shock2"></div>`);

    // particle sparks
    const sparkCount = level >= 5 ? 46 : level >= 4 ? 34 : level >= 3 ? 20 : 0;
    if (sparkCount) {
      let sp = `<div class="cele-sparks">`;
      for (let i = 0; i < sparkCount; i++) {
        const ang = (360 / sparkCount) * i + (i % 3) * 7;
        const dist = 120 + (i % 5) * 60;
        const delay = (i % 7) * 40;
        const size = 2 + (i % 4);
        sp += `<span style="--a:${ang}deg; --d:${dist}px; --delay:${delay}ms; --s:${size}px"></span>`;
      }
      sp += `</div>`;
      parts.push(sp);
    }

    parts.push(
      `<div class="cele-banner">` +
        `<div class="cele-tier">${escapeText(tier)}</div>` +
        `<div class="cele-label">${escapeText(label)} DROP</div>` +
        `<div class="cele-name">${escapeText(name)}</div>` +
      `</div>`
    );

    stage.innerHTML = parts.join("");
    document.body.appendChild(stage);

    // screen shake for the big ones
    if (level >= 4) {
      const gc = document.getElementById("game-container");
      gc?.classList.add(level >= 5 ? "shake-hard" : "shake-soft");
      setTimeout(() => gc?.classList.remove("shake-hard", "shake-soft"), level >= 5 ? 900 : 650);
    }

    setTimeout(() => stage.classList.add("out"), dur - 700);
    setTimeout(() => stage.remove(), dur);
  }
}

function escapeText(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
