# Verification — September 17, 2026

Production: https://ularn-3d.vercel.app

## Lemming artwork and landmark clarity

Production deployment `dpl_43Ke9i1W2m9rczhTM2A87Jr7a8aW` is READY at https://ularn-3d.vercel.app. Its immutable deployment is https://ularn-3d-5q0nz71hk-hellos-projects-dbb58047.vercel.app.

- The green-haired character was the original engine's artwork for its lemming monster. The 3D view now uses an original transparent rodent sprite, with the same species, statistics, behavior, and mirrored facing. The classic renderer retains its original artwork. Generation provenance and the exact prompt are in `docs/art/lemming.prompt.md`.
- Clicking stairs underneath the player now sends the correct up/down command instead of Enter. Stair arrival messages specify direction. Known dead-end stairs have blocked landings and explicit metadata; the volcano's usable surface shaft has a distinct label. The metadata was checked against all 84 level/direction/ruleset combinations in the original engine, without revealing hidden tiles.
- Fountain depletion remains an original gameplay rule. Real drinking and washing commands were exercised through depletion; water actions disappear, messages explain the dry state, the water animation drains, and dryness survives save/reload. The washing action now says "wash".
- Local checks: **12 passed** across focused runs, covering fountain state, stair commands/clicks, blocked-stair geometry, hidden-tile handling, species artwork/facing, title/class selection, and five compact viewports. The final independent read-only stair audit found no serious regression. Existing concurrent title-screen spacing edits were preserved and included in the layout checks.
- Production checks: **3 passed in 40.3 seconds**, covering actual fountain depletion/save restoration, downward stair clicking, and species artwork/facing. The live inspector verified exact application JavaScript, stylesheet, and engine SHA-256 hashes, successful 3D/classic startup, and no browser exceptions or console errors. Deployed assets are `index-Bqs4zf3i.js` and `index-Dko39EdA.css`.
- The Windows portable executable was rebuilt with the same changes: **101,676,574 bytes**, SHA-256 `eaef6c3bcff751c0b98a7d8793b501768741f37b2554180c6148b259391755d5`. All 73 embedded runtime files and 293 game/host files matched. Exact staged bytes, the live executable size/MZ signature/checksum, and the served rodent image hash were verified. Windows execution remains untested on this macOS host.
- Production build and `git diff --check` passed. These are focused regression checks, not exhaustive random gameplay coverage.

## Welcome-panel scrollbar correction

Production deployment `dpl_9p7aHTTf5XW9WMWoyw6Ru2MuZ4a6` is READY at https://ularn-3d.vercel.app. The decorative welcome backdrop extended 100px below its scroll container, creating a scrollbar even when the visible content fit. Its bottom now ends at the panel boundary; small screens retain real content scrolling.

- Reproduced the phantom overflow at 1440×1000: an 810px panel had 910px of scroll height. After the fix both are 810px.
- Local and live Chrome checks passed at 1440×1000, 1024×1100, 390×844, 1280×800, 900×700, and 568×320. Roomy layouts have no overflow; compact layouts have only actual content overflow, and the Windows download remains reachable by scrolling and browser hit-testing. The corrected desktop screenshot was visually reviewed. No page exceptions occurred.
- Verified the exact production stylesheet hash (`index-B4jSS58e.css`). The app bundle is `index-rPB4hqWE.js`. An attempted additional WebKit check could not launch because its Playwright runtime is not installed; these new checks are Chrome results.
- Rebuilt the Windows download with the same correction. All 73 embedded runtime files and 292 game/host files match; the served executable is 101,044,152 bytes with SHA-256 `3b9a54046e4112e818096afbae31690a94e78b461d9835d33e67df99f52fbbf5`. Verified staging bytes before deployment and the live download size/checksum afterwards. Windows execution remains outside this macOS verification.
- Production build and whitespace checks passed. This is a CSS-only gameplay presentation change; the earlier gameplay and SEO validation below remains applicable.

## Online release, optional Windows download, and SEO

Production deployment `dpl_H1Qo4xacoBT6Co8MoGmCnroG9961` is **READY** at https://ularn-3d.vercel.app. It promotes the tested preview `dpl_GY9kQ1UNGrZ4mEVH6PGMAP5nYFLo`, available at https://ularn-3d-m7u9aomh9-hellos-projects-dbb58047.vercel.app with Vercel preview protection. A temporary share link was provided separately; no protection settings were weakened.

