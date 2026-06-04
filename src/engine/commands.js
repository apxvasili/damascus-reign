/**
 * Command registry + parser. Commands declare which game states they're valid
 * in; dispatch() enforces that and routes to the handler.
 *
 * A command definition:
 *   {
 *     name, aliases?, desc, usage?, group?,
 *     states?: string[]            // allowed game states; omit = any
 *     run(args, ctx)               // args: rest string; ctx: shared game context
 *   }
 */
export class CommandRegistry {
  constructor() {
    this.commands = new Map();   // canonical name -> def
    this.lookup = new Map();     // name & aliases -> canonical name
  }

  register(def) {
    this.commands.set(def.name, def);
    this.lookup.set(def.name, def.name);
    for (const a of def.aliases ?? []) this.lookup.set(a, def.name);
    return this;
  }

  resolve(word) {
    const name = this.lookup.get(word);
    return name ? this.commands.get(name) : null;
  }

  /** All commands grouped for the codex panel, preserving registration order. */
  grouped() {
    const groups = new Map();
    for (const def of this.commands.values()) {
      const g = def.group ?? "General";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(def);
    }
    return groups;
  }

  /**
   * Parse and dispatch a raw input line.
   * Returns { ok, error } so the caller can surface problems.
   */
  dispatch(input, ctx) {
    const trimmed = input.trim();
    if (!trimmed) return { ok: true };

    const parts = trimmed.split(/\s+/);
    const word = parts[0].toLowerCase();
    const args = parts.slice(1).join(" ");

    const def = this.resolve(word);
    if (!def) {
      return { ok: false, error: `Unknown command: "${word}". Type "help".` };
    }

    const state = ctx.getState();
    if (def.states && !def.states.includes(state)) {
      return { ok: false, error: ctx.stateHint(def, state) };
    }

    try {
      def.run(args, ctx, word);
      return { ok: true };
    } catch (err) {
      console.error(err);
      return { ok: false, error: `Command failed: ${err.message}` };
    }
  }
}
