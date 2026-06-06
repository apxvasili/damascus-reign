/**
 * DAMASCUS REIGN — game orchestrator.
 *
 * Owns the state machine (MENU → IDLE → COMBAT / ENCOUNTER / BUSY), wires every
 * command to its system, and routes combat/encounter resolution. Systems stay
 * pure-ish; this file is the glue and the place state transitions happen.
 */
import { RNG } from "./engine/rng.js";
import { loadGameData } from "./engine/data.js";
import { CommandRegistry } from "./engine/commands.js";
import { Player, SLOTS } from "./engine/state.js";
import { Terminal } from "./ui/terminal.js";
import { Panels } from "./ui/panels.js";
import { itemLine, itemDetail, itemNameHtml, esc } from "./ui/render.js";
import { listClasses, getClass, grantStartingKit } from "./systems/classes.js";
import { displayName, generateItem, itemPower, sellValue, rarityOf } from "./systems/items.js";
import { CombatSession, makeEnemy } from "./systems/combat.js";
import { forge, forgeInfo } from "./systems/forge.js";
import { enchant, enchantInfo } from "./systems/enchant.js";
import { rollStock, buy, sell } from "./systems/shop.js";
import { rollEvent, resolveChoice, narrationPrompt } from "./systems/encounters.js";
import { SaveManager } from "./systems/save.js";
import { AINarrator, PROVIDERS } from "./systems/ai.js";
import { allSkills, skillById, skillStatus, unlockSkill, applySkillMods, unlockedAbilities, visibleSkills } from "./systems/skills.js";
import * as Mining from "./systems/mining.js";

const STATE = { MENU: "MENU", IDLE: "IDLE", COMBAT: "COMBAT", ENCOUNTER: "ENCOUNTER", BUSY: "BUSY", SKILLS: "SKILLS", MINE: "MINE" };

// Human slot labels (as shown by `gear`) map back to their internal slot key, so
// `unequip feet` works as well as `unequip boots`.
const SLOT_ALIASES = {
  head: "hat", chest: "armor", legs: "pants", hands: "gloves", feet: "boots",
  neck: "necklace", "off-hand": "offhand", mainhand: "weapon",
};

const TITLE_ART = String.raw`
 ▓█████▄  ▄▄▄       ███▄ ▄███▓ ▄▄▄        ██████  ▄████▄   █    ██   ██████
 ▒██▀ ██▌▒████▄    ▓██▒▀█▀ ██▒▒████▄    ▒██    ▒ ▒██▀ ▀█   ██  ▓██▒▒██    ▒
 ░██   █▌▒██  ▀█▄  ▓██    ▓██░▒██  ▀█▄  ░ ▓██▄   ▒▓█    ▄ ▓██  ▒██░░ ▓██▄
 ░▓█▄   ▌░██▄▄▄▄██ ▒██    ▒██ ░██▄▄▄▄██   ▒   ██▒▒▓▓▄ ▄██▒▓▓█  ░██░  ▒   ██▒
 ░▒████▓  ▓█   ▓██▒▒██▒   ░██▒ ▓█   ▓██▒▒██████▒▒▒ ▓███▀ ░▒▒█████▓ ▒██████▒▒
  ▒▒▓  ▒  ▒▒   ▓▒█░░ ▒░   ░  ░ ▒▒   ▓▒█░▒ ▒▓▒ ▒ ░░ ░▒ ▒  ░░▒▓▒ ▒ ▒ ▒ ▒▓▒ ▒ ░
              R E I G N   O F   I R O N   A N D   D U S T`;

class Game {
  constructor() {
    this.term = new Terminal();
    this.panels = new Panels();
    this.registry = new CommandRegistry();
    this.rng = new RNG();
    this.ai = new AINarrator();
    this.state = STATE.MENU;
    this.player = null;
    this.combat = null;
    this.encounter = null;
    this.shopStock = null;
  }

  log(msg, cls) { return this.term.print(msg, cls); }

  // ---- ctx interface used by the registry ----
  getState() { return this.state; }
  stateHint(def, state) {
    if (state === STATE.MENU) return `You must load or create a character first. Try "help".`;
    if (state === STATE.COMBAT) return `You're in combat! Valid: attack, ability, use <n>, flee.`;
    if (state === STATE.ENCOUNTER) return `Resolve the encounter first — pick a number (e.g. "1").`;
    if (state === STATE.SKILLS) return `You're in the skill tree — unlock <n> or back.`;
    if (state === STATE.MINE) return `You're in the mine — dig, craft, smelt, ores, upgrade, or leave.`;
    if (state === STATE.BUSY) return `You're occupied right now…`;
    return `That command isn't available right now.`;
  }

  async boot() {
    this.term.bind((line) => this.handleInput(line));
    this.term.art(TITLE_ART);
    this.log("Loading the realm…", "system");
    try {
      this.data = await loadGameData();
    } catch (err) {
      this.log(`FATAL: could not load game data. ${esc(err.message)}`, "error");
      this.log(`This game must be served over HTTP. From the project folder run:`, "system");
      this.log(`<b>python3 -m http.server 8080</b> &nbsp;then open&nbsp; <b>http://localhost:8080</b>`, "system");
      return;
    }
    this.save = new SaveManager(this.data);
    this.version = this.data.version?.version ?? "0.0.0";
    this.registerCommands();
    this.term.setCompleter((line) => this.complete(line));
    this.panels.renderCodex(this.registry.grouped());
    this.refresh();
    this.showMenu();
    this.term.focus();
    this.startUpdateWatch();
  }

  handleInput(line) {
    this.term.echo(line);
    const res = this.registry.dispatch(line, this);
    if (!res.ok && res.error) this.log(res.error, "error");
    this.refresh();
  }

  refresh() {
    const enemy = this.state === STATE.COMBAT ? this.combat?.enemy : null;
    const zone = this.player ? this.zoneOf(this.player.location) : null;
    this.panels.update(this.player, this.data, { enemy, zone });
    if (!this.player) { this.panels.setHeader("CHARACTER SELECT"); this.term.setPrompt("Reign:>"); return; }
    if (this.state === STATE.COMBAT) this.panels.setHeader(`COMBAT — ${this.combat.enemy.name}`, true);
    else if (this.state === STATE.ENCOUNTER) this.panels.setHeader(this.encounter.event.title.toUpperCase());
    else if (this.state === STATE.SKILLS) this.panels.setHeader("SKILL TREE");
    else if (this.state === STATE.MINE) this.panels.setHeader(`THE MINE — depth ${this.player.mineDepth}m`);
    else this.panels.setHeader(zone ? zone.name : "THE WILDS");
    this.term.setPrompt(`${this.player.name}:>`);
  }

  zoneOf(id) { return this.data.zones.find((z) => z.id === id); }

  // ---- difficulty helpers ----
  diffDef(id) {
    return this.data.difficulties.levels.find((d) => d.id === id) ?? this.data.difficulties.levels.find((d) => d.id === this.data.difficulties.default);
  }

  diffTag(id, hardcore) {
    const d = this.diffDef(id);
    const hc = hardcore ? ` <span style="color:var(--danger)">☠HC</span>` : "";
    return `<span style="color:${d.color}">[${d.name}]</span>${hc}`;
  }

  /** Combined run modifiers from difficulty + hardcore. */
  diffMods() {
    const d = this.diffDef(this.player.difficulty);
    const hc = this.data.difficulties.hardcore;
    const hardcore = this.player.hardcore;
    return {
      mobHp: d.mobHp,
      mobDmg: d.mobDmg,
      // loot/xp/gold stack difficulty * hardcore (hardcore neutral when off)
      loot: d.loot * (hardcore ? hc.loot : 1),
      xp: d.xp * (hardcore ? hc.xp : 1),
      gold: d.gold,
    };
  }

