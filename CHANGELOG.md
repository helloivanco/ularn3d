# Changelog

Player-facing notes for **Ularn 3D**. The marketing [What’s New](https://ularn-3d.vercel.app/changelog/) page mirrors recent entries below. Full release artifacts (Windows builds and checksums) live on [GitHub Releases](https://github.com/helloivanco/ularn3d/releases).

When shipping a product version, add a short entry here and on `/changelog/`, then bump with `npm version patch|minor|major`.

## 1.3.46 — Matching controls

- Gold and quiet buttons on the site and the play screen share one shape, hover, and focus
- Text fields, panels, and the links under the pages share the same spacing and hover
- Home, About, and What’s New use one header and one footer

## 1.3.45 — Play page mark

- The play page title is Ularn 3D, with the cave-and-gem mark beside it and “The caves below” underneath. Sound, the field guide, and “The adventure awaits” stay along the top, and the watching line sits below that line

## 1.3.44 — Start screen fits the window

- The play screen shows the class choices, the class note, Multiplayer, Continue, and Download for Windows together on a normal desktop window
- A saved expedition no longer pushes the Windows download below the fold

## 1.3.43 — Clearer download links

- Links under Download for Windows read About, What’s New, History, Verify Download, then a GitHub icon, each on one line

## 1.3.42 — Chat emoji

- The multiplayer chat box has an emoji button that opens a compact picker
- Choosing an emoji puts it in the message at the cursor. Enter still sends

## 1.3.41 — Public end-screen scoreboard

- After an expedition ends, the scoreboard reads the same verified public board as the rest of the site
- If that board has no rows, it says the board is empty. If the board cannot be loaded, it says so

## 1.3.40 — Clearer chrome

- Multiplayer, the lobby, and the leaderboard close with a round X. The title stays
- Links under Download for Windows read About, New, History, Verify, then a GitHub icon, each on one line
- The spectating line sits under the header on a blurred dark chip. The number is people watching, not the players or the host

## 1.3.39 — Live multiplayer rooms

- Hosting, joining, and watching open the room and keep the lobby, chat, and turns in sync
- Ready and Start talk to the room. If the host is gone, the next player can take the room
- A finished co-op run is sent in for a verified or rejected score, and the leaderboard shows verified rows
- Chat history stays with the people still in the room

## 1.3.37 — Verified scores

- A finished run is replayed on the server. The number on the public board is the score that replay produced
- A run that is too long to replay is refused. Shorter runs still count
- A changed log, a run used twice, someone else's run, a co-op score from anyone but the host, and a run that finished too fast are still refused

## 1.3.36 — Score submit checks

- A co-op score submission is checked against the current host of that room
- Knowing another player's run id does not throw that run away
- Too many score submissions in an hour are refused, and the run stays as it was

## 1.3.35 — Unknown finds and the aura switch

- Picking up a potion or a scroll no longer tells you what it is. Drinking, reading, and an identify scroll still do. The shop still names what you buy
- The floor bubble is only there in a multiplayer game, and it starts on. **AURA: ON** / **AURA: OFF** hides it. Off means creatures do not take that bubble's turn
- A solo expedition has no bubble and no switch. Creatures still take their usual turn

## 1.3.34 — Online co-op

- Optional multiplayer: host or join a room, watch a game, and chat with the party
- Solo play is the same expedition. Online menus say “Online unavailable” when the service cannot be reached
- A verified leaderboard is ready for scores the server has replayed. Unverified runs stay off the board

## 1.3.33 — Cooperation aura

- A flat bubble follows you on the dungeon floor (Ivan Wong). It is 20 tiles wide and 10 tiles tall, centered on you with the extra tile to the east and north
- The bubble is the ellipse of that rectangle. A creature on your floor is inside when its tile sits in the ellipse. The corners of the rectangle are outside it
- When you take a turn, only creatures inside your bubble take a turn. Creatures outside stay put, and a creature on another floor never acts
- Each creature acts once for the person who just moved. You have to stand together if you want the same creature to answer both of you
- The bubble is a flat unlit shape. Balanced play stays evenly lit: no fog, no bloom, no shadow map, and no extra light
- Town is unchanged

## 1.3.32 — Clearer caves

- Hall floors and the rock around them use different tints on the same stone (Ivan Wong). The floor reads lighter than the wall
- Deeper caves and the volcano use a warmer tint on that stone
- Stairs, doors, and the town exit carry a small unlit mark. Gold and items sit a little brighter on the pictures they already use
- A flat dark disc sits under you and under creatures, and you have a thin outline. It is not a cast shadow
- The wall that drops in front of the camera keeps a shorter lip
- Balanced play stays evenly lit: no fog when you zoom out, no bloom, and no shadow maps

## 1.3.31 — Monster hover card

- Hovering a creature you can already see opens a small card with its sprite, its name, and a short original note (Ivan Wong)
- Hidden creatures and mimics stay as they are: the old label, or nothing new, and no extra facts
- Floor items keep the one-line ground label
- Hit points stay off the card. The game does not reveal that number

## 1.3.30 — Reachable caves

- Every cave and volcano floor can be walked from where you enter (Ivan Wong). A room or hallway with no way in is joined by a door, or it is not built
- Original chart floors keep their rooms. A sealed room gets a door into the cavern you can already travel
- Stairs, monsters, and items go down after that, and only on tiles you can reach
- Rare-item chances, combat, town, and teleport landings are unchanged

## 1.3.29 — Rare find rates

- Six named rare finds change spawn chance only (Ivan Wong). Effects, stats, and the depths where they can appear stay the same
- Brass lamp is 5% (was 7.5%). Slayer is 5 points lower at every eligible depth, from 10% on D10 to 20% on V5, and still starts on dungeon 10
- Staff of power is 2 points lower at every eligible depth, from 11% on D8 to 23% on V5, and still starts on dungeon 8
- Sword of slashing, elven chain, and the orb of enlightenment use the closest 1–120 step: 7.5%, 8.333%, and 8.333%. The exact requested 7.333%, 8.133%, and 8.233% are not on that roll
- Other rare-item chances, caves, doors, combat, spells, and shops are unchanged

## 1.3.28 — Teleport landings

- A teleport stays on the map (Ivan Wong). Scrolls, the teleport spell, traps, and elevators never drop you outside the level
- In town, you land in town. The square is not a cave, and the rock around it is not a floor
- The destination is open floor with a step back into the level. Rock, a closed door, and a walled-off pocket are passed over
- A bad roll tries another open tile. If none is left, you do not move, and you are not left in the wall
- Caves, doors, combat, shops, and rare-item chances are unchanged

## 1.3.27 — Reachable floors

- A generated cave is kept only when every walkable tile connects back to where you start (Ivan Wong). A roll that leaves floor behind solid rock is thrown away and rolled again
- Stairs, monsters, and items are placed after that check, and only on tiles you can reach
- Original Ularn charts are not redrawn. Their rock stays. Stairs on those floors sit on the cavern you can actually travel
- No new tunnels, spines, or corridor doors. A treasure room still has one door, and only when that door opens onto the maze
- Combat, monster stats, spells, shops, textures, and save timing are unchanged

## 1.3.26 — Original caves, doors, and rare finds

- Dungeon floors are irregular Ularn `eat()` labyrinths again (Ivan Wong) — no density sculpt, no cross-map spine, no room-and-corridor rewrite
- The repeating weird-door floors were a fixed generated map library. Those depths now use the original Ularn canned maps, with a door only where that map has `D`
- Procedural floors have no corridor doors. A treasure room, when it appears, has one door in its outer wall
- Cave 1 still exits to town. D15 keeps the dead-end stair up and the Eye. Volcano 3–5 have no stair down; you go deeper by pit or trapdoor
- Rare artifacts are back to the original `rnd(120) < 8` roll. The brass lamp stays at its current slightly higher chance. Slayer’s chance still rises with depth
- Combat, monster stats, spells, shops, textures, and how often the game writes a save are unchanged

## 1.3.25 — Honest expedition-ended actions

- After death, the scoreboard overlay only shows actions that still work (Ivan Wong) — **New expedition**, plus **Enter** while the classic scoreboard is still waiting to open
- Hides inert **Continue / next page**, **Return to game**, and Esc close on a finished run (a dead character cannot return)
- Scoreboard copy points at a new expedition instead of “reload your browser”
- Gameplay, maze rules, saves, and live HUD chrome otherwise unchanged

## 1.3.24 — Quiet rats on the walls

- Tiny ambient rats scurry along dungeon wall tops (Ivan Wong) — decorative only: not clickable, not combat, not inventory, and they never block movement
- Hard-capped pool (4 per floor view), reused instances, no pathfinding against the player and no journal noise
- Town stays quiet; Balanced idle frames are not kept awake except during a brief near-camera scurry
- Labyrinth density, sealed doors, textured floors, quieter saves, journal cap, XP panel, north camera, and classic loot unchanged

## 1.3.23 — Stable long expeditions

- Soft-caps the scrollable journal so LOG and journal DOM cannot grow without bound on very long runs (still far past the old 7/20/60 caps)
- Snapshot reuses the log view between paints; world trusts structure/actor revisions so quiet walks skip re-hashing every known tile
- DEV `?perf=1` / `ularn3d.perf` records move timing, journal size, and heap when available
- Textured floors, dirty-only disk saves, labyrinth doors, XP panel, north camera, and classic loot unchanged

## 1.3.22 — Textured floors, quieter saves

- Dungeon floors show the classic stone texture again (MeshBasic flat lighting kept the maps; 1.3.20 had dropped sampling and left solid white ground)
- Texture maps stay locked unless a texture change is explicitly requested
- Moves keep an in-memory dirty snapshot only — disk writes happen on Save, Save & Exit, tab hide, or page unload, not every step
- Labyrinth density, sealed door throats, XP panel, north camera, classic loot, and flat cave lighting unchanged

## 1.3.21 — Door throats and labyrinth floors

- Corridor doors sit flush between connecting stone so keypad diagonals (1/3/7/9) cannot squeeze past without going through the door
- Closed doors also block diagonal corner-cuts in movement (open doors stay walkable)
- Classic `eat()` caverns keep the connectivity spine but use fewer/smaller chambers plus a light density sculpt so floors read more like a labyrinth
- Wall/open ratios track canned Ularn density more closely; huge empty halls and solid blocks are rejected
- Stairs, Cave 1 town exit, flat lighting, XP panel, north camera, classic loot, and rare goblin/treasure rooms unchanged

## 1.3.20 — Smoother browser dungeon walking

- Balanced mode turns off the shadow system entirely (no leftover sun/hero shadow pass in Chrome)
- Flat dungeon floors/walls stay unlit; Balanced skipped stone-map sampling (restored in 1.3.22)
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