- The title page offers browser play and an optional direct `/downloads/Ularn.windows.exe` download. The static `/about/` page explains classes, controls, local saves, graphics, and the Windows edition. Desktop and phone layouts were visually reviewed; the native edition hides website-only download controls.
- Both indexable pages have unique titles/descriptions, one H1, production canonicals, Open Graph/Twitter previews, and JSON-LD. `robots.txt` advertises the sitemap containing only `/` and `/about/`. Duplicate document URLs redirect permanently; engine/download responses are non-indexable and missing routes return real 404s. Production pages are indexable; the preview returns `X-Robots-Tag: noindex`.
- A new native Apple Silicon NSIS toolset successfully produced the single-file Windows x64 portable executable. It is **101,042,847 bytes** (96.4 MiB), with SHA-256 `9eeb78c4d17b0ab0eba8bae300082d878dcfa0334c2c898bfdb150cd887590f1`. Its 73 embedded runtime files and 292 game/host files match the local build. Download artifacts are excluded from desktop packaging to prevent recursive payloads.
- Downloaded the complete executable from the production site and verified the exact SHA-256 above. HEAD/range checks also confirmed the executable size, `MZ` signature, executable MIME type, attachment filename, and published checksum. The browser game and downloadable package include the gameplay feedback changes below.
- Local site checks: **4 passed**, with the deployment-only header/redirect check intentionally skipped. The existing title/class, movement/save, and five-size compact-layout checks also passed. An initial local guide check exposed Vite's SPA fallback; explicit multipage directory routing fixed it before deployment.
- Preview smoke passed: game startup and movement, guide route/classes, executable size/signature/attachment, real 404s, and no browser errors.
- Production checks: **7 passed in 48.2 seconds**, covering browser startup/class selection, movement/inventory/exact save restoration, static metadata without JavaScript, guide/download links, sitemap/social image, executable responses, redirects/indexability, and 404 behavior.
- The live inspector confirmed exact application JavaScript, stylesheet, and engine hashes; security headers; working 3D and classic views; and no browser exceptions or console errors. Current Vite assets are `index-BGuEBQKf.js` and `index-DqLsHnjs.css`.
- `npm run build`, two desktop protocol/security tests, and the native Electron save/relaunch smoke passed. The unsigned Windows executable was verified by extraction and hashing on macOS; execution on a Windows machine remains untested. Search-engine indexing itself is outside the deployment checks.

## September 17 gameplay feedback and desktop edition

These gameplay changes were initially verified locally and are now included in the online/Windows release above.

- Default gameplay camera elevation is approximately 60°. The desktop symbol map is 782px wide at a 1440px viewport (previous panel width: 250px), with no legend, `@` for the player, native monster/item glyphs, and distinct `<` / `>` stairs.
- Health, mana, actions, and the journal share a bottom bar. The child-cure quest card is removed. F2 toggles auto-loot, including gold; F3 toggles a persistent inventory panel with equipped-slot labels. Actual timed buffs and ailments appear in a right-side rail. Both toggles persist and consume no turn.
- Deterministic tests prove an awake dungeon gnome pursues and attacks on player turns. The game remains turn-based. Monsters now retain render identity while moving and use the original species-matched sprites. Facing is represented by mirroring and a ground direction marker; the source artwork does not include eight distinct directional views.
- Separate sound profiles cover ten weapon families and all 39 spells. Actual resolved combat events drive sound/casting poses/visible projectile trails. Rejected/cancelled spells stay quiet. Voices are bounded at 24 and explicitly released after playback or suspension; tests include muting a full voice pool and resuming.
- Rising and descending stairs have distinct geometry. Fountains drain visibly and remain dry. Spell effects use six reusable slots with bounded trail buffers, wall-clock expiration, and segment endpoints that do not cut across corners.
- Balanced rendering defaults to a 30 FPS cap and stops after settling; hidden windows stop scheduling frames. Cinematic caps active rendering at 45 FPS. Repeated movement, level changes, quality switches, and graphics recovery test GPU resource stability. Off-scene cached sprite textures release GPU registrations during recovery and clear on full disposal. Autosave compression is coalesced over two seconds, with immediate manual/exit saves.
- Reviewed final desktop and phone gameplay screenshots. Responsive hit-testing checks controls at 320×568, 360×640, 568×320, 844×390, and 900×700. Screenshots are in `docs/screenshots/feedback-town.png` and `feedback-dungeon.png`.
- Built `release/Ularn-1.0.0-windows-x64.zip` (~147 MiB), containing a real Windows x64 `Ularn.exe` and its offline runtime. All 74 ZIP entries passed integrity checks; 286 packaged application files matched final source/build output. SHA-256 is recorded in `release/SHA256SUMS.txt`.
- Desktop route/security tests and real Electron launch, fresh-profile creation, gameplay, save-before-close, and complete quit/relaunch restoration passed on macOS. Windows binary execution still needs a Windows machine. The initial ZIP release encountered an Intel NSIS compiler requirement; the later portable release above resolves that build limitation using a native compiler.

