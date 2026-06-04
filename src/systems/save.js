/**
 * SAVES — multiple named characters persisted to localStorage. Stores only raw
 * player JSON (derived stats are recomputed on load via Player.fromJSON).
 */
import { Player, SAVE_VERSION } from "../engine/state.js";
import { getClass } from "./classes.js";

const LS_KEY = "damascus_reign_saves_v2";

export class SaveManager {
  constructor(data) {
    this.data = data;
    this.saves = this._load();
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  _persist() {
    localStorage.setItem(LS_KEY, JSON.stringify(this.saves));
  }

  names() {
    return Object.keys(this.saves);
  }

  exists(name) {
    return !!this.saves[name];
  }

  summary(name) {
    const raw = this.saves[name];
    if (!raw) return null;
    const cls = getClass(this.data, raw.classId);
    return { name, level: raw.level ?? 1, className: cls?.name ?? raw.classId, kills: raw.kills ?? 0 };
  }

  save(player) {
    this.saves[player.name] = player.toJSON();
    this._persist();
  }

  load(name) {
    const raw = this.saves[name];
    if (!raw) return null;
    const cls = getClass(this.data, raw.classId);
    if (!cls) return null;
    if ((raw.version ?? 1) < SAVE_VERSION) {
      // Future migrations would go here; for now we just attempt a best-effort load.
    }
    return Player.fromJSON(raw, cls);
  }

  remove(name) {
    delete this.saves[name];
    this._persist();
  }
}
