# Ularn audio

Music and effects start on Play or Continue, after that user gesture unlocks Web Audio. The top-bar Sound button is a master mute; Menu → Sound & music has separate volume sliders. Preferences persist in `ularn3d.audio.v1` without consuming turns or altering expedition saves. A saved mute choice stays muted on subsequent launches.

## Original orchestral score

Ularn has an original orchestral score: layered strings, horns, trombones and tuba, flute, alto flute, oboe, English horn, clarinets and bassoon, harp, celesta, glockenspiel, a wordless choir, timpani and orchestral percussion. Everything is composed in this repository and synthesized offline. No recordings, samples or soundfonts are used.

### The Ularn motif

One leitmotif threads every region: **E–G–B | A–G–F#**, a rising minor triad answered by a turn that stops on the second degree instead of resolving. Each region recasts it:

| Region | Floors | Track | Meter / tempo | Loop | Form | How the motif appears |
| --- | --- | --- | --- | --- | --- | --- |
| Town | Surface | Hearth of Ularn | 6/8, ♩. = 56 | 68.6 s, 32 bars | Intro · A · A′ · B · coda | Flute states it over a harp ostinato; violins take it with an oboe answer and warm horns; in the B section cellos and bassoon turn it towards A minor, F Lydian and a borrowed C minor under a cold high pedal; a distant horn recalls it in the coda |
| Caves | 1–7 | Stone and Shadow | 4/4, ♩ = 60 | 96 s, 24 bars | Intro · A · B · A′ | Low alto flute with celesta echoes; the bass clarinet then carries it through chromatic mediants (Em → Gm → E♭maj7 → Cm → Am → F) under a descending horn line; veiled high violins close it over a choir |
| Deep caves | 8–15 | The Deep Halls | 4/4, ♩ = 52 | 92.3 s, 20 bars | Intro · A · B | Augmented to half speed in bass clarinet and horns, bent to F natural (Phrygian); a cold solo violin sings it in long tones over a low choir, a B♭/E tritone and glass-like glockenspiel |
| Volcano | V1–V5 | Beneath the Ember | 4/4, ♩ = 84 | 91.4 s, 32 bars | Intro · A · B · A′ · bridge | Horns and trombones in augmentation over a Phrygian spiccato riff (E–F–E–G–F–E–D), the turn bent to F natural; violins and bassoon answer over A minor and B♭; the bridge falls C–B♭–A–F back to E |

The title screen never plays music on its own, so the title region shares the town files.

Harmony is voice-led rather than block-chorded. `scripts/audio/theory.mjs` voices every pad and choir chord from the chord chart, keeps the thirds, sevenths and colour tones, minimises motion between chords, and penalises parallel fifths and octaves against the bass. Melodies and countermelodies are written out by hand in `scripts/audio/score.mjs`. Each line carries a phrase-level dynamic arc, onsets are humanized per section, and section balance keeps the lead about 3 dB above its accompaniment.

### Vertical intensity

Each region pairs a stereo bed with a two-channel stem whose channels are separate layers, all sharing the bed's chord chart:

- **Stir** (channel 0): spiccato low strings or the volcano riff in violas, with timpani and taiko pulse.
- **Fray** (channel 1): horn calls, low brass stabs or swells, string tremolo, choir, bass drum, timpani rolls and cymbal swells into section downbeats.

Danger (visible nearby creatures, or 0.85 for four seconds after a blow or cast) brings in stir from about one nearby creature and fray as it approaches three; menus halve it. Each layer eases in and out over about a second. The build trims stir so it lifts the region by 1.5 LU (−18 → −16.5 LUFS) and fray by a further 2.2 LU (→ −14.3 LUFS). Both layers ride one buffer source split by channel, so a region still costs two music sources and a crossfade stays within four.

### Stingers

Short orchestral cues share one sprite, `stingers.flac`. Their slots are defined in `src/audio-score.js`.

