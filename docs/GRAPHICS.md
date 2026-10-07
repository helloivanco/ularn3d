# Graphics and fluidity verification

The 3D edition uses species-indexed creature rigs, class-specific heroes, separate procedural surface maps, spatial terrain/prop batching, bounded movement interpolation, and worker-compressed stable saves. The original engine remains authoritative for every turn, interaction, visibility check, and save state.

## Graphics settings

| Setting | Resolution cap | Shadows | Nearby torch lights | Effects |
| --- | --- | --- | --- | --- |
| Auto · low tier | 0.65 pixel ratio | Off | Off | None |
| Auto · starting / Balanced | 0.75 pixel ratio | Off | Off | None |
| Auto · high tier | 1.0 pixel ratio | Off | Off | None |
| Cinematic | 1.5 pixel ratio | 2048 | Up to four in town | Bloom, ambient occlusion and SMAA |

Resolution never exceeds the device pixel ratio. All settings target 60 FPS during gameplay. Auto lowers quality after two seconds with active frame p95 above 20 ms and raises it gradually after ten seconds below 19 ms; idle time contributes no headroom. Long active stalls remain visible to the controller even though animation integration clamps its timestep. Auto spends headroom on sharper native-resolution rendering, with the expensive effects stack reserved for explicit Cinematic selection. Auto and Balanced stop settled scenes, Cinematic idles at 12 FPS, and native game panels and dialogs use reduced background rendering. Hidden windows suspend rendering. Reduced motion snaps locomotion and disables decorative motion.

The first held direction is immediate, with a 220 ms initial delay and 140 ms repeat interval. Release, focus loss, menus, prompts, graphics loss, and level transitions cancel it. Timers never catch up missed turns. Click travel uses the same cadence, rechecks each step, stops on displacement or danger, without drawing route lines or destination markers. The compact symbol map follows the hero; Expand provides full-floor pan/zoom planning.

## Historical local measurements

These measurements and the verification counts below describe the earlier local build, before reconciliation with GitHub 1.3.62. They are retained as historical evidence and do not measure the combined 1.3.63 release.

Measured on October 7, 2026 in hardware-accelerated Chrome on this Mac's Apple M2 Pro, at 1440 × 1000 and device pixel ratio 1. The original checkout ran its default Balanced renderer; the production build ran Auto and remained at its Balanced tier. Both rendered the same seeded, fully explored Dungeon 1 with creatures removed, then processed 36 alternating movement inputs at 140 ms intervals. Matching tile fixtures have SHA-256 `12288930db25c54d252bf2d42b1536a07b39e660367b358981511689fdc13ec9`.

| Measurement | Original | Upgraded production build |
| --- | ---: | ---: |
| Average active FPS | 21.6 | 60.0 |
| Frame interval p95 | 51.4 ms | 17.1 ms |
| Average draw calls per rendered frame, including shadows | 322.0 | 115.9 |
| Input-to-render latency p95 | Not instrumented | 17.2 ms |
| Presentation update p95 | Not instrumented | 0.5 ms |

Average draw calls fell 64.0%. The frame p95 meets the 20 ms target and input latency meets the 50 ms target on this fixture and machine. These are hardware measurements, separate from software-rendered functional checks; they do not establish performance on every device or densely crowded scene.

After generating all 21 floors, the background save captured JSON in 9.3 ms and wrote storage in 0.1 ms. Compression took 73.5 ms in the worker. Manual and exit saves intentionally remain synchronous. [Raw measurements](graphics-benchmark.json) preserve the GPU identity, fixture hash, frame samples, draw-call range, and save timings.

## Verification

- Full hardware-accelerated browser suite: 78 passed; two deployment-only checks skipped because publishing and packaging are outside this change.
- Software-rendered core checks: all 24 passed, including held input, route cancellation, adaptive quality, save ordering/fallback/failure, death/victory during compression, and context/resource recovery. The victory check was rerun after reducing native-panel background rendering.
- Desktop protocol checks and offline Electron smoke passed, including real worker autosaving through `ularn://game/`, manual close saving, exact resume, renderer isolation, and network blocking.
- Portrait/landscape control coverage passed across 320 × 568, 360 × 640, 568 × 320, 844 × 390, and 900 × 700. The rapid-resize regression also passed five consecutive runs.
- Creature bounds and shared geometry are checked for all 65 species. All eight classes retain their original engine attributes/equipment. Context recovery, Retina resizing, all-floor saves, visibility, combat, stores, stairs, and victory remain covered.

