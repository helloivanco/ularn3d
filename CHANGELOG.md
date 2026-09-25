# Changelog

Player-facing notes for **Ularn 3D**. The marketing [What’s New](https://ularn-3d.vercel.app/changelog/) page mirrors recent entries below. Full release artifacts (Windows builds and checksums) live on [GitHub Releases](https://github.com/helloivanco/ularn3d/releases).

When shipping a product version, add a short entry here and on `/changelog/`, then bump with `npm version patch|minor|major`.

## 1.3.21 — Door throats and labyrinth floors

- Corridor doors sit flush between connecting stone so keypad diagonals (1/3/7/9) cannot squeeze past without going through the door
- Closed doors also block diagonal corner-cuts in movement (open doors stay walkable)
- Classic `eat()` caverns keep the connectivity spine but use fewer/smaller chambers plus a light density sculpt so floors read more like a labyrinth
- Wall/open ratios track canned Ularn density more closely; huge empty halls and solid blocks are rejected
- Stairs, Cave 1 town exit, flat lighting, XP panel, north camera, classic loot, and rare goblin/treasure rooms unchanged

## 1.3.20 — Smoother browser dungeon walking

- Balanced mode turns off the shadow system entirely (no leftover sun/hero shadow pass in Chrome)
- Flat dungeon floors/walls stay unlit and drop stone-map sampling; instance colors keep caves readable
- No tone-mapping cost in Balanced; dust/water stay town-only
- Snapshot tile buffers reused; known-floor walks skip full mesh rebuilds when only the hero or monsters move
- HUD and minimap skip redundant work on unchanged frames
- Regression: Playwright asserts dungeon frame time stays within 1.35× town on a known classic floor

## 1.3.19 — Experience panel, flat caves, north camera, door facing

- Experience progression panel beside Spells and Stats: classic Ularn titles plus current XP / XP to next level
- Dungeon lighting is constant (unlit floors, no torch/point lights, no fog dimming when zooming out)
- Camera starts facing true north on new game and load; orbit zoom/elevation preferences persist across sessions
- Corridor doors face correctly again — the door plane blocks travel along the hall
- Loot goblin, treasure-room rarity, and classic loot density unchanged

## 1.3.18 — Classic caverns, reachable stairs, remembered name

- Restored classic Ularn `eat()` cavern generation (with the proven 57×20 spine) instead of the short-lived room-corridor rewrite
- Every dungeon floor keeps reachable stairs on the walkable maze graph — no more rock-enclosed stair pockets
- Cave 1 always has a town entrance connected to the maze; doors only appear at real hall/room junctions and face the passage
- Adventurer name is remembered on this device for the next expedition
- Classic floor loot amounts unchanged

## 1.3.17 — Maze floors, portals, and rare treasure rooms

- Dungeon floors are maze-like again (rooms and corridors); doors only connect spaces — no blank halls with doors to nowhere
- Floor loot amount matches classic Ularn budgets; item *types* scale with depth
- Town portals: only one active at a time (new replaces old); using the town portal to return consumes it
- Rare **treasure rooms** (0.10%) with real room structure, more gold than items, and monsters 3 levels above the floor

## 1.3.16 — Loot goblin, shop clarity, and more maps

- DnD shop always shows proper scroll names, graphics, and catalog prices (Town Portal stays 2500g on the last page); buying or finding discovers items
- Undiscovered dungeon scrolls still share one unknown graphic
- Rare **Loot Goblin** (`?` on the minimap) flees, drops any item equally, and vanishes after 200 turns
- Slight independent boosts to special weapon find rates
- 100 more unique canned maps; 1% chance of a treasure map packed with gold and valuables
- Larger unique weapon swing models (no tiny floor icon stuck on a default blade)
- Thin spell-aim grid lines while choosing a cast direction

## 1.3.15 — What’s New on the site

- New **What’s New** page with curated version notes for players
- Changelog linked from the site nav, home, About, play welcome links, and footers
- Clearer path to the [GitHub repository](https://github.com/helloivanco/ularn3d) and [Releases](https://github.com/helloivanco/ularn3d/releases)

## 1.3.14 — Weapons, portals, and lighter meshes

- Distinct trap meshes for pits, dart traps, and express elevators
- Wielded weapons match floor loot art while swinging, with per-weapon attack sounds
- **Teleport to Town** scroll at the DnD store (2500g); reading it opens linked dungeon and town portals
- Undiscovered scrolls use shared unknown art until identified
- Browser performance: cheaper orb/ring/cone meshes and tighter Balanced GPU budgets

## 1.3.13 — Traps, relics, and Field Guide tips

- Trap art for pits, darts, and elevators
- Special-item ground hovers with classic-tone titles (Eye of Larn, Orbs, Scarab, and more)
- Short known-hazard tips for visible pits, darts, and elevators
- Field Guide sections for Hazards and Relics; quieter tips for ordinary loot
- Clearer journal lines when discovering or triggering hazards

## 1.3.12 — Site polish

- Home gallery shows a clear town vs dungeon pair
- Navbar keeps About, Play free, and Download for Windows
- Footer adds a GitHub link to this repository
- Favicon, apple-touch, and PWA icons regenerated from the brand sigil

## 1.3.11 — Balance and clarity

- Sonic spear statue crumble chance raised (~60%)
- Undiscovered potions share unknown bottle art until learned
- Giant centipede / ant strength drain is a 20% roll
- Brass lamp spawn chance slightly increased
- Minimap stairs: red down, green up
- Self-cast spell buffs refresh instead of stacking; potions and scrolls still accumulate
- Town buildings keep a clear empty ring so landmarks never overlap

## 1.3.10 — Readable Balanced caves

- Balanced quality raises ambient light and eases fog so floors stay readable without torch point lights
- Bloom is never allocated in Balanced; Cinematic builds a lighter pass only when chosen
- Marketing home preview always runs Balanced so a leftover Cinematic setting cannot lag the hero

## 1.3.9 — Interactive hero and About history

- Restored the interactive Three.js town preview on the marketing home
- Larn / Ultra-Larn creator history moved into About; legacy `/credits` URLs redirect there
- Gallery screenshots refreshed

## 1.3.8 — Marketing redesign

- Multi-page site: home, play, About field guide, and creator history
- New cave/gem brand sigil for favicon and PWA icons
- SEO metadata, sitemap, and structured data for public pages

## Earlier 1.3.x highlights

- **1.3.7 / 1.3.6** — Faster Balanced dungeon walking (fewer rebuilds, cheaper shadows and materials)
- **1.3.5** — Town plaza walls stay solid when walking past; dungeon cutaway only lowers the camera–hero column
- **1.3.4** — Expedition journal keeps the full action history and scrolls
- **1.3.3** — Scrolls of Enchant Armor always target worn armor when armor is equipped
- **1.3.2** — Dungeon floors are **57×20**; symbol map shows the whole floor
- **1.3.1** — Remaining / max spells shown above the adventurer stats
