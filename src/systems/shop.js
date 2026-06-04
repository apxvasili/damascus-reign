/**
 * THE MARKET — buy consumables, materials and a small rotating stock of
 * procedurally generated gear; sell loot back at its computed value.
 */
import { generateItem, sellValue, displayName } from "./items.js";
import { consumableInstance } from "./classes.js";

/** Build a fresh shop offering. Gear rotates each visit. */
export function rollStock(data, rng, player) {
  const gear = [];
  const count = data.shop.rotatingStockCount ?? 4;
  for (let i = 0; i < count; i++) {
    const ilvl = Math.max(1, player.level + rng.range(-1, 2));
    const item = generateItem(data, rng, { ilvl, luck: 0, rarityBias: 1.05, classId: player.classId });
    gear.push({ kind: "gear", item, price: Math.round(sellValue(item, data) * 3.2 + item.ilvl * 4) });
  }

  const consumables = data.shop.consumables.map((c) => ({ kind: "consumable", def: c, price: c.cost }));
  const materials = data.shop.materials.map((m) => ({ kind: "material", def: m, price: m.cost }));

  return [...consumables, ...materials, ...gear];
}

export function buy(player, entry, data) {
  if (player.gold < entry.price) return { ok: false, message: `Not enough gold (need ${entry.price}, have ${player.gold}).` };
  player.gold -= entry.price;

  if (entry.kind === "consumable") {
    player.addItem(consumableInstance(entry.def));
    return { ok: true, message: `Bought ${entry.def.name} for ${entry.price}g.`, consumed: false };
  }
  if (entry.kind === "material") {
    player[entry.def.key] = (player[entry.def.key] ?? 0) + 1;
    return { ok: true, message: `Bought 1 ${entry.def.name} for ${entry.price}g.`, consumed: false };
  }
  if (entry.kind === "gear") {
    player.addItem(entry.item);
    return { ok: true, message: `Bought ${displayName(entry.item)} for ${entry.price}g.`, consumed: true };
  }
  return { ok: false, message: "Nothing to buy." };
}

export function sell(player, uid, data) {
  const item = player.findItem(uid);
  if (!item) return { ok: false, message: "No such item in your bag." };
  if (item.kind === "consumable") {
    player.removeItem(uid);
    player.gold += 2;
    return { ok: true, message: `Sold ${item.name} for 2g.` };
  }
  const value = sellValue(item, data);
  player.removeItem(uid);
  player.gold += value;
  return { ok: true, message: `Sold ${displayName(item)} for ${value}g.` };
}