Run the dev server, then:

```sh
TEST_GPU=hardware npm test
npm test -- --grep 'held movement|keyboard hold|direction pad|click routes|context recovery|compression'
npm run test:desktop
node scripts/benchmark.mjs
node scripts/visual-graphics.mjs
```

The benchmark also accepts two URLs to compare a baseline with a build. It uses isolated profiles and writes `test-results/graphics-benchmark.json`. Visual capture uses a local dev server and saves deterministic review scenes and complete galleries. `ularnGraphics.metrics()`, `creatures()`, `landmarks()`, `projectTile()`, and `ularnPersistence.metrics()` expose read-only diagnostics.

## Visual review

[All 66 creature models](screenshots/creatures-gallery.png) · [Eight hero models](screenshots/heroes-gallery.png) · [Town](screenshots/feedback-town.png) · [Caves](screenshots/feedback-dungeon.png) · [Volcano](screenshots/volcanic-gameplay.png) · [Cinematic](screenshots/cinematic-volcano.png) · [Expanded map](screenshots/expanded-map.png) · [Phone](screenshots/mobile-graphics.png)

## Rendering stability

Neighboring wall caps no longer overlap. Wall cutaways ease from the displayed position, use hysteresis and settle; translucent building fades avoid writing depth. Shadow projections retain a stable light-space texel phase and refresh moving geometry at 30/60 Hz. A zoom-sensitive range keeps shadows in view. Torch assignments survive distance ties, fade down before moving, and use only gentle 1.2% variation. Color, normal and roughness maps have mipmaps and anisotropic filtering. Flames and ground indicators do not cast tiny unstable shadows. Higher tiers use SMAA before output mapping, with lookup images embedded locally. Damage briefly highlights health without changing the whole scene palette.

`tests/render-stability.spec.js` verifies shadow phase, lamp identity and zero-intensity handover, disjoint cap bounds, smooth cutaway settling, batching flags and repeated-damage feedback.

The 1.3.65 repair uses exact one-tile floor, wall and cap footprints. Neighboring surfaces share edges without overlapping area; wall bases sit on the floor at −0.015, and cap undersides meet wall tops. This replaces undersized wall bodies, oversized full caps and floating cutaway caps. Town building materials write depth when solid, and the previously disconnected building-cutaway update now runs for a cached list of town buildings. It disables depth writing while a building fades around the hero and restores it when opaque. Roof color maps use trilinear mip blending to avoid abrupt detail changes during zoom/orbit; stone filtering remains unchanged. No triangles, lights or render passes are added. `tests/surface-seams.spec.js` checks the actual World matrices and browser fade/depth restoration; zoom brightness compares the same floor patch at both distances.

The stability update passed 55 hardware browser checks, all five production stability checks with software rendering, the production build, and offline desktop protocol/smoke tests. Town, cave, volcano, Cinematic, phone and complete galleries were visually reviewed. On the Apple M2 Pro at 1440 × 1000 in Auto, the updated production fixture recorded 60.0 FPS, 18.5 ms frame p95, 16.3 ms input-to-render p95 and 122 average draw calls. Combat recorded 60.0 FPS and 18.4 ms frame p95. [Stability benchmark](render-stability-benchmark.json).

## Walking presentation

The 140 ms articulated, collision-aware step matches the held-direction repeat interval. Smaller leg/arm swings, knee flex, counter-rotating ankles and a restrained 0.019-unit body lift replace the earlier marching bounce. Smoothstep translation reduces the burst of speed in each tile crossing; rapid input blends from the displayed limb pose. A renderer footfall event at 88% of the stride aligns the quiet scuff with the plant. Reduced motion resets the complete rig and emits the accepted step immediately. The earlier 280 ms glide helper and its historical captures remain in the preserved local work. Input remains immediate and retargets the current displayed position without queuing. Feet alternate with displayed distance, body bob is subtle, and the weapon arm stays steadier during walking. Creature interpolation and combat animation retain their existing timings. World and map path lines and destination markers have been removed; click travel and its safety checks remain active. `routePoints` retains internal travel diagnostics and `routeVisible` is false. Desktop and phone walking captures are in `screenshots/walking-desktop.png` and `screenshots/walking-mobile.png`.

