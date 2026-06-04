/**
 * RANDOM ENCOUNTERS — non-combat events with choices and weighted outcomes.
 * Mechanics are fully procedural and offline; the AI narrator (if enabled)
 * only rewrites the descriptive prose, never the effects.
 */
import { generateItem, displayName } from "./items.js";

export function rollEvent(data, rng, player) {
  const eligible = data.events.events.filter((e) => (e.minLevel ?? 1) <= player.level);
  return rng.weighted(eligible);
}

/** Resolve a chosen option. Returns a structured result the UI renders. */
export function resolveChoice(player, event, choiceIndex, data, rng) {
  const choice = event.choices[choiceIndex];
  if (!choice) return { ok: false, message: "No such choice." };

  // Pay any up-front cost.
  if (choice.cost?.gold) {
    if (player.gold < choice.cost.gold) {
      return { ok: false, message: `You can't afford that (need ${choice.cost.gold}g).` };
    }
    player.gold -= choice.cost.gold;
  }

  const outcome = rng.weighted(choice.results);
  const lines = [];
  let fight = false;
  let leveled = null;

  const e = outcome.effects ?? {};
  if (e.gold) { player.gold = Math.max(0, player.gold + e.gold); lines.push({ msg: `${e.gold > 0 ? "+" : ""}${e.gold} gold.`, cls: e.gold > 0 ? "gold" : "error" }); }
  if (e.goldMult !== undefined) { const before = player.gold; player.gold = Math.round(player.gold * e.goldMult); lines.push({ msg: `Gold ${player.gold >= before ? "rises" : "falls"} to ${player.gold}.`, cls: player.gold >= before ? "gold" : "error" }); }
  if (e.xp) { const r = player.gainXp(e.xp); lines.push({ msg: `+${e.xp} XP.`, cls: "success" }); if (r) leveled = r; }
  if (e.essence) { player.essence += e.essence; lines.push({ msg: `+${e.essence} arcane essence.`, cls: "item" }); }
  if (e.shards) { player.shards += e.shards; lines.push({ msg: `+${e.shards} forge shards.`, cls: "item" }); }
  if (e.hp) { player.heal(e.hp); lines.push({ msg: `+${e.hp} HP.`, cls: "heal" }); }
  if (e.hpPct !== undefined) {
    const amt = Math.round(player.maxHp * Math.abs(e.hpPct));
    if (e.hpPct >= 0) { player.heal(amt); lines.push({ msg: `Recovered ${amt} HP.`, cls: "heal" }); }
    else { player.hp = Math.max(1, player.hp - amt); lines.push({ msg: `Lost ${amt} HP.`, cls: "error" }); }
  }
  if (e.item !== undefined) {
    const item = generateItem(data, rng, { ilvl: player.level, luck: player.attrs.luck, rarityBias: e.item, classId: player.classId });
    player.addItem(item);
    lines.push({ msg: `Found: ${displayName(item)}`, cls: "loot", item });
  }
  if (e.fight) { fight = true; }

  return { ok: true, text: outcome.text, lines, fight, leveled };
}

/** Build the prompt pair used to ask the AI narrator for fresh prose. */
export function narrationPrompt(event, zone, player) {
  const system =
    "You are the narrator of a grim, terse fantasy roguelike played in a terminal. " +
    "Rewrite the given encounter description in 2-3 atmospheric sentences. " +
    "Keep the same situation and the same set of choices intact in spirit. " +
    "Do NOT invent rewards, numbers, or outcomes. Output only the prose, no preamble.";
  const user =
    `Zone: ${zone?.name ?? "the wilds"}.\n` +
    `Hero: a level ${player.level} ${player.classDef.name} named ${player.name}.\n` +
    `Encounter: "${event.title}".\n` +
    `Original text: ${event.text}\n` +
    `Choices: ${event.choices.map((c) => c.label).join(" | ")}`;
  return { system, user };
}
