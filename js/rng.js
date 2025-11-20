/**
 * MODULE: THE FATES
 * Handles all probability, dice rolls, and math logic.
 */
class RNGModule {
    constructor() {}

    /**
     * Standard dice roll (1 to sides)
     * @param {number} sides - Max value
     */
    roll(sides) {
        return Math.floor(Math.random() * sides) + 1;
    }

    /**
     * Get random integer between min and max (inclusive)
     */
    range(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * Boolean success check based on probability (0.0 to 1.0)
     */
    check(chance) {
        return Math.random() < chance;
    }
    
    /**
     * Pick random element from an array
     */
    pick(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    /**
     * Calculates damage with a potential critical hit
     * @param {number} baseDmg 
     * @param {number} critChance (0-1)
     * @param {number} critMultiplier 
     */
    calcDamage(baseDmg, critChance = 0.05, critMultiplier = 2.0) {
        const isCrit = this.check(critChance);
        // variance of -1 to +2
        const variance = this.range(-1, 2);
        let total = baseDmg + variance;
        
        if (isCrit) {
            total = Math.floor(total * critMultiplier);
        }
        
        return { dmg: Math.max(1, total), isCrit };
    }
}