/**
 * THE MINE — a parallel gathering/crafting loop.
 *
 * `dig` rolls an ore your pickaxe can reach at the current depth; deeper digs
 * surface rarer ore and risk boss ambushes. Ore sells for gold or crafts gear
 * whose rarity equals the ore's tier. Pickaxes are crafted up a tier ladder,
 * each reaching one rarity higher.
 */
import { generateItem, displayName } from "./items.js";

/** Index of a rarity tier letter in the canonical common→rare order. */
export function tierIndex(data, tier) {
  return data.rarities.findIndex((r) => r.tier === tier);
}

export function oreById(data, id) {
  return data.mining.ores.find((o) => o.id === id) ?? null;
}

export function pickaxeById(data, id) {
  return data.mining.pickaxes.find((p) => p.id === id) ?? null;
}

export function startingPickaxe(data) {
  return { ...data.mining.pickaxes[0] };
}

export function nextPickaxe(data, current) {
  const p = data.mining.pickaxes.find((p) => p.craft && p.craft.req === current.id);
  return p ?? null;
}

/** Roll a single dig: returns { ore, count } or { ore: null } if the seam is barren. */
export function digOnce(data, rng, { depth, pickaxe, luck }) {
  const reach = tierIndex(data, pickaxe.reach);
  const eligible = data.mining.ores.filter((o) => tierIndex(data, o.tier) <= reach && o.minDepth <= depth);
  if (!eligible.length) return { ore: null, count: 0 };

  // Depth and luck tilt the roll toward rarer ore (higher tier index).
  const factor = 1 + luck * 0.008 + depth * 0.012;
  const picked = rng.weighted(
    eligible.map((o) => ({ o, w: o.weight * Math.pow(factor, tierIndex(data, o.tier)) })),
    (e) => e.w
  ).o;

  const count = rng.range(1, Math.max(1, Math.round(pickaxe.power / 2)));
  return { ore: picked, count };
}

export function addOre(player, oreId, n) {
  player.ores[oreId] = (player.ores[oreId] ?? 0) + n;
}

export function oreCount(player, oreId) {
  return player.ores[oreId] ?? 0;
}

/** Total satchel value if everything were smelted. */
export function satchelValue(data, player) {
  let total = 0;
  for (const [id, n] of Object.entries(player.ores)) {
    total += (oreById(data, id)?.value ?? 0) * n;
  }
  return total;
}

export function sellOre(player, data, oreId) {
  const ore = oreById(data, oreId);
  const n = oreCount(player, oreId);
  if (!ore || n <= 0) return { ok: false, message: "You have none of that ore." };
  const gold = ore.value * n;
  player.ores[oreId] = 0;
  player.gold += gold;
  return { ok: true, message: `Smelted ${n}× ${ore.name} for ${gold} gold.`, gold };
}

export function sellAllOre(player, data) {
  let gold = 0;
  let kinds = 0;
  for (const ore of data.mining.ores) {
    const n = oreCount(player, ore.id);
    if (n > 0) { gold += ore.value * n; player.ores[ore.id] = 0; kinds++; }
  }
  if (!gold) return { ok: false, message: "Your satchel is empty." };
  player.gold += gold;
  return { ok: true, message: `Smelted ${kinds} ore type${kinds > 1 ? "s" : ""} for ${gold} gold.`, gold };
}

// --- crafting ---

export function pickaxeCraftInfo(data, player) {
  const next = nextPickaxe(data, player.pickaxe);
  if (!next) return { atMax: true };
  const c = next.craft;
  const ore = oreById(data, c.ore);
  return {
    atMax: false,
    next,
    ore,
    count: c.count,
    gold: c.gold,
    haveOre: oreCount(player, c.ore),
    canAfford: oreCount(player, c.ore) >= c.count && player.gold >= c.gold,
  };
}

export function craftPickaxe(player, data) {
  const info = pickaxeCraftInfo(data, player);
  if (info.atMax) return { ok: false, message: "Your pickaxe is already the finest ever forged." };
  if (info.haveOre < info.count) return { ok: false, message: `Need ${info.count}× ${info.ore.name} (have ${info.haveOre}).` };
  if (player.gold < info.gold) return { ok: false, message: `Need ${info.gold} gold (have ${player.gold}).` };
  player.ores[info.ore.id] -= info.count;
  player.gold -= info.gold;
  player.pickaxe = { ...info.next };
  return { ok: true, message: `Forged the ${info.next.name}! It now reaches ${info.next.reach}-tier ore.`, pickaxe: player.pickaxe };
}

export function gearCraftCost(data, ore) {
  const g = data.mining.gear;
  const ti = tierIndex(data, ore.tier);
  return { ore: g.oreCostBase + g.oreCostPerTier * ti, gold: g.goldBase + g.goldPerTier * ti };
}

/** Craft a piece of gear from an ore; its rarity equals the ore's tier. */
export function craftGear(player, data, rng, oreId, slot) {
  const ore = oreById(data, oreId);
  if (!ore) return { ok: false, message: "No such ore." };
  const cost = gearCraftCost(data, ore);
  if (oreCount(player, oreId) < cost.ore) return { ok: false, message: `Need ${cost.ore}× ${ore.name} (have ${oreCount(player, oreId)}).` };
  if (player.gold < cost.gold) return { ok: false, message: `Need ${cost.gold} gold (have ${player.gold}).` };

  player.ores[oreId] -= cost.ore;
  player.gold -= cost.gold;
  const item = generateItem(data, rng, { ilvl: player.level, rarity: ore.tier, slot, classId: player.classId });
  player.addItem(item);
  return { ok: true, message: `Smithed ${displayName(item)} from ${ore.name}.`, item };
}

// --- mine boss ---

export function bossChance(data, depth) {
  const b = data.mining.boss;
  return Math.min(b.maxChance, b.baseChance + depth * b.depthChance);
}

/**
 * A mine guardian scaled to the *player's level* (not a fixed monster's raw
 * stats), so deep mining is a fair-but-tense fight at any level. Borrows a
 * golem's name for flavor; gets tougher with depth and difficulty.
 */
export function makeMineGuardian(data, rng, player, depth, mods = {}) {
  const present = data.mining.boss.monsters.filter((id) => data.monsters[id]);
  const name = present.length ? data.monsters[rng.pick(present)].name : "Mine Guardian";
  const b = data.mining.boss;
  const lvl = Math.max(1, player.level);
  const dscale = 1 + depth * 0.015;

  const maxHp = Math.round((40 + lvl * 22) * b.hpMult * dscale * (mods.mobHp ?? 1));
  const attack = Math.round((5 + lvl * 2.4) * b.atkMult * dscale * (mods.mobDmg ?? 1));
  const defense = Math.round(lvl * 1.2 + depth * 0.1);
  const xp = Math.round((maxHp * 0.3 + attack * 2) * b.rewardMult);
  const gold = Math.round(xp * rng.between(0.3, 0.7));

  return {
    id: "mine_guardian",
    name: `${name}, Mine Guardian`,
    level: lvl,
    maxHp,
    hp: maxHp,
    attack,
    defense,
    element: rng.pick(["physical", "physical", "lightning", "shadow"]),
    xp,
    gold,
    boss: true,
    special: false,
    statuses: {},
  };
}
