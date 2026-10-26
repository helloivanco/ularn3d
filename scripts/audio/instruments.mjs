// Orchestral instrument models for the offline score. Each renders one note
// (a whole section for strings, brass and choir) into a short stereo buffer,
// already shaped by its body resonances, so notes can be summed freely:
// the filters are linear, so per-note filtering equals filtering the section.
import { Biquad, OnePole, TAU, midiHz, panGains, rng, clamp } from "./dsp.mjs";

const blep = (t, dt) => {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
};
class Saw {
  constructor(phase = 0) { this.p = phase; }
  next(dt) { this.p += dt; if (this.p >= 1) this.p -= 1; return 2 * this.p - 1 - blep(this.p, dt); }
}
class Square {
  constructor(phase = 0, duty = .5) { this.p = phase; this.duty = duty; }
  next(dt) {
    this.p += dt; if (this.p >= 1) this.p -= 1;
    let v = this.p < this.duty ? 1 : -1;
    v += blep(this.p, dt); v -= blep((this.p - this.duty + 1) % 1, dt);
    return v;
  }
}
// Smooth random wander in [-1, 1] for pitch drift and bow pressure.
class Wander {
  constructor(random, rate, hz = 1.5) { this.random = random; this.step = Math.max(1, Math.round(rate / hz)); this.i = 0; this.a = random.signed(); this.b = random.signed(); }
  next() { if (++this.i >= this.step) { this.i = 0; this.a = this.b; this.b = this.random.signed(); } const t = this.i / this.step, s = t * t * (3 - 2 * t); return this.a + (this.b - this.a) * s; }
}

// Attack/sustain/release envelope with an optional dynamic shape across the
// note: "swell" rises into the middle, "fade" thins out, "accent" leans in.
function envelope(t, length, attack, release, shape = "flat") {
  const a = t < attack ? Math.sin(Math.PI / 2 * t / attack) ** 1.6 : 1;
  const left = length - t, r = left < release ? Math.max(0, left / release) ** 1.5 : 1;
  const x = clamp(t / Math.max(.01, length - release * .5), 0, 1);
  const s = shape === "swell" ? .62 + .38 * Math.sin(Math.PI * x) : shape === "cresc" ? .55 + .45 * x : shape === "fade" ? 1 - .5 * x
    : shape === "accent" ? .7 + .3 * Math.exp(-t * 3) * 1.4 : 1;
  return a * r * s;
}

const SECTIONS = {
  // voices, width, base pan, detune cents, vibrato hz / cents, brightness, body peaks [hz, gainDb, q]
  violins: { voices: 5, width: .45, detune: 7, vib: [5.6, 13], bright: [8, 20], max: 9000, body: [[290, 3, 1.4], [520, 1.5, 1.2], [2900, 3.5, .9], [5200, -4, .8]] },
  violas: { voices: 4, width: .3, detune: 6, vib: [5.3, 12], bright: [7, 16], max: 7000, body: [[230, 3, 1.3], [440, 2, 1.2], [2200, 2.5, .9], [4200, -4, .8]] },
  cellos: { voices: 4, width: .3, detune: 6, vib: [5.0, 11], bright: [7, 16], max: 5500, body: [[110, 2.5, 1.2], [240, 3, 1.1], [1500, 2, .9], [3200, -5, .8]] },
  basses: { voices: 3, width: .2, detune: 5, vib: [4.6, 8], bright: [6, 12], max: 3000, body: [[70, 3, 1.1], [180, 2, 1.1], [900, 1, .9], [2000, -6, .8]] },
};

const noiseOf = (seed) => { const r = rng(seed); return () => r() * 2 - 1; };

// Bowed string section. Articulations: legato (default), tremolo, spiccato,
// harmonic (airy flautando), sforzando.
function strings(n, rate) {
  const s = SECTIONS[n.section], random = rng(n.seed), noise = noiseOf(n.seed ^ 0x51), f0 = midiHz(n.midi);
  const art = n.art || "legato", short = art === "spiccato";
  const attack = n.attack ?? (short ? .012 : art === "tremolo" ? .08 : art === "sfz" ? .03 : clamp(.32 - n.vel * .16, .08, .4));
  const release = n.release ?? (short ? .09 : .45);
  const length = n.dur + release, frames = Math.ceil(length * rate), L = new Float32Array(frames), R = new Float32Array(frames);
  const voices = Math.max(1, Math.round(s.voices * (n.solo ? .2 : 1)));
  const dyn = .35 + .65 * n.vel, cutoff = clamp(f0 * (s.bright[0] + s.bright[1] * n.vel * (art === "harmonic" ? .3 : 1)), 300, s.max);
  for (let v = 0; v < voices; v++) {
    const spread = voices > 1 ? v / (voices - 1) - .5 : 0, [gl, gr] = panGains(clamp(n.pan + spread * s.width * 2, -1, 1));
    const osc = new Saw(random()), detune = (random.signed() * s.detune + spread * s.detune) / 1200;
    const vibHz = s.vib[0] * random.range(.92, 1.08), vibDepth = s.vib[1] / 1200 * random.range(.7, 1.2) * (art === "harmonic" ? .4 : 1);
    const vibPhase = random() * TAU, vibDelay = random.range(.15, .45), drift = new Wander(random, rate, 1.3);
    const lp1 = new OnePole(rate, cutoff), lp2 = new OnePole(rate, cutoff * 2.5);
    const tremHz = random.range(11.5, 15), tremPhase = random(), delay = Math.round(random() * .018 * rate);
    const gain = dyn / Math.sqrt(voices) * .5;
    for (let i = delay; i < frames; i++) {
      const t = (i - delay) / rate, vibAmt = clamp((t - vibDelay) / .5, 0, 1) * vibDepth;
      const cents = detune + vibAmt * Math.sin(TAU * vibHz * t + vibPhase) + drift.next() * 2.5 / 1200;
      let x = osc.next(f0 * (1 + cents * .693147) / rate);
      if (art === "harmonic") x = Math.sin(osc.p * TAU) * .8 + x * .2;
      x = lp2.process(lp1.process(x));
      let e = envelope(t, length, attack, release, n.shape);
      if (art === "tremolo") { const ph = (t * tremHz + tremPhase) % 1; e *= .55 + .45 * Math.exp(-ph * 4.5); }
      if (short) e *= Math.exp(-Math.max(0, t - .02) * 9);
      const y = x * e * gain;
      L[i] += y * gl; R[i] += y * gr;
    }
  }
  // Bow hair: band-limited noise that leans on the attack.
  const hair = new Biquad(rate, "bandpass", clamp(f0 * 6, 1200, 5200), .9), [hl, hr] = panGains(n.pan);
  const hairAmt = (art === "tremolo" ? .05 : short ? .07 : .022) * dyn;
  for (let i = 0; i < frames; i++) {
    const t = i / rate, e = envelope(t, length, attack, release) * (1 + 3 * Math.exp(-t * 18));
    const y = hair.process(noise()) * e * hairAmt; L[i] += y * hl; R[i] += y * hr;
  }
  bodyEq([L, R], rate, s.body);
  return [L, R];
}

function bodyEq(channels, rate, peaks) {
  for (const data of channels) for (const [hz, db, q] of peaks) new Biquad(rate, "peak", hz, q, db).run(data);
}

// Brass: brightness follows loudness, the defining brass behaviour, with a
// small lip "scoop" into pitch and a section of slightly detuned players.
const BRASS = {
  horns: { voices: 3, width: .25, formant: [[420, 5, 1.2], [1100, -2, 1], [2600, -8, .8]], bright: [2, 7], max: 2400, scoop: 22, attack: .07 },
  trumpets: { voices: 2, width: .2, formant: [[1250, 5, 1.1], [2600, 2, 1], [5200, -4, .8]], bright: [3, 12], max: 6500, scoop: 15, attack: .03 },
  trombones: { voices: 3, width: .25, formant: [[520, 4, 1.1], [1350, 1, 1], [3200, -6, .8]], bright: [2.5, 10], max: 4200, scoop: 18, attack: .05 },
  tuba: { voices: 1, width: 0, formant: [[230, 4, 1.1], [700, 1, 1], [1600, -6, .8]], bright: [2, 6], max: 1600, scoop: 12, attack: .07 },
};
function brass(n, rate) {
  const b = BRASS[n.section], random = rng(n.seed), f0 = midiHz(n.midi);
  const short = n.art === "stab", attack = n.attack ?? (short ? .02 : b.attack * (1.4 - n.vel * .6)), release = n.release ?? (short ? .12 : .32);
  const length = n.dur + release, frames = Math.ceil(length * rate), L = new Float32Array(frames), R = new Float32Array(frames);
  const voices = Math.max(1, n.solo ? 1 : b.voices);
  for (let v = 0; v < voices; v++) {
    const spread = voices > 1 ? v / (voices - 1) - .5 : 0, [gl, gr] = panGains(clamp(n.pan + spread * b.width * 2, -1, 1));
    const osc = new Saw(random()), detune = random.signed() * 5 / 1200, drift = new Wander(random, rate, 1.1);
    const lp1 = new OnePole(rate, 1000), lp2 = new OnePole(rate, 1000), delay = Math.round(random() * .012 * rate);
    for (let i = delay; i < frames; i++) {
      const t = (i - delay) / rate, e = envelope(t, length, attack, release, n.shape) * (short ? Math.exp(-Math.max(0, t - .05) * 6) : 1);
      const scoop = -b.scoop / 1200 * Math.exp(-t / .045), vib = t > .4 ? Math.sin(TAU * 4.8 * t) * 4 / 1200 * clamp((t - .4) / .6, 0, 1) : 0;
      const cents = detune + scoop + vib + drift.next() * 2 / 1200;
      const level = e * (.4 + .6 * n.vel), cut = clamp(f0 * (b.bright[0] + b.bright[1] * level * level), 120, b.max);
      lp1.set(cut); lp2.set(cut * 1.25);
      const y = lp2.process(lp1.process(osc.next(f0 * (1 + cents * .693147) / rate))) * level * .55 / Math.sqrt(voices);
      L[i] += y * gl; R[i] += y * gr;
    }
  }
  bodyEq([L, R], rate, b.formant);
  return [L, R];
}

// Woodwinds: breath, register-appropriate spectra and a delayed vibrato.
const WINDS = {
  flute: { wave: "sine", formant: [[1800, 2, 1]], breath: .06, vib: [5, 9], max: 7000 },
  altoFlute: { wave: "sine", formant: [[900, 2, 1]], breath: .07, vib: [4.7, 8], max: 5000 },
  oboe: { wave: "pulse", duty: .22, formant: [[1150, 9, 2.5], [2900, 5, 2], [4500, -6, 1]], breath: .02, vib: [5.4, 11], max: 7000 },
  englishHorn: { wave: "pulse", duty: .25, formant: [[950, 8, 2.2], [2300, 4, 2], [3800, -6, 1]], breath: .02, vib: [5, 10], max: 5500 },
  clarinet: { wave: "square", formant: [[1500, 2, 1.3], [3300, -6, 1]], breath: .025, vib: [0, 0], max: 4200 },
  bassClarinet: { wave: "square", formant: [[600, 3, 1.3], [1800, -6, 1]], breath: .03, vib: [0, 0], max: 2600 },
  bassoon: { wave: "saw", formant: [[480, 7, 1.8], [1180, 4, 1.8], [2800, -8, 1]], breath: .02, vib: [5, 7], max: 3000 },
};
function wind(n, rate) {
  const w = WINDS[n.section], random = rng(n.seed), noise = noiseOf(n.seed ^ 0x77), f0 = midiHz(n.midi);
  const attack = n.attack ?? clamp(.09 - n.vel * .04, .03, .12), release = n.release ?? .18;
  const length = n.dur + release, frames = Math.ceil(length * rate), M = new Float32Array(frames);
  const osc = w.wave === "square" ? new Square(random()) : w.wave === "pulse" ? new Square(random(), w.duty) : new Saw(random());
  const lp1 = new OnePole(rate, 1000), lp2 = new OnePole(rate, 1000), drift = new Wander(random, rate, 1.6), vibPhase = random() * TAU;
  const breath = new Biquad(rate, "bandpass", clamp(f0 * 2.2, 600, 6000), 1.4);
  let phase = random();
  for (let i = 0; i < frames; i++) {
    const t = i / rate, e = envelope(t, length, attack, release, n.shape), level = e * (.45 + .55 * n.vel);
    const vib = w.vib[1] / 1200 * clamp((t - .25) / .5, 0, 1) * Math.sin(TAU * w.vib[0] * t + vibPhase);
    const f = f0 * (1 + (vib + drift.next() * 3 / 1200) * .693147), dt = f / rate;
    let x;
    if (w.wave === "sine") { phase = (phase + dt) % 1; x = Math.sin(TAU * phase) + .22 * Math.sin(2 * TAU * phase) * level + .06 * Math.sin(3 * TAU * phase); }
    else x = osc.next(dt);
    const cut = clamp(f0 * (3 + 10 * level), 200, w.max); lp1.set(cut); lp2.set(cut * 2);
    const chiff = Math.exp(-t * 40) * .5;
    M[i] = (lp2.process(lp1.process(x)) + breath.process(noise()) * (w.breath + chiff * w.breath * 4)) * level * .32;
  }
  bodyEq([M], rate, w.formant);
  const [gl, gr] = panGains(n.pan);
  return [M.map((v) => v * gl), M.map((v) => v * gr)];
}