| Cue | When | Length | Music |
| --- | --- | --- | --- |
| Level up | Rank rises | 4.4 s | Harp glissando, then trumpets and horns play the motif's triad in E major over tremolo strings, timpani and celesta |
| Descent | First visit to a deeper floor | 5.2 s | Tam-tam bloom, falling harp, low horns and bass clarinet descending B–G–E, a choir "oo" closing to a hum |
| The cure | The cure potion is found | 5.8 s | Celesta plays the motif in E major while a choir moves from C to E major, the chromatic mediant; harp and glockenspiel shine on top |
| Death | The expedition ends in death | 7.6 s | English horn plays the motif and stops on F#, unresolved, over E minor, C minor/E♭ and a bare fifth; tam-tam |
| Victory | Winning | 10.6 s | Timpani roll, then the full motif in E major for trumpets, horns and violins, closing on C–D–E (♭VI–♭VII–I) with cymbal and choir |

Stingers follow the music volume, bypass the duck and the low-health muffle, and hold the score down while they play (level up 0.32, descent 0.38, cure 0.28). Revisiting a floor, playing with music at 0, or playing before the sprite has loaded falls back to the earlier short synthesized cues on the effects bus.

### Generation, mastering and licensing

`npm run audio:build` composes and renders everything reproducibly in about three and a half minutes. Every note, humanization and noise source is seeded, so it needs no network or external tools. Passing one region (`npm run audio:build -- caves`) re-renders only that region.

- **Synthesis** (`scripts/audio/instruments.mjs`):
  - Strings: sections of detuned band-limited sawtooth players with delayed vibrato, pitch drift, bow-hair noise, brightness that follows dynamics, and body resonances. Articulations are legato, tremolo, spiccato and harmonic.
  - Brass: brightness rises with loudness, plus a lip scoop into pitch and formants.
  - Woodwinds: register spectra, breath and a delayed vibrato.
  - Harp and pizzicato: tuned Karplus-Strong strings.
  - Celesta and glockenspiel: modal bars.
  - Choir: detuned singers through gliding vowel formants.
  - Percussion: modal timpani, taiko, tam-tam bloom and cymbal swells.
- **Space** (`scripts/audio/dsp.mjs`): an eight-line feedback-delay-network hall with early reflections, sized per region from a 2.1 s town hall to a 5.6 s deep cave. Sections sit at orchestral seating positions with distance-based sends. Loops are rendered twice, keeping the steady-state second pass, so note and reverb tails cross the seam exactly as in continuous playback.
- **Mastering**: each bed is set to −18 LUFS integrated (ITU-R BS.1770-4, gated). One lookahead true-peak limiter (4× oversampled) holds the full-intensity sum of bed, stir and fray at or below −1.3 dBTP, and every file is limited on its own as a backstop. Stingers are −17 LUFS. `MUSIC_TRIM` (0.061) in `src/audio.js` keeps the in-game music level where the earlier −20.3 LUFS beds played.
- **Files**: the beds are 32 kHz stereo at 14-bit precision, and the layers 24 kHz at 12-bit, which they can afford because the bed masks them. Both use TPDF dither and are stored as lossless 16-bit FLAC.
  - The FLAC encoder is dependency-free (`scripts/audio/flac.mjs`); its "wasted bits" coding drops the unused low bits.
  - Chrome, Firefox, Safari and Electron decode FLAC natively. The build round-trips every file through a reference decoder, and a browser test checks the decode bit-exactly against checksums.
  - Only the current region's pair is fetched. The stinger sprite loads after the first region starts.
- **Sizes**: town 6.65 MB, caves 8.22 MB, deep caves 7.44 MB, volcano 8.54 MB, stingers 1.73 MB: **32.6 MB in total**. The earlier PCM set was 25.5 MB, of which 7 MB was a title bed that never played.
- **Licensing**: the composition, arrangements and synthesis code were written for this repository and are owned like the rest of the Ularn 3D code. The vendored engine's MIT licence covers only `public/engine/`. The score uses no third-party samples, soundfonts, loops or downloads, so it carries no third-party licences or attributions.

`public/audio/score.json` records, per file: frames, rate, bytes, PCM checksum, integrated loudness, true peak, the loudness at rest, stir and full intensity, the layer trims and the loop seam.