Final test results: the 45-case full browser run completed in 10.7 minutes with 44 passes and one development-hot-reload interruption in the building-roof click case. After updating that older test’s projection to the new overhead camera, its isolated rerun passed (23.4 seconds). The newly added 46th case, repeated recovery of off-scene sprite textures and full cache disposal, passed separately (28.7 seconds); the post-review spell/trajectory regression also passed. Thus all 46 current browser cases have passing results across the full run and focused reruns. Two desktop protocol/security tests and the real Electron save/relaunch smoke passed. JavaScript syntax and `git diff --check` passed.

These are bounded regressions and software-rendered browser checks, not an hours-long physical-GPU stress test or exhaustive random playthrough.

## Previous reliability audit

The icon release exposed gaps in the previous verification scope. This follow-up reproduced and corrected:

- Difficulty was restored as a number but was not reapplied to monster templates. For example, after resuming difficulty 3, a newly created gnome reverted from 3 HP / 2 damage / 7 armor to 2 HP / 1 damage / 10 armor. The adapter now resets the original template values and applies difficulty exactly once. Regression tests compare every template and representative newly spawned monsters at all four offered difficulties through two resumes, while checking that an already-wounded monster remains unchanged.
- The global game keyboard handler intercepted Enter/Space on focused interface buttons. Focused controls now receive normal browser activation. Tests cover guide, sound, pause/resume, inventory, save, and exactly one wait turn.
- Clicking an adjacent door queued a separate direction command 30 ms later. Open and its requested direction now complete synchronously through the original engine. If Open is rejected, no direction is sent. Tests check a single action, immediate follow-up inventory input, and confusion without unintended movement.
- The original equipment loader selected the last matching item when two inventory entries had identical item IDs/bonuses. New saves include exact WIELD/WEAR/SHIELD indices, validated and restored alongside the original state. Tests check duplicate weapons, armor, and shields through two reloads and compatibility with saves without the optional metadata.
- At 320px width, the pause button could be clipped; at phone landscape heights, HUD panels overlapped. Responsive layouts now keep controls and vitality/mana unobstructed at 320 × 568, 360 × 640, 568 × 320, 844 × 390, and 900 × 700. Tests use browser hit-testing, actual movement/menu input, a long hero name, and screenshots. The landscape title form is also exercised.

- WebKit reported stale WebGL resource deletion errors after context restoration, especially when subsequently resizing or replacing levels on a Retina display. The renderer now releases GPU disposal registrations during context loss, keeps the CPU artwork, and recreates GPU resources upon restoration. Two recovery cycles followed by quality, resolution, and level changes pass without browser errors; screenshots confirm that the recovered scene renders.

Validation results:

- Complete Chrome regression run: **34 passed**, 8.5 minutes, covering the gameplay/save/layout fixes. The subsequently isolated GPU cleanup is verified by focused follow-up checks below.
- Final-candidate Chrome follow-up: **3 passed**, 1.3 minutes, covering context recovery, compact layouts, and repeated Retina recovery with quality/resolution/level changes.
- Final-candidate WebKit regression run: **34 passed**, 1.0 minute. The only excluded case is the Chrome DevTools Protocol multitouch-injection test; that test passed in Chrome. All remaining cases, including repeated Retina recovery, run in WebKit.
- `npm run build` passed. The graphics fix was checked in an isolated candidate before the final toolbar-only CSS correction. The production assets are `index-D_VPN4Ps.js` and `index-BtTSIULK.css`.
- The first live pass found a 360px camera-toolbar overlap missed by the original center-only subset of controls. The final layout test includes camera controls and the timer, checking each control’s center and four inset corners. The toolbar now clears the journal in portrait; noninteractive toast notices do not intercept pointer input. Mobile controls/shop checks and the strengthened five-viewport WebKit test passed after this CSS correction.
- No browser exceptions or console errors occurred in either passing full run. Physical iPhones/Android devices, Firefox, and every possible randomly generated outcome are outside this verification scope.

## Final production verification

Deployment **`dpl_HV5qzRZUZq9XsbKjkcDRrXKCtMfb`** is READY and aliased to **https://ularn-3d.vercel.app**. Vercel built the final source successfully.

