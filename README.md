# Ularn — The Caves Below

A complete, browser-hosted Ularn game with a Three.js 3D presentation. The original JavaScript Ularn engine powers the rules; this is not a reduced recreation of its mechanics.

Play the deployed game: <https://ularn-3d.vercel.app>

## Play locally

Requires Node.js 22.12+ (or a version supported by the pinned Vite release).

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Choose one of the eight original classes and begin an expedition. Arrow keys move and attack; the direction pad also supports diagonal moves. Click a known tile or select a town landmark to travel. Travel stops at visible danger, damage, confusion, blindness, or interaction prompts. Known traps are avoided unless selected as the destination. Drag the world to rotate the camera, scroll to zoom, and use the compass button to recenter.

- `i`: inventory; `c`: cast; `q`: drink; `r`: read; `w`: wield; `W`: wear; `d`: drop.
- `e` / Enter: enter a building; `>` / `<`: stairs; `o`: open; `t`: take; `.`: wait.
- `S`: save without ending the expedition. Escape cancels a prompt or opens the menu.
- Contextual buttons retain the original engine's full interactions and shop menus.
- Press `?` for the complete original manual, or open the field guide.

The objective is to retrieve the potion of cure dianthroritis from Volcano 5 and return home in time. The Eye of Larn on Dungeon 15 reveals demons. Original combat, spells, regeneration, equipment, shops, traps, death, and victory rules are preserved.

## Graphics

The world uses locally generated stone, grass, timber, and shingle textures, detailed town buildings, class-specific heroes, creature models, torch lighting, soft shadows, fog, reflective materials, and subtle bloom. Movement and combat have brief visual feedback. Foreground dungeon walls lower near the hero to preserve visibility.

Open **Menu → Graphics** to choose Cinematic or Balanced. Balanced reduces rendering resolution and disables bloom; phones select it by default. The setting persists on this device. Camera gestures do not consume turns. The title scene batches building geometry by material to reduce rendering work without reducing geometric detail. Reduced-motion preferences are respected. If the browser loses its graphics context, gameplay input pauses, a save is attempted, and rendering recovers when the context returns.

## Saves

A compressed, versioned autosave is stored in this browser's local storage after completed turns. Continue restores position, generated maps, monsters, inventory, stats, and game time. Menus and unfinished prompts do not replace the last stable save. Storage failures display an explicit message. Resume validates saved map dimensions and player state before loading. Legacy checkpoint, backup, and end-of-run save slots use a separate 3D namespace, preserving classic saves during play as well as on reload. Death or victory deletes the resumable expedition. Beginning another expedition replaces the current autosave. Saves belong to the exact web origin and device; preview and production domains have separate saves.

No account, database, API key, external assets, analytics, or score server is required by the 3D edition. Scores remain local. Global leaderboards, live broadcasts, weekly challenges, and remote replays from larn.org are intentionally not connected.

## Build and Vercel

```sh
npm run build
npm run preview
```

`dist/` is a standalone static website, containing HTML, JavaScript, CSS, and local assets. Serve over HTTP/HTTPS; ES modules cannot be opened directly via `file://`.

Import this directory as a Vercel project. `vercel.json` specifies Vite, `npm run build`, and the `dist` output directory. No environment variables or server functions are needed. Alternatively:

```sh
npx vercel deploy
npx vercel deploy --prod
```

A classic 2D fallback is available at `/engine/larn_local.html?ularn=true` for devices without WebGL2. Its saves use the original engine's storage keys, separate from the 3D edition's autosave.

## Verification

```sh
npm test
```

Start the dev server first. `TEST_URL` can select another server. `CHROME_PATH` can point to an installed Chromium executable; by default the tests use Chrome on macOS. Tests use isolated browser profiles and never access your normal browser data.

Tests cover character creation, movement, inventory, save/load, dungeon entry, collision, combat, rendering visibility rules, stores, spells, potions, all depth generation, death, local-only requests, mobile controls, all classes, corrupted saves, and the cure/victory sequence. Additional regression checks cover travel hazards, storage exhaustion, classic save isolation, touch gestures, building selection, both graphics settings, WebGL context recovery, mobile shops, GPU resource reuse across levels, cancellation of native auto-explore on pause, checkpoint/winner save isolation, complete multi-floor restoration, and real shop/bank transactions. Combat and late-game scenarios seed deterministic fixtures; these are integration checks, not a claim that every random playthrough has been exhausted.

## Attribution

Original Ularn by Phil Cordier, descended from Noah Morgan's Larn. This project vendors Jason Primeau's JavaScript Larn/Ularn 12.5.4, build 613, from <https://github.com/primeau/Larn> (retrieved September 16, 2026). Its MIT license is preserved at `public/engine/LICENSE`. Vendor library notices remain in their original files. Three.js is MIT-licensed.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the engine/presentation boundary.
