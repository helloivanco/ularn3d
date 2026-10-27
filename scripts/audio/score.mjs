// The Ularn score. One leitmotif, E–G–B | A–G–F#, the rising minor triad and
// its turning answer, threads every region:
//   town     pastoral 6/8 in E minor with Dorian/Lydian light and a darker B section
//   caves    slow Aeolian hymn with chromatic-mediant shadows
//   deep     the motif in augmentation over Phrygian (F natural) and tritone colour
//   volcano  a Phrygian riff; the motif bends to F natural, brass in augmentation
// Every region is a bed plus two vertical intensity layers that share its
// chord chart: layer A ("stir") adds pulse, layer B ("fray") adds brass,
// timpani and tremolo. Stingers restate the motif for level-ups, new floors,
// the cure, death and victory.
import { chart, line, lineLength, voiceLead, inRange, midi } from "./theory.mjs";
import { rng, hashSeed } from "./dsp.mjs";

export class Piece {
  constructor({ id, title, tempo, beats, bars, hall, seed }) {
    Object.assign(this, { id, title, tempo, beats, bars, hall });
    this.events = []; this.random = rng(seed ?? hashSeed(id));
  }
  get seconds() { return this.bars * this.beats * 60 / this.tempo; }
  at(bar, beat = 0) { return (bar - 1) * this.beats + beat; }
  note(bus, section, at, dur, pitch, o = {}) {
    this.events.push({ bus, section, at, dur, midi: typeof pitch === "string" ? midi(pitch) : pitch, vel: o.vel ?? .55, ...o });
  }
  // A melodic line with a gentle phrase arc and legato overlap.
  line(bus, section, bar, text, o = {}) {
    const notes = line(text), total = lineLength(text);
    for (const n of notes) {
      const arc = 1 + (o.arc ?? .12) * Math.sin(Math.PI * (n.at + n.dur / 2) / total);
      this.note(bus, section, this.at(bar) + n.at, n.dur + (o.overlap ?? .08), n.midi + (o.transpose || 0),
        { ...o, vel: Math.min(1, (o.vel ?? .55) * arc + (n.accent ? .12 : 0)) });
    }
  }
  chart(bar, text) { return chart(text, this.beats).map((c) => ({ ...c, at: c.at + this.at(bar) })); }
}

const between = (changes, from, to, piece) => changes.filter((c) => c.at >= piece.at(from) && c.at < piece.at(to + 1));
const tonesIn = (c, low, high) => { const out = []; for (let m = low; m <= high; m++) if (c.chord.tones.includes(m % 12)) out.push(m); return out; };

// Voice-led string pad, lowest voice to cellos, then violas, then violins.
function stringPad(p, bus, changes, { low = 50, high = 74, vel = .4, sections = ["cellos", "violas", "violins", "violins"], shape = "swell", art, gain = -3 } = {}) {
  const voicing = voiceLead(changes, { voices: sections.length, low, high });
  changes.forEach((c, i) => voicing[i].upper.forEach((m, v) => p.note(bus, sections[v], c.at, c.dur + .15, m, { vel, shape, art, gain })));
  return voicing;
}
function choirPad(p, bus, changes, { low = 52, high = 72, voices = 4, vel = .45, vowel = "oo", to, shape = "swell", gain = -2 } = {}) {
  const voicing = voiceLead(changes, { voices, low, high });
  changes.forEach((c, i) => voicing[i].upper.forEach((m, v) => p.note(bus, "choir", c.at, c.dur + .2, m, { vel, vowel, to, shape, gain, pan: (v / (voices - 1) - .5) * .5 })));
  return voicing;
}
const bassOf = (c, low) => inRange(c.chord.bass, low, low + 11)[0];
function harpRoll(p, bus, c, at, { vel = .5, low = 40, notes = 4, gap = .09 } = {}) {
  const bass = bassOf(c, low), upper = tonesIn(c, bass + 7, bass + 26).slice(0, notes);
  [bass, ...upper].forEach((m, i) => p.note(bus, "harp", at + i * gap * p.tempo / 60, 4, m, { vel: vel * (i ? .8 : 1), ring: 5 }));
}
// Deterministic sparkle: chord tones high up, a few per bar.
function drips(p, bus, changes, section, { low = 84, high = 98, perBar = 2, vel = .3, grid = 1 } = {}) {
  const random = rng(hashSeed(`${p.id}-${section}-${bus}`));
  for (const c of changes) {
    const pool = tonesIn(c, low, high), slots = Math.round(c.dur / grid);
    for (let k = 0; k < perBar * c.dur / p.beats; k++) {
      const slot = Math.floor(random() * slots), m = pool[Math.floor(random() * pool.length)];
      p.note(bus, section, c.at + slot * grid, 2, m, { vel: vel * (.7 + .5 * random()), ring: 3.5 });
    }
  }
}
// Spiccato ostinato on the chord bass following a semitone shape.
function ostinato(p, bus, section, changes, shape, { low, vel = .5, step = 1, accent = [0], art = "spiccato", thirdAware = false, gain = 0 } = {}) {
  for (const c of changes) {
    const root = bassOf(c, low), major = c.chord.tones.includes((c.chord.root + 4) % 12);
    for (let i = 0; i * step < c.dur - 1e-6; i++) {
      let offset = shape[i % shape.length];
      if (thirdAware && offset === 3 && major) offset = 4;
      p.note(bus, section, c.at + i * step, step * .9, root + offset, { vel: vel * (accent.includes(i % shape.length) ? 1.15 : .85), art, gain });
    }
  }
}
function cymbalInto(p, bus, bar, beats, vel = .45) { const at = p.at(bar) - beats; p.note(bus, "cymbal", at, beats, 0, { vel, ring: 2.4 }); }