  // =================== COMMAND REGISTRATION ===================
  registerCommands() {
    const r = this.registry;

    // --- character / menu ---
    r.register({ name: "new", usage: "new <class> <name>", desc: "Create a character.", group: "Character", states: [STATE.MENU], run: (a) => this.cmdNew(a) });
    r.register({ name: "load", usage: "load <name>", desc: "Load a saved character.", group: "Character", states: [STATE.MENU], run: (a) => this.cmdLoad(a) });
    r.register({ name: "delete", usage: "delete <name>", desc: "Delete a save.", group: "Character", states: [STATE.MENU], run: (a) => this.cmdDelete(a) });
    r.register({ name: "saves", desc: "List saved characters.", group: "Character", states: [STATE.MENU], run: () => this.showMenu() });
    r.register({ name: "classes", desc: "Show available classes.", group: "Character", run: () => this.cmdClasses() });

    // --- exploration ---
    r.register({ name: "look", aliases: ["l"], desc: "Describe your surroundings.", group: "World", states: [STATE.IDLE], run: () => this.cmdLook() });
    r.register({ name: "zones", aliases: ["map"], desc: "List all zones.", group: "World", states: [STATE.IDLE], run: () => this.cmdZones() });
    r.register({ name: "travel", usage: "travel <zone>", aliases: ["go"], desc: "Travel to a zone.", group: "World", states: [STATE.IDLE], run: (a) => this.cmdTravel(a) });
    r.register({ name: "hunt", aliases: ["h"], desc: "Seek danger — fight or fate.", group: "World", states: [STATE.IDLE], run: () => this.cmdHunt() });
    r.register({ name: "rest", desc: "Recover HP over time.", group: "World", states: [STATE.IDLE], run: () => this.cmdRest() });

    // --- items ---
    r.register({ name: "inventory", aliases: ["inv", "i", "bag"], desc: "List your belongings.", group: "Items", states: [STATE.IDLE], run: () => this.cmdInventory() });
    r.register({ name: "gear", aliases: ["equipped"], desc: "Show equipped gear.", group: "Items", states: [STATE.IDLE], run: () => this.cmdGear() });
    r.register({ name: "inspect", usage: "inspect <n|slot>", aliases: ["look-at"], desc: "Examine an item.", group: "Items", states: [STATE.IDLE], run: (a) => this.cmdInspect(a) });
    r.register({ name: "equip", usage: "equip <n>", aliases: ["wear", "wield"], desc: "Equip an item.", group: "Items", states: [STATE.IDLE], run: (a) => this.cmdEquip(a) });
    r.register({ name: "unequip", usage: "unequip <slot>", aliases: ["remove"], desc: "Unequip a slot.", group: "Items", states: [STATE.IDLE], run: (a) => this.cmdUnequip(a) });
    r.register({ name: "drop", usage: "drop <n>", desc: "Discard an item.", group: "Items", states: [STATE.IDLE], run: (a) => this.cmdDrop(a) });

    // --- skills ---
    r.register({ name: "skills", aliases: ["tree", "talents"], desc: "Open the skill tree.", group: "Skills", states: [STATE.IDLE], run: () => this.cmdSkills() });
    r.register({ name: "unlock", usage: "unlock <n>", desc: "Unlock a skill.", group: "Skills", states: [STATE.SKILLS], run: (a) => this.cmdUnlock(a) });

    // --- mine ---
    r.register({ name: "mine", desc: "Enter the mine.", group: "Mine", states: [STATE.IDLE], run: () => this.cmdMine() });
    r.register({ name: "dig", aliases: ["swing"], desc: "Swing your pickaxe for ore.", group: "Mine", states: [STATE.MINE], run: () => this.cmdDig() });
    r.register({ name: "ores", aliases: ["satchel"], desc: "List your ore satchel.", group: "Mine", states: [STATE.MINE], run: () => this.cmdOres() });
    r.register({ name: "smelt", usage: "smelt <ore|all>", aliases: ["sellore"], desc: "Sell ore for gold.", group: "Mine", states: [STATE.MINE], run: (a) => this.cmdSmelt(a) });
    r.register({ name: "upgrade", aliases: ["forge-pick"], desc: "Forge the next pickaxe tier.", group: "Mine", states: [STATE.MINE], run: () => this.cmdUpgradePick() });
    r.register({ name: "craft", usage: "craft <ore> [slot]", desc: "Smith gear from ore.", group: "Mine", states: [STATE.MINE], run: (a) => this.cmdCraftGear(a) });

    // leave/back exits either the skill tree or the mine
    r.register({ name: "back", aliases: ["exit", "leave"], desc: "Leave this view.", group: "Skills", states: [STATE.SKILLS, STATE.MINE], run: () => this.cmdLeaveView() });

    // --- crafting & economy ---
    r.register({ name: "forge", usage: "forge <n|slot>", desc: "Enhance an item (+N).", group: "Forge", states: [STATE.IDLE], run: (a) => this.cmdForge(a) });
    r.register({ name: "enchant", usage: "enchant <n|slot>", desc: "Roll an affix onto an item.", group: "Forge", states: [STATE.IDLE], run: (a) => this.cmdEnchant(a) });
    r.register({ name: "shop", aliases: ["market"], desc: "Browse the market.", group: "Market", states: [STATE.IDLE], run: () => this.cmdShop() });
    r.register({ name: "buy", usage: "buy <n>", desc: "Buy from the market.", group: "Market", states: [STATE.IDLE], run: (a) => this.cmdBuy(a) });
    r.register({ name: "sell", usage: "sell <n>", desc: "Sell an item from your bag.", group: "Market", states: [STATE.IDLE], run: (a) => this.cmdSell(a) });

    // --- combat ---
    r.register({ name: "attack", aliases: ["a"], desc: "Strike the enemy.", group: "Combat", states: [STATE.COMBAT], run: () => this.cmdAttack() });
    r.register({ name: "ability", usage: "ability [n]", aliases: ["skill", "cast"], desc: "Use an ability (n = which).", group: "Combat", states: [STATE.COMBAT], run: (a) => this.cmdAbility(a) });
    r.register({ name: "abilities", aliases: ["moves"], desc: "List your combat abilities.", group: "Combat", states: [STATE.COMBAT], run: () => this.cmdAbilities() });
    r.register({ name: "flee", aliases: ["run"], desc: "Attempt to escape.", group: "Combat", states: [STATE.COMBAT], run: () => this.cmdFlee() });

    // use works in both field and combat
    r.register({ name: "use", usage: "use <n>", desc: "Use a consumable.", group: "Items", states: [STATE.IDLE, STATE.COMBAT], run: (a) => this.cmdUse(a) });

    // --- encounter ---
    r.register({ name: "choose", usage: "choose <n>", aliases: ["1", "2", "3", "4", "pick"], desc: "Pick an encounter option.", group: "Encounter", states: [STATE.ENCOUNTER], run: (a, ctx, raw) => this.cmdChoose(a, raw) });

    // --- system ---
    r.register({ name: "status", aliases: ["stats", "char"], desc: "Show your character sheet.", group: "System", run: () => this.cmdStatus() });
    r.register({ name: "help", aliases: ["?", "commands"], desc: "Show command help.", group: "System", run: () => this.cmdHelp() });
    r.register({ name: "clear", aliases: ["cls"], desc: "Clear the screen.", group: "System", run: () => this.term.clear() });
    r.register({ name: "save", desc: "Save your progress.", group: "System", states: [STATE.IDLE], run: () => this.cmdSave() });
    r.register({ name: "ai", usage: "ai <provider> <key> [model] | ai off | ai status", desc: "Configure the optional AI narrator.", group: "System", run: (a) => this.cmdAI(a) });
    r.register({ name: "credits", desc: "Who made this.", group: "System", run: () => this.cmdCredits() });
    r.register({ name: "difficulties", aliases: ["modes"], desc: "List difficulty modes.", group: "System", run: () => this.cmdDifficulties() });
    r.register({ name: "update", aliases: ["reload"], desc: "Check for & apply game updates.", group: "System", run: () => this.cmdUpdate() });
    r.register({ name: "version", desc: "Show game version.", group: "System", run: () => this.cmdVersion() });
  }

