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

  /** Wire the input line. `handler(line)` is called on Enter. */
  bind(handler) {
    this.input.addEventListener("keydown", (e) => {
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
}

function escapeText(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