// ─── Town: "Hearth of Ularn" ─────────────────────────────────────────────
function town() {
  const p = new Piece({ id: "town", title: "Hearth of Ularn", tempo: 168, beats: 6, bars: 32,
    hall: { decay: 2.1, predelay: .022, damping: 6200, size: .9, early: .55 } });
  const changes = p.chart(1, [
    "Em | Cadd9 | Em | Dsus4:3 D:3",
    "Em | C | G | D | Em | C | Am | B7",
    "Em | C | G/B | Am | C | D | Em | Em",
    "Am | Fmaj7#11 | Em | C#m7b5 | C | Cm6 | G/B | B7",
    "Em | Cmaj7 | Am7 | B7sus4:3 B7:3",
  ].join(" | "));
  // Harp 6/8 ostinato (rests to drops in the B section).
  for (const c of changes) {
    const bar = Math.floor(c.at / 6) + 1, b = bassOf(c, 40), up = tonesIn(c, b + 7, b + 24);
    if (bar >= 21 && bar <= 28) { p.note("bed", "harp", c.at, 3, b, { vel: .42, ring: 4 }); p.note("bed", "harp", c.at + 3, 3, up[2] ?? up[0], { vel: .3, ring: 3 }); continue; }
    const pattern = [b, up[0], up[1], up[2], up[3] ?? up[2], up[1]], vels = [.62, .4, .44, .5, .46, .38];
    const soft = bar <= 4 || bar >= 29 ? .8 : 1;
    for (let i = 0; i < c.dur; i++) p.note("bed", "harp", c.at + i, 1.6, pattern[(c.at % 6 + i) % 6], { vel: vels[i % 6] * soft, ring: 3.2 });
  }
  stringPad(p, "bed", between(changes, 1, 20, p), { low: 52, high: 74, vel: .34, sections: ["cellos", "violas", "violas", "violins"] });
  stringPad(p, "bed", between(changes, 21, 28, p), { low: 50, high: 70, vel: .3, sections: ["cellos", "violas", "violins"], shape: "swell" });
  stringPad(p, "bed", between(changes, 29, 32, p), { low: 52, high: 74, vel: .3, sections: ["cellos", "violas", "violas", "violins"] });
  for (const c of changes) {
    const bar = Math.floor(c.at / 6) + 1, bass = bassOf(c, 28);
    if (bar >= 21 && bar <= 28) p.note("bed", "basses", c.at, c.dur + .2, bass + 12, { vel: .32, shape: "swell" });
    else if (c.at % 6 === 0) p.note("bed", "pizz", c.at, 2, bass + 12, { vel: bar <= 4 ? .45 : .55 });
  }
  // A: the theme on flute, clarinet countermelody.
  p.line("bed", "flute", 5, "E5:3 G5:1 B5:2 | A5:2 G5:1 F#5:1 G5:2 | D5:3 G5:1 B5:2 | A5:4 F#5:2 | G5:3 F#5:1 E5:2 | C6:2 B5:1 A5:1 G5:2 | A5:2 G5:1 E5:1 F#5:2 | F#5:3 D#5:1 F#5:2", { vel: .6 });
  p.line("bed", "clarinet", 5, "B3:6 | C4:3 E4:3 | D4:6 | D4:3 C4:3 | B3:6 | C4:3 E4:3 | E4:3 C4:3 | D#4:3 A3:3", { vel: .42 });
  // A': violins carry it, oboe answers below, horns warm the middle.
  p.line("bed", "violins", 13, "E5:3 G5:1 B5:2 | A5:2 G5:1 F#5:1 G5:2 | B5:3 D6:1 B5:2 | C6:2 B5:1 A5:3 | G5:3 E5:1 G5:2 | F#5:3 A5:1 G5:1 F#5:1 | E5:6", { vel: .66, gain: 2 });
  p.line("bed", "oboe", 13, "G4:6 | E4:3 G4:3 | D4:6 | E4:3 C5:3 | C5:3 B4:3 | A4:3 D5:3 | B4:6", { vel: .34, gain: -2 });
  p.line("bed", "horns", 20, "B3:3 E4:3", { vel: .4 });
  const hornPad = voiceLead(between(changes, 13, 19, p), { voices: 2, low: 52, high: 66 });
  between(changes, 13, 19, p).forEach((c, i) => hornPad[i].upper.forEach((m) => p.note("bed", "horns", c.at, c.dur + .2, m, { vel: .3, shape: "swell" })));
  for (let bar = 13; bar <= 20; bar++) { p.note("bed", "frame", p.at(bar), 1, 0, { vel: .42 }); p.note("bed", "frame", p.at(bar, 3), 1, 0, { vel: .22 }); p.note("bed", "frame", p.at(bar, 5), 1, 0, { vel: .16 }); }
  // B: something stirs below. Cellos and bassoon, a cold high pedal, celesta drops.
  const bTheme = "A3:3 C4:1 E4:2 | D4:2 C4:1 B3:1 C4:2 | B3:3 G3:1 E3:2 | G3:2 E3:1 C#3:1 E3:2 | E3:3 G3:1 C4:2 | Eb4:2 D4:1 C4:1 A3:2 | B3:3 D4:1 G4:2 | F#4:2 E4:1 D#4:1 B3:2";
  p.line("bed", "cellos", 21, bTheme, { vel: .55, solo: true });
  p.line("bed", "bassoon", 21, bTheme, { vel: .38, transpose: -12 });
  p.line("bed", "violins", 21, "E6:30 Eb6:6 D6:6 D#6:6", { vel: .2, art: "harmonic", solo: true, arc: 0, gain: -3 });
  drips(p, "bed", between(changes, 21, 28, p), "celesta", { low: 79, high: 93, perBar: 2, vel: .34 });
  // Coda: a distant horn remembers the motif.
  p.line("bed", "horns", 29, "E4:3 G4:1 B4:2 | A4:2 G4:1 F#4:3", { vel: .42 });
  p.note("bed", "flute", p.at(3), 6, "E5", { vel: .26, shape: "swell" });

  // Layer A: pulse.
  ostinato(p, "a", "cellos", changes, [0, 0, 7, 0, 0, 7], { low: 40, vel: .5, accent: [0, 3] });
  ostinato(p, "a", "basses", changes, [0, 0, 0, 0, 0, 0], { low: 28, vel: .42, step: 3, accent: [0] });
  for (const c of changes) if (c.at % 6 === 0) p.note("a", "timpani", c.at, 1, inRange(c.chord.bass, 38, 49)[0], { vel: .45 });
  // Layer B: horn calls, low brass, tremolo, timpani and swells.
  for (const c of changes) {
    const t = tonesIn(c, 55, 72), fifth = t.find((m) => m % 12 === (c.chord.root + 7) % 12) ?? t[2], third = t.find((m) => m % 12 === c.chord.third) ?? t[1], root = t.find((m) => m % 12 === c.chord.root) ?? t[0];
    if (c.dur === 6) { p.note("b", "horns", c.at, 3, fifth, { vel: .62 }); p.note("b", "horns", c.at + 3, 1, third, { vel: .55 }); p.note("b", "horns", c.at + 4, 2, root, { vel: .58 }); }
    else p.note("b", "horns", c.at, c.dur, third, { vel: .58 });
    if (c.at % 6 === 0) { p.note("b", "trombones", c.at, 1.5, bassOf(c, 40), { vel: .62, art: "stab" }); p.note("b", "tuba", c.at, 1.5, bassOf(c, 28), { vel: .55, art: "stab" }); p.note("b", "timpani", c.at + 3, 1, inRange(c.chord.bass, 38, 49)[0], { vel: .38 }); }
  }
  stringPad(p, "b", changes, { low: 72, high: 88, vel: .42, sections: ["violins", "violins"], art: "tremolo", shape: "flat" });
  for (const bar of [5, 13, 21, 29]) cymbalInto(p, "b", bar, 6, .5);
  return p;
}