  // =================== CHARACTER ===================
  showMenu() {
    this.state = STATE.MENU;
    this.player = null;
    this.term.rule("THE CHRONICLES");
    const names = this.save.names();
    if (names.length) {
      this.log("Saved characters:", "gold");
      for (const n of names) {
        const s = this.save.summary(n);
        this.log(`  • <b>${esc(n)}</b> — Lvl ${s.level} ${s.className} ${this.diffTag(s.difficulty, s.hardcore)} <span class="cmd-desc">(${s.kills} kills)</span>`);
      }
      this.log(`Continue with <b>load &lt;name&gt;</b>, or start anew:`, "system");
      this.log(`<b>new &lt;class&gt; &lt;name&gt; [difficulty] [hardcore]</b>`, "gold");
      this.log(`  difficulty: ${this.data.difficulties.levels.map((d) => d.id).join(" / ")} (default ${this.data.difficulties.default}) · add <b>hardcore</b> for permadeath.`, "cmd-desc-line");
      this.log(`  See <b>classes</b> and <b>difficulties</b> for details.`, "cmd-desc-line");
    } else {
      this.log("No chronicles yet. Begin one with:", "system");
      this.log(`<b>new &lt;class&gt; &lt;name&gt; [difficulty] [hardcore]</b>`, "gold");
      this.log(`  difficulty: ${this.data.difficulties.levels.map((d) => d.id).join(" / ")} (default ${this.data.difficulties.default}) · add <b>hardcore</b> for permadeath.`, "cmd-desc-line");
      this.log(`  Browse <b>classes</b> and <b>difficulties</b> first.`, "cmd-desc-line");
    }
    this.refresh();
  }

  cmdClasses() {
    this.term.rule("CLASSES");
    for (const c of listClasses(this.data)) {
      this.log(`<b style="color:var(--highlight)">${c.name}</b> — ${esc(c.blurb)}`, "");
      this.log(`  STR ${c.base.str} · AGI ${c.base.agi} · INT ${c.base.int} · VIT ${c.base.vit} · LUCK ${c.base.luck} · ${c.resourceName}`, "cmd-desc-line");
      this.log(`  Ability — <b>${c.ability.name}</b>: ${esc(c.ability.desc)}`, "cmd-desc-line");
    }
  }

  cmdNew(args) {
    const tokens = args.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      this.log(`Usage: new <class> <name> [difficulty] [hardcore]`, "error");
      this.log(`Classes: ${listClasses(this.data).map((c) => c.id).join(", ")} · Difficulties: ${this.data.difficulties.levels.map((d) => d.id).join(", ")} (see <b>difficulties</b>)`, "cmd-desc-line");
      return;
    }
    const classId = tokens[0].toLowerCase();
    const cls = getClass(this.data, classId);
    if (!cls) return this.log(`Unknown class "${classId}". Options: ${listClasses(this.data).map((c) => c.id).join(", ")}.`, "error");

    // Remaining tokens: name words, plus optional difficulty id and a hardcore flag.
    let difficulty = this.data.difficulties.default;
    let hardcore = false;
    const nameWords = [];
    for (const t of tokens.slice(1)) {
      const tl = t.toLowerCase();
      if (this.data.difficulties.levels.some((d) => d.id === tl)) difficulty = tl;
      else if (["hardcore", "perma", "permadeath", "ironman", "iron"].includes(tl)) hardcore = true;
      else nameWords.push(t);
    }
    const name = nameWords.join(" ");
    if (!name) return this.log("Your character needs a name.", "error");
    if (this.save.exists(name)) return this.log(`A chronicle named "${esc(name)}" already exists.`, "error");