// Karplus-Strong plucked string with allpass fine tuning; harp and pizzicato.
function pluck(n, rate) {
  const f0 = midiHz(n.midi), random = rng(n.seed), period = rate / f0;
  const pizz = n.section !== "harp";
  const t60 = pizz ? clamp(1.6 - (n.midi - 28) * .022, .25, 1.4) : clamp(7 - (n.midi - 36) * .11, 1.1, 7);
  const length = Math.min(t60 * 1.1, (n.ring ?? 8)) + .05, frames = Math.ceil(length * rate), M = new Float32Array(frames);
  const D = Math.max(2, Math.floor(period - .5 - .1)), frac = period - .5 - D, c = (1 - frac) / (1 + frac);
  const line = new Float32Array(D), loss = 10 ** (-3 / (f0 * t60));
  const tone = new OnePole(rate, clamp(f0 * (pizz ? 4 + 6 * n.vel : 6 + 18 * n.vel), 300, 9000));
  for (let i = 0; i < D; i++) line[i] = tone.process(random.signed());
  const pos = Math.max(1, Math.round(D * (pizz ? .2 : .13)));
  const excite = Float32Array.from(line, (v, i) => v - line[(i - pos + D) % D]);
  let mean = 0; for (const v of excite) mean += v / D; for (let i = 0; i < D; i++) line[i] = excite[i] - mean;
  let idx = 0, prev = 0, apX = 0, apY = 0;
  const gain = (.25 + .75 * n.vel) * (pizz ? .9 : .75);
  for (let i = 0; i < frames; i++) {
    const out = line[idx], avg = loss * (out * .5 + prev * .5); prev = out;
    const ap = c * avg + apX - c * apY; apX = avg; apY = ap;
    line[idx] = ap; idx = (idx + 1) % D;
    const fade = i > frames - rate * .05 ? (frames - i) / (rate * .05) : 1;
    M[i] = out * gain * fade * Math.min(1, i / (rate * .0015));
  }
  bodyEq([M], rate, pizz ? [[200, 4, 1], [900, 1, 1], [3000, -6, .8]] : [[180, 3, 1], [420, 2, 1], [3800, -4, .8]]);
  const [gl, gr] = panGains(n.pan);
  return [M.map((v) => v * gl), M.map((v) => v * gr)];
}