// ─── Caves: "Stone and Shadow" ───────────────────────────────────────────
function caves() {
  const p = new Piece({ id: "caves", title: "Stone and Shadow", tempo: 60, beats: 4, bars: 24,
    hall: { decay: 4.2, predelay: .045, damping: 4200, size: 1.35, early: .45 } });
  const changes = p.chart(1, [
    "Emadd9 | Emadd9 | Cmaj7 | Cmaj7",
    "Em | Cmaj7 | Amadd9 | B7sus4 B7 | Em | G/D | Cmaj7#11 | B",
    "Em | Gm/D | Ebmaj7 | Cm | Am | F | Em/B | B7b9",
    "Em | Cmaj7 | Amadd9 | B7sus4 B7",
  ].join(" | "));
  for (const c of changes) p.note("bed", "basses", c.at, c.dur + .3, bassOf(c, 28), { vel: .4, shape: "swell" });
  choirPad(p, "bed", between(changes, 1, 4, p), { low: 52, high: 71, vel: .56, vowel: "oo", gain: 0 });
  choirPad(p, "bed", between(changes, 21, 24, p), { low: 52, high: 71, vel: .4, vowel: "oo", to: "oh" });
  stringPad(p, "bed", between(changes, 5, 12, p), { low: 48, high: 69, vel: .34, sections: ["cellos", "violas", "violas", "violins"] });
  stringPad(p, "bed", between(changes, 13, 20, p), { low: 45, high: 67, vel: .36, sections: ["cellos", "cellos", "violas", "violas"] });
  choirPad(p, "bed", between(changes, 13, 20, p), { low: 57, high: 74, voices: 3, vel: .3, vowel: "ah", to: "oh" });
  for (const c of between(changes, 5, 12, p).concat(between(changes, 21, 24, p))) if (c.at % 4 === 0) harpRoll(p, "bed", c, c.at, { vel: .4, low: 40 });
  // A: the motif low on alto flute, celesta echoing each phrase tail.
  p.line("bed", "altoFlute", 5, "E4:1.5 G4:.5 B4:2 | A4:1 G4:.5 F#4:.5 G4:2 | C5:1.5 B4:.5 A4:2 | F#4:2 E4:1 D#4:1 | E4:1.5 G4:.5 B4:1 E5:1 | D5:2 B4:1 G4:1 | F#4:1.5 G4:.5 B4:2 | A4:1 G4:1 F#4:2", { vel: .6 });
  for (const [bar, text] of [[6, "G5:.5 F#5:.5 G5:1"], [8, "E5:1 D#5:1"], [10, "B5:1 G5:1"], [12, "G5:1 F#5:1"]]) p.line("bed", "celesta", bar, `r:2.25 ${text}`, { vel: .36, arc: 0 });
  // B: the bass clarinet turns the motif through chromatic mediants; distant horns descend.
  p.line("bed", "bassClarinet", 13, "E3:1.5 G3:.5 B3:2 | Bb3:1 A3:.5 G3:.5 D3:2 | G3:1.5 Bb3:.5 D4:2 | C4:1 Bb3:.5 G3:.5 Eb3:2 | A3:1.5 C4:.5 E4:2 | F4:1 E4:.5 C4:.5 A3:2 | G3:2 F#3:1 E3:1 | D#3:2 F#3:1 A3:1", { vel: .58 });
  p.line("bed", "horns", 13, "B3:4 | Bb3:4 | Bb3:4 | G3:4 | A3:4 | A3:4 | G3:4 | F#3:4", { vel: .34, arc: .3, solo: true });
  // A': violins, high and veiled.
  p.line("bed", "violins", 21, "E5:1.5 G5:.5 B5:2 | A5:1 G5:.5 F#5:.5 G5:2 | C6:1.5 B5:.5 A5:2 | F#5:2 E5:1 D#5:1", { vel: .6, art: "harmonic", gain: 3 });
  drips(p, "bed", between(changes, 1, 4, p), "celesta", { low: 76, high: 91, perBar: 2, vel: .3, grid: .5 });
  drips(p, "bed", between(changes, 21, 24, p), "glock", { low: 81, high: 96, perBar: 1.5, vel: .24, grid: .5 });
  p.note("bed", "tamtam", p.at(1), 4, 0, { vel: .34, ring: 7 });
  p.note("bed", "tamtam", p.at(13), 4, 0, { vel: .4, ring: 7 });
  p.note("bed", "timpani", p.at(13), 2, "E2", { vel: .3 });

  ostinato(p, "a", "cellos", changes, [0, 0, 7, 0, 0, 7, 0, 12], { low: 40, vel: .48, step: .5, accent: [0, 3, 6] });
  ostinato(p, "a", "basses", changes, [0, 0], { low: 28, vel: .4, step: 2, accent: [0] });
  for (const c of changes) for (let b = 0; b < c.dur; b += 2) p.note("a", "timpani", c.at + b, 1, inRange(c.chord.bass, 38, 49)[0], { vel: b ? .3 : .4 });
  for (const c of changes) if (c.at % 4 === 0) p.note("a", "taiko", c.at, 1, 0, { vel: .3 });
  const brassLine = voiceLead(changes, { voices: 2, low: 52, high: 69 });
  changes.forEach((c, i) => {
    const [lo, hi] = brassLine[i].upper;
    if (c.dur === 4) { p.note("b", "horns", c.at, 2, hi, { vel: .6 }); p.note("b", "horns", c.at + 2, 1.5, lo, { vel: .5 }); p.note("b", "horns", c.at + 3.5, .5, hi, { vel: .62 }); }
    else p.note("b", "horns", c.at, c.dur, hi, { vel: .58 });
    p.note("b", "trombones", c.at, c.dur, bassOf(c, 40), { vel: .5, shape: "cresc" });
    if (c.at % 4 === 0) p.note("b", "bassDrum", c.at, 1, 0, { vel: .5 });
  });
  stringPad(p, "b", changes, { low: 71, high: 86, vel: .4, sections: ["violins", "violins"], art: "tremolo", shape: "flat" });
  for (const bar of [4, 8, 12, 16, 20, 24]) for (let k = 0; k < 8; k++) p.note("b", "timpani", p.at(bar, 2 + k * .25), .25, "E2", { vel: .22 + k * .05 });
  for (const bar of [5, 13, 21]) cymbalInto(p, "b", bar, 4, .45);
  return p;
}

// ─── Deep caves: "The Deep Halls" ────────────────────────────────────────
function deep() {
  const p = new Piece({ id: "deep", title: "The Deep Halls", tempo: 52, beats: 4, bars: 20,
    hall: { decay: 5.6, predelay: .06, damping: 3200, size: 1.6, early: .4, lowCut: 110 } });
  const changes = p.chart(1, [
    "E5 | F/E | Em | F/E",
    "Em | Em | C | C | Am | Am | F | B7b9",
    "Em | Bb/E | Em | Cm/Eb | Am/E | F | Emadd9 | B7sus4 B7",
  ].join(" | "));
  for (const c of changes) p.note("bed", "basses", c.at, c.dur + .3, bassOf(c, 28), { vel: .44, shape: "swell" });
  p.note("bed", "tuba", p.at(1), 16, "E1", { vel: .3, shape: "swell" });
  choirPad(p, "bed", between(changes, 1, 4, p), { low: 43, high: 59, voices: 3, vel: .6, vowel: "mm", to: "oh", gain: 1 });
  choirPad(p, "bed", between(changes, 13, 20, p), { low: 45, high: 62, voices: 3, vel: .58, vowel: "oh", to: "ah", gain: 1 });
  stringPad(p, "bed", between(changes, 5, 12, p), { low: 43, high: 64, vel: .36, sections: ["cellos", "cellos", "violas"] });
  stringPad(p, "bed", between(changes, 13, 20, p), { low: 48, high: 66, vel: .26, sections: ["violas", "violas"] });
  // A: the motif stretched to half speed in bass clarinet, horns joining.
  const augmented = "E3:3 G3:1 | B3:4 | A3:2 G3:1 F#3:1 | G3:4 | C4:3 B3:1 | A3:4 | A3:2 G3:1 F3:1 | F#3:2 D#3:2";
  p.line("bed", "bassClarinet", 5, augmented, { vel: .46, arc: .2, gain: -3 });
  p.line("bed", "horns", 9, "C4:3 B3:1 | A3:4 | A3:2 G3:1 F3:1 | F#3:2 D#3:2", { vel: .4, arc: .3, transpose: 12, gain: -2 });
  for (const c of between(changes, 5, 12, p)) { const b = bassOf(c, 40); p.note("bed", "harp", c.at, 4, b, { vel: .4, ring: 6 }); p.note("bed", "harp", c.at + 2, 4, b + 7, { vel: .28, ring: 5 }); }
  // B: a cold solo violin over low choir; glass-like stars.
  p.line("bed", "violins", 13, "B5:4 | Bb5:2 A5:2 | G5:4 | G5:2 Eb5:2 | E5:4 | F5:2 E5:1 C5:1 | B4:4 | F#5:2 D#5:2", { vel: .62, solo: true, art: "harmonic", arc: .2, gain: 4 });
  drips(p, "bed", between(changes, 13, 20, p), "glock", { low: 84, high: 98, perBar: 1.2, vel: .2, grid: 1 });
  drips(p, "bed", between(changes, 1, 4, p), "celesta", { low: 76, high: 88, perBar: 1, vel: .26, grid: 1 });
  p.note("bed", "tamtam", p.at(1), 4, 0, { vel: .4, ring: 8, low: 48, bloom: 1.6 });
  p.note("bed", "tamtam", p.at(13), 4, 0, { vel: .46, ring: 8, low: 48, bloom: 1.6 });
  for (const bar of [4, 12]) for (let k = 0; k < 10; k++) p.note("bed", "timpani", p.at(bar, 2 + k * .2), .2, "E2", { vel: .12 + k * .025 });
  p.note("bed", "timpani", p.at(5), 2, "E2", { vel: .34 }); p.note("bed", "timpani", p.at(13), 2, "E2", { vel: .38 });

  ostinato(p, "a", "cellos", changes, [0, 1, 0, 0, 0, 1, 0, -2], { low: 40, vel: .5, step: .5, accent: [0, 4] });
  for (const c of changes) for (let b = 0; b < c.dur; b += 4) { p.note("a", "timpani", c.at + b, 1, inRange(c.chord.bass, 38, 49)[0], { vel: .42 }); p.note("a", "timpani", c.at + b + .5, 1, inRange(c.chord.bass, 38, 49)[0], { vel: .3 }); p.note("a", "taiko", c.at + b + 2, 1, 0, { vel: .26 }); }
  stringPad(p, "b", changes, { low: 40, high: 60, vel: .55, sections: ["trombones", "trombones", "horns"], shape: "cresc" });
  for (const c of changes) p.note("b", "tuba", c.at, c.dur, bassOf(c, 28), { vel: .5, shape: "cresc" });
  choirPad(p, "b", changes, { low: 57, high: 74, voices: 3, vel: .55, vowel: "ah", shape: "cresc" });
  for (const c of changes) if (c.at % 4 === 0) p.note("b", "bassDrum", c.at, 1, 0, { vel: .55 });
  for (const bar of [4, 8, 12, 16, 20]) for (let k = 0; k < 12; k++) p.note("b", "timpani", p.at(bar, 2 + k * .1667), .17, "E2", { vel: .2 + k * .04 });
  for (const bar of [5, 13]) cymbalInto(p, "b", bar, 4, .4);
  stringPad(p, "b", changes, { low: 52, high: 64, vel: .4, sections: ["cellos", "violas"], art: "tremolo", shape: "flat" });
  return p;
}

