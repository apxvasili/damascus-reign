/**
 * The two side panels: the Chronicle (left — live character sheet + combat
 * readout) and the Codex (right — grouped command reference).
 */
import { bar, itemNameHtml } from "./render.js";
import { itemPower } from "../systems/items.js";

const STATUS_ICON = { burn: "🔥", chill: "❄", shock: "⚡" };

export class Panels {
  constructor() {
    this.stats = document.getElementById("stats-content");
    this.codex = document.getElementById("help-content");
    this.header = document.getElementById("location-header");
    this._lastHp = null;
    this._lastEnemyHp = null;
    this._lastEnemyId = null;
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
    const off = eq.offhand ? itemNameHtml(eq.offhand, data) : null;

    // Weapon element + gear "set power" (sum of equipped item power).
    const wel = eq.weapon && data.elements[eq.weapon.stats?.element] && eq.weapon.stats.element !== "physical"
      ? ` <span style="color:${data.elements[eq.weapon.stats.element].color}">◈ ${data.elements[eq.weapon.stats.element].name}</span>` : "";
    let setPower = 0;
    for (const s of Object.values(eq)) if (s && s.stats) setPower += itemPower(s);

    const diff = data.difficulties.levels.find((d) => d.id === player.difficulty);
    const diffTag = diff ? ` <span style="color:${diff.color}">[${diff.name}]</span>${player.hardcore ? ' <span style="color:var(--danger)">☠</span>' : ""}` : "";
    const spLine = player.skillPoints > 0
      ? `<div class="stat-row"><span class="stat-label">Skill pts</span> <span class="stat-val" style="color:var(--highlight)">${player.skillPoints} ◆</span></div>`
      : "";

    // Damage flash: pulse the HP bar when it drops since last render.
    const hpHit = this._lastHp != null && player.hp < this._lastHp ? " hit" : "";
    this._lastHp = player.hp;

    const lifeRow = player.lifesteal ? ` <span class="stat-label">LFS</span><span class="stat-val">${Math.round(player.lifesteal * 100)}%</span>` : ` <span class="stat-label">DDG</span><span class="stat-val">${Math.round(player.dodge * 100)}%</span>`;

    let html = `
      <div class="sheet-name">${player.name}${diffTag}</div>
      <div class="sheet-sub">Lvl ${player.level} ${player.classDef.name}</div>
      <div class="meter${hpHit}"><span class="meter-label">HP</span> ${bar(hpPct, hpColor, 16)} <span class="meter-num">${player.hp}/${player.maxHp}</span></div>
      <div class="meter"><span class="meter-label">${player.resourceName.slice(0, 4)}</span> ${bar(resPct, "#4aa3ff", 16)} <span class="meter-num">${player.resource}/${player.resourceMax}</span></div>
      <div class="meter"><span class="meter-label">XP</span> ${bar(xpPct, "#b06bff", 16)} <span class="meter-num">${player.xp}/${player.xpToNext}</span></div>
      ${spLine}
      <div class="divider"></div>
      <div class="stat-row"><span class="stat-label">Gold</span> <span class="stat-val msg-gold">${player.gold}</span> <span class="stat-label">Shards</span><span class="stat-val">${player.shards}</span> <span class="stat-label">Ess</span><span class="stat-val">${player.essence}</span></div>
      <div class="divider"></div>
      <div class="stat-row"><span class="stat-label">STR</span><span class="stat-val">${player.attrs.str}</span> <span class="stat-label">AGI</span><span class="stat-val">${player.attrs.agi}</span> <span class="stat-label">INT</span><span class="stat-val">${player.attrs.int}</span></div>
      <div class="stat-row"><span class="stat-label">VIT</span><span class="stat-val">${player.attrs.vit}</span> <span class="stat-label">LCK</span><span class="stat-val">${player.attrs.luck}</span> <span class="stat-label">CRT</span><span class="stat-val">${Math.round(player.critChance * 100)}%</span></div>
      <div class="stat-row"><span class="stat-label">ATK</span><span class="stat-val">${player.attackPower}</span> <span class="stat-label">DEF</span><span class="stat-val">${player.defense}</span>${lifeRow}</div>
      <div class="divider"></div>
      <div class="stat-row"><span class="stat-label">Gear</span> <span class="stat-val" title="combined item power">⚔ ${setPower}</span></div>
      <div class="equip-line">${wpn}${wel}</div>
      ${off ? `<div class="equip-line cmd-desc">off: ${off}</div>` : ""}
    `;

    if (enemy) {
      // reset enemy flash baseline when a new fight starts
      if (this._lastEnemyId !== enemy.id + enemy.name) { this._lastEnemyHp = null; this._lastEnemyId = enemy.id + enemy.name; }
      const ehp = Math.round((enemy.hp / enemy.maxHp) * 100);
      const el = data.elements[enemy.element];
      const ehpHit = this._lastEnemyHp != null && enemy.hp < this._lastEnemyHp ? " hit" : "";
      this._lastEnemyHp = enemy.hp;
      const tags = Object.keys(enemy.statuses || {})
        .filter((k) => STATUS_ICON[k])
        .map((k) => `<span class="status-tag status-${k}">${STATUS_ICON[k]} ${k}</span>`)
        .join(" ");
      html += `
        <div class="divider danger-divider"></div>
        <div class="enemy-name">${enemy.boss ? "☠ " : ""}${enemy.name}</div>
        <div class="sheet-sub">Lvl ${enemy.level}${el && enemy.element !== "physical" ? ` · <span style="color:${el.color}">${el.name}</span>` : ""}</div>
        <div class="meter${ehpHit}"><span class="meter-label">HP</span> ${bar(ehp, "var(--danger)", 16)} <span class="meter-num">${enemy.hp}/${enemy.maxHp}</span></div>
        ${tags ? `<div class="status-row">${tags}</div>` : ""}
      `;
    } else {
      this._lastEnemyHp = null;
      this._lastEnemyId = null;
    }

    // low-HP screen vignette
    document.body.classList.toggle("low-hp", player.isAlive() && hpPct < 25);

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
