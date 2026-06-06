/**
 * COMBAT — turn-based duels. A CombatSession owns one enemy and resolves a
 * single exchange per player action (player acts, enemy retaliates). It writes
 * to a `log(text, cls)` callback and calls `onEnd(outcome)` when the fight
 * resolves. All math runs through the injected RNG.
 *
 * Elements, crits, dodge, lifesteal and a few status effects (burn / chill /
 * shock) make each weapon roll feel distinct.
 */

const ZONE_ELEMENT = [
  [/scorch|blackrock|hellfire|magma|flame|ember/, "fire"],
  [/frozen|frost|ice|northrend|icecrown|rime/, "ice"],
  [/dragonblight/, "ice"],
  [/haunted|shadowfen|abyssal|sunken|outland|draenor/, "shadow"],
  [/silithus|crystal/, "lightning"],
  [/pandaria|vale/, "light"],
];

function zoneElement(zone) {
  const hay = `${zone.id} ${zone.name}`.toLowerCase();
  for (const [re, el] of ZONE_ELEMENT) if (re.test(hay)) return el;
  return "physical";
}

function mitigation(def) {
  return def / (def + 60);
}

/** Build a scaled enemy instance for a zone. */
export function makeEnemy(data, rng, zone, { boss = false, mods = {} } = {}) {
  const pool = zone.monsters ?? [];
  // Boss fights prefer entries flagged boss/special; otherwise any monster.
  let candidates = pool
    .map((id) => ({ id, def: data.monsters[id] }))
    .filter((m) => m.def);
  if (boss) {
    const bosses = candidates.filter((m) => m.def.boss);
    if (bosses.length) candidates = bosses;
  } else {
    candidates = candidates.filter((m) => !m.def.boss) ;
    if (!candidates.length) candidates = pool.map((id) => ({ id, def: data.monsters[id] })).filter((m) => m.def);
  }
  const chosen = rng.pick(candidates);
  const base = chosen.def;

  const level = Math.max(1, zone.min_level + rng.range(0, 3));
  const lvlFactor = 1 + (level - zone.min_level) * 0.08;
  const hpMult = mods.mobHp ?? 1;
  const dmgMult = mods.mobDmg ?? 1;

  // Reward is computed from the *unscaled* stats so difficulty's xp/gold knobs
  // (applied at reward time) stay the single source of reward truth.
  const rawHp = base.health * lvlFactor;
  const rawAtk = base.damage * lvlFactor;
  const defense = Math.round((base.defense ?? 0) * lvlFactor);

  const maxHp = Math.round(rawHp * hpMult);
  const attack = Math.round(rawAtk * dmgMult);
  const element = base.boss || base.special ? zoneElement(zone) : (rng.chance(0.35) ? zoneElement(zone) : "physical");

  const xp = Math.round((rawHp * 0.35 + rawAtk * 2.2 + defense * 1.5) * (base.boss ? 2.2 : base.special ? 1.5 : 1));
  const gold = Math.round(xp * rng.between(0.3, 0.7));

  return {
    id: chosen.id,
    name: base.name,
    level,
    maxHp,
    hp: maxHp,
    attack,
    defense,
    element,
    xp,
    gold,
    boss: !!base.boss,
    special: !!base.special,
    statuses: {},
  };
}

export class CombatSession {
  constructor({ player, enemy, data, rng, log, onEnd }) {
    this.player = player;
    this.enemy = enemy;
    this.data = data;
    this.rng = rng;
    this.log = log;
    this.onEnd = onEnd;
    this.over = false;
    this.turn = 0;
  }

  elements() {
    return this.data.affixes.elements;
  }

  effectiveness(attackerEl, defenderEl) {
    if (attackerEl === "physical") return 1;
    const el = this.elements()[attackerEl];
    if (!el) return 1;
    if (el.strongVs.includes(defenderEl)) return 1.3;
    if (el.weakVs.includes(defenderEl)) return 0.75;
    return 1;
  }

  // --- player actions ---

  playerAttack() {
    if (this.over) return;
    this.turn++;
    const p = this.player;
    const roll = this.rng.damageRoll(p.attackPower, {
      variance: 0.18,
      critChance: p.critChance,
      critMult: p.critMult,
    });
    let dmg = roll.value + p.elemDmg;
    const effMult = p.element !== "physical" ? this.effectiveness(p.element, this.enemy.element) : 1;
    dmg = Math.round(dmg * effMult);
    this._dealToEnemy(dmg, { crit: roll.crit, effMult, element: p.element, label: "You strike" });
    if (!this.over) this._enemyTurn();
  }

