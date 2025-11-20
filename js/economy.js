/**
 * MODULE: THE LEDGER
 * Manages items, prices, and the shop.
 */
class EconomyModule {
    constructor() {
        // Advanced: Added sell value and rarity indicator
        this.shopInventory = [
            { id: 'ration', name: 'Stale Bread', cost: 5, sell: 1, type: 'consumable', heal: 10, desc: "Hard as a rock, but edible." },
            { id: 'potion', name: 'Herbal Brew', cost: 25, sell: 5, type: 'consumable', heal: 50, desc: "Smells like bog water. Heals wounds." },
            { id: 'dagger', name: 'Iron Dagger', cost: 50, sell: 10, type: 'weapon', dmg: 5, desc: "Simple, rusty, sharp enough." },
            { id: 'sword', name: 'Damascus Blade', cost: 300, sell: 150, type: 'weapon', dmg: 15, desc: "Folded steel. A king's weapon." },
            { id: 'chain', name: 'Rusted Chainmail', cost: 100, sell: 25, type: 'armor', def: 3, desc: "Better than skin." },
            { id: 'plate', name: 'Knight\'s Plate', cost: 500, sell: 200, type: 'armor', def: 8, desc: "Heavy steel used by the King's Guard." }
        ];
    }

    getItem(id) {
        return this.shopInventory.find(i => i.id === id);
    }

    formatGold(amount) {
        return `${amount} Sovereigns`;
    }

    getSellValue(item) {
        return item.sell || Math.floor(item.cost / 4);
    }
}