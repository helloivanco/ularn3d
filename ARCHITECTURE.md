# Architecture

## Runtime

This is a static Vite application. Three.js renders the world with a perspective camera, shadows, fog, procedural meshes, and pointer controls. There is no application backend.

`public/engine/` contains the original JavaScript Larn/Ularn source and assets. `scripts/build-engine.mjs` concatenates its classic scripts in upstream load order, then appends `src/bridge.js`, producing `public/engine/game.js`. The Vite build copies this bundle and other public assets into `dist`.

## Authority and state

The original engine owns level generation, player attributes, items, monsters, movement, turns, combat, spells, shops, traps, time limits, and endings. The 3D UI sends ordinary engine commands through `window.ularn.key()`. It does not independently simulate gameplay.

The bridge exposes `start`, `snapshot`, `key`, `save`, `hasSave`, and `interruptTravel`. Snapshot construction filters unexplored tiles, hidden traps, invisible monsters, and blindness using the engine's knowledge flags and visibility checks. The presentation never treats its meshes as authoritative collision data.

`src/world.js` renders known tiles and follows the player. `src/materials.js` caches procedural surface maps and materials. `src/models.js` builds the player, buildings, creature families, terrain objects, and items from local procedural geometry. `src/main.js` owns HUD updates, input, contextual-menu layout, known-tile pathfinding, minimap, camera controls, sound, and start/pause/help flows. Creature species remain distinct in the engine; the models share visual families.

Native engine context buttons and its terminal panels remain available for the complete set of original commands. The bridge namespaces their IDs, replaces the engine's absolute page layout, and disables upstream telemetry and online services. The classic fallback uses a small `offline.js` hosting adapter for the same network isolation.

The vendor source has two small adapters: `store.js` only advertises replay links when recording is enabled, and `explore.js` rechecks cancellation after awaited approach animations. The latter prevents an interrupted native explorer from taking a queued step after a pause or manual command. Combat and progression rules are unchanged. Known floor and wall tiles are GPU-instanced. Static terrain and buildings in both the title scene and gameplay are merged by material; reusable model geometries are shared. Replaced merged geometry and landmark textures are disposed when levels change. Shadows update when the scene or nearby cutaway walls change. A PMREM environment supplies material reflections; cinematic rendering adds bloom and output color conversion. Context restoration regenerates the reflection environment. Read-only `ularnGraphics.metrics()` reports rendering and GPU resource counts for diagnostics.

## Persistence

The autosave key is `ularn3d.expedition.v1`. Saves contain a version and the engine's complete `GameState`, compressed with the bundled LZString library. Saving only happens between stable turns: never during a blocking callback, animation, or after death. Saves are synchronous at page exit to avoid losing a pending worker write. The original `S` command is adapted to save without invoking the legacy save-and-die path.

Resume calls the original `loadState` after structural validation, avoiding legacy save deletion. All original save-slot, backup, checkpoint, and winner-mail keys are redirected to a `ularn3d.legacy.` prefix; periodic checkpoints and endings therefore preserve classic save slots. Preferences and local leaderboard handling remain as before. Save errors dispatch a presentation event immediately. Informational telemetry is disabled; original error/warning diagnostics remain visible in the local browser console. The UI interrupts both its own route timer and the native engine explorer when pausing, opening help, or hiding the page. Input is also gated while a dialog is open or graphics are unavailable. Original local score handling is retained. Global scores, recorded replays, and the weekly challenge service are not attached to this fork.

## Deployment

`npm run build` produces `dist`; Vercel serves those static files. No SPA wildcard rewrite is needed because the game has a single route and a directly served classic fallback. Source scripts and the original engine license are kept with the project. `package-lock.json` pins dependencies.

## Validation boundaries

Playwright verifies actual browser input, presentation state, and serialized reloads. Fixtures seed difficult-to-reach scenarios such as demon visibility, death, and quest completion, then exercise the original callbacks. No gameplay cheats or test-only endpoints are included in the UI. Automated verification reduces regression risk; it cannot prove that a large random roguelike has no defects.
