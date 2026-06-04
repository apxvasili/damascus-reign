/**
 * THE FORGE — enhancement (+N). Spends forge shards + gold to raise an item's
 * enhancement level, multiplying its stats. Success chance falls as the level
 * climbs; past the safe threshold a failure can knock the item down a level.
 */
import { computeStats, displayName } from "./items.js";

export function forgeInfo(item, data) {
  const cfg = data.forge;
  const atMax = item.enhance >= cfg.maxLevel;
  const tier = cfg.tiers.find((t) => t.from === item.enhance) ?? cfg.tiers[cfg.tiers.length - 1];
  const gold = Math.round(cfg.baseGoldCost + cfg.goldPerItemLevel * item.ilvl + item.enhance * cfg.goldPerItemLevel * item.ilvl * 0.3);
  return {
    atMax,
    shards: tier.shards,
    gold,
    success: tier.success,
    downgradeOnFail: tier.downgradeOnFail,
    next: item.enhance + 1,
  };
}

export function forge(player, item, data, rng) {
  const info = forgeInfo(item, data);
  if (info.atMax) return { result: "blocked", message: `${displayName(item)} is already at the forge limit (+${data.forge.maxLevel}).` };
  if (player.shards < info.shards) return { result: "blocked", message: `Need ${info.shards} forge shards (have ${player.shards}).` };
  if (player.gold < info.gold) return { result: "blocked", message: `Need ${info.gold} gold (have ${player.gold}).` };

  player.shards -= info.shards;
  player.gold -= info.gold;

  if (rng.chance(info.success)) {
    item.enhance += 1;
    computeStats(item, data);
    item.name = displayName(item);
    player.recalc();
    return { result: "success", message: `The forge flares — ${displayName(item)} now glows at +${item.enhance}!` };
  }

  if (info.downgradeOnFail && item.enhance > 0) {
    item.enhance -= 1;
    computeStats(item, data);
    item.name = displayName(item);
    player.recalc();
    return { result: "downgrade", message: `The temper cracks! ${displayName(item)} slips to +${item.enhance}.` };
  }
  return { result: "fail", message: `The forge sputters. Materials lost, but ${displayName(item)} holds at +${item.enhance}.` };
}
