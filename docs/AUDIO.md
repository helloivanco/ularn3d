# Ularn audio

Music and effects start on Play or Continue, after that user gesture unlocks Web Audio. The top-bar Sound button is a master mute; Menu → Sound & music has separate volume sliders. Preferences persist in `ularn3d.audio.v1` without consuming turns or altering expedition saves. A saved mute choice stays muted on subsequent launches.

## Original soundtrack

The score uses a shared E-minor E–G–B–A–G motif with distinct arrangements:

| Scene | Track | Arrangement | Tempo / meter | Loop |
| --- | --- | --- | --- | --- |
| Title | The Caves Below | Soft strings, lute and flute | 72 BPM, 4/4 | 53.3 s |
| Town | Hearth of Ularn | Plucked lute, flute, bass and a light frame drum | 78 BPM, 3/4 | 36.9 s |
| Caves | Stone and Shadow | Low strings, distant bells and sparse flute | 64 BPM, 4/4 | 60 s |
| Volcano | Beneath the Ember | Low strings, plucked ostinato, bass and deeper drums | 88 BPM, 4/4 | 43.6 s |

Each scene has a synchronized mono tension stem. Visible nearby creatures and accepted attacks/casts raise it gradually; it fades as danger recedes. Unseen monsters never drive the music. Region changes crossfade for 1.8 seconds, and rapid transitions reject stale loads. Menus soften music; effects briefly duck it so impacts remain clear.

`scripts/build-audio.mjs` reproducibly composes and renders the score as local 22.05 kHz PCM WAV files. Plucked, breathy, bowed and bell timbres are synthesized from private deterministic oscillators/noise, with stereo early reflections baked into the beds. Note and reverb tails wrap around the loop boundary, and percussion has an attack ramp to avoid clicks. No external samples, soundfonts, accounts or streaming services are used. `public/audio/score.json` records length, channel count, RMS, peak and seam measurements. Beds peak at 0.42; stems at 0.5, leaving mixer headroom.

[Listen to the 18-second town / caves / volcano preview](audio/soundtrack-preview.wav).

## Action sounds

Weapon families combine swishes, body impacts and metal or wood resonances. Misses retain the swish without claiming an impact. All 39 spells retain distinct pitch, envelope and pulse patterns, with fire, electric, cold, healing, dark and arcane timbres. Footsteps vary across grass, stone and volcanic ash. Door/chest opening, potion use, reading, pickup, coins, stairs, death and victory have separate cues.

Bridge `ularn:action` events fire only for actual inventory consumption/pickup and changed doors/chests. Existing combat acceptance events drive attacks and casts. Merely opening or cancelling a prompt does not play the associated action. Main derives gold gains, floor transitions and endings from resolved snapshots. The renderer emits `ularn:footstep` near the end of each adjacent-tile stride, when the lifted foot returns to the floor. Reduced motion emits immediately. Blocked movement, teleports, menu interruption, camera reset and hidden windows do not leave stale footfalls. A private noise/variation generator keeps audio from consuming gameplay randomness.

Footsteps use a short, dry filtered scuff and a soft sole impact, with small pitch/level changes and alternating subtle stereo placement. They avoid a duplicate MP3 layer and reverb tails; an 85 ms minimum interval prevents rapid tapping from stacking bursts. Grass is softer than stone, and volcanic ash has a duller texture. Routine doors, pickups, coins, reading and stairs also use lower levels, while combat cues retain their existing levels. [Listen to the comparison](audio/footsteps-comparison.wav): previous stone footsteps, new stone, new grass, then new ash. Eight steps per two-second segment, separated by silence. The render uses identical default mixer settings; the new stone sequence measures approximately 17 dB lower RMS than the previous version. [Measurements](audio/footsteps-review.json). Regenerate with `FOOTSTEP_BEFORE=/path/to/previous-audio.js node scripts/review-footsteps.mjs`.

The mixer uses separate music/effects buses, modest room reverb, stereo positioning, gain ramps and dynamic compression. It caps FX at 24 voices and music at four sources during crossfades, trimming decoded buffers to the current pair once settled. Music playback uses buffers rather than a JavaScript note scheduler, keeping work off the movement/rendering loop.

## Playback recovery and verification

Hidden windows stop and disconnect music/FX, clear the reverb tail and suspend the context. Returning resumes the selected scene at its saved musical offset without replaying old attacks. Mute cancels pending FX and music loads. Failed context unlock or music loading leaves gameplay working and displays a retry control; missing music does not disable effects or retry on every turn.

The browser tests cover gesture activation, region races, tension, channel volumes, persisted mute, hide/resume, action acceptance, unavailable audio, missing files, and actual OfflineAudioContext sample energy/headroom. WAV checks verify synchronized loop durations, valid headers, audible RMS and clean seams. The offline desktop smoke also verifies music playback through `ularn://game/` after Play.

```sh
npm run audio:build
TEST_GPU=hardware npm test -- tests/audio.spec.js
npm run test:desktop
```

Read-only `ularnAudio.metrics()` reports enabled state, context/playback status, desired and playing regions, track, channel volumes, voice/source counts, cache size, tension and accepted-effect history.

## Historical local checks

These recorded checks and measurements describe the earlier local build before reconciliation with GitHub 1.3.62.

The browser regression checks passed, including the intentional spell-failure fixture after making that acceptance scenario deterministic. All nine audio checks also passed with software rendering. Production build, desktop protocol checks, and offline desktop playback/save/relaunch passed. Two publishing-only checks remain outside the local change.

On this Mac's Apple M2 Pro at 1440 × 1000, the production navigation benchmark with music enabled recorded 60.0 FPS, 17.7 ms frame p95 and 15.5 ms input-to-render p95. The audio context was running, playing the caves bed/stem pair with 2 music sources and 38 accepted effects. [Raw playback/performance record](audio/navigation-benchmark.json).
