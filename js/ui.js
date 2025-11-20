/**
 * MODULE: THE SCRIBE
 * Handles DOM manipulation, rendering, and visual feedback.
 */
class UIModule {
    constructor() {
        this.output = document.getElementById('output');
        this.input = document.getElementById('cmd-input');
        this.statsContent = document.getElementById('stats-content');
        this.helpContent = document.getElementById('help-content');
        this.locationHeader = document.getElementById('location-header');
    }

    // --- MAIN TERMINAL ---

    print(text, type = '') {
        const div = document.createElement('div');
        div.textContent = text;
        if (type) div.className = `msg-${type}`;
        this.output.appendChild(div);
        this.scrollToBottom();
    }

    printArt(text) {
        const pre = document.createElement('pre');
        pre.textContent = text;
        pre.className = 'header-art';
        this.output.appendChild(pre);
        this.scrollToBottom();
    }

    scrollToBottom() {
        this.output.scrollTop = this.output.scrollHeight;
    }

    clear() {
        this.output.innerHTML = '';
    }

    focus() {
        this.input.focus();
    }

    // --- SIDE PANELS & HEADERS ---

    updateLocationHeader(location) {
        this.locationHeader.textContent = `LOCATION: ${location.toUpperCase()}`;
        // Visual cue: change border color based on safety?
        this.locationHeader.style.borderColor = location === 'town' ? '#558b2f' : '#a03030';
    }

    updateStats(player) {
        // Rebuild stats panel
        let html = '';
        
        html += this.createStatRow('Name', player.name);
        html += this.createStatRow('Level', player.level);
        html += this.createStatRow('XP', `${player.xp}/${player.level * 100}`);
        html += `<div style="margin: 10px 0; border-bottom: 1px dashed #444;"></div>`;
        
        // HP Bar in Stats Panel
        const hpPct = Math.floor((player.hp / player.maxHp) * 100);
        const hpColor = hpPct < 30 ? 'var(--danger)' : 'var(--success)';
        html += `<div class="stat-row"><span class="stat-label">Health</span> <span class="stat-val" style="color:${hpColor}">${player.hp}/${player.maxHp}</span></div>`;
        html += `<div style="width:100%; height:6px; background:#333; margin-bottom:10px;"><div style="width:${hpPct}%; height:100%; background:${hpColor}; transition: width 0.3s;"></div></div>`;

        html += this.createStatRow('Gold', player.gold, 'var(--highlight)');
        html += `<div style="margin: 10px 0; border-bottom: 1px dashed #444;"></div>`;
        
        html += this.createStatRow('Weapon', player.weapon.name);
        html += this.createStatRow('Dmg', player.weapon.dmg);
        html += this.createStatRow('Armor', player.armor.name);
        html += this.createStatRow('Def', player.armor.def);

        this.statsContent.innerHTML = html;
    }

    createStatRow(label, val, color = '') {
        const style = color ? `style="color:${color}"` : '';
        return `<div class="stat-row"><span class="stat-label">${label}</span> <span class="stat-val" ${style}>${val}</span></div>`;
    }

    renderCommandList(commands) {
        let html = '';
        for (const [key, data] of Object.entries(commands)) {
            html += `
                <div class="cmd-entry">
                    <span class="cmd-name">${key}</span>
                    <span class="cmd-desc">${data.desc}</span>
                </div>
            `;
        }
        this.helpContent.innerHTML = html;
    }

    // Keep renderHealthBar for combat logs if needed, though panel is primary now
    renderHealthBar(current, max) {
        // Optional: could still print to log for dramatic effect
    }
}