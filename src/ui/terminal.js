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
   * Fire a rarity drop celebration. `flash` tints the screen; `intense` adds a
   * full banner. The top tiers (X / SSS) get extra-unhinged variants via CSS.
   */
  dropFx({ tier, label, color, name, flash = true, intense = false }) {
    if (flash) {
      const f = document.createElement("div");
      f.className = "drop-flash";
      f.style.setProperty("--c", color);
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 1300);
    }
    if (!intense) return;
    const variant = tier === "X" ? " drop-x" : tier === "SSS" ? " drop-sss" : tier === "SS" ? " drop-ss" : "";
    const b = document.createElement("div");
    b.className = `drop-banner${variant}`;
    b.style.setProperty("--c", color);
    b.innerHTML =
      `<div class="db-tier">${tier}</div>` +
      `<div class="db-label">${escapeText(label)} DROP</div>` +
      `<div class="db-name">${escapeText(name)}</div>`;
    document.body.appendChild(b);
    setTimeout(() => b.classList.add("out"), 2300);
    setTimeout(() => b.remove(), 3100);
  }
}

function escapeText(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