### Listening guide

[`docs/audio/soundtrack-preview.flac`](audio/soundtrack-preview.flac) runs for 89 s. Each region starts at rest; stir enters about 4.6–7 s into its segment and fray about 8–10.7 s in. The stingers follow.

| Time | What to listen for |
| --- | --- |
| 0:00 | Town: harp in 6/8 under the string pad, with the flute about to enter |
| 0:13 | Caves: choir "oo" and celesta drops over a low E, then the stir ostinato and horn calls |
| 0:27 | Deep caves: low hummed choir over F/E (Phrygian), then pulsing timpani, trombone swells and the high choir |
| 0:40 | Volcano: the E–F–E–G riff with taiko, then brass stabs, tremolo and cymbal swells |
| 0:54 | Level up · 0:58 Descent · 1:04 The cure · 1:10 Death · 1:18 Victory |

In the game itself:
- **Town**: the flute theme starts at 0:09, violins take it at 0:26, the uneasy B section starts at 0:43 (listen for the cold E–E♭–D–D# pedal) and the horn recalls the motif at 1:00.
- **Caves**: the alto-flute theme starts at 0:16, the bass clarinet's chromatic journey at 0:48, and the veiled violins at 1:20.
- **Deep caves**: the augmented motif starts at 0:18, the solo violin and choir at 0:55.
- **Volcano**: horns at 0:11, the dark violin answer at 0:34, the full return at 0:57 and the descending bridge at 1:20.
- Stand near one creature for the stir layer; several, or trading blows, bring in fray.

## Action sounds

Weapon families combine swishes, body impacts and metal or wood resonances. Misses retain the swish without claiming an impact. All 39 spells retain distinct pitch, envelope and pulse patterns, with fire, electric, cold, healing, dark and arcane timbres. Footsteps vary across grass, stone and volcanic ash. Door/chest opening, fountains, altars, thrones, potion use, reading, pickup, coins, stairs, death and victory have separate cues.

Spell casts keep their pulse timing, but each cast now varies by ±3% in pitch and ±10% in level. Ward, arcane, healing and cold casts also ring a quiet shimmer tuned to the score's E-minor pentatonic. Stairs keep their footfall timing, vary per flight, and add a low draught of air that falls when you descend and rises when you climb. Drinking at a fountain pours and bubbles, and washing adds a splash. A prayer at an altar sounds an open fifth and a high bell; desecration cracks stone with a low tritone beneath. Sitting on a throne settles stone and sounds a regal low fifth, and prying gems glints. These cues use the same private ±3% / ±10% variation.

Bridge `ularn:action` events fire only for actual inventory consumption/pickup, changed doors/chests, and fountain, altar or throne actions the engine performs. Those wrappers sit around the engine's own `act_*` functions, observe-only. A prayer counts only once the engine accepts it, so cancelling or overdrawing stays quiet. Existing combat acceptance events drive attacks and casts. Merely opening or cancelling a prompt does not play the associated action. Main derives gold gains, floor transitions and endings from resolved snapshots. The renderer emits `ularn:footstep` near the end of each adjacent-tile stride, when the lifted foot returns to the floor. Reduced motion emits immediately. Blocked movement, teleports, menu interruption, camera reset and hidden windows do not leave stale footfalls. A private noise/variation generator keeps audio from consuming gameplay randomness.

Footsteps use a short, dry filtered scuff and a soft sole impact, with small pitch/level changes and alternating subtle stereo placement. They avoid a duplicate MP3 layer and reverb tails; an 85 ms minimum interval prevents rapid tapping from stacking bursts. Grass is softer than stone, and volcanic ash has a duller texture. Routine doors, pickups, coins, reading and stairs also use lower levels, while combat cues retain their existing levels. [Listen to the comparison](audio/footsteps-comparison.wav): previous stone footsteps, new stone, new grass, then new ash. Eight steps per two-second segment, separated by silence. The render uses identical default mixer settings; the new stone sequence measures approximately 17 dB lower RMS than the previous version. [Measurements](audio/footsteps-review.json). Regenerate with `FOOTSTEP_BEFORE=/path/to/previous-audio.js node scripts/review-footsteps.mjs`.

The mixer uses separate music/effects buses, modest room reverb, stereo positioning, gain ramps and dynamic compression. It caps FX at 24 voices and music at four sources during crossfades, trimming decoded buffers to the current pair once settled. Music playback uses buffers rather than a JavaScript note scheduler, keeping work off the movement/rendering loop.

## Playback recovery and verification

Hidden windows stop and disconnect music/FX, clear the reverb tail and suspend the context. Returning resumes the selected scene at its saved musical offset without replaying old attacks. Mute cancels pending FX and music loads. Failed context unlock or music loading leaves gameplay working and displays a retry control; missing music does not disable effects or retry on every turn.

The browser tests cover gesture activation, region races (including the deep caves), both intensity layers, channel volumes, persisted mute, hide/resume, action acceptance, fountain and altar actions, stingers and their fallbacks, unavailable audio, missing files, and actual OfflineAudioContext sample energy/headroom. Manifest checks verify FLAC headers, bed/stem loop alignment within half a sample, −18 LUFS beds, true peaks at or below −1 dBTP (including the full-intensity sum), the rising intensity steps, the stinger slots and the download budget. A browser test decodes the town pair and the stinger sprite and matches them bit-exactly against the build's checksums. The offline desktop smoke also verifies music playback through `ularn://game/` after Play.

```sh
npm run audio:build
TEST_GPU=hardware npm test -- tests/audio.spec.js
npm run test:desktop
```

Read-only `ularnAudio.metrics()` reports enabled state, context/playback status, desired and playing regions, track, channel volumes, voice/source counts, cache size, tension, both layer levels (`layers`), whether the stingers are ready, the last stinger and accepted-effect history.

## Historical local checks

These recorded checks and measurements describe the earlier local build before reconciliation with GitHub 1.3.62.

The browser regression checks passed, including the intentional spell-failure fixture after making that acceptance scenario deterministic. All nine audio checks also passed with software rendering. Production build, desktop protocol checks, and offline desktop playback/save/relaunch passed. Two publishing-only checks remain outside the local change.

On this Mac's Apple M2 Pro at 1440 × 1000, the production navigation benchmark with music enabled recorded 60.0 FPS, 17.7 ms frame p95 and 15.5 ms input-to-render p95. The audio context was running, playing the caves bed/stem pair with 2 music sources and 38 accepted effects. [Raw playback/performance record](audio/navigation-benchmark.json).

## Feedback cues

Combat feedback adds synthesized cues on the effects bus: `kill` (a thud and crunch pitched by creature size, landing with blade contact), `spellImpact` (fire, cold, electric or bell families where a bolt lands), `levelup` (an E-minor arpeggio with a shimmer tail), `arrive` (a drone swell and two-note motif, pitched lower with depth), `cure` (the motif in E major as bells), `feat`, `whiff` for misses, and a rate-limited `hover` tick for interface controls. Every new cue varies pitch by ±3% and level by ±10% from the private generator, never from gameplay randomness.

These synthesized cues stand in for the orchestral stingers whenever those cannot play. Every cue dips the music through `duckFor(level, holdMs)` on the duck stage only, so the player's music volume is never rewritten. A synthesized level-up holds the music at 35% for 1.4 s, an arrival at 50% and a feat at 60%; the orchestral stingers hold it longer, as listed above. Overlapping dips compose, and the deepest held dip wins.

Low health starts a dry heartbeat through `setHeartbeat(rate)`: 70 beats per minute at 30% health and 100 at 15%. A low-pass filter between the music gain and the duck stage eases the score down to about 2.4 kHz and then 900 Hz, and back to full range when the hero recovers. The loop stops in menus, while suspended, when sound is off and when the expedition ends. `ularnAudio.metrics()` reports `heartbeat` and `duck`. Heartbeat and hover never count as the last effect, and above 16 active voices they, along with misses, are skipped first.
