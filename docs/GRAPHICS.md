# Graphics and fluidity verification

The 3D edition uses species-indexed creature rigs, class-specific heroes, separate procedural surface maps, spatial terrain/prop batching, bounded movement interpolation, and worker-compressed stable saves. The original engine remains authoritative for every turn, interaction, visibility check, and save state.

## Graphics settings

| Setting | Resolution cap | Shadows | Nearby torch lights | Effects |
| --- | --- | --- | --- | --- |
| Auto · low tier | 0.75 pixel ratio | 512 | 2 | None |
| Auto · starting / Balanced | 1.25 pixel ratio | 1024 | 4 | None |
| Auto · high tier | 1.5 pixel ratio | 2048 | 6 | Bloom, ambient occlusion and SMAA |
| Cinematic | 1.75 pixel ratio | 2048 | 6 | Bloom, ambient occlusion and SMAA |

Resolution never exceeds the device pixel ratio. All settings target 60 FPS during gameplay. Auto lowers quality after two seconds of sustained active overload and raises it gradually after ten seconds of active headroom; idle time contributes no headroom. Auto and Balanced stop settled scenes, Cinematic idles at 12 FPS, and native game panels and dialogs use reduced background rendering. Hidden windows suspend rendering. Reduced motion snaps locomotion and disables decorative motion.

The first held direction is immediate, with a 220 ms initial delay and 140 ms repeat interval. Release, focus loss, menus, prompts, graphics loss, and level transitions cancel it. Timers never catch up missed turns. Click travel uses the same cadence, rechecks each step, stops on displacement or danger, without drawing route lines or destination markers. The compact symbol map follows the hero; Expand provides full-floor pan/zoom planning.

## Measured production result

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

[All 65 creature models](screenshots/creatures-gallery.png) · [Eight hero models](screenshots/heroes-gallery.png) · [Town](screenshots/feedback-town.png) · [Caves](screenshots/feedback-dungeon.png) · [Volcano](screenshots/volcanic-gameplay.png) · [Cinematic](screenshots/cinematic-volcano.png) · [Expanded map](screenshots/expanded-map.png) · [Phone](screenshots/mobile-graphics.png)

## Rendering stability

Neighboring wall caps no longer overlap. Wall cutaways ease from the displayed position, use hysteresis and settle; translucent building fades avoid writing depth. Shadow projections retain a stable light-space texel phase and refresh moving geometry at 30/60 Hz. A zoom-sensitive range keeps shadows in view. Torch assignments survive distance ties, fade down before moving, and use only gentle 1.2% variation. Color, normal and roughness maps have mipmaps and anisotropic filtering. Flames and ground indicators do not cast tiny unstable shadows. Higher tiers use SMAA before output mapping, with lookup images embedded locally. Damage briefly highlights health without changing the whole scene palette.

`tests/render-stability.spec.js` verifies shadow phase, lamp identity and zero-intensity handover, disjoint cap bounds, smooth cutaway settling, batching flags and repeated-damage feedback.

The stability update passed 55 hardware browser checks, all five production stability checks with software rendering, the production build, and offline desktop protocol/smoke tests. Town, cave, volcano, Cinematic, phone and complete galleries were visually reviewed. On the Apple M2 Pro at 1440 × 1000 in Auto, the updated production fixture recorded 60.0 FPS, 18.5 ms frame p95, 16.3 ms input-to-render p95 and 122 average draw calls. Combat recorded 60.0 FPS and 18.4 ms frame p95. [Stability benchmark](render-stability-benchmark.json).

## Earlier walking presentation

The hero now uses the earlier exponential glide, normalized to a bounded 280 ms finish. Input remains immediate and retargets the current displayed position without queuing. Feet alternate with displayed distance, body bob is subtle, and the weapon arm stays steadier during walking. Creature interpolation and combat animation retain their existing timings. World and map path lines and destination markers have been removed; click travel and its safety checks remain active. `routePoints` retains internal travel diagnostics and `routeVisible` is false. Desktop and phone walking captures are in `screenshots/walking-desktop.png` and `screenshots/walking-mobile.png`.