  /**
   * Use an ability. `ab` is an ability definition (defaults to the class base).
   * Supports kinds attack / spell / heal and optional fields: guaranteedCrit,
   * critBonus, executeThreshold/executeMult, applyStatus (+statusChance), and
   * healPct (hybrid heal on any kind).
   */
  playerAbility(ab) {
    if (this.over) return;
    const p = this.player;
    ab = ab || p.classDef.ability;
    const power = p.abilityPower ?? 1;             // skill: ability power
    const cost = Math.max(1, Math.round(ab.cost * (1 - (p.costReduction ?? 0)))); // skill: cheaper
    if (p.resource < cost) {
      this.log(`Not enough ${p.resourceName} (${p.resource}/${cost}).`, "error");
      return;
    }
    this.turn++;
    p.resource -= cost;
    this.log(`✦ ${ab.name}!`, "ability");

    // optional heal component (kind "heal" or any ability with healPct)
    if (ab.healPct) {
      const healed = Math.round(p.maxHp * ab.healPct);
      p.heal(healed);
      this.log(`You channel light and recover ${healed} HP.`, "heal");
    }

    const status = ab.applyStatus ? { forceStatus: ab.applyStatus, statusChance: ab.statusChance ?? 1 } : {};

    if (ab.kind === "attack") {
      let mult = ab.mult;
      if (ab.executeThreshold && this.enemy.hp / this.enemy.maxHp <= ab.executeThreshold) {
        mult *= ab.executeMult ?? 1;
        this.log(`Execution! The wound runs deep.`, "ability");
      }
      const base = p.attackPower * mult * power;
      let crit = false;
      let value;
      if (ab.guaranteedCrit) { crit = true; value = Math.round(base * (p.critMult + (ab.critBonus ?? 0))); }
      else value = Math.round(base);
      const effMult = p.element !== "physical" ? this.effectiveness(p.element, this.enemy.element) : 1;
      const dmg = Math.round((value + p.elemDmg) * effMult);
      this._dealToEnemy(dmg, { crit, effMult, element: p.element, label: "It lands", ...status });
    } else if (ab.kind === "spell" || ab.kind === "heal") {
      const scaleVal = p.attrs[ab.scale ?? "int"] ?? 0;
      const raw = Math.round((scaleVal * (ab.mult ?? 0) + p.elemDmg) * power);
      const el = ab.element ?? "light";
      const effMult = this.effectiveness(el, this.enemy.element);
      const dmg = Math.round(raw * effMult);
      if (dmg > 0) this._dealToEnemy(dmg, { crit: false, effMult, element: el, label: "Power tears in", ignoreDef: true, ...status });
    }
    if (!this.over) this._enemyTurn();
  }

  useConsumable(item) {
    if (this.over) return;
    const eff = item.effect ?? {};
    if (eff.heal) { this.player.heal(eff.heal); this.log(`You use ${item.name}, recovering ${eff.heal} HP.`, "heal"); }
    if (eff.healPct) { const amt = Math.round(this.player.maxHp * eff.healPct); this.player.heal(amt); this.log(`You use ${item.name}, recovering ${amt} HP.`, "heal"); }
    if (eff.resource) { this.player.restoreResource(eff.resource); this.log(`You use ${item.name}, restoring ${eff.resource} ${this.player.resourceName}.`, "heal"); }
    this.player.removeItem(item.uid);
    this._enemyTurn();
  }

  flee() {
    if (this.over) return;
    const chance = 0.45 + this.player.attrs.agi * 0.01 - this.enemy.level * 0.01;
    if (this.enemy.boss) {
      this.log("There is no fleeing this. The boss blocks your escape!", "error");
      this._enemyTurn();
      return;
    }
    if (this.rng.chance(Math.max(0.15, Math.min(0.9, chance)))) {
      this.log("You break away and escape.", "system");
      this._finish("fled");
    } else {
      this.log("Your escape fails!", "error");
      this._enemyTurn();
    }
  }

  // --- internals ---