// Struck bars: celesta (soft, resonator-reinforced) and glockenspiel.
function bars(n, rate) {
  const f0 = midiHz(n.midi), random = rng(n.seed), glock = n.section === "glock";
  const partials = glock ? [[1, 1, 3.2], [2.76, .4, 1.2], [5.4, .22, .5], [8.93, .1, .25]] : [[1, 1, 2.6], [2, .12, 1.1], [2.76, .16, .45], [5.4, .06, .2]];
  const length = Math.min(n.ring ?? 6, partials[0][2] * 1.1) + .05, frames = Math.ceil(length * rate), M = new Float32Array(frames);
  for (const [ratio, amp, t60] of partials) {
    const f = f0 * ratio * (1 + random.signed() * .0008);
    if (f > rate * .45) continue;
    const w = TAU * f / rate, k = 2 * Math.cos(w), decay = 10 ** (-3 / (t60 * rate));
    let y1 = 0, y2 = -Math.sin(w), g = 1; // struck from rest: a sine from zero phase
    for (let i = 0; i < frames; i++) { const y = k * y1 - y2; y2 = y1; y1 = y; g *= decay; M[i] += y * amp * g; }
  }
  const noise = noiseOf(n.seed), click = new Biquad(rate, "highpass", 2500, .7);
  for (let i = 0; i < Math.min(frames, rate * .01); i++) M[i] += click.process(noise()) * .08 * (1 - i / (rate * .01));
  const level = (.2 + .8 * n.vel) * (glock ? .32 : .38);
  const fade = Math.round(rate * .04);
  for (let i = 0; i < frames; i++) M[i] *= level * Math.min(1, i / (rate * .001)) * (i > frames - fade ? (frames - i) / fade : 1);
  const [gl, gr] = panGains(n.pan);
  return [M.map((v) => v * gl), M.map((v) => v * gr)];
}

// Choir: detuned singers through vowel formants with breath. Vowels blend
// over the note for a living pad.
const VOWELS = {
  oo: [[320, 1, 70], [800, .35, 90], [2300, .08, 140]],
  oh: [[480, 1, 80], [840, .5, 90], [2450, .1, 140]],
  ah: [[760, 1, 90], [1180, .6, 100], [2600, .22, 150]],
  mm: [[260, 1, 60], [1100, .08, 120], [2400, .03, 160]],
};
function choir(n, rate) {
  const random = rng(n.seed), noise = noiseOf(n.seed ^ 0x99), f0 = midiHz(n.midi), singers = n.voices ?? 6;
  const attack = n.attack ?? .45, release = n.release ?? .6, length = n.dur + release, frames = Math.ceil(length * rate);
  const L = new Float32Array(frames), R = new Float32Array(frames), mix = new Float32Array(frames);
  for (let v = 0; v < singers; v++) {
    const osc = new Saw(random()), detune = random.signed() * 9 / 1200, vibHz = random.range(4.6, 5.8), vibPhase = random() * TAU;
    const drift = new Wander(random, rate, 1.1), delay = Math.round(random() * .05 * rate), depth = random.range(14, 24) / 1200;
    for (let i = delay; i < frames; i++) {
      const t = (i - delay) / rate, vib = depth * clamp((t - .2) / .6, 0, 1) * Math.sin(TAU * vibHz * t + vibPhase);
      mix[i] += osc.next(f0 * (1 + (detune + vib + drift.next() * 4 / 1200) * .693147) / rate) / Math.sqrt(singers);
    }
  }
  const from = VOWELS[n.vowel || "ah"], to = VOWELS[n.to || n.vowel || "ah"];
  const filters = from.map(([hz, , bw]) => new Biquad(rate, "bandpass", hz, hz / bw));
  const air = new Biquad(rate, "bandpass", 3000, .8), [gl, gr] = panGains(n.pan), width = n.width ?? .35;
  const [wl, wr] = panGains(clamp(n.pan - width, -1, 1)), [xl, xr] = panGains(clamp(n.pan + width, -1, 1));
  const decorrelate = new Float32Array(Math.round(rate * .011));
  let d = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / rate, x = clamp(t / Math.max(.1, n.dur), 0, 1), e = envelope(t, length, attack, release, n.shape) * (.35 + .65 * n.vel);
    if (i % 64 === 0) filters.forEach((f, k) => { const hz = from[k][0] + (to[k][0] - from[k][0]) * x; f.set(hz, hz / from[k][2]); });
    let y = 0; for (let k = 0; k < 3; k++) y += filters[k].process(mix[i]) * (from[k][1] + (to[k][1] - from[k][1]) * x);
    y = (y * 1.6 + air.process(noise()) * .018) * e * .5;
    const late = decorrelate[d]; decorrelate[d] = y; d = (d + 1) % decorrelate.length;
    L[i] += y * gl * .6 + y * wl * .4 + late * xl * .25; R[i] += y * gr * .6 + late * xr * .25 + y * wr * .15;
  }
  return [L, R];
}

