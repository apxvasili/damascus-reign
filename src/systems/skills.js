/**
 * SKILL TREE — passive bonuses unlocked with skill points (1 per level).
 *
 * Skill definitions live in data/skills.json. The player stores only the list of
 * unlocked ids + remaining points; the aggregated `skillMods` are recomputed
 * from that list (here) and consumed by Player.recalc().
 */

export function allSkills(data) {
  return data.skills.branches.flatMap((b) => b.skills.map((s) => ({ ...s, branchId: b.id, branchName: b.name, branchColor: b.color })));
}

export function skillById(data, id) {
  return allSkills(data).find((s) => s.id === id) ?? null;
}

/** Sum every unlocked skill's mods into a single bonus object. */
export function aggregateMods(data, unlockedIds) {
  const mods = {};
  const set = new Set(unlockedIds);
  for (const s of allSkills(data)) {
    if (!set.has(s.id)) continue;
    for (const [k, v] of Object.entries(s.mods ?? {})) mods[k] = (mods[k] ?? 0) + v;
  }
  return mods;
}

/** Recompute and attach the player's skillMods, then refresh derived stats. */
export function applySkillMods(player, data) {
  player.skillMods = aggregateMods(data, player.skills);
  player.recalc();
}

/** "unlocked" | "available" | "needs-req" | "needs-points" */
export function skillStatus(data, player, skill) {
  if (player.skills.includes(skill.id)) return "unlocked";
  const reqMet = (skill.req ?? []).every((r) => player.skills.includes(r));
  if (!reqMet) return "needs-req";
  if (player.skillPoints < skill.cost) return "needs-points";
  return "available";
}

export function unlockSkill(player, data, id) {
  const skill = skillById(data, id);
  if (!skill) return { ok: false, message: "No such skill." };
  if (player.skills.includes(id)) return { ok: false, message: `${skill.name} is already unlocked.` };
  const missing = (skill.req ?? []).filter((r) => !player.skills.includes(r));
  if (missing.length) {
    const names = missing.map((r) => skillById(data, r)?.name ?? r).join(", ");
    return { ok: false, message: `${skill.name} requires: ${names}.` };
  }
  if (player.skillPoints < skill.cost) {
    return { ok: false, message: `${skill.name} costs ${skill.cost} points (you have ${player.skillPoints}).` };
  }
  player.skillPoints -= skill.cost;
  player.skills.push(id);
  applySkillMods(player, data);
  return { ok: true, message: `Unlocked ${skill.name}! ${skill.desc}.`, skill };
}

export function unlockedCount(player) {
  return player.skills.length;
}

/** Skills visible to this player (class-gated skills only show for their class). */
export function visibleSkills(data, player, branch) {
  return branch.skills.filter((s) => !s.class || s.class === player.classId);
}

/** Active combat abilities the player has unlocked from the tree. */
export function unlockedAbilities(data, player) {
  const set = new Set(player.skills);
  return allSkills(data)
    .filter((s) => s.ability && set.has(s.id))
    .map((s) => s.ability);
}
