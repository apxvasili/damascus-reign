<div align="center">

# ⚔️ Damascus Reign

### *Reign of Iron and Dust*

A **web CLI roguelite RPG** — terminal aesthetics (CRT glow, ASCII art, typed
output) with the flexibility of HTML/CSS/JS. Hunt across 20 zones, gather
procedurally generated loot, forge and enchant your gear, and survive random
encounters.

**No install. No build. Plays in any browser.**

### ▶️ [**Play now**](https://apxvasili.github.io/damascus-reign/)

</div>

---

## How to play

Type commands at the prompt. The **Codex** panel (right) lists every command;
the **Chronicle** panel (left) is your live character sheet and combat readout.

```
new warrior Conan      create a Warrior named Conan
classes                see all four classes and their abilities
hunt                   seek danger — a fight or a random event
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
help                   command overview
```

**The loop:** `hunt` → win fights → loot drops + gold + crafting mats →
`equip` upgrades → `forge`/`enchant` to push them further → `shop` to spend gold
→ `travel` to harder zones. Death isn't permanent — you respawn at the Enchanted
Forest, lighter a little gold.

## Features

| | |
|---|---|
| **Classes** | Warrior, Mage, Rogue, Cleric — each with unique stats and a signature ability |
| **Loot** | Procedural gear, **10 rarity tiers** (`F→X`), 9 slots, rollable affixes |
| **Combat** | Turn-based, crits, dodge, lifesteal, elemental matchups (burn / chill / shock / wither), bosses |
| **Forging** | `+N` enhancement with rising risk |
| **Enchanting** | Roll and replace affixes with arcane essence |
| **Encounters** | Weighted random events with branching choices |
| **Saves** | Multiple characters, persisted in your browser |

## Optional AI narrator (bring your own key)

Encounters play fully offline with hand-written prose. Supply your own free-tier
API key for AI-written flavor text — it changes *words only*, never mechanics:

```
ai gemini     <your-key>          # Google Gemini  (free tier)
ai groq       <your-key>          # Groq           (free tier)
ai openrouter <your-key> <model>  # OpenRouter      (free models)
ai status                         # check setting
ai off                            # disable
```

The key is stored only in your browser's `localStorage`. **Use a personal key
only** — never commit or share one.

## Run locally

ES modules can't load over `file://`, so serve over HTTP from the project root:

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

Any static server works (`npx serve`, VS Code Live Server, …). Nothing to compile.

## Architecture

Zero-build, modular vanilla ES modules. Content is data-driven — add a zone,
monster, affix, event, or shop item by editing `data/*.json`, no code required.

```
index.html            shell — layout + mounts the app
styles/main.css        styling + CRT / animation effects
data/*.json            zones, monsters, item word-banks, rarities, affixes,
                       classes, events, shop, forge config
src/
  engine/   rng · data loader · Player state · command registry
  systems/  items · classes · combat · forge · enchant · shop · encounters · ai · save
  ui/       terminal · panels · render helpers
  main.js   orchestrator — state machine + command wiring
```
