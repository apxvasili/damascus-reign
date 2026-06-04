/**
 * Class helpers — selection metadata and the starting kit each class spawns
 * with. Class stat blocks themselves live in data/classes.json.
 */
import { generateItem } from "./items.js";

export function listClasses(data) {
  return Object.values(data.classes);
}

export function getClass(data, id) {
  return data.classes[id] ?? null;
}

/**
 * Equip a fresh character with a low-tier weapon (biased to their class) and a
 * chest piece, plus a starter healing item in the bag.
 */
export function grantStartingKit(player, data, rng) {
  const weapon = generateItem(data, rng, { slot: "weapon", rarity: "E", ilvl: 1, classId: player.classId });
  const chest = generateItem(data, rng, { slot: "armor", rarity: "E", ilvl: 1 });

  player.equipment.weapon = weapon;
  player.equipment.armor = chest;

  // Two herbal brews to start.
  const brew = data.shop.consumables.find((c) => c.id === "potion");
  if (brew) {
    player.addItem(consumableInstance(brew));
    player.addItem(consumableInstance(brew));
  }
  player.recalc();
  player.hp = player.maxHp;
}

let _cuid = 1;
export function consumableInstance(def) {
  return {
    uid: `cn_${(_cuid++).toString(36)}`,
    kind: "consumable",
    id: def.id,
    name: def.name,
    desc: def.desc,
    effect: def.effect,
  };
}