// Percussion.
function timpani(n, rate) {
  const f0 = midiHz(n.midi), random = rng(n.seed), noise = noiseOf(n.seed);
  const modes = [[.56, .5, .25], [1, 1, 2.8], [1.504, .55, 1.7], [1.742, .32, 1.2], [1.99, .3, 1.0], [2.245, .16, .7], [2.494, .12, .55], [2.8, .08, .45]];
  const length = (n.ring ?? 3) + .05, frames = Math.ceil(length * rate), M = new Float32Array(frames), soft = 1 - n.vel;
  for (const [ratio, amp, t60] of modes) {
    let phase = random() * TAU; const decay = 10 ** (-3 / (t60 * (.8 + .4 * soft) * rate));
    let g = amp * (ratio > 2 ? .4 + .6 * n.vel : 1);
    for (let i = 0; i < frames; i++) {
      const t = i / rate, glide = 1 + .018 * n.vel * Math.exp(-t / .06);
      phase += TAU * f0 * ratio * glide / rate; g *= decay; M[i] += Math.sin(phase) * g;
    }
  }
  const mallet = new Biquad(rate, "lowpass", 700 + 1600 * n.vel, .7);
  for (let i = 0; i < Math.min(frames, rate * .04); i++) M[i] += mallet.process(noise()) * Math.exp(-i / rate * 90) * 1.2;
  const level = (.15 + .85 * n.vel) * .32, fade = Math.round(rate * .05);
  for (let i = 0; i < frames; i++) M[i] *= level * Math.min(1, i / (rate * .0008)) * (i > frames - fade ? (frames - i) / fade : 1);
  const [gl, gr] = panGains(n.pan);
  return [M.map((v) => v * gl), M.map((v) => v * gr)];
}
function drum(n, rate) {
  const random = rng(n.seed), noise = noiseOf(n.seed), kind = n.section;
  const spec = { taiko: [88, 52, .9, 900], bassDrum: [62, 44, 1.6, 400], frame: [150, 105, .35, 1600], tom: [130, 90, .5, 1200] }[kind];
  const [start, end, t60, skin] = spec, length = (n.ring ?? t60 * 1.15) + .03, frames = Math.ceil(length * rate), M = new Float32Array(frames);
  let phase = random() * TAU, phase2 = random() * TAU; const body = new Biquad(rate, "bandpass", skin, .9);
  for (let i = 0; i < frames; i++) {
    const t = i / rate, f = end + (start - end) * Math.exp(-t / .045);
    phase += TAU * f / rate; phase2 += TAU * f * 1.58 / rate;
    const e = Math.exp(-t * 6.9 / t60);
    M[i] = (Math.sin(phase) + .3 * Math.sin(phase2) * Math.exp(-t * 14)) * e + body.process(noise()) * Math.exp(-t * 45) * (kind === "frame" ? .9 : .6);
  }
  const level = (.15 + .85 * n.vel) * (kind === "frame" ? .2 : .42);
  for (let i = 0; i < frames; i++) M[i] *= level * Math.min(1, i / (rate * .0006)) * Math.min(1, (frames - i) / (rate * .02));
  const [gl, gr] = panGains(n.pan);
  return [M.map((v) => v * gl), M.map((v) => v * gr)];
}
// Tam-tam: dense inharmonic partials that bloom upward after the strike.
function tamtam(n, rate) {
  const random = rng(n.seed), length = (n.ring ?? 7) + .05, frames = Math.ceil(length * rate), L = new Float32Array(frames), R = new Float32Array(frames);
  const count = 42, low = n.low ?? 70;
  for (let k = 0; k < count; k++) {
    const pos = (k + random()) / count, f = low * (5200 / low) ** pos;
    if (f > rate * .45) continue;
    const w = TAU * f / rate, c = 2 * Math.cos(w), amp = (1 - pos * .6) * random.range(.5, 1) / Math.sqrt(count);
    const bloom = .03 + pos * (n.bloom ?? 1.1), t60 = (n.ring ?? 7) * (1 - pos * .6), decay = 10 ** (-3 / (t60 * rate));
    const [gl, gr] = panGains(random.signed() * .7);
    let y1 = 0, y2 = -Math.sin(w), g = amp;
    for (let i = 0; i < frames; i++) {
      const t = i / rate, y = c * y1 - y2; y2 = y1; y1 = y; g *= decay;
      const v = y * g * (1 - Math.exp(-t / bloom)); L[i] += v * gl; R[i] += v * gr;
    }
  }
  const level = (.2 + .8 * n.vel) * .55, fade = Math.round(rate * .3);
  for (let i = 0; i < frames; i++) { const f = i > frames - fade ? (frames - i) / fade : 1; L[i] *= level * f; R[i] *= level * f; }
  return [L, R];
}
// Suspended cymbal: soft-mallet roll swelling into the downbeat, or a crash.
function cymbal(n, rate) {
  const noise = noiseOf(n.seed), random = rng(n.seed ^ 3), swell = n.art !== "crash";
  const rise = swell ? n.dur : 0, length = rise + (n.ring ?? 2.6) + .05, frames = Math.ceil(length * rate);
  const L = new Float32Array(frames), R = new Float32Array(frames);
  const hp = [new Biquad(rate, "highpass", 3200, .7), new Biquad(rate, "highpass", 3200, .7)], hp2 = [new Biquad(rate, "highpass", 2400, .7), new Biquad(rate, "highpass", 2400, .7)];
  const rings = Array.from({ length: 5 }, () => new Biquad(rate, "bandpass", random.range(3800, Math.min(11000, rate * .42)), 12));
  for (let i = 0; i < frames; i++) {
    const t = i / rate, after = t - rise;
    const e = swell ? (after < 0 ? (t / rise) ** 2.6 : Math.exp(-after * 6.9 / (n.ring ?? 2.6))) : Math.exp(-t * 6.9 / (n.ring ?? 2.6)) * (1 + 2 * Math.exp(-t * 30));
    for (let c = 0; c < 2; c++) {
      const x = noise(); let y = hp2[c].process(hp[c].process(x)); let ring = 0;
      for (const r of rings) ring += r.process(x); y = y * .6 + ring * .9;
      (c ? R : L)[i] = y * e * (.15 + .85 * n.vel) * .09;
    }
  }
  return [L, R];
}

