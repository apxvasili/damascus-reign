# Damascus Reign

A web **CLI roguelite RPG** that runs entirely in the browser — terminal aesthetics
(CRT scanlines, typed output, ASCII art) with the flexibility of HTML/CSS/JS for
animation and color. No build step, no framework, no backend.

> *Reign of Iron and Dust.* Hunt monsters across 20 zones, gather procedurally
> generated loot across 10 rarity tiers, forge and enchant your gear, and survive
> random encounters — optionally narrated by an AI of your choosing.

---

## Running it

The game uses native ES modules, which browsers refuse to load over `file://`.
Serve the folder over HTTP from the project root:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static server works (`npx serve`, `php -S localhost:8080`, VS Code Live
Server, etc.). That's the only requirement — there is nothing to compile.

---

## How to play

Type commands at the prompt. The **Codex** panel (right) lists every command,
grouped; the **Chronicle** panel (left) is your live character sheet and combat
readout.

```
new warrior Conan      create a Warrior named Conan
classes                see all four classes and their abilities
hunt                   seek danger — leads to a fight or a random event
attack / ability / flee   combat actions (ability = your class skill)
inventory              list your bag (items are numbered)
equip 6                equip inventory item #6
inspect weapon         examine an item (compares vs equipped)
forge weapon           spend shards + gold to enhance (+N)
enchant 3              roll a new affix onto an item
shop / buy 2 / sell 4  the market
rest                   heal over time
travel frozen          move to another zone
status                 full character sheet
```

### The core loop
`hunt` → win fights → loot drops + gold + crafting mats → `equip` upgrades →
`forge`/`enchant` to push them further → `shop` to spend gold → tackle higher
zones with `travel`. Death isn't permanent: you respawn at the Enchanted Forest
having lost some gold.

### Classes
- **Warrior** — STR/VIT bruiser. *Rampage*: a big, unmissable flurry.
- **Mage** — INT glass cannon. *Arcane Nova*: defense-ignoring fire burst.
- **Rogue** — AGI crit/dodge. *Eviscerate*: a guaranteed, amplified crit.
- **Cleric** — INT/VIT hybrid. *Lay on Hands*: heal + holy smite.

### Items & rarity
Gear is generated from a slot, a rarity tier, a base name, a rarity prefix, and
rolled affixes. Ten tiers, rarest to most common: `F E D C B A S SS SSS X`
(Junk → Anomaly). Higher tiers hit harder *and* carry more affixes (`+stats`,
crit, dodge, lifesteal, elemental damage). Weapons carry an element; elements
have strong/weak matchups that matter in combat (fire burns, ice chills,
lightning shocks, shadow withers).

---

## Optional AI narrator (bring your own key)

Random encounters are fully playable offline with hand-written procedural prose.
If you want fresh, AI-written flavor text, supply your own free-tier API key —
the game calls the provider directly from the browser and **never** changes
mechanics, only the descriptive text.

```
ai gemini     <your-key>          # Google Gemini  (free tier)
ai groq       <your-key>          # Groq           (free tier)
ai openrouter <your-key> <model>  # OpenRouter      (free models available)
ai status                         # check current setting
ai off                            # disable
```

The key is stored only in your browser's `localStorage`. Because a static site
can't hide secrets, **only use a personal key** — don't commit one or share a
deployed copy with it baked in.

---

## Architecture

Zero-build, modular vanilla ES modules.

```
index.html            shell: layout + mounts the app
styles/main.css       all styling + CRT / animation effects
data/*.json           content: zones, monsters, item word-banks, rarities,
                      affixes, classes, events, shop, forge config
src/
  engine/
    rng.js            seedable PRNG + dice/weighted/crit helpers
    data.js           loads all data/*.json at boot
    state.js          Player model + derived-stat recalc + save serialization
    commands.js       command registry + parser + state gating
  systems/
    items.js          procedural item generation, stats, rarity, value
    classes.js        class metadata + starting kit
    combat.js         turn-based combat, elements, statuses, enemy scaling
    forge.js          enhancement (+N) with risk
    enchant.js        affix rolling / replacement
    shop.js           rotating stock, buy/sell
    encounters.js     random events + AI narration prompt
    ai.js             optional BYO-key narrator client
    save.js           multi-character localStorage saves
  ui/
    terminal.js       output stream + input line + history
    panels.js         Chronicle (stats) + Codex (commands)
    render.js         HTML formatting (colored item names, bars, cards)
  main.js             orchestrator: state machine + command wiring
```

Data is data: to add a zone, monster, affix, event, or shop item, edit the
relevant `data/*.json` — no code changes needed.