  _dealToEnemy(rawDmg, { crit, effMult, element, label, ignoreDef = false, forceStatus = null, statusChance = 1 }) {
    let dmg = rawDmg;
    if (!ignoreDef) dmg = Math.max(1, Math.round(dmg * (1 - mitigation(this.enemy.defense))));
    dmg = Math.max(1, dmg);
    this.enemy.hp -= dmg;

    const critTxt = crit ? " <b>CRIT!</b>" : "";
    const effTxt = effMult > 1 ? " <i>(super effective)</i>" : effMult < 1 ? " <i>(resisted)</i>" : "";
    this.log(`${label} ${this.enemy.name} for <b>${dmg}</b> damage.${critTxt}${effTxt}`, "combat");

    // lifesteal
    if (this.player.lifesteal > 0) {
      const back = Math.max(1, Math.round(dmg * this.player.lifesteal));
      this.player.heal(back);
      this.log(`You drain ${back} HP.`, "heal");
    }
    // status application — forced (from an ability) or elemental (from weapon)
    if (forceStatus) this._setStatus(forceStatus, dmg, statusChance);
    else this._applyStatus(element, dmg);

    if (this.enemy.hp <= 0) {
      this.enemy.hp = 0;
      this.log(`${this.enemy.name} is slain!`, "gold");
      this._finish("victory");
    }
  }

  /** Apply a specific status with a given chance (used by abilities). */
  _setStatus(name, dmg, chance = 1) {
    if (!this.rng.chance(chance)) return;
    const s = this.enemy.statuses;
    if (name === "burn") { s.burn = { turns: 3, dmg: Math.max(2, Math.round(dmg * 0.2)) }; this.log(`${this.enemy.name} is set ablaze!`, "system"); }
    else if (name === "chill") { s.chill = { turns: 2 }; this.log(`${this.enemy.name} is chilled, its blows weakened.`, "system"); }
    else if (name === "shock") { s.shock = { turns: 2 }; this.log(`${this.enemy.name} is shocked and may seize up!`, "system"); }
    else if (name === "wither") { this.enemy.defense = Math.max(0, Math.round(this.enemy.defense * 0.85)); this.log(`${this.enemy.name}'s guard withers.`, "system"); }
  }

  /** Chance-based status from the weapon's element. */
  _applyStatus(element, dmg) {
    if (element === "fire") this._setStatus("burn", dmg, 0.5);
    else if (element === "ice") this._setStatus("chill", dmg, 0.5);
    else if (element === "lightning") this._setStatus("shock", dmg, 0.35);
    else if (element === "shadow") this._setStatus("wither", dmg, 0.4);
  }

  _enemyTurn() {
    if (this.over) return;
    const e = this.enemy;
    const s = e.statuses;

    // burn DoT
    if (s.burn) {
      e.hp -= s.burn.dmg;
      this.log(`${e.name} burns for ${s.burn.dmg}.`, "system");
      if (--s.burn.turns <= 0) delete s.burn;
      if (e.hp <= 0) { e.hp = 0; this.log(`${e.name} succumbs to its burns!`, "gold"); return this._finish("victory"); }
    }

    // shock stun
    if (s.shock) {
      const stunned = this.rng.chance(0.4);
      if (--s.shock.turns <= 0) delete s.shock;
      if (stunned) { this.log(`${e.name} is stunned and cannot act!`, "system"); return; }
    }

    // dodge
    if (this.rng.chance(this.player.dodge)) {
      this.log(`You dodge ${e.name}'s attack!`, "success");
    } else {
      let atk = e.attack;
      if (s.chill) { atk = Math.round(atk * 0.75); if (--s.chill.turns <= 0) delete s.chill; }
      const roll = this.rng.damageRoll(atk, { variance: 0.15, critChance: 0.05, critMult: 1.5 });
      let dmg = roll.value;
      if (e.element !== "physical") dmg = Math.round(dmg * 1.0); // enemies don't get matchup bonus vs player for simplicity
      dmg = Math.max(1, Math.round(dmg * (1 - mitigation(this.player.defense))));
      this.player.hp -= dmg;
      const critTxt = roll.crit ? " <b>CRIT!</b>" : "";
      this.log(`${e.name} hits you for <b>${dmg}</b>.${critTxt}`, "enemy");
      if (!this.player.isAlive()) { this.player.hp = 0; return this._finish("defeat"); }
    }

    // small resource regen per turn
    this.player.restoreResource(8);
  }

  _finish(outcome) {
    if (this.over) return;
    this.over = true;
    this.onEnd?.(outcome, this.enemy);
  }
}
