/**
 * THE LOOT FORGE — procedural item generation.
 *
 * An item is built from: a slot, a rarity tier, a base name, a rarity prefix,
 * and 0..N rolled affixes. Raw rolls are stored once at generation; the live
 * `.stats` block is (re)derived by computeStats so enhancement levels and
 * enchant changes always recompute cleanly.
 */

import { rng as defaultRng } from "../engine/rng.js";

let _uid = 1;
function nextUid() {
  return `it_${(_uid++).toString(36)}_${Math.floor(defaultRng.float() * 1e6).toString(36)}`;
}

/** Stat keys that scale with enhancement (+N). Chance-based affixes do not. */
const ENHANCE_KEYS = new Set([
  "dmg", "def", "hp", "elemDmg", "str", "agi", "int", "vit", "luck", "allStats",
]);

/** Pick a rarity, biased by player luck and an external bias multiplier. */
export function rollRarity(data, rng, { luck = 0, bias = 1 } = {}) {
  // Higher luck/bias nudges weight toward rarer tiers by dampening common ones.
  const rarities = data.rarities;
  const tilt = 1 + luck * 0.012 + (bias - 1);
  return rng.weighted(rarities, (r) => {
    // Rarer tiers (smaller weight) get amplified by tilt; common tiers shrink.
    const rarityRank = 1 / Math.max(0.1, r.weight);
    return r.weight * Math.pow(tilt, rarityRank * 6);
  });
}

function rollSlot(data, rng) {
  const entries = Object.entries(data.loot.slotWeights).map(([slot, weight]) => ({ slot, weight }));
  return rng.weighted(entries).slot;
}

function rollAffixes(data, rng, count, ilvl, exclude = new Set()) {
  const pool = data.affixes.pool.filter((a) => !exclude.has(a.id));
  const chosen = [];
  const used = new Set();
  for (let i = 0; i < count && pool.length; i++) {
    const candidates = pool.filter((a) => !used.has(a.id));
    if (!candidates.length) break;
    const a = rng.weighted(candidates);
    used.add(a.id);
    chosen.push(makeAffix(a, rng, ilvl));
  }
  return chosen;
}

/** Roll a concrete value for an affix definition at a given item level. */
export function makeAffix(def, rng, ilvl) {
  let value;
  if (def.pct) {
    value = round2(rng.between(def.min, def.max));
  } else {
    value = Math.max(def.flat, Math.round(ilvl * rng.between(def.min, def.max)));
  }
  return {
    id: def.id,
    name: def.name,
    stat: def.stat,
    element: def.element,
    pct: !!def.pct,
    value,
  };
}

/**
 * Generate a fresh item.
 * opts: { slot, rarityBias, luck, classId, ilvl }
 */
export function generateItem(data, rng = defaultRng, opts = {}) {
  const ilvl = Math.max(1, Math.round(opts.ilvl ?? 1));
  const slot = opts.slot ?? rollSlot(data, rng);
  const rarity = opts.rarity
    ? data.rarities.find((r) => r.tier === opts.rarity)
    : rollRarity(data, rng, { luck: opts.luck ?? 0, bias: opts.rarityBias ?? 1 });

  // Base name — bias weapon names toward the player's class when known.
  const names = data.items.names[slot] ?? data.items.names.weapon;
  let baseName;
  if (slot === "weapon" && opts.classId && data.loot.classWeaponBias[opts.classId] && rng.chance(0.6)) {
    const biased = data.loot.classWeaponBias[opts.classId].filter((n) => names.includes(n));
    baseName = biased.length ? rng.pick(biased) : rng.pick(names);
  } else {
    baseName = rng.pick(names);
  }

  const prefix = rng.pick(data.items.prefixes[rarity.tier]);
  const affixes = rollAffixes(data, rng, rarity.affixes, ilvl);

  // Primary base stat for the slot, scaled by item level + rarity.
  const slotCfg = data.slots[slot];
  let base = null;
  if (slotCfg.primary !== "none") {
    const raw = (slotCfg.base + ilvl * slotCfg.perLevel) * rarity.mult * rng.between(0.9, 1.12);
    base = { stat: slotCfg.primary, value: Math.max(1, Math.round(raw)) };
  } else {
    // Accessories grant a little baseline vitality so they're never dead slots.
    base = { stat: "hp", value: Math.max(2, Math.round(ilvl * 1.0 * rarity.mult)) };
  }

  const item = {
    uid: nextUid(),
    slot,
    baseName,
    prefix,
    rarity: rarity.tier,
    ilvl,
    enhance: 0,
    base,
    affixes,
  };
  computeStats(item, data);
  item.name = displayName(item);
  return item;
}

/** (Re)derive the live `.stats` block from raw rolls + enhancement. */
export function computeStats(item, data) {
  const mult = 1 + 0.1 * item.enhance;
  const stats = {};
  const add = (k, v) => { stats[k] = (stats[k] ?? 0) + v; };

  if (item.base) {
    const v = ENHANCE_KEYS.has(item.base.stat) ? item.base.value * mult : item.base.value;
    add(item.base.stat, Math.round(v));
  }

  let element = null;
  for (const af of item.affixes) {
    const scaled = ENHANCE_KEYS.has(af.stat) ? af.value * mult : af.value;
    add(af.stat, af.pct ? scaled : Math.round(scaled));
    if (af.element) element = af.element;
  }
  // Weapons carry the elemental tag for combat; default physical.
  if (item.slot === "weapon") stats.element = element ?? "physical";
  else if (element) stats.element = element;

  // round pct stats to keep them tidy
  for (const k of ["crit", "critDmg", "dodge", "lifesteal"]) {
    if (stats[k]) stats[k] = round3(stats[k]);
  }
  item.stats = stats;
  return stats;
}

export function displayName(item) {
  const affix = item.affixes[0];
  const suffix = affix ? ` ${affix.name}` : "";
  const enh = item.enhance > 0 ? ` +${item.enhance}` : "";
  return `${item.prefix} ${item.baseName}${suffix}${enh}`;
}

export function rarityOf(item, data) {
  return data.rarities.find((r) => r.tier === item.rarity);
}

export function colorOf(item, data) {
  return rarityOf(item, data)?.color ?? "#ffffff";
}

/** Rough numeric strength, used for "is this an upgrade?" hints. */
export function itemPower(item) {
  const s = item.stats ?? {};
  return Math.round(
    (s.dmg ?? 0) * 2 +
    (s.def ?? 0) * 1.6 +
    (s.hp ?? 0) * 0.25 +
    ((s.str ?? 0) + (s.agi ?? 0) + (s.int ?? 0) + (s.vit ?? 0) + (s.luck ?? 0)) * 1.6 +
    (s.allStats ?? 0) * 7 +
    (s.elemDmg ?? 0) * 1.6 +
    (s.crit ?? 0) * 220 +
    (s.critDmg ?? 0) * 70 +
    (s.dodge ?? 0) * 180 +
    (s.lifesteal ?? 0) * 220
  );
}

export function sellValue(item, data) {
  const rarity = rarityOf(item, data);
  return Math.max(1, Math.round((item.ilvl * 2 + 5) * (rarity?.mult ?? 1) * (1 + item.enhance * 0.18)));
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
