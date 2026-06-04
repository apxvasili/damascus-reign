/**
 * The two side panels: the Chronicle (left — live character sheet + combat
 * readout) and the Codex (right — grouped command reference).
 */
import { bar, itemNameHtml } from "./render.js";

export class Panels {
  constructor() {
    this.stats = document.getElementById("stats-content");
    this.codex = document.getElementById("help-content");
    this.header = document.getElementById("location-header");
  }

  setHeader(text, danger = false) {
    this.header.textContent = text;
    this.header.classList.toggle("danger", danger);
  }

  empty() {
    this.stats.innerHTML = `<div class="muted">No active chronicle.</div>`;
  }

  update(player, data, { enemy = null, zone = null } = {}) {
    if (!player) return this.empty();
    const hpPct = Math.round((player.hp / player.maxHp) * 100);
    const hpColor = hpPct < 30 ? "var(--danger)" : hpPct < 60 ? "#d4a017" : "var(--success)";
    const xpPct = Math.round((player.xp / player.xpToNext) * 100);
    const resPct = Math.round((player.resource / player.resourceMax) * 100);

    const eq = player.equipment;
    const wpn = eq.weapon ? itemNameHtml(eq.weapon, data) : '<span class="muted">unarmed</span>';

    let html = `
      <div class="sheet-name">${player.name}</div>
      <div class="sheet-sub">Lvl ${player.level} ${player.classDef.name}</div>
      <div class="meter"><span class="meter-label">HP</span> ${bar(hpPct, hpColor, 16)} <span class="meter-num">${player.hp}/${player.maxHp}</span></div>
      <div class="meter"><span class="meter-label">${player.resourceName.slice(0, 4)}</span> ${bar(resPct, "#4aa3ff", 16)} <span class="meter-num">${player.resource}/${player.resourceMax}</span></div>
      <div class="meter"><span class="meter-label">XP</span> ${bar(xpPct, "#b06bff", 16)} <span class="meter-num">${player.xp}/${player.xpToNext}</span></div>
      <div class="divider"></div>
      <div class="stat-row"><span class="stat-label">Gold</span> <span class="stat-val msg-gold">${player.gold}</span></div>
      <div class="stat-row"><span class="stat-label">Shards</span> <span class="stat-val">${player.shards}</span></div>
      <div class="stat-row"><span class="stat-label">Essence</span> <span class="stat-val">${player.essence}</span></div>
      <div class="divider"></div>
      <div class="stat-row"><span class="stat-label">STR</span><span class="stat-val">${player.attrs.str}</span> <span class="stat-label">AGI</span><span class="stat-val">${player.attrs.agi}</span></div>
      <div class="stat-row"><span class="stat-label">INT</span><span class="stat-val">${player.attrs.int}</span> <span class="stat-label">VIT</span><span class="stat-val">${player.attrs.vit}</span></div>
      <div class="stat-row"><span class="stat-label">LUCK</span><span class="stat-val">${player.attrs.luck}</span> <span class="stat-label">ATK</span><span class="stat-val">${player.attackPower}</span></div>
      <div class="stat-row"><span class="stat-label">DEF</span><span class="stat-val">${player.defense}</span> <span class="stat-label">CRIT</span><span class="stat-val">${Math.round(player.critChance * 100)}%</span></div>
      <div class="divider"></div>
      <div class="stat-row"><span class="stat-label">Weapon</span></div>
      <div class="equip-line">${wpn}</div>
    `;

    if (enemy) {
      const ehp = Math.round((enemy.hp / enemy.maxHp) * 100);
      const el = data.elements[enemy.element];
      html += `
        <div class="divider danger-divider"></div>
        <div class="enemy-name">${enemy.boss ? "☠ " : ""}${enemy.name}</div>
        <div class="sheet-sub">Lvl ${enemy.level}${el && enemy.element !== "physical" ? ` · <span style="color:${el.color}">${el.name}</span>` : ""}</div>
        <div class="meter"><span class="meter-label">HP</span> ${bar(ehp, "var(--danger)", 16)} <span class="meter-num">${enemy.hp}/${enemy.maxHp}</span></div>
      `;
    }

    this.stats.innerHTML = html;
  }

  renderCodex(grouped) {
    let html = "";
    for (const [group, defs] of grouped) {
      html += `<div class="codex-group">${group}</div>`;
      for (const def of defs) {
        html += `<div class="cmd-entry"><span class="cmd-name">${def.usage ?? def.name}</span><span class="cmd-desc">${def.desc}</span></div>`;
      }
    }
    this.codex.innerHTML = html;
  }
}
