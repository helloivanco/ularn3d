# Changelog

Player-facing notes for **Ularn 3D**. The marketing [What’s New](https://ularn-3d.vercel.app/changelog/) page mirrors recent entries below. Full release artifacts (Windows builds and checksums) live on [GitHub Releases](https://github.com/helloivanco/ularn3d/releases).

When shipping a product version, add a short entry here and on `/changelog/`, then bump with `npm version patch|minor|major`.

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