    this.player = new Player(name, cls);
    this.player.difficulty = difficulty;
    this.player.hardcore = hardcore;
    this.player.skillPoints = 1; // a taster point to spend immediately
    this.player.pickaxe = Mining.startingPickaxe(this.data);
    grantStartingKit(this.player, this.data, this.rng);
    applySkillMods(this.player, this.data);
    this.save.save(this.player);
    this.state = STATE.IDLE;
    this.term.clear();
    const d = this.diffDef(difficulty);
    this.log(`A new ${cls.name} rises: <b>${esc(name)}</b> ${this.diffTag(difficulty, hardcore)}`, "success");
    this.log(`"${esc(cls.blurb)}"`, "system");
    this.log(`Difficulty: <b style="color:${d.color}">${d.name}</b>${hardcore ? ' — <b style="color:var(--danger)">HARDCORE: one life</b>' : ""}. ${esc(d.desc)}`, "cmd-desc-line");
    this.log(`You have 1 skill point — type <b>skills</b>.`, "cmd-desc-line");
    this.cmdLook();
  }

  cmdLoad(name) {
    name = name.trim();
    if (!name) return this.log("Usage: load <name>", "error");
    const p = this.save.load(name);
    if (!p) return this.log(`No chronicle named "${esc(name)}".`, "error");
    this.player = p;
    if (!this.player.pickaxe) this.player.pickaxe = Mining.startingPickaxe(this.data); // pre-mining saves
    applySkillMods(this.player, this.data); // re-aggregate passives from unlocked skills
    this.state = STATE.IDLE;
    this.term.clear();
    this.log(`Welcome back, ${esc(p.name)} the ${p.classDef.name}. (Lvl ${p.level}) ${this.diffTag(p.difficulty, p.hardcore)}`, "success");
    if (p.skillPoints > 0) this.log(`You have ${p.skillPoints} unspent skill point${p.skillPoints > 1 ? "s" : ""} — type <b>skills</b>.`, "cmd-desc-line");
    this.cmdLook();
  }

  cmdDelete(name) {
    name = name.trim();
    if (!this.save.exists(name)) return this.log(`No chronicle named "${esc(name)}".`, "error");
    this.save.remove(name);
    this.log(`Chronicle "${esc(name)}" erased.`, "system");
    this.showMenu();
  }

  cmdSave() {
    this.save.save(this.player);
    this.log("Progress saved.", "success");
  }

  // =================== WORLD ===================
  cmdLook() {
    const z = this.zoneOf(this.player.location);
    this.term.rule(z.name.toUpperCase());
    this.log(esc(z.description), "system");
    this.log(`Recommended level: ${z.min_level}. Use <b>hunt</b> to seek danger.`, "cmd-desc-line");
  }

  cmdZones() {
    this.term.rule("ZONES");
    for (const z of this.data.zones) {
      const ok = this.player.level >= z.min_level;
      const tag = ok ? `<span class="msg-success">open</span>` : `<span class="msg-error">lvl ${z.min_level}</span>`;
      const here = z.id === this.player.location ? " ◄ here" : "";
      this.log(`${esc(z.name).padEnd(34, " ")} ${tag}${here}`);
    }
    this.log(`Travel with <b>travel &lt;name&gt;</b>.`, "cmd-desc-line");
  }

  cmdTravel(input) {
    if (!input) return this.log("Usage: travel <zone>", "error");
    const s = input.toLowerCase();
    const z = this.data.zones.find((z) => z.id === s || z.name.toLowerCase().includes(s));
    if (!z) return this.log(`Unknown zone "${esc(input)}".`, "error");
    if (this.player.level < z.min_level) return this.log(`${z.name} demands level ${z.min_level}.`, "error");
    if (this.player.location === z.id) return this.log("You're already here.", "system");
    this.player.location = z.id;
    this.save.save(this.player);
    this.log(`You journey to ${z.name}.`, "info");
    this.cmdLook();
  }

  cmdHunt() {
    const z = this.zoneOf(this.player.location);
    const roll = this.rng.float();
    if (roll < 0.30) {
      return this.startEncounter(z);
    }
    if (roll < 0.95) {
      const boss = this.rng.chance(0.06);
      this.startCombat(makeEnemy(this.data, this.rng, z, { boss, mods: this.diffMods() }));
      return;
    }
    this.log("You scour the area but find nothing of note.", "system");
  }

  cmdRest() {
    if (this.player.hp >= this.player.maxHp && this.player.resource >= this.player.resourceMax) {
      return this.log("You're already at full strength.", "system");
    }
    this.state = STATE.BUSY;
    this.log("You make camp and tend your wounds…", "system");
    const total = 2200;
    const step = 110;
    let elapsed = 0;
    const startHp = this.player.hp;
    const timer = setInterval(() => {
      elapsed += step;
      const pct = Math.min(1, elapsed / total);
      this.player.hp = Math.round(startHp + (this.player.maxHp - startHp) * pct);
      this.player.restoreResource(this.player.resourceMax * (step / total));
      this.refresh();
      if (pct >= 1) {
        clearInterval(timer);
        this.player.hp = this.player.maxHp;
        this.player.resource = this.player.resourceMax;
        this.state = STATE.IDLE;
        this.save.save(this.player);
        this.log("You rise restored.", "success");
        this.refresh();
      }
    }, step);
  }

  // =================== ITEMS ===================
  /** Resolve a slot key from either its internal name or its display label. */
  slotKey(arg) {
    arg = (arg ?? "").trim().toLowerCase();
    if (SLOTS.includes(arg)) return arg;
    return SLOT_ALIASES[arg] ?? null;
  }

  resolveItem(arg) {
    arg = (arg ?? "").trim().toLowerCase();
    if (!arg) return null;
    if (/^\d+$/.test(arg)) {
      const idx = parseInt(arg, 10) - 1;
      const item = this.player.inventory[idx];
      return item ? { item, source: "inv", idx } : null;
    }
    const slot = this.slotKey(arg);
    if (slot && this.player.equipment[slot]) {
      return { item: this.player.equipment[slot], source: "equip", slot };
    }
    return null;
  }

  /**
   * Context-aware Tab completion. Returns full-line candidates: the command word
   * when typing the verb, or argument values (slots, zones, classes, providers)
   * once a command is chosen.
   */
  complete(line) {
    const trailing = /\s$/.test(line);
    const parts = line.trim().split(/\s+/).filter(Boolean);

    // Completing the command verb itself.
    if (parts.length === 0 || (parts.length === 1 && !trailing)) {
      const prefix = (parts[0] ?? "").toLowerCase();
      const names = [...this.registry.commands.keys()].filter((n) => n && /^[a-z]/.test(n));
      return names.filter((n) => n.startsWith(prefix)).sort();
    }

    const cmd = this.registry.lookup.get(parts[0].toLowerCase());
    const argPrefix = trailing ? "" : parts[parts.length - 1].toLowerCase();
    const head = (trailing ? parts : parts.slice(0, -1)).join(" ");

    let options = [];
    if (cmd === "unequip") {
      options = SLOTS.filter((s) => this.player?.equipment[s]); // only occupied slots
    } else if (cmd === "equip" || cmd === "inspect" || cmd === "forge" || cmd === "enchant" || cmd === "use" || cmd === "sell" || cmd === "drop") {
      // suggest equipped slot names for inspect/forge/enchant; numbers are typed directly
      if (cmd === "inspect" || cmd === "forge" || cmd === "enchant") options = SLOTS.filter((s) => this.player?.equipment[s]);
    } else if (cmd === "travel") {
      options = this.data.zones.filter((z) => this.player && this.player.level >= z.min_level).map((z) => z.id);
    } else if (cmd === "new" && parts.length <= 2) {
      options = listClasses(this.data).map((c) => c.id);
    } else if (cmd === "new") {
      // 3rd+ token: difficulty ids and the hardcore flag
      options = [...this.data.difficulties.levels.map((d) => d.id), "hardcore"];
    } else if (cmd === "ai" && parts.length <= 2) {
      options = ["gemini", "groq", "openrouter", "status", "off"];
    } else if (cmd === "load" || cmd === "delete") {
      options = this.save.names();
    } else if (cmd === "smelt") {
      options = ["all", ...this.data.mining.ores.filter((o) => this.player && Mining.oreCount(this.player, o.id) > 0).map((o) => o.id)];
    } else if (cmd === "craft") {
      if (parts.length <= 2) options = this.data.mining.ores.map((o) => o.id);
      else options = SLOTS;
    }

    const matched = options.filter((o) => o.toLowerCase().startsWith(argPrefix));
    return matched.map((o) => `${head} ${o}`);
  }

  /** Trigger a visual celebration for a noteworthy gear drop. */
  /** Map a rarity index to a celebration intensity (0 = none). */
  celebrationLevel(idx) {
    return idx >= 9 ? 5 : idx >= 8 ? 4 : idx >= 6 ? 3 : idx >= 5 ? 2 : idx >= 3 ? 1 : 0;
  }

  celebrateDrop(item) {
    if (!item || item.kind === "consumable" || !item.rarity) return;
    const idx = this.data.rarities.findIndex((r) => r.tier === item.rarity);
    const level = this.celebrationLevel(idx);
    if (!level) return; // F/E drop quietly
    const r = rarityOf(item, this.data);
    this.term.dropFx({ tier: r.tier, label: r.label, color: r.color, name: item.name, level });
  }

  cmdInventory() {
    this.term.rule("INVENTORY");
    const inv = this.player.inventory;
    if (!inv.length) return this.log("Your bag is empty.", "system");
    inv.forEach((item, i) => this.log(itemLine(item, this.data, { idx: i + 1, showValue: true })));
    this.log(`<span class="cmd-desc">equip / inspect / use / forge / enchant / sell &lt;number&gt;</span>`);
  }

  cmdGear() {
    this.term.rule("EQUIPPED");
    for (const slot of SLOTS) {
      const item = this.player.equipment[slot];
      // Show the typeable slot key (fixed width via CSS) so `unequip <slot>` is unambiguous.
      const label = `<span class="slot-key">${slot}</span>`;
      if (item) this.log(`${label}${itemLine(item, this.data, {})}`);
      else this.log(`${label}<span class="muted">— empty —</span>`);
    }
    this.log(`<span class="cmd-desc">unequip &lt;slot&gt; — Tab cycles equipped slots</span>`);
  }

  cmdInspect(arg) {
    const r = this.resolveItem(arg);
    if (!r) return this.log("Inspect what? Use an inventory number or a slot name.", "error");
    this.term.print(itemDetail(r.item, this.data));
    if (r.source === "inv" && r.item.slot) {
      const equipped = this.player.equipment[r.item.slot];
      if (equipped) {
        const diff = itemPower(r.item) - itemPower(equipped);
        const word = diff > 0 ? `<span class="msg-success">upgrade (+${diff} power)</span>` : diff < 0 ? `<span class="msg-error">downgrade (${diff} power)</span>` : "sidegrade";
        this.log(`vs equipped ${this.data.slots[r.item.slot].label}: ${word}`, "cmd-desc-line");
      }
    }
  }

  cmdEquip(arg) {
    const r = this.resolveItem(arg);
    if (!r || r.source !== "inv") return this.log("Equip which inventory item? (use a number)", "error");
    const item = r.item;
    if (item.kind === "consumable" || !item.slot) return this.log("You can't equip that.", "error");
    const prev = this.player.equipment[item.slot];
    this.player.equipment[item.slot] = item;
    this.player.removeItem(item.uid);
    if (prev) this.player.addItem(prev);
    this.player.recalc();
    this.save.save(this.player);
    this.log(`Equipped ${itemNameHtml(item, this.data)}${prev ? `, stowing ${itemNameHtml(prev, this.data)}` : ""}.`, "success");
  }

  cmdUnequip(arg) {
    const slot = this.slotKey(arg);
    if (!slot) return this.log(`Slot must be one of: ${SLOTS.join(", ")}. (Tab cycles them.)`, "error");
    const item = this.player.equipment[slot];
    if (!item) return this.log("That slot is already empty.", "system");
    this.player.equipment[slot] = null;
    this.player.addItem(item);
    this.player.recalc();
    this.save.save(this.player);
    this.log(`Unequipped ${itemNameHtml(item, this.data)}.`, "system");
  }

  cmdDrop(arg) {
    const r = this.resolveItem(arg);
    if (!r || r.source !== "inv") return this.log("Drop which inventory item? (use a number)", "error");
    this.player.removeItem(r.item.uid);
    this.save.save(this.player);
    this.log(`Discarded ${itemNameHtml(r.item, this.data)}.`, "system");
  }

  cmdUse(arg) {
    const r = this.resolveItem(arg);
    if (!r || r.item.kind !== "consumable") return this.log("Use which consumable? (an inventory number)", "error");
    if (this.state === STATE.COMBAT) {
      this.combat.useConsumable(r.item);
      this.afterCombatAction();
      return;
    }
    const eff = r.item.effect ?? {};
    if (eff.heal) this.player.heal(eff.heal);
    if (eff.healPct) this.player.healPct(eff.healPct);
    if (eff.resource) this.player.restoreResource(eff.resource);
    this.player.removeItem(r.item.uid);
    this.save.save(this.player);
    this.log(`You use ${itemNameHtml(r.item, this.data)}.`, "heal");
  }

  // =================== FORGE / ENCHANT ===================
  cmdForge(arg) {
    const r = this.resolveItem(arg);
    if (!r || r.item.kind === "consumable" || !r.item.slot) return this.log("Forge which gear? (inventory number or slot name)", "error");
    const info = forgeInfo(r.item, this.data);
    if (info.atMax) return this.log(`${displayName(r.item)} is already at the forge limit.`, "system");
    this.log(`Forging ${displayName(r.item)} → +${info.next}: costs ${info.shards} shards, ${info.gold}g · ${Math.round(info.success * 100)}% success.`, "cmd-desc-line");
    const res = forge(this.player, r.item, this.data, this.rng);
    const cls = res.result === "success" ? "success" : res.result === "downgrade" ? "error" : res.result === "blocked" ? "error" : "system";
    this.log(res.message, cls);
    if (res.result !== "blocked") this.save.save(this.player);
  }

  cmdEnchant(arg) {
    const r = this.resolveItem(arg);
    if (!r || r.item.kind === "consumable" || !r.item.slot) return this.log("Enchant which gear? (inventory number or slot name)", "error");
    const info = enchantInfo(r.item, this.data);
    if (!info.canEnchant) return this.log(`${displayName(r.item)} is too crude to enchant.`, "error");
    this.log(`Enchanting costs ${info.essence} essence, ${info.gold}g.${info.atCap ? " (at affix cap — will replace the weakest)" : ""}`, "cmd-desc-line");
    const res = enchant(this.player, r.item, this.data, this.rng);
    this.log(res.message, res.result === "success" ? "info" : "error");
    if (res.result === "success") this.save.save(this.player);
  }

  // =================== MARKET ===================
  cmdShop() {
    this.shopStock = rollStock(this.data, this.rng, this.player);
    this.term.rule("THE MARKET");
    this.log(`Your purse: <span class="msg-gold">${this.player.gold}g</span>. ${this.ai.isEnabled() ? "" : ""}`, "");
    this.shopStock.forEach((entry, i) => {
      const idx = `<span class="handle">${i + 1}</span>`;
      let label;
      if (entry.kind === "gear") label = itemLine(entry.item, this.data, {});
      else label = `${entry.def.name} <span class="cmd-desc">— ${esc(entry.def.desc)}</span>`;
      this.log(`${idx} ${label} <span class="msg-gold">${entry.price}g</span>`);
    });
    this.log(`<span class="cmd-desc">buy &lt;number&gt; · sell &lt;inventory number&gt;</span>`);
  }

  cmdBuy(arg) {
    if (!this.shopStock) return this.log("Open the <b>shop</b> first.", "error");
    const idx = parseInt(arg, 10) - 1;
    const entry = this.shopStock[idx];
    if (!entry) return this.log("No such item on offer.", "error");
    const res = buy(this.player, entry, this.data);
    this.log(res.message, res.ok ? "success" : "error");
    if (res.ok) {
      if (entry.kind === "gear") this.shopStock.splice(idx, 1); // sold out
      this.save.save(this.player);
    }
  }

  cmdSell(arg) {
    const idx = parseInt(arg, 10) - 1;
    const item = this.player.inventory[idx];
    if (!item) return this.log("Sell which inventory item? (use a number)", "error");
    const res = sell(this.player, item.uid, this.data);
    this.log(res.message, res.ok ? "gold" : "error");
    if (res.ok) this.save.save(this.player);
  }

  // =================== COMBAT ===================
  startCombat(enemy) {
    this.combat = new CombatSession({
      player: this.player,
      enemy,
      data: this.data,
      rng: this.rng,
      log: (m, c) => this.log(m, c),
      onEnd: (outcome) => this.endCombat(outcome),
    });
    this.state = STATE.COMBAT;
    this.term.rule("AMBUSH");
    const el = this.data.elements[enemy.element];
    this.log(`A <b style="color:var(--danger)">${enemy.name}</b> (Lvl ${enemy.level}${enemy.boss ? ", BOSS" : ""}) blocks your path!`, "enemy");
    if (enemy.element !== "physical") this.log(`It radiates <span style="color:${el?.color}">${el?.name}</span>.`, "cmd-desc-line");
    const abs = this.getAbilities();
    const abHint = abs.length > 1 ? `<b>abilities</b> (${abs.length} known)` : `<b>ability</b> (${abs[0].name})`;
    this.log(`Commands: <b>attack</b>, ${abHint}, <b>use &lt;n&gt;</b>, <b>flee</b>.`, "combat");
  }

  /** Base class ability plus any unlocked from the Combat Arts tree. */
  getAbilities() {
    return [this.player.classDef.ability, ...unlockedAbilities(this.data, this.player)];
  }

  cmdAbilities() {
    const abs = this.getAbilities();
    this.term.rule("ABILITIES");
    abs.forEach((a, i) => {
      const cost = Math.max(1, Math.round(a.cost * (1 - (this.player.costReduction ?? 0))));
      this.log(`<span class="handle">${i + 1}</span> <b class="msg-ability">${esc(a.name)}</b> <span class="cmd-desc">${cost} ${this.player.resourceName} — ${esc(a.desc ?? a.kind)}</span>`);
    });
    this.log(`<span class="cmd-desc">cast with <b>ability &lt;n&gt;</b> (or just <b>ability</b> for #1)</span>`);
  }

  cmdAttack() { this.combat.playerAttack(); this.afterCombatAction(); }
  cmdAbility(arg) {
    const abs = this.getAbilities();
    let i = parseInt(arg, 10);
    i = isNaN(i) ? 0 : i - 1;
    if (i < 0 || i >= abs.length) return this.log(`No ability #${arg}. Type <b>abilities</b> to list them.`, "error");
    this.combat.playerAbility(abs[i]);
    this.afterCombatAction();
  }
  cmdFlee() { this.combat.flee(); this.afterCombatAction(); }

  afterCombatAction() {
    // If combat ended, endCombat already ran via onEnd. Otherwise just refresh.
    this.refresh();
  }

  endCombat(outcome) {
    const enemy = this.combat.enemy;
    const wasMine = this.mineFight;
    this.mineFight = false;
    if (outcome === "victory") {
      const mods = this.diffMods();
      this.player.kills++;
      const xpGain = Math.round(enemy.xp * mods.xp * (1 + this.player.xpBonus));
      const goldGain = Math.round(enemy.gold * mods.gold * (1 + this.player.goldFind));
      const r = this.player.gainXp(xpGain);
      this.player.gold += goldGain;
      this.log(`You gain ${xpGain} XP and ${goldGain} gold.`, "success");
      this.rollDrops(enemy, mods);
      if (wasMine) this.grantMineBossOre();
      if (r) {
        this.log(`★ LEVEL UP! You are now level ${r.leveledTo}. (+${r.skillPoints} skill point${r.skillPoints > 1 ? "s" : ""} — type skills) ★`, "gold");
      }
      this.combat = null;
      this.save.save(this.player);
      if (wasMine && this.player.isAlive()) { this.state = STATE.MINE; this.refresh(); return this.renderMine(); }
      this.state = STATE.IDLE;
    } else if (outcome === "fled") {
      this.combat = null;
      if (wasMine) { this.state = STATE.MINE; this.refresh(); return this.renderMine(); }
      this.state = STATE.IDLE;
    } else if (outcome === "defeat") {
      this.handleDefeat(enemy);
    }
    this.refresh();
  }

  /** A slain mine guardian disgorges a haul of ore the player can already reach. */
  grantMineBossOre() {
    const p = this.player;
    const reach = Mining.tierIndex(this.data, p.pickaxe.reach);
    const pool = this.data.mining.ores.filter((o) => Mining.tierIndex(this.data, o.tier) <= reach && o.minDepth <= p.mineDepth);
    if (!pool.length) return;
    const ore = this.rng.weighted(pool.map((o) => ({ o, w: 1 + Mining.tierIndex(this.data, o.tier) })), (e) => e.w).o;
    const n = this.data.mining.boss.oreReward;
    Mining.addOre(p, ore.id, n);
    this.log(`The guardian's hoard yields <b style="color:${ore.color}">${n}× ${ore.name}</b>!`, "loot");
  }

  rollDrops(enemy, mods = this.diffMods()) {
    // gold/material trickle
    if (this.rng.chance(0.5)) { const s = this.rng.range(1, enemy.boss ? 6 : 2); this.player.shards += s; this.log(`Salvaged ${s} forge shard${s > 1 ? "s" : ""}.`, "item"); }
    if (this.rng.chance(0.25)) { this.player.essence += 1; this.log(`Recovered 1 arcane essence.`, "item"); }
    // gear drop — difficulty/hardcore raise both the chance and the rarity bias
    const lootBonus = mods.loot - 1;
    const baseChance = enemy.boss ? 1.0 : enemy.special ? 0.7 : 0.45;
    const dropChance = Math.min(1, baseChance + lootBonus * 0.3);
    if (this.rng.chance(dropChance)) {
      const enemyBias = enemy.boss ? 1.6 : enemy.special ? 1.25 : 1.0;
      // Combine biases additively on their deltas so they don't multiply out of control.
      const bias = 1 + (enemyBias - 1) + lootBonus + this.player.dropBonus;
      const item = generateItem(this.data, this.rng, { ilvl: enemy.level, luck: this.player.attrs.luck, rarityBias: bias, classId: this.player.classId });
      this.player.addItem(item);
      this.log(`Loot: ${itemNameHtml(item, this.data)} ${this.data.slots[item.slot].label}`, "loot");
      this.celebrateDrop(item);
    }
  }

  handleDefeat(enemy) {
    this.combat = null;
    if (this.player.hardcore) {
      // Permadeath — the chronicle ends here.
      this.term.rule("DEATH");
      this.log(`${enemy.name} strikes down ${esc(this.player.name)}.`, "error");
      this.log(`☠ HARDCORE — this chronicle is over. Reached level ${this.player.level} with ${this.player.kills} kills. ☠`, "enemy");
      this.save.remove(this.player.name);
      this.player = null;
      this.state = STATE.MENU;
      setTimeout(() => { this.term.clear(); this.showMenu(); }, 4500);
      return;
    }
    this.log(`${enemy.name} strikes you down…`, "error");
    const lost = Math.round(this.player.gold * 0.25);
    this.player.gold -= lost;
    this.player.location = "enchanted_forest";
    this.player.hp = Math.max(1, Math.round(this.player.maxHp * 0.5));
    this.player.resource = this.player.resourceMax;
    this.state = STATE.IDLE;
    this.save.save(this.player);
    this.log(`You wake at the edge of the Enchanted Forest, ${lost} gold lighter but alive.`, "system");
  }

  // =================== ENCOUNTERS ===================
  async startEncounter(zone) {
    const event = rollEvent(this.data, this.rng, this.player);
    this.encounter = { event, zone };
    this.state = STATE.ENCOUNTER;
    this.term.rule(event.title.toUpperCase());

    let text = event.text;
    if (this.ai.isEnabled()) {
      const thinking = this.log("<span class='muted'>the world holds its breath…</span>", "");
      const { system, user } = narrationPrompt(event, zone, this.player);
      const out = await this.ai.narrate(system, user);
      thinking.remove();
      if (out) text = out;
    }
    this.log(esc(text), "info");
    event.choices.forEach((c, i) => this.log(`<span class="handle">${i + 1}</span> ${esc(c.label)}`, ""));
    this.log(`<span class="cmd-desc">choose a number…</span>`);
    this.refresh();
  }

  cmdChoose(args, raw) {
    // Accept "choose 2", "pick 2", or a bare number command ("2").
    let n = parseInt(args, 10);
    if (isNaN(n)) {
      const word = (raw ?? "").trim().split(/\s+/)[0];
      n = parseInt(word, 10);
    }
    if (isNaN(n)) return this.log("Pick a choice by number.", "error");
    const res = resolveChoice(this.player, this.encounter.event, n - 1, this.data, this.rng);
    if (!res.ok) return this.log(res.message, "error");
    this.log(esc(res.text), "system");
    this.term.printLines(res.lines.map((l) => ({ msg: l.item ? `${l.msg.replace(esc(l.item.name), itemNameHtml(l.item, this.data))}` : l.msg, cls: l.cls })));
    for (const l of res.lines) if (l.item) this.celebrateDrop(l.item);
    if (res.leveled) this.log(`★ LEVEL UP! Now level ${res.leveled.leveledTo}. ★`, "gold");

    const fight = res.fight;
    this.encounter = null;
    if (fight) {
      this.startCombat(makeEnemy(this.data, this.rng, this.zoneOf(this.player.location), { mods: this.diffMods() }));
    } else {
      this.state = STATE.IDLE;
      this.save.save(this.player);
    }
    this.refresh();
  }

  // =================== SYSTEM ===================
  cmdStatus() {
    if (!this.player) return this.log("No active character. Use <b>new</b> or <b>load</b>.", "system");
    const p = this.player;
    this.term.rule(`${p.name.toUpperCase()} — ${p.classDef.name}`);
    this.log(`Level ${p.level} · ${p.xp}/${p.xpToNext} XP · ${p.kills} kills`);
    this.log(`HP ${p.hp}/${p.maxHp} · ${p.resourceName} ${p.resource}/${p.resourceMax}`);
    this.log(`STR ${p.attrs.str} · AGI ${p.attrs.agi} · INT ${p.attrs.int} · VIT ${p.attrs.vit} · LUCK ${p.attrs.luck}`);
    this.log(`ATK ${p.attackPower} · DEF ${p.defense} · Crit ${Math.round(p.critChance * 100)}% (x${p.critMult.toFixed(2)}) · Dodge ${Math.round(p.dodge * 100)}%`);
    if (p.lifesteal) this.log(`Lifesteal ${Math.round(p.lifesteal * 100)}%`);
    this.log(`Gold ${p.gold} · Shards ${p.shards} · Essence ${p.essence}`);
    this.log(`Difficulty ${this.diffTag(p.difficulty, p.hardcore)} · Skill points ${p.skillPoints} (${p.skills.length} unlocked)`);
    if (p.pickaxe) this.log(`Pickaxe ${esc(p.pickaxe.name)} · Mine depth ${p.mineDepth}m · Ore value ${Mining.satchelValue(this.data, p)}g`);
    const known = this.getAbilities();
    this.log(`Abilities (${known.length}): ${known.map((a) => a.name).join(", ")}`, "cmd-desc-line");
  }

  // =================== DIFFICULTY ===================
  cmdDifficulties() {
    this.term.rule("DIFFICULTIES");
    this.log("Chosen at creation and locked for the run: <b>new &lt;class&gt; &lt;name&gt; &lt;difficulty&gt; [hardcore]</b>", "cmd-desc-line");
    for (const d of this.data.difficulties.levels) {
      this.log(`<b style="color:${d.color}">${d.name}</b> <span class="cmd-desc">(${d.id})</span> — mobs HP ×${d.mobHp}, DMG ×${d.mobDmg}, loot ×${d.loot}, XP ×${d.xp}, gold ×${d.gold}`);
      this.log(`  ${esc(d.desc)}`, "cmd-desc-line");
    }
    const hc = this.data.difficulties.hardcore;
    this.log(`<b style="color:var(--danger)">Hardcore</b> — ${esc(hc.desc)} (loot ×${hc.loot}, XP ×${hc.xp})`, "");
  }

  // =================== SKILL TREE ===================
  cmdSkills() {
    this.state = STATE.SKILLS;
    this.renderSkillTree();
  }

  renderSkillTree() {
    const p = this.player;
    this.term.clear();
    this.term.rule("SKILL TREE");
    this.log(`<b style="color:var(--highlight)">Skill Points: ${p.skillPoints}</b> · ${p.skills.length}/${allSkills(this.data).length} unlocked · Lvl ${p.level}`, "");
    this.log(`<span class="cmd-desc">unlock &lt;number&gt; · back to leave</span>`);
    this.term.blank();

    // Assign stable numbers across the whole tree for `unlock <n>`.
    this.skillIndex = [];
    const ICON = { unlocked: "✓", available: "◆", "needs-req": "○", "needs-points": "◌" };

    for (const branch of this.data.skills.branches) {
      const skills = visibleSkills(this.data, this.player, branch);
      if (!skills.length) continue;
      const suffix = branch.id === "arts" ? ` · ${this.player.classDef.name}` : "";
      this.log(`<span class="skill-branch" style="color:${branch.color}">╒═ ${branch.name.toUpperCase()}${suffix} ${"═".repeat(Math.max(2, 20 - branch.name.length - suffix.length))}╕</span>`);
      const byTier = {};
      for (const s of skills) (byTier[s.tier] ??= []).push(s);
      for (const tier of Object.keys(byTier).sort()) {
        for (const s of byTier[tier]) {
          const idx = this.skillIndex.push(s.id);
          const status = skillStatus(this.data, this.player, { ...s });
          const cls = status === "unlocked" ? "skill-on" : status === "available" ? "skill-can" : "skill-off";
          const reqNote = status === "needs-req"
            ? ` <span class="cmd-desc">‹needs ${s.req.map((r) => skillById(this.data, r)?.name ?? r).join(", ")}›</span>`
            : status === "needs-points" ? ` <span class="cmd-desc">‹${s.cost} pts›</span>` : "";
          const handle = status === "unlocked" ? `<span class="skill-num done">${ICON[status]}</span>` : `<span class="handle">${idx}</span>`;
          this.log(`<span style="color:${branch.color}">│</span> ${handle} <span class="${cls}">T${s.tier} ${ICON[status]} ${esc(s.name)}</span> <span class="cmd-desc">(${s.cost}) — ${esc(s.desc)}</span>${reqNote}`);
        }
      }
      this.log(`<span style="color:${branch.color}">╘${"═".repeat(26)}╛</span>`);
      this.term.blank();
    }
    this.refresh();
  }

  cmdUnlock(arg) {
    const n = parseInt(arg, 10);
    if (isNaN(n) || !this.skillIndex || !this.skillIndex[n - 1]) return this.log("Unlock which skill? Use a number from the tree.", "error");
    const id = this.skillIndex[n - 1];
    const res = unlockSkill(this.player, this.data, id);
    if (res.ok) {
      this.save.save(this.player);
      this.renderSkillTree();
      this.log(res.message, "success");
    } else {
      this.log(res.message, "error");
    }
  }

  cmdLeaveView() {
    if (this.state === STATE.MINE) return this.cmdLeaveMine();
    return this.cmdBackFromSkills();
  }

  cmdBackFromSkills() {
    this.state = STATE.IDLE;
    this.term.clear();
    this.log("You close the tome of talents.", "system");
    this.cmdLook();
  }

  // =================== THE MINE ===================
  cmdMine() {
    this.state = STATE.MINE;
    this.renderMine();
  }

  renderMine() {
    const p = this.player;
    this.term.clear();
    this.term.rule("THE MINE");
    const pick = p.pickaxe;
    this.log(`Pickaxe: <b>${esc(pick.name)}</b> <span class="cmd-desc">(power ${pick.power}, reaches ${pick.reach}-tier ore)</span> · Depth: <b>${p.mineDepth}m</b>`, "");
    const owned = this.data.mining.ores.filter((o) => Mining.oreCount(p, o.id) > 0);
    if (owned.length) {
      this.log("Satchel: " + owned.map((o) => `<span style="color:${o.color}">${o.name} ×${Mining.oreCount(p, o.id)}</span>`).join(" · "), "");
    } else {
      this.log("Satchel: <span class='muted'>empty</span>", "");
    }
    this.log(`<span class="cmd-desc">dig · ores · smelt &lt;ore|all&gt; · upgrade · craft &lt;ore&gt; [slot] · leave</span>`);
  }

  cmdDig() {
    const p = this.player;
    const res = Mining.digOnce(this.data, this.rng, { depth: p.mineDepth, pickaxe: p.pickaxe, luck: p.attrs.luck });
    p.mineDepth = Math.min(this.data.mining.maxDepth, p.mineDepth + this.data.mining.depthPerDig);

    if (res.ore) {
      Mining.addOre(p, res.ore.id, res.count);
      this.log(`⛏ You unearth <b style="color:${res.ore.color}">${res.count}× ${esc(res.ore.name)}</b> <span class="cmd-desc">[${res.ore.tier}]</span>.`, "loot");
      const oreLevel = this.celebrationLevel(Mining.tierIndex(this.data, res.ore.tier));
      if (oreLevel >= 2) this.term.dropFx({ tier: res.ore.tier, label: res.ore.name.toUpperCase(), color: res.ore.color, name: `${res.count}× ${res.ore.name}`, level: oreLevel });
    } else {
      this.log("⛏ Your pickaxe bites only barren rock.", "system");
    }

    // boss ambush deepens with depth
    if (this.rng.chance(Mining.bossChance(this.data, p.mineDepth))) {
      this.save.save(p);
      this.log("The rock splits — something vast stirs in the dark!", "enemy");
      this.mineFight = true;
      this.startCombat(Mining.makeMineGuardian(this.data, this.rng, p, p.mineDepth, this.diffMods()));
      return;
    }
    this.save.save(p);
    this.refresh();
  }

  cmdOres() {
    const p = this.player;
    this.term.rule("ORE SATCHEL");
    const owned = this.data.mining.ores.filter((o) => Mining.oreCount(p, o.id) > 0);
    if (!owned.length) return this.log("Your satchel is empty. Go <b>dig</b>.", "system");
    for (const o of owned) {
      const n = Mining.oreCount(p, o.id);
      this.log(`<span style="color:${o.color}">${esc(o.name)}</span> <span class="cmd-desc">[${o.tier}]</span> ×${n} <span class="msg-gold">(${o.value * n}g)</span>`);
    }
    this.log(`Total value: <span class="msg-gold">${Mining.satchelValue(this.data, p)}g</span> · <span class="cmd-desc">smelt &lt;ore|all&gt;</span>`);
  }

  cmdSmelt(arg) {
    arg = (arg ?? "").trim().toLowerCase();
    if (!arg) return this.log("Smelt which ore? Use an ore id or <b>all</b>.", "error");
    const res = arg === "all" ? Mining.sellAllOre(this.player, this.data) : Mining.sellOre(this.player, this.data, this.resolveOreId(arg));
    this.log(res.message, res.ok ? "gold" : "error");
    if (res.ok) { this.save.save(this.player); this.renderMine(); }
  }

  cmdUpgradePick() {
    const info = Mining.pickaxeCraftInfo(this.data, this.player);
    if (info.atMax) return this.log("Your pickaxe is already the finest ever forged.", "system");
    this.log(`Next: <b>${esc(info.next.name)}</b> — needs ${info.count}× ${info.ore.name} (have ${info.haveOre}) + ${info.gold}g.`, "cmd-desc-line");
    const res = Mining.craftPickaxe(this.player, this.data);
    this.log(res.message, res.ok ? "success" : "error");
    if (res.ok) { this.save.save(this.player); this.renderMine(); }
  }

  cmdCraftGear(args) {
    const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
      this.term.rule("ORE SMITHING");
      this.log("Forge gear from ore — its rarity matches the ore's tier.", "cmd-desc-line");
      for (const o of this.data.mining.ores) {
        const cost = Mining.gearCraftCost(this.data, o);
        const have = Mining.oreCount(this.player, o.id);
        const ok = have >= cost.ore && this.player.gold >= cost.gold;
        this.log(`<span style="color:${o.color}">${esc(o.name)}</span> <span class="cmd-desc">[${o.tier}]</span> → ${cost.ore}× + ${cost.gold}g ${ok ? '<span class="msg-success">✓</span>' : `<span class="muted">(have ${have})</span>`}`);
      }
      this.log(`<span class="cmd-desc">craft &lt;ore&gt; [slot] — e.g. craft iron weapon</span>`);
      return;
    }
    const oreId = this.resolveOreId(parts[0]);
    const slot = parts[1] ? this.slotKey(parts[1]) : undefined;
    if (parts[1] && !slot) return this.log(`Unknown slot "${esc(parts[1])}". Options: ${SLOTS.join(", ")}.`, "error");
    const res = Mining.craftGear(this.player, this.data, this.rng, oreId, slot);
    if (res.ok) {
      this.log(res.message, "loot");
      this.celebrateDrop(res.item);
      this.save.save(this.player);
      this.renderMine();
    } else {
      this.log(res.message, "error");
    }
  }

  cmdLeaveMine() {
    this.state = STATE.IDLE;
    this.term.clear();
    this.log("You climb back into the daylight.", "system");
    this.cmdLook();
  }

  /** Match an ore by id or a case-insensitive name fragment. */
  resolveOreId(arg) {
    arg = (arg ?? "").trim().toLowerCase();
    if (this.data.mining.ores.some((o) => o.id === arg)) return arg;
    const byName = this.data.mining.ores.find((o) => o.name.toLowerCase().includes(arg));
    return byName ? byName.id : arg;
  }

  // =================== UPDATES ===================
  async checkRemoteVersion() {
    try {
      const res = await fetch(`./data/version.json?_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return null;
      const json = await res.json();
      return json.version ?? null;
    } catch {
      return null;
    }
  }

  cmdVersion() {
    this.log(`Damascus Reign v${this.version}${this.data.version?.codename ? ` — "${this.data.version.codename}"` : ""}`, "info");
    this.checkRemoteVersion().then((latest) => {
      if (latest && latest !== this.version) this.log(`A newer version (v${latest}) is available — run <b>update</b>.`, "gold");
      else if (latest) this.log("You're on the latest version.", "cmd-desc-line");
    });
  }

  async cmdUpdate() {
    this.log("Checking for updates…", "system");
    const latest = await this.checkRemoteVersion();
    if (latest && latest !== this.version) this.log(`Updating v${this.version} → v${latest}. Reloading…`, "success");
    else this.log(`Already up to date (v${this.version}). Reloading to apply any changes…`, "system");
    setTimeout(() => location.reload(), 700);
  }

  /** Periodically poll for a new deploy and nudge the player once. */
  startUpdateWatch() {
    const check = async () => {
      if (this._updateNudged) return;
      const latest = await this.checkRemoteVersion();
      if (latest && latest !== this.version) {
        this._updateNudged = true;
        this.log(`⟳ A new version (v${latest}) is live — run <b>update</b> to apply it.`, "gold");
      }
    };
    setTimeout(check, 4000);
    this._updateTimer = setInterval(check, 5 * 60 * 1000);
  }

  cmdHelp() {
    this.term.rule("HELP");
    this.log("Type commands at the prompt. The Codex on the right lists everything.", "system");
    this.log("Core loop: <b>hunt</b> for fights & events, loot drops, <b>equip</b> upgrades, <b>forge</b>/<b>enchant</b> to power them up, <b>shop</b> to spend gold, <b>rest</b> to heal.", "system");
    this.log("Also: <b>skills</b> (spend level-up points) · <b>mine</b> (dig ore, craft pickaxes & gear).", "system");
    this.log("In combat: <b>attack</b>, <b>ability</b>, <b>use &lt;n&gt;</b>, <b>flee</b>.", "system");
    this.log("Optional AI flavor: <b>ai &lt;provider&gt; &lt;key&gt;</b> (gemini/groq/openrouter). " + this.ai.status(), "cmd-desc-line");
    this.log("Tip: press <b>Tab</b> to autocomplete commands, slots and zones. See <b>credits</b>.", "cmd-desc-line");
  }

  cmdCredits() {
    this.term.rule("CREDITS");
    this.log("✦ <b style='color:var(--highlight)'>DAMASCUS REIGN</b> — Reign of Iron and Dust ✦", "");
    this.term.blank();
    this.log("<b>apxvasili</b> — creator", "gold");
    this.log("  Original concept &amp; game design. Authored the world data: the", "cmd-desc-line");
    this.log("  item rarity system (F→X tiers, prefixes &amp; suffixes), the item", "cmd-desc-line");
    this.log("  word-banks, the 20 zones and the bestiary.", "cmd-desc-line");
    this.term.blank();
    this.log("<b>Claude (Opus 4.8)</b> — engineering", "info");
    this.log("  Full frontend &amp; backend: the engine, combat, classes,", "cmd-desc-line");
    this.log("  procedural item generation, forging, enchanting, encounters,", "cmd-desc-line");
    this.log("  the optional AI narrator, saves and the terminal UI.", "cmd-desc-line");
    this.term.blank();
    this.log("Built with Claude Code. No LARP — credit where it's due.", "system");
  }

  cmdAI(args) {
    const parts = args.split(/\s+/).filter(Boolean);
    if (!parts.length || parts[0] === "status") return this.log(this.ai.status(), "info");
    if (parts[0] === "off") { this.ai.disable(); return this.log("AI narrator disabled.", "system"); }
    const provider = parts[0].toLowerCase();
    if (!PROVIDERS[provider]) return this.log(`Provider must be one of: ${Object.keys(PROVIDERS).join(", ")}.`, "error");
    const key = parts[1];
    if (!key) return this.log(`Usage: ai ${provider} <api-key> [model]`, "error");
    const model = parts[2];
    const res = this.ai.configure({ provider, key, model });
    this.log(res.message, res.ok ? "success" : "error");
  }
}

// ---- boot ----
window.addEventListener("DOMContentLoaded", () => {
  new Game().boot();
});