// ─── Volcano: "Beneath the Ember" ────────────────────────────────────────
function volcano() {
  const p = new Piece({ id: "volcano", title: "Beneath the Ember", tempo: 84, beats: 4, bars: 32,
    hall: { decay: 3.3, predelay: .035, damping: 3600, size: 1.2, early: .5, lowCut: 120 } });
  const changes = p.chart(1, [
    "E5 | E5 | F/E | E5",
    "Em | Em | F | F | Dm | Dm | E | E",
    "Am | Am | Bb | Bb | C | C | B7 | B7",
    "Em | Em | F | F | Dm | Dm | E | E",
    "C | Bb | A5 | F",
  ].join(" | "));
  const riff = [0, 0, 1, 0, 3, 1, 0, -2];
  ostinato(p, "bed", "cellos", changes, riff, { low: 40, vel: .56, step: .5, accent: [0, 4], thirdAware: true, gain: 3 });
  ostinato(p, "bed", "basses", changes, [0, 0, 0, 0], { low: 28, vel: .4, step: 1, accent: [0] });
  choirPad(p, "bed", between(changes, 5, 28, p), { low: 45, high: 62, voices: 3, vel: .36, vowel: "oh" });
  // A: horns state the motif in augmentation, bent to F natural; trombones join.
  const theme = "E4:4 | G4:2 B4:2 | A4:3 G4:1 | F4:4 | F4:2 E4:1 D4:1 | D4:2 F4:2 | E4:4 | G#4:2 E4:2";
  p.line("bed", "horns", 5, theme, { vel: .52, arc: .2 });
  p.line("bed", "trombones", 9, "F4:2 E4:1 D4:1 | D4:2 F4:2 | E4:4 | G#4:2 E4:2", { vel: .42, transpose: -12 });
  // B: violins and bassoon sing a dark answer over the tritone shift.
  const answer = "C5:4 | B4:2 A4:2 | D5:4 | C5:2 Bb4:2 | E5:4 | D5:2 C5:2 | D#5:4 | F#5:2 B4:2";
  p.line("bed", "violins", 13, answer, { vel: .5 });
  p.line("bed", "bassoon", 13, answer, { vel: .38, transpose: -24 });
  stringPad(p, "bed", between(changes, 13, 20, p), { low: 52, high: 67, vel: .3, sections: ["violas", "violas"] });
  // A': the theme returns in violins and horns together.
  p.line("bed", "violins", 21, theme, { vel: .52, transpose: 12 });
  p.line("bed", "horns", 21, theme, { vel: .44 });
  for (const bar of [1, 13, 21]) p.note("bed", "tamtam", p.at(bar), 4, 0, { vel: .4, ring: 6, low: 55 });
  for (const c of changes) if (c.at % 8 === 0) p.note("bed", "timpani", c.at, 1, inRange(c.chord.bass, 38, 49)[0], { vel: .4 });
  for (let bar = 1; bar <= 32; bar++) p.note("bed", "taiko", p.at(bar), 1, 0, { vel: .34 });

  ostinato(p, "a", "violas", changes, riff, { low: 52, vel: .44, step: .5, accent: [0, 4], thirdAware: true });
  const taiko = [[0, .55], [1, .3], [1.5, .38], [2, .5], [2.5, .3], [3.5, .34]];
  for (let bar = 1; bar <= 32; bar++) for (const [beat, vel] of taiko) p.note("a", "taiko", p.at(bar, beat), 1, 0, { vel });
  for (const c of changes) for (let b = 0; b < c.dur; b += 2) p.note("a", "timpani", c.at + b, 1, inRange(c.chord.bass, 38, 49)[0], { vel: .42 });
  const stabs = voiceLead(changes, { voices: 3, low: 45, high: 64 });
  changes.forEach((c, i) => {
    for (let b = 0; b < c.dur; b += 4) for (const [beat, vel] of [[0, .7], [1.5, .55]]) {
      stabs[i].upper.forEach((m, v) => p.note("b", v === 2 ? "horns" : "trombones", c.at + b + beat, .9, m, { vel, art: "stab" }));
      p.note("b", "tuba", c.at + b + beat, .9, bassOf(c, 28), { vel: vel * .9, art: "stab" });
    }
  });
  p.line("b", "trumpets", 21, theme, { vel: .42, transpose: 12, gain: -2 });
  choirPad(p, "b", changes, { low: 60, high: 76, voices: 3, vel: .5, vowel: "ah" });
  stringPad(p, "b", changes, { low: 76, high: 88, vel: .4, sections: ["violins", "violins"], art: "tremolo", shape: "flat" });
  for (let bar = 1; bar <= 32; bar++) p.note("b", "bassDrum", p.at(bar), 1, 0, { vel: .5 });
  for (const bar of [4, 12, 20, 28, 32]) for (let k = 0; k < 8; k++) p.note("b", "tom", p.at(bar, 2 + k * .25), .25, 0, { vel: .3 + k * .06 });
  for (const bar of [5, 13, 21, 29]) cymbalInto(p, "b", bar, 4, .5);
  return p;
}

