/**
 * Rendering helpers — pure functions that turn game objects into HTML strings.
 * Kept separate from the terminal so formatting is easy to tweak/test.
 */
import { rarityOf, colorOf, sellValue } from "../systems/items.js";

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const STAT_LABELS = {
  dmg: "Damage", def: "Armor", hp: "Health",
  str: "STR", agi: "AGI", int: "INT", vit: "VIT", luck: "LUCK",
  elemDmg: "Elemental", allStats: "All Attributes",
  crit: "Crit Chance", critDmg: "Crit Damage", dodge: "Dodge", lifesteal: "Lifesteal",
};

const PCT_KEYS = new Set(["crit", "critDmg", "dodge", "lifesteal"]);

function statLine(key, val, data) {
  if (key === "element") return "";
  const label = STAT_LABELS[key] ?? key;
  const shown = PCT_KEYS.has(key) ? `${Math.round(val * 100)}%` : `+${val}`;
  return `<span class="stat-label">${label}</span> <span class="stat-val">${shown}</span>`;
}

/**
 * Item name colored by rarity, prefixed with its tier badge (e.g. [X]).
 * The `rarity-<tier>` class drives the per-rarity CSS animations.
 */
export function itemNameHtml(item, data) {
  if (item.kind === "consumable") return `<span class="item-consumable">${esc(item.name)}</span>`;
  const r = rarityOf(item, data);
  const color = r?.color ?? colorOf(item, data);
  const tier = r?.tier ?? "?";
  return `<span class="item-name rarity-${tier}" style="--rc:${color}; color:${color}">` +
         `<span class="rarity-badge">${tier}</span> ${esc(item.name)}</span>`;
}

export function rarityTag(item, data) {
  const r = rarityOf(item, data);
  return r ? `<span style="color:${r.color}">${r.label}</span>` : "";
}

/** Compact one-liner for inventory/shop lists. `idx` is an optional handle. */
export function itemLine(item, data, { idx, showValue = false } = {}) {
  if (item.kind === "consumable") {
    const handle = idx != null ? `<span class="handle">${idx}</span> ` : "";
    return `${handle}${itemNameHtml(item, data)} <span class="cmd-desc">— ${esc(item.desc ?? "")}</span>`;
  }
  const handle = idx != null ? `<span class="handle">${idx}</span> ` : "";
  const slot = data.slots[item.slot]?.label ?? item.slot;
  const s = item.stats;
  const primary = s.dmg ? `${s.dmg} dmg` : s.def ? `${s.def} arm` : s.hp ? `${s.hp} hp` : "";
  const val = showValue ? ` <span class="msg-gold">(${sellValue(item, data)}g)</span>` : "";
  return `${handle}${itemNameHtml(item, data)} <span class="cmd-desc">[${slot} · ilvl ${item.ilvl} · ${primary}]</span>${val}`;
}

/** Full multi-line detail block for `inspect`. */
export function itemDetail(item, data) {
  if (item.kind === "consumable") {
    return `<div class="item-card">${itemNameHtml(item, data)}<div class="cmd-desc">${esc(item.desc ?? "")}</div></div>`;
  }
  const slot = data.slots[item.slot]?.label ?? item.slot;
  const lines = [];
  lines.push(`<div class="item-card-head">${itemNameHtml(item, data)} ${rarityTag(item, data)}</div>`);
  lines.push(`<div class="cmd-desc">${slot} · item level ${item.ilvl}${item.enhance ? ` · enhanced +${item.enhance}` : ""}</div>`);

  const s = item.stats;
  const order = ["dmg", "def", "hp", "str", "agi", "int", "vit", "luck", "allStats", "elemDmg", "crit", "critDmg", "dodge", "lifesteal"];
  for (const k of order) {
    if (s[k]) lines.push(`<div class="stat-row">${statLine(k, s[k], data)}</div>`);
  }
  if (s.element && s.element !== "physical") {
    const el = data.elements[s.element];
    lines.push(`<div class="stat-row"><span class="stat-label">Element</span> <span class="stat-val" style="color:${el?.color}">${el?.name ?? s.element}</span></div>`);
  }
  if (item.affixes?.length) {
    lines.push(`<div class="cmd-desc" style="margin-top:6px">${item.affixes.map((a) => esc(a.name)).join(", ")}</div>`);
  }
  lines.push(`<div class="cmd-desc">Sell value: ${sellValue(item, data)}g</div>`);
  return `<div class="item-card">${lines.join("")}</div>`;
}

export function bar(pct, color, width = 22) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return `<span style="color:${color}">${"█".repeat(filled)}</span><span style="color:#333">${"░".repeat(width - filled)}</span>`;
}
