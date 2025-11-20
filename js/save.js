
class SaveModule {
    constructor() {
        this.saves = this.loadSaves();
    }

    loadSaves() {
        const saves = localStorage.getItem('damascus_reign_saves');
        return saves ? JSON.parse(saves) : {};
    }

    saveGame(player) {
        this.saves[player.name] = player;
        localStorage.setItem('damascus_reign_saves', JSON.stringify(this.saves));
    }

    loadGame(playerName) {
        return this.saves[playerName];
    }

    deleteSave(playerName) {
        delete this.saves[playerName];
        localStorage.setItem('damascus_reign_saves', JSON.stringify(this.saves));
    }

    getSaves() {
        return Object.keys(this.saves);
    }
}
