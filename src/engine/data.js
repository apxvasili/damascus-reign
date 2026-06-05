/**
 * Loads all static game data from ./data/*.json once at boot and exposes it
 * as a single frozen object. Everything downstream reads from here.
 */

const FILES = {
  zones: "./data/zones.json",
  monsters: "./data/monsters.json",
  items: "./data/items.json",
  loot: "./data/loot.json",
  affixes: "./data/affixes.json",
  classes: "./data/classes.json",
  events: "./data/events.json",
  shop: "./data/shop.json",
  forge: "./data/forge.json",
  difficulties: "./data/difficulties.json",
  skills: "./data/skills.json",
  version: "./data/version.json",
};

export async function loadGameData() {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, url]) => {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
      return [key, await res.json()];
    })
  );

  const data = Object.fromEntries(entries);

  // Normalize a couple of shapes for convenience.
  data.zones = data.zones.zones ?? data.zones;
  data.rarities = data.loot.rarities;
  data.slots = data.loot.slots;
  data.elements = data.affixes.elements;

  return data;
}
