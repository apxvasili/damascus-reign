/**
 * THE FATES — all randomness in Damascus Reign flows through here.
 *
 * Backed by a seedable mulberry32 PRNG so runs can (optionally) be reproduced.
 * If no seed is given it falls back to crypto/Math.random entropy.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function entropySeed() {
  if (globalThis.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }
  return Math.floor(Math.random() * 0xffffffff);
}

export class RNG {
  constructor(seed) {
    this.seed = seed ?? entropySeed();
    this._next = mulberry32(this.seed);
  }

  /** Float in [0, 1). */
  float() {
    return this._next();
  }

  /** Integer in [min, max] inclusive. */
  range(min, max) {
    return Math.floor(this._next() * (max - min + 1)) + min;
  }

  /** Classic die: 1..sides. */
  roll(sides) {
    return this.range(1, sides);
  }

  /** True with probability p (0..1). */
  chance(p) {
    return this._next() < p;
  }

  /** Random element of an array. */
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }

  /** Float in [lo, hi). */
  between(lo, hi) {
    return lo + this._next() * (hi - lo);
  }

  /**
   * Weighted pick. `entries` is an array of objects each carrying a numeric
   * `weight` (or a [item, weight] pair). Returns the chosen item.
   * Optional `weightFn` derives the weight from an entry.
   */
  weighted(entries, weightFn = (e) => e.weight) {
    let total = 0;
    for (const e of entries) total += Math.max(0, weightFn(e));
    if (total <= 0) return entries[0];
    let r = this._next() * total;
    for (const e of entries) {
      r -= Math.max(0, weightFn(e));
      if (r < 0) return e;
    }
    return entries[entries.length - 1];
  }

  /**
   * Damage roll with variance and crit. Returns { value, crit }.
   * variance is +/- fraction (0.15 = ±15%).
   */
  damageRoll(base, { variance = 0.15, critChance = 0.05, critMult = 1.75 } = {}) {
    const v = 1 + this.between(-variance, variance);
    let value = base * v;
    const crit = this.chance(critChance);
    if (crit) value *= critMult;
    return { value: Math.max(1, Math.round(value)), crit };
  }
}

/** Shared default generator for casual use. */
export const rng = new RNG();