- **12 live-site checks passed in 45.3 seconds**: start/guide/class selection, movement/inventory/save/reload, shop/bank transactions, all four difficulty settings through repeated resumes, focused keyboard controls, door-click ordering, duplicate equipment slots, the strengthened five-viewport layout test, and repeated Retina graphics recovery.
- The final local compact-layout check also passed in Chrome (23.5 seconds), after the toolbar correction and stronger center/corner hit-testing.
- The final live inspector received HTTP 200, verified exact **SHA-256 matches for all three production artifacts** (application JavaScript, stylesheet, engine), confirmed security headers and cinematic rendering, and loaded the classic fallback. It recorded **no browser exceptions or console errors**.
- The temporary graphics-recovery preview was stopped after verification. The existing project preview and public deployment remain available.

Acceptance evidence:

| Requested outcome | Evidence |
| --- | --- |
| Complete 3D Ularn gameplay | Original 49-module rules engine, all eight classes and 20 underground floors, real input/combat/spells/item/shop tests, death and original victory callbacks, exact floor/inventory save round trips |
| Polished 3D presentation and icons | Rendered town/dungeon/item/creature fixtures, quality modes, GPU resource bounds, 143-call title rendering budget, 35 consistent SVG icons, inspected desktop/phone/landscape/Retina scenes |
| Reliable controls and persistence | Existing core suite plus difficulty, duplicate-equipment, focused-button, door-ordering, travel-interruption, classic-save-isolation, malformed-save, and storage-failure regressions |
| Browser and layout compatibility | Chrome suite and follow-ups; WebKit suite; actual control hit-testing at five compact sizes; repeated context loss/restoration on a simulated 2× display |
| Vercel-hosted release | READY production deployment, 12 passing live checks, exact deployed artifact hashes, live 3D/classic loads without errors |

These are verified acceptance checks, not a mathematical guarantee covering every random outcome or physical device. No unresolved failures remain in this audited scope.

## Icon refresh

- Replaced the 3D interface’s font-symbol icons with 35 original inline SVG designs, including all eight class emblems, inventory/actions, sound states, menus, camera controls, direction controls, and the Ularn sigil. Updated the favicon to match.
- All SVGs use a shared 24-unit grid and consistent stroke weight. Decorative SVGs are hidden from assistive technology; buttons retain their text or accessible names. Icons do not intercept pointer events.
- The hero emblem follows the selected class. Sound updates its visible icon, label, tooltip, and pressed state together.
- `npm run build` passed. Four existing browser regression tests passed in 51.1 seconds: title/guide/class selection, movement/inventory/save restoration, phone controls/dialogs/layout, and mobile shop interactions. No console errors or uncaught exceptions were recorded.
- Inspected the complete icon sheet at 40px and 18px, plus actual desktop and phone title/game/menu views. Dedicated checks also exercised sound toggles, class emblems, direction-pad waiting, and menu close controls at 1440 × 1000 and 390 × 844.
- Production deployment `dpl_AeBFDgK1kwQmtWviLQPPrZCCqPXe` was READY and aliased to https://ularn-3d.vercel.app. Its production build passed.
- Post-deployment desktop and phone icon/control checks passed with no browser errors. The live inspection confirmed HTTP 200, the current Vite bundle, an exact SHA-256 match for the engine bundle, expected security headers, and working cinematic rendering.

## Gameplay baseline before the icon refresh

- `npm run build`: passed. Static output is in `dist/`.
- `TEST_URL=http://localhost:4178 npm test`: **26 passed**, 5.5 minutes, against the final production bundle.
- Chrome runs in an isolated profile with SwiftShader software rendering. Desktop and 390 × 844 phone layouts were inspected. Physical phones were not tested; this baseline used Chrome, before the later WebKit audit.
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

## Previous gameplay deployment

Vercel deployment `dpl_C4MvQ5wEuoFw1P7u1MQc79JzXcfD` was **READY** and aliased to the production URL for that release. Vercel completed the production build successfully. **Seven live-site checks passed** (1.7 minutes): checkpoint/death isolation, paused native exploration, title rendering budget, all-floor save restoration, shop/bank transactions, title/class selection, and movement/inventory/save/reload.

The final live inspection confirmed HTTP 200, the tested Vite JavaScript bundle name, an exact **SHA-256 match of the served engine bundle** against `dist/engine/game.js`, the configured security headers, cinematic rendering, and a working classic fallback page. No browser exceptions or console errors were recorded. The title-scene draw-call comparison above is the controlled optimization measurement; software-rendered screenshot timings are not a physical-GPU performance benchmark.

This project deploys from the local Ularn directory. The unrelated parent Desktop Git repository was not modified or pushed. Its accidental initial connection to the Vercel project was removed during the original deployment.

The build has a non-fatal chunk-size advisory for the Three.js graphics runtime: approximately 648 kB uncompressed / 167 kB gzipped. All game assets are local; no application server or database is required.