// ─── Stingers ────────────────────────────────────────────────────────────
// Rendered one after another into a single sprite; offsets live in audio-score.js.
function levelup() {
  const p = new Piece({ id: "levelup", tempo: 60, beats: 4, bars: 1, hall: { decay: 2.4, predelay: .02, damping: 6500, size: 1, early: .5 } });
  "E3 G#3 B3 E4 G#4 B4 C#5 E5 G#5 B5 E6".split(" ").forEach((n, i) => p.note("s", "harp", i * .07, 2, n, { vel: .45 + i * .03, ring: 3 }));
  p.note("s", "cymbal", 0, 1.3, 0, { vel: .4, ring: 2.2 });
  for (const [n, at, d] of [["E4", .8, .32], ["G#4", 1.12, .32], ["B4", 1.44, .32], ["E5", 1.76, 2.6]]) {
    p.note("s", "trumpets", at, d, n, { vel: .66, attack: .02 }); p.note("s", "horns", at, d, midi(n) - 12, { vel: .6 });
  }
  for (const n of ["E3", "B3", "G#4"]) p.note("s", "trombones", 1.76, 2.6, n, { vel: .55 });
  for (const n of ["G#4", "B4", "E5", "B5"]) p.note("s", "violins", 1.76, 2.6, n, { vel: .5, art: "tremolo", shape: "fade" });
  p.note("s", "timpani", 1.76, 1, "E2", { vel: .62 }); p.note("s", "basses", 1.76, 2.4, "E1", { vel: .5, shape: "fade" });
  for (const [n, at] of [["E6", 1.9], ["G#6", 2.02], ["B6", 2.14]]) p.note("s", "celesta", at, 2, n, { vel: .4 });
  return p;
}
function descend() {
  const p = new Piece({ id: "descend", tempo: 60, beats: 4, bars: 1, hall: { decay: 4.5, predelay: .05, damping: 3800, size: 1.4, early: .4 } });
  p.note("s", "tamtam", 0, 3, 0, { vel: .45, ring: 5, low: 50, bloom: 1.2 });
  "E6 B5 G5 E5 B4 G4 E4 B3".split(" ").forEach((n, i) => p.note("s", "harp", .05 + i * .06, 2, n, { vel: .32, ring: 2.5 }));
  for (const [n, at, d] of [["B3", .35, .5], ["G3", .85, .5], ["E3", 1.35, 2.3]]) { p.note("s", "horns", at, d, n, { vel: .52 }); p.note("s", "bassClarinet", at, d, midi(n) - 12, { vel: .48 }); }
  for (const n of ["E3", "G3", "B3"]) p.note("s", "choir", 1.3, 2.4, n, { vel: .45, vowel: "oo", to: "mm", shape: "fade", voices: 5 });
  p.note("s", "basses", .2, 3.6, "E1", { vel: .5, shape: "swell" }); p.note("s", "cellos", .2, 3.6, "E2", { vel: .4, shape: "swell" });
  for (let k = 0; k < 10; k++) p.note("s", "timpani", .1 + k * .14, .14, "E2", { vel: .34 - k * .02 });
  return p;
}
function cure() {
  const p = new Piece({ id: "cure", tempo: 60, beats: 4, bars: 2, hall: { decay: 3.6, predelay: .03, damping: 7000, size: 1.2, early: .5 } });
  for (const n of ["C4", "E4", "G4"]) p.note("s", "choir", 0, 1.5, n, { vel: .42, vowel: "oo", to: "ah" });
  for (const n of ["E4", "G#4", "B4"]) p.note("s", "choir", 1.45, 3.2, n, { vel: .52, vowel: "ah", shape: "fade" });
  "E5:.24 G#5:.24 B5:.24 A5:.24 G#5:.24 F#5:.24 E6:2.4".split(" ").reduce((at, token) => { const [n, d] = token.split(":"); p.note("s", "celesta", at, +d, n, { vel: .48, ring: 3.2 }); return at + +d; }, 0);
  "E4 G#4 B4 E5 G#5 B5".split(" ").forEach((n, i) => p.note("s", "harp", 1.45 + i * .08, 2.5, n, { vel: .4, ring: 3.5 }));
  for (const n of ["G#5", "B5", "E6"]) p.note("s", "violins", 1.45, 3, n, { vel: .36, art: "tremolo", shape: "fade" });
  for (const n of ["C3", "G3"]) p.note("s", "cellos", 0, 1.5, n, { vel: .4 });
  for (const n of ["E2", "B2"]) p.note("s", "cellos", 1.45, 3.2, n, { vel: .42, shape: "fade" });
  p.note("s", "glock", 1.5, 3, "B6", { vel: .32 }); p.note("s", "glock", 1.62, 3, "E7", { vel: .28 });
  p.note("s", "cymbal", 0, 1.45, 0, { vel: .3, ring: 3 });
  return p;
}
function death() {
  const p = new Piece({ id: "death", tempo: 60, beats: 4, bars: 2, hall: { decay: 4.8, predelay: .05, damping: 3400, size: 1.4, early: .4 } });
  p.note("s", "bassDrum", 0, 1, 0, { vel: .55 });
  for (const n of ["E2", "B2"]) p.note("s", "cellos", 0, 2.1, n, { vel: .45, shape: "fade" });
  for (const n of ["E3", "G3", "B3"]) p.note("s", "choir", .1, 2.1, n, { vel: .4, vowel: "oo" });
  for (const n of ["Eb3", "G3", "C4"]) p.note("s", "choir", 2.1, 2.1, n, { vel: .42, vowel: "oo", to: "oh" });
  for (const n of ["C2", "G2"]) p.note("s", "cellos", 2.1, 2.1, n, { vel: .4 });
  for (const n of ["E2", "B2", "E3"]) p.note("s", "basses", 4.2, 2.4, midi(n) - 12, { vel: .4, shape: "fade" });
  for (const n of ["E3", "B3"]) p.note("s", "choir", 4.2, 2.4, n, { vel: .34, vowel: "mm", shape: "fade" });
  "E4:.7 G4:.5 B4:1.2 A4:.6 G4:.5 F#4:2.6".split(" ").reduce((at, token) => { const [n, d] = token.split(":"); p.note("s", "englishHorn", at, +d, n, { vel: .5, shape: "fade" }); return at + +d; }, .3);
  p.note("s", "tamtam", 4.1, 3, 0, { vel: .32, ring: 4, low: 45 });
  for (let k = 0; k < 12; k++) p.note("s", "timpani", 2 + k * .16, .16, "E2", { vel: .3 - k * .02 });
  return p;
}
function victory() {
  const p = new Piece({ id: "victory", tempo: 60, beats: 4, bars: 3, hall: { decay: 3, predelay: .03, damping: 6500, size: 1.2, early: .5 } });
  for (let k = 0; k < 18; k++) p.note("s", "timpani", k * .065, .065, "B1", { vel: .2 + k * .025 });
  p.note("s", "cymbal", 0, 1.2, 0, { vel: .5, ring: 1 });
  const fanfare = [["E4", 1.2, .38], ["G#4", 1.58, .19], ["B4", 1.77, .76], ["A4", 2.53, .38], ["G#4", 2.91, .19], ["F#4", 3.1, .19], ["G#4", 3.29, .71]];
  for (const [n, at, d] of fanfare) { p.note("s", "trumpets", at, d, n, { vel: .7 }); p.note("s", "horns", at, d, midi(n) - 12, { vel: .62 }); p.note("s", "violins", at, d, midi(n) + 12, { vel: .55 }); }
  for (const [notes, at, d] of [[["E3", "B3", "G#4"], 1.2, 2.8], [["C3", "G3", "E4"], 4, 1], [["D3", "A3", "F#4"], 5, 1], [["E3", "B3", "G#4"], 6, 2.6]]) {
    for (const n of notes) { p.note("s", "trombones", at, d, n, { vel: .58 }); p.note("s", "choir", at, d, midi(n) + 12, { vel: .5, vowel: "ah" }); }
    p.note("s", "basses", at, d, midi(notes[0]) - 12, { vel: .55 }); p.note("s", "timpani", at, 1, midi(notes[0]) - 12, { vel: .64 });
  }
  for (const [n, at, d] of [["C5", 4, 1], ["D5", 5, 1], ["E5", 6, 2.6]]) { p.note("s", "trumpets", at, d, n, { vel: .72 }); p.note("s", "horns", at, d, midi(n) - 5, { vel: .6 }); }
  for (const n of ["E5", "G#5", "B5", "E6"]) p.note("s", "violins", 6, 2.6, n, { vel: .55, art: "tremolo", shape: "fade" });
  "E3 G#3 B3 E4 G#4 B4 E5 G#5 B5 E6".split(" ").forEach((n, i) => p.note("s", "harp", 5.55 + i * .045, 2.2, n, { vel: .5, ring: 2.5 }));
  for (let k = 0; k < 20; k++) p.note("s", "timpani", 6.4 + k * .07, .07, "E2", { vel: .5 - k * .015 });
  p.note("s", "cymbal", 6, .1, 0, { vel: .6, ring: 2.8, art: "crash" });
  p.note("s", "glock", 6.05, 2, "E7", { vel: .35 }); p.note("s", "glock", 6.15, 2, "B6", { vel: .3 });
  return p;
}

export const PIECES = { town, caves, deep, volcano };
export const STINGER_PIECES = { levelup, descend, cure, death, victory };
