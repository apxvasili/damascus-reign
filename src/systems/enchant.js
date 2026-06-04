/**
 * ENCHANTING — rolls a fresh affix onto an item using arcane essence. If the
 * item is already at its rarity's affix cap, the new affix replaces the
 * weakest existing one (a gamble: it might be worse).
 */
import { computeStats, displayName, makeAffix, rarityOf, itemPower } from "./items.js";

export function enchantInfo(item, data) {
  const e = data.forge.enchant;
  const rarity = rarityOf(item, data);
  const cap = rarity?.affixes ?? 0;
  return {
    essence: e.essenceCost,
    gold: e.goldCost + e.goldPerItemLevel * item.ilvl,
    cap,
    atCap: item.affixes.length >= cap,
    canEnchant: cap > 0,
  };
}

export function enchant(player, item, data, rng) {
  const info = enchantInfo(item, data);
  if (!info.canEnchant) return { result: "blocked", message: `${displayName(item)} is too crude to hold an enchantment.` };
  if (player.essence < info.essence) return { result: "blocked", message: `Need ${info.essence} arcane essence (have ${player.essence}).` };
  if (player.gold < info.gold) return { result: "blocked", message: `Need ${info.gold} gold (have ${player.gold}).` };

  player.essence -= info.essence;
  player.gold -= info.gold;

  const existingIds = new Set(item.affixes.map((a) => a.id));
  const pool = data.affixes.pool.filter((a) => !existingIds.has(a.id));
  if (!pool.length) return { result: "blocked", message: "No new affixes remain to apply." };

  const def = rng.weighted(pool);
  const fresh = makeAffix(def, rng, item.ilvl);

  let message;
  if (info.atCap) {
    // Replace the weakest current affix (compare single-affix power contribution).
    let weakestIdx = 0;
    let weakestVal = Infinity;
    item.affixes.forEach((a, i) => {
      const probe = { ...item, affixes: [a] };
      computeStats(probe, data);
      const p = itemPower(probe);
      if (p < weakestVal) { weakestVal = p; weakestIdx = i; }
    });
    const removed = item.affixes[weakestIdx];
    item.affixes[weakestIdx] = fresh;
    message = `Essence flares — "${removed.name}" is burned away and "${fresh.name}" takes hold.`;
  } else {
    item.affixes.push(fresh);
    message = `Essence binds "${fresh.name}" to ${item.baseName}.`;
  }

  computeStats(item, data);
  item.name = displayName(item);
  player.recalc();
  return { result: "success", message };
}