export const INSTRUMENTS = {
  violins: strings, violas: strings, cellos: strings, basses: strings,
  horns: brass, trumpets: brass, trombones: brass, tuba: brass,
  flute: wind, altoFlute: wind, oboe: wind, englishHorn: wind, clarinet: wind, bassClarinet: wind, bassoon: wind,
  harp: pluck, pizz: pluck, celesta: bars, glock: bars, choir,
  timpani, taiko: drum, bassDrum: drum, frame: drum, tom: drum, tamtam, cymbal,
};
// Orchestral seating (audience view) and how far back each section sits,
// which sets its reverb send.
export const SEATING = {
  violins: [-.42, .22], violas: [.12, .24], cellos: [.34, .24], basses: [.5, .26], pizz: [.3, .24],
  flute: [-.12, .28], altoFlute: [-.14, .3], oboe: [.08, .28], englishHorn: [.1, .3], clarinet: [-.2, .3], bassClarinet: [-.24, .32], bassoon: [.18, .3],
  horns: [-.3, .42], trumpets: [.08, .4], trombones: [.32, .42], tuba: [.4, .42],
  harp: [-.55, .3], celesta: [.48, .34], glock: [.4, .38], choir: [0, .45],
  timpani: [.22, .44], taiko: [-.1, .4], bassDrum: [.05, .46], frame: [-.08, .3], tom: [.1, .4], tamtam: [.15, .55], cymbal: [-.05, .5],
};

export function renderNote(n, rate) {
  const fn = INSTRUMENTS[n.section];
  if (!fn) throw new Error(`Unknown instrument ${n.section}`);
  return fn(n, rate);
}
