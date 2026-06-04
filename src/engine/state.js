/**
 * Player + run state. The Player owns raw progression data (level, xp, gold,
 * attributes, inventory, equipment) and derives combat stats on demand via
 * recalc(). Derived values are never persisted — only the raw data is saved.
 */

export const SLOTS = [
  "weapon", "offhand", "hat", "armor", "pants", "gloves", "boots", "necklace", "ring",
];

export const ATTRS = ["str", "agi", "int", "vit", "luck"];

/** Which attribute each class converts into attack power. */
const SCALE_STAT = { warrior: "str", rogue: "agi", mage: "int", cleric: "int" };

export const SAVE_VERSION = 2;

export class Player {
  constructor(name, classDef) {
    this.name = name;
    this.classId = classDef.id;
    this.level = 1;
    this.xp = 0;
    this.gold = 60;
    this.shards = 3;
    this.essence = 1;
    this.location = "enchanted_forest";
    this.inventory = [];
    this.equipment = Object.fromEntries(SLOTS.map((s) => [s, null]));
    this.resource = classDef.resourceMax ?? 100;
    this.kills = 0;

    // Snapshot the class definition we need at runtime so saves are self-contained.
    this._class = classDef;
    this.hp = 1;
    this.recalc();
    this.hp = this.maxHp;
    this.resource = this.resourceMax;
  }

  get classDef() {
    return this._class;
  }

  /** XP required to reach the next level. */
  get xpToNext() {
    return Math.floor(80 * Math.pow(this.level, 1.45));
  }

  /** Base attributes from class + per-level growth (before gear). */
  baseAttrs() {
    const c = this._class;
    const out = {};
    for (const a of ATTRS) {
      out[a] = (c.base[a] ?? 0) + (c.growth[a] ?? 0) * (this.level - 1);
    }
    return out;
  }

  /** Sum a stat key across all equipped items. */
  gearStat(key) {
    let total = 0;
    for (const slot of SLOTS) {
      const item = this.equipment[slot];
      if (item?.stats?.[key]) total += item.stats[key];
      // "allStats" affixes contribute to every attribute.
      if (ATTRS.includes(key) && item?.stats?.allStats) total += item.stats.allStats;
    }
    return total;
  }

  /** Recompute every derived combat value. Call after any gear/level change. */
  recalc() {
    const base = this.baseAttrs();
    this.attrs = {};
    for (const a of ATTRS) this.attrs[a] = Math.round(base[a] + this.gearStat(a));

    const c = this._class;
    this.resourceMax = c.resourceMax ?? 100;
    this.resourceName = c.resourceName ?? "Resource";
    this.maxHp = Math.round(20 + this.attrs.vit * (c.hpPerVit ?? 10) + this.gearStat("hp"));

    const scaleStat = SCALE_STAT[this.classId] ?? "str";
    const scaleVal = this.attrs[scaleStat];

    const weaponDmg = this.gearStat("dmg");
    this.scaleStat = scaleStat;
    this.attackPower = Math.max(1, Math.round(1 + weaponDmg + scaleVal * 0.6));
    this.defense = Math.round(this.gearStat("def") + this.attrs.vit * 0.25);
    this.critChance = clamp(0.05 + this.attrs.agi * 0.004 + this.attrs.luck * 0.003 + this.gearStat("crit"), 0, 0.85);
    this.critMult = 1.75 + this.gearStat("critDmg");
    this.dodge = clamp(this.attrs.agi * 0.003 + this.attrs.luck * 0.0025 + this.gearStat("dodge"), 0, 0.5);
    this.lifesteal = clamp(this.gearStat("lifesteal"), 0, 0.75);
    this.elemDmg = this.gearStat("elemDmg");
    this.element = this.equipment.weapon?.stats?.element ?? "physical";

    if (this.hp > this.maxHp) this.hp = this.maxHp;
    if (this.resource > this.resourceMax) this.resource = this.resourceMax;
  }

  isAlive() {
    return this.hp > 0;
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + Math.round(amount));
  }

  healPct(pct) {
    this.heal(this.maxHp * pct);
  }

  restoreResource(amount) {
    this.resource = Math.min(this.resourceMax, this.resource + Math.round(amount));
  }

  /** Returns { leveledTo } if a level (or several) was gained, else null. */
  gainXp(amount) {
    this.xp += amount;
    let levels = 0;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      levels++;
    }
    if (levels > 0) {
      this.recalc();
      this.hp = this.maxHp;
      this.resource = this.resourceMax;
      return { leveledTo: this.level, levels };
    }
    return null;
  }

  // --- inventory helpers ---
  addItem(item) {
    this.inventory.push(item);
  }

  removeItem(uid) {
    const i = this.inventory.findIndex((it) => it.uid === uid);
    if (i === -1) return null;
    return this.inventory.splice(i, 1)[0];
  }

  findItem(uid) {
    return this.inventory.find((it) => it.uid === uid) ?? null;
  }

  // --- persistence ---
  toJSON() {
    return {
      version: SAVE_VERSION,
      name: this.name,
      classId: this.classId,
      level: this.level,
      xp: this.xp,
      gold: this.gold,
      shards: this.shards,
      essence: this.essence,
      location: this.location,
      inventory: this.inventory,
      equipment: this.equipment,
      hp: this.hp,
      resource: this.resource,
      kills: this.kills,
    };
  }

  static fromJSON(raw, classDef) {
    const p = new Player(raw.name, classDef);
    Object.assign(p, {
      level: raw.level ?? 1,
      xp: raw.xp ?? 0,
      gold: raw.gold ?? 0,
      shards: raw.shards ?? 0,
      essence: raw.essence ?? 0,
      location: raw.location ?? "enchanted_forest",
      inventory: raw.inventory ?? [],
      equipment: { ...Object.fromEntries(SLOTS.map((s) => [s, null])), ...(raw.equipment ?? {}) },
      kills: raw.kills ?? 0,
    });
    p.recalc();
    p.hp = clamp(raw.hp ?? p.maxHp, 1, p.maxHp);
    p.resource = clamp(raw.resource ?? p.resourceMax, 0, p.resourceMax);
    return p;
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
