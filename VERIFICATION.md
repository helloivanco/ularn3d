# Verification — September 16, 2026

Production: https://ularn-3d.vercel.app

## Final local build

- `npm run build`: passed. Static output is in `dist/`.
- `TEST_URL=http://localhost:4178 npm test`: **26 passed**, 5.5 minutes, against the final production bundle.
- Chrome runs in an isolated profile with SwiftShader software rendering. Desktop and 390 × 844 phone layouts were inspected. Physical phones and other browser engines were not tested.
- Every test asserts no uncaught browser exceptions and no browser console errors. The final full run passed both checks throughout.
- Desktop town, dungeon, mobile title, mobile gameplay, mobile shop, and a fixture containing item/creature models were visually inspected.
- HTML element IDs are unique; custom JavaScript modules pass syntax checks.

## Final optimization and reliability pass

- Title-scene building batching reduced steady-state draw calls from **253 to 143 (43.5%)**, while triangle count remained **55,376**. The optimized scene was visually inspected. This is a measured draw-call reduction, not a claim of a 43.5% frame-rate gain on every GPU.
- Periodic checkpoints, backups, death, and winner-mail save slots now use the `ularn3d.legacy.` namespace. Browser tests reproduce the original checkpoint overwrite and verify that actual classic storage keys remain intact after checkpointing, reload, death, and victory.
- Pause/help/page-hide handlers interrupt native auto-explore as well as click-to-travel. The engine rechecks cancellation after awaited approach animations, and blocks input behind open dialogs or unavailable graphics.
- Removed calls to an uninstalled telemetry client while preserving genuine error/warning diagnostics in the browser console. The optional classic fallback uses the same local diagnostic behavior.
- Added exact round-trip coverage for all 20 generated underground floors, changed inventory, spells, gold, and bank balance.
- Verified actual shop purchases, deposits, and withdrawals through keyboard prompts.

## Coverage

The suite covers all eight classes, movement, collision, combat, spell casting, potion use, shops, inventory, all 20 underground levels, hidden traps, invisible demons, blindness, death, local scores, corrupted saves, and the original homecoming/victory sequence.

Additional checks exercise:

- Stopping travel immediately after damage, including damage after regeneration.
- Avoiding known traps and stopping travel while confused.
- Explicit storage-quota failure messages, without leaving the game.
- Preserving classic-edition saves when restoring a 3D expedition.
- Mouse drags and real browser multitouch events without accidental movement.
- Clicking a building roof and arriving at that building's actual tile.
- Mobile shop controls within the scrollable interaction panel.
- Cinematic/Balanced switching and WebGL context loss/restoration, with keyboard and engine input paused during graphics loss.
- Rendering item/creature families and bounded GPU geometry/texture counts across repeated level changes.
- Gameplay and saves without external services.

An initial multi-class run exceeded the generic 45-second test timeout during its eighth complete app initialization. That specific test now allows 120 seconds; the latest full run completed it in 49.9 seconds. A synthetic-touch test was replaced with real browser touch input, because synthetic pointer IDs cannot obtain browser pointer capture. Neither failure was ignored in the final run.

Difficult-to-reach scenarios use fixtures. This is not an exhaustive playthrough of every random outcome, nor a guarantee of defect-free operation on every browser/device.

## Deployment

Vercel deployment `dpl_C4MvQ5wEuoFw1P7u1MQc79JzXcfD` is **READY** and aliased to the production URL. Vercel completed the production build successfully. **Seven live-site checks passed** (1.7 minutes): checkpoint/death isolation, paused native exploration, title rendering budget, all-floor save restoration, shop/bank transactions, title/class selection, and movement/inventory/save/reload.

The final live inspection confirmed HTTP 200, the tested Vite JavaScript bundle name, an exact **SHA-256 match of the served engine bundle** against `dist/engine/game.js`, the configured security headers, cinematic rendering, and a working classic fallback page. No browser exceptions or console errors were recorded. The title-scene draw-call comparison above is the controlled optimization measurement; software-rendered screenshot timings are not a physical-GPU performance benchmark.

This project deploys from the local Ularn directory. The unrelated parent Desktop Git repository was not modified or pushed. Its accidental initial connection to the Vercel project was removed during the original deployment.

The build has a non-fatal chunk-size advisory for the Three.js graphics runtime: approximately 643 kB uncompressed / 165 kB gzipped. All game assets are local; no application server or database is required.