## Full cast review in 1.3.64

All eight player classes and all 66 enemies were inspected from front, back and actual gameplay-camera elevations. The Rogue hood and serpent proportions now use relative scales. Every enemy has an exact-ID model, including the loot goblin. Class rigs retain their named limbs and actual starting weapon. Enemy families use distinct anatomy and authored joint rest rotations; mirrored wing triangles retain correct winding after batching. Enemy gait strength eases in over a 35 ms time constant and settles over 55 ms, with smaller arm/leg swings and restrained body lift. The renderer stays active during the short settle; reduced motion immediately restores all authored rest rotations. Animation state is per instance and never uses engine randomness.

Run `node scripts/visual-characters.mjs` against the development server to regenerate the three-angle galleries and geometry measurements. `CHARACTER_OUTPUT` selects another output folder. The node checks cover native enemy coverage, corridor-sized player bodies, finite/shared enemy geometry, reduced-motion rest poses and wing winding. The historical benchmark numbers above have not been rerun for this model pass.

[Front views of all enemies](screenshots/creatures-front.png) · [Back views of all enemies](screenshots/creatures-back.png) · [Player front views](screenshots/heroes-front.png) · [Player back views](screenshots/heroes-back.png) · [In the caves](screenshots/characters-desktop.png) · [On a phone](screenshots/characters-mobile.png)

## Graphics boost and latency in 1.3.64

Stone, grass, wood and roof generation now use the same logical coordinates at 128/512 pixels, aligning color, normal and roughness detail instead of cropping different patterns. Shared wall vertices bake a restrained vertical shade gradient so even unlit caves have depth. Existing player/enemy contact fans feather to transparent at their edges. These changes retain terrain maps, topology, instancing, geometry budgets and the existing render passes; textures remain cached and are never regenerated while walking. The shared world renderer applies them to solo and online views.

Paired production builds were measured on October 8, 2026 in hardware Chrome on the Apple M2 Pro. Baseline commit `fec1f0a` and the graphics boost ran identical seeded scene hashes and engine action outcomes, with music and native combat enabled, using 96 directional inputs at 140 ms intervals per scene. The phone case emulates a 390 × 844, DPR 2 layout on this Mac; it does not measure phone hardware. Other scenes use 1440 × 1000, DPR 1.

| Scene | Baseline frame p95 | Boost frame p95 | Boost input-to-render p95 | Active FPS |
| --- | ---: | ---: | ---: | ---: |
| Town | 18.4 ms | 18.4 ms | 16.5 ms | 60.0 |
| Caves | 18.4 ms | 18.5 ms | 15.7 ms | 60.0 |
| Volcano | 18.2 ms | 18.5 ms | 15.2 ms | 60.0 |
| Phone cave layout | 18.4 ms | 18.4 ms | 16.6 ms | 60.0 |

Every boosted run reached Auto high at native-resolution cap 1.0; the baseline stayed at 0.75. Average draw-call differences ranged from −0.2 to +0.4, reflecting motion/culling at capture rather than added passes. Render callback p95 remained 2.2–3.7 ms. These measurements establish the budget on this machine and fixtures, not every GPU or scene. [Complete measurements](graphics-boost-benchmark.json).

Run `GRAPHICS_OUTPUT=/path/to/output node scripts/benchmark-scenes.mjs BASELINE_URL CANDIDATE_URL` to reproduce. Separate profiles, seeded first-start interception, fixture hashes and equal action counts keep the comparison valid. Hardware benchmarks should run without other graphics tests concurrently. Functional checks additionally cover Auto high across all three regions, fallback after sustained slow frames, mapped terrain, zoom brightness, cutaways, idle rendering, context recovery, replay and long expeditions.

[Before](screenshots/graphics-boost-before.png) · [After](screenshots/graphics-boost-after.png) · [Town](screenshots/graphics-boost-town.png) · [Volcano](screenshots/graphics-boost-volcano.png) · [Phone layout](screenshots/graphics-boost-phone-caves.png)
