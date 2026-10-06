/**
 * Original Ularn beds and effects. Mood only: warm filtered synths, a soft
 * drum machine, mid-tempo and unhurried. No sampled or transcribed recordings.
 *
 * Run: node scripts/generate-game-audio.mjs
 * Writes public/audio/*.mp3 for the offline desktop build.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "audio");
const SR = 44100;

const NOTE = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

const hz = (note, octave) => {
  const midi = (octave + 1) * 12 + NOTE[note];
  return 440 * 2 ** ((midi - 69) / 12);
};

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const polyblep = (t, dt) => {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
};

class Biquad {
  constructor(sr, type, freq, q) {
    this.sr = sr;
    this.type = type;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(freq, q);
  }
  set(freq, q) {
    const f = Math.min(Math.max(freq, 30), this.sr * 0.45);
    const w0 = (2 * Math.PI * f) / this.sr;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.max(0.2, q));
    let b0;
    let b1;
    let b2;
    let a0;
    let a1;
    let a2;
    if (this.type === "highpass") {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (this.type === "bandpass") {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const renderSaw = (sr, freq, seconds, cents = 0) => {
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  const f = freq * 2 ** (cents / 1200);
  const dt = f / sr;
  let p = 0.15;
  for (let i = 0; i < n; i++) {
    let y = 2 * p - 1;
    y -= polyblep(p, dt);
    out[i] = y;
    p += dt;
    if (p >= 1) p -= 1;
  }
  return out;
};

const renderSine = (sr, freq, seconds, glide = 1) => {
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = freq * (1 + (glide - 1) * t);
    phase += (2 * Math.PI * f) / sr;
    out[i] = Math.sin(phase);
  }
  return out;
};

const applyEnv = (samples, sr, { attack = 0.02, release = 0.08, curve = 3 } = {}) => {
  const n = samples.length;
  const a = Math.max(1, Math.floor(attack * sr));
  const r = Math.max(1, Math.floor(release * sr));
  for (let i = 0; i < n; i++) {
    let g = 1;
    if (i < a) g = i / a;
    const tail = n - i;
    if (tail < r) g *= tail / r;
    samples[i] *= g ** curve;
  }
  return samples;
};

const scale = (samples, gain) => {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
};

const mixAt = (bus, start, samples, gain = 1) => {
  for (let i = 0; i < samples.length; i++) {
    const idx = start + i;
    if (idx >= 0 && idx < bus.length) bus[idx] += samples[i] * gain;
  }
};

const filterSamples = (samples, sr, type, freq, q) => {
  const filter = new Biquad(sr, type, freq, q);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = filter.process(samples[i]);
  return out;
};

const highpassDC = (samples, sr, freq = 28) => {
  const rc = 1 / (2 * Math.PI * freq);
  const a = rc / (rc + 1 / sr);
  let y = 0;
  let x = 0;
  for (let i = 0; i < samples.length; i++) {
    const next = samples[i];
    y = a * (y + next - x);
    x = next;
    samples[i] = y;
  }
};

const peakOf = (channels) => {
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  return peak;
};

const normalize = (channels, target) => {
  const peak = peakOf(channels) || 1;
  const gain = target / peak;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
  return peak;
};

const seamless = (left, right, xfade) => {
  const n = left.length;
  const outL = left.slice(0, n - xfade);
  const outR = right.slice(0, n - xfade);
  for (let i = 0; i < xfade; i++) {
    const t = xfade <= 1 ? 1 : i / (xfade - 1);
    const fadeIn = Math.sin(t * Math.PI * 0.5);
    const fadeOut = Math.cos(t * Math.PI * 0.5);
    outL[i] = left[i] * fadeIn + left[n - xfade + i] * fadeOut;
    outR[i] = right[i] * fadeIn + right[n - xfade + i] * fadeOut;
  }
  return [outL, outR];
};

const widen = (left, right, sr, delaySec, amount) => {
  const delay = Math.floor(sr * delaySec);
  for (let i = right.length - 1; i >= 0; i--) {
    const delayed = i >= delay ? left[i - delay] : 0;
    right[i] = right[i] * (1 - amount) + delayed * amount;
  }
};

const saturate = (samples, drive = 1.1) => {
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i] * drive) / norm;
};

const writeWav = (file, channels, sr) => {
  const frames = channels[0].length;
  const block = channels.length * 2;
  const buffer = Buffer.alloc(44 + frames * block);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * block, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels.length, 22);
  buffer.writeUInt32LE(sr, 24);
  buffer.writeUInt32LE(sr * block, 28);
  buffer.writeUInt16LE(block, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * block, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const data of channels) {
      const clamped = Math.max(-1, Math.min(1, data[i]));
      buffer.writeInt16LE(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, offset);
      offset += 2;
    }
  }
  writeFileSync(file, buffer);
};

const encode = (wav, mp3, bitrate) => {
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", bitrate, mp3],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || `ffmpeg failed for ${mp3}`);
};

const footfall = (sr, seed, seconds = 0.18) => {
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  const rand = mulberry32(seed);
  const body = new Biquad(sr, "lowpass", 240, 0.7);
  const grit = new Biquad(sr, "bandpass", 720, 0.8);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const freq = 78 * Math.exp(-t * 22) + 46;
    phase += (2 * Math.PI * freq) / sr;
    const thud = Math.sin(phase) * Math.exp(-t * 20) * 0.62;
    const scrape = grit.process(rand() * 2 - 1) * Math.exp(-t * 38) * 0.22;
    const heel = body.process(rand() * 2 - 1) * Math.exp(-t * 48) * 0.55;
    const toeT = t - 0.052;
    const toe = toeT > 0 ? (rand() * 2 - 1) * Math.exp(-toeT * 70) * 0.14 : 0;
    out[i] = thud + scrape + heel + toe;
  }
  return filterSamples(out, sr, "lowpass", 1400, 0.6);
};

const renderStep = () => footfall(SR, 11, 0.2);

const renderSwing = () => {
  const seconds = 0.3;
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const rand = mulberry32(21);
  const air = new Biquad(SR, "bandpass", 700, 1.2);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const travel = Math.sin(Math.PI * Math.min(1, t / 0.24));
    air.set(380 + 1900 * travel, 1.15);
    const open = Math.min(1, t / 0.035);
    const shut = Math.exp(-Math.max(0, t - 0.12) * 7.5);
    out[i] = air.process(rand() * 2 - 1) * open * shut * 0.85;
  }
  return out;
};

const renderHit = () => {
  const seconds = 0.16;
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const rand = mulberry32(33);
  let thud = 0;
  let metalA = 0;
  let metalB = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const freq = 128 * Math.exp(-t * 26) + 52;
    thud += (2 * Math.PI * freq) / SR;
    metalA += (2 * Math.PI * 1680) / SR;
    metalB += (2 * Math.PI * 2375) / SR;
    const click = i < SR * 0.004 ? (rand() * 2 - 1) * (1 - i / (SR * 0.004)) : 0;
    const body = Math.sin(thud) * Math.exp(-t * 24) * 0.7;
    const tick = (Math.sin(metalA) * 0.55 + Math.sin(metalB) * 0.35) * Math.exp(-t * 55) * 0.18;
    const crush = (rand() * 2 - 1) * Math.exp(-t * 40) * 0.16;
    out[i] = body + tick + crush + click * 0.35;
  }
  return filterSamples(out, SR, "lowpass", 4200, 0.5);
};

const renderDoor = () => {
  const seconds = 0.42;
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const rand = mulberry32(44);
  const creak = new Biquad(SR, "bandpass", 640, 6);
  const wood = new Biquad(SR, "lowpass", 380, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    creak.set(520 + Math.sin(t * 18) * 160 + t * 90, 7);
    const open = t < 0.04 ? t / 0.04 : 1;
    const groan = creak.process(rand() * 2 - 1) * open * Math.exp(-Math.max(0, t - 0.28) * 14) * 0.42;
    const latchT = t - 0.3;
    const latch = latchT > 0 ? wood.process(rand() * 2 - 1) * Math.exp(-latchT * 46) * 0.55 : 0;
    out[i] = groan + latch;
  }
  return out;
};

const renderStairs = () => {
  const seconds = 0.58;
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  [0, 0.16, 0.33].forEach((at, index) => {
    const step = footfall(SR, 60 + index, 0.2);
    mixAt(out, Math.floor(SR * at), step, 0.85 - index * 0.08);
  });
  const wet = new Float32Array(n);
  const delay = Math.floor(SR * 0.014);
  for (let i = delay; i < n; i++) wet[i] = out[i - delay] * 0.22;
  for (let i = 0; i < n; i++) out[i] += wet[i];
  return filterSamples(out, SR, "lowpass", 2200, 0.6);
};

const renderSpell = () => {
  const seconds = 0.42;
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const rand = mulberry32(77);
  const air = new Biquad(SR, "bandpass", 1400, 0.8);
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    air.set(900 + 700 * Math.min(1, t / 0.2), 0.7);
    a += (2 * Math.PI * 392) / SR;
    b += (2 * Math.PI * 588) / SR;
    c += (2 * Math.PI * 784) / SR;
    const bloom = Math.min(1, t / 0.05) * Math.exp(-Math.max(0, t - 0.08) * 4.2);
    const glass = (Math.sin(a) * 0.45 + Math.sin(b) * 0.28 + Math.sin(c) * 0.16) * bloom;
    const rush = air.process(rand() * 2 - 1) * bloom * 0.35;
    out[i] = glass * 0.34 + rush;
  }
  return out;
};

const schedulePad = (left, right, sr, start, seconds, tones, cutoff) => {
  const n = Math.floor(sr * seconds);
  const dryL = new Float32Array(n);
  const dryR = new Float32Array(n);
  tones.forEach((freq) => {
    const a = renderSaw(sr, freq, seconds, -6);
    const b = renderSaw(sr, freq, seconds, 6);
    for (let i = 0; i < n; i++) {
      dryL[i] += (a[i] + b[i]) * 0.5;
      dryR[i] += a[i] * 0.42 + b[i] * 0.58;
    }
  });
  const filterL = new Biquad(sr, "lowpass", cutoff, 0.7);
  const filterR = new Biquad(sr, "lowpass", cutoff * 0.94, 0.7);
  const begin = Math.floor(start * sr);
  for (let i = 0; i < n; i++) {
    const attack = Math.min(1, i / (sr * 0.2));
    const t = i / n;
    const release = t > 0.78 ? (1 - t) / 0.22 : 1;
    const g = attack * release * 0.2;
    const idx = begin + i;
    if (idx < 0 || idx >= left.length) continue;
    left[idx] += filterL.process(dryL[i]) * g;
    right[idx] += filterR.process(dryR[i]) * g;
  }
};

const scheduleBass = (left, right, sr, start, seconds, freq) => {
  const n = Math.floor(sr * seconds);
  const sine = renderSine(sr, freq, seconds);
  const body = renderSine(sr, freq * 2, seconds);
  const begin = Math.floor(start * sr);
  for (let i = 0; i < n; i++) {
    const t = i / seconds;
    const env = Math.min(1, i / (sr * 0.03)) * Math.exp(-t * 1.6);
    const idx = begin + i;
    if (idx < 0 || idx >= left.length) continue;
    const sample = (sine[i] * 0.75 + body[i] * 0.12) * env * 0.55;
    left[idx] += sample;
    right[idx] += sample;
  }
};

const schedulePluck = (left, right, sr, start, freq, pan) => {
  const seconds = 0.42;
  const n = Math.floor(sr * seconds);
  const tone = renderSine(sr, freq, seconds);
  const over = renderSine(sr, freq * 2, seconds);
  const begin = Math.floor(start * sr);
  const gL = pan < 0 ? 1 : 0.72;
  const gR = pan > 0 ? 1 : 0.72;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 6.5) * Math.min(1, i / (sr * 0.008));
    const idx = begin + i;
    if (idx < 0 || idx >= left.length) continue;
    const sample = (tone[i] * 0.8 + over[i] * 0.18) * env * 0.16;
    left[idx] += sample * gL;
    right[idx] += sample * gR;
  }
};

const scheduleKick = (bus, sr, start, gain) => {
  const seconds = 0.12;
  const n = Math.floor(sr * seconds);
  const begin = Math.floor(start * sr);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const freq = 52 + 90 * Math.exp(-t * 28);
    phase += (2 * Math.PI * freq) / sr;
    const idx = begin + i;
    if (idx >= 0 && idx < bus.length) bus[idx] += Math.sin(phase) * Math.exp(-t * 16) * gain;
  }
};

const scheduleSnare = (bus, sr, start, gain, seed) => {
  const seconds = 0.1;
  const n = Math.floor(sr * seconds);
  const rand = mulberry32(seed);
  const noise = new Biquad(sr, "bandpass", 1800, 0.7);
  const begin = Math.floor(start * sr);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    phase += (2 * Math.PI * 180) / sr;
    const idx = begin + i;
    if (idx < 0 || idx >= bus.length) continue;
    const body = Math.sin(phase) * Math.exp(-t * 30) * 0.35;
    const snap = noise.process(rand() * 2 - 1) * Math.exp(-t * 22);
    bus[idx] += (body + snap) * gain;
  }
};

const scheduleHat = (bus, sr, start, gain, seed) => {
  const seconds = 0.035;
  const n = Math.floor(sr * seconds);
  const rand = mulberry32(seed);
  const noise = new Biquad(sr, "highpass", 6500, 0.7);
  const begin = Math.floor(start * sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const idx = begin + i;
    if (idx >= 0 && idx < bus.length)
      bus[idx] += noise.process(rand() * 2 - 1) * Math.exp(-t * 90) * gain;
  }
};

const renderBar = (spec, left, right, drums, index, chord) => {
  const beat = 60 / spec.bpm;
  const bar = beat * 4;
  const start = index * bar;
  schedulePad(left, right, SR, start, bar + 0.24, chord.tones, spec.cutoff);
  scheduleBass(left, right, SR, start, beat * 1.45, chord.bass);
  for (const step of spec.kicks) {
    scheduleKick(drums, SR, start + beat * step.at, spec.kick * step.gain);
  }
  for (const step of spec.snares) {
    scheduleSnare(drums, SR, start + beat * step.at, spec.snare * step.gain, 200 + index * 17 + Math.round(step.at * 10));
  }
  spec.hats.forEach((step, hatIndex) => {
    const swung = start + beat * step.at + (step.at % 1 ? 0.011 : 0);
    scheduleHat(drums, SR, swung, spec.hat * step.gain, 400 + index * 13 + hatIndex);
  });
  for (const note of spec.melody.filter((item) => item.bar === index)) {
    schedulePluck(left, right, SR, start + beat * note.beat, note.freq, note.pan || 0);
  }
};

const renderBed = (spec) => {
  const beat = 60 / spec.bpm;
  const bar = beat * 4;
  const duration = spec.chords.length * bar;
  const xfadeSec = 0.48;
  const frames = Math.ceil((duration + xfadeSec) * SR);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const drums = new Float32Array(frames);
  spec.chords.forEach((chord, index) => renderBar(spec, left, right, drums, index, chord));
  renderBar(spec, left, right, drums, spec.chords.length, spec.chords[0]);
  widen(left, right, SR, spec.widen, spec.wide);
  for (let i = 0; i < frames; i++) {
    left[i] += drums[i];
    right[i] += drums[i];
  }
  saturate(left, 1.04);
  saturate(right, 1.04);
  highpassDC(left, SR);
  highpassDC(right, SR);
  const xfade = Math.floor(xfadeSec * SR);
  const [loopL, loopR] = seamless(left, right, xfade);
  normalize([loopL, loopR], spec.peak);
  const seam = Math.abs(loopL[0] - left[frames - xfade]);
  const step = Math.abs(left[frames - xfade] - left[frames - xfade - 1]);
  return {
    channels: [loopL, loopR],
    seconds: loopL.length / SR,
    seam,
    step,
  };
};

const tones = (notes) => notes.map(([name, octave]) => hz(name, octave));

const town = () =>
  renderBed({
    bpm: 102,
    cutoff: 1180,
    peak: 0.16,
    kick: 0.42,
    snare: 0.16,
    hat: 0.045,
    widen: 0.013,
    wide: 0.28,
    kicks: [
      { at: 0, gain: 1 },
      { at: 2, gain: 0.72 },
    ],
    snares: [
      { at: 1, gain: 0.85 },
      { at: 3, gain: 0.7 },
    ],
    hats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((at) => ({
      at,
      gain: at % 1 ? 0.9 : 0.45,
    })),
    chords: [
      { bass: hz("D", 2), tones: tones([["D", 3], ["F#", 3], ["A", 3], ["C#", 4]]) },
      { bass: hz("B", 1), tones: tones([["B", 2], ["D", 3], ["F#", 3], ["A", 3]]) },
      { bass: hz("G", 2), tones: tones([["G", 2], ["B", 2], ["D", 3], ["F#", 3]]) },
      { bass: hz("A", 2), tones: tones([["A", 2], ["C#", 3], ["E", 3], ["F#", 3]]) },
      { bass: hz("D", 2), tones: tones([["D", 3], ["F#", 3], ["A", 3], ["E", 4]]) },
      { bass: hz("E", 2), tones: tones([["E", 3], ["G", 3], ["B", 3], ["D", 4]]) },
      { bass: hz("G", 2), tones: tones([["G", 2], ["B", 2], ["D", 3], ["F#", 3]]) },
      { bass: hz("A", 2), tones: tones([["A", 2], ["D", 3], ["E", 3], ["G", 3]]) },
    ],
    melody: [
      { bar: 0, beat: 1.5, freq: hz("F#", 4), pan: -0.2 },
      { bar: 1, beat: 2.5, freq: hz("A", 4), pan: 0.25 },
      { bar: 2, beat: 1, freq: hz("D", 5), pan: -0.1 },
      { bar: 4, beat: 2, freq: hz("A", 4), pan: 0.2 },
      { bar: 5, beat: 1.5, freq: hz("B", 4), pan: -0.25 },
      { bar: 6, beat: 3, freq: hz("D", 5), pan: 0.15 },
    ],
  });

const cave = () =>
  renderBed({
    bpm: 96,
    cutoff: 720,
    peak: 0.15,
    kick: 0.36,
    snare: 0.1,
    hat: 0.02,
    widen: 0.007,
    wide: 0.12,
    kicks: [
      { at: 0, gain: 1 },
      { at: 2.5, gain: 0.45 },
    ],
    snares: [{ at: 3, gain: 0.75 }],
    hats: [0, 2].map((at) => ({ at, gain: 0.6 })),
    chords: [
      { bass: hz("F", 1), tones: tones([["F", 2], ["Ab", 2], ["C", 3], ["Eb", 3]]) },
      { bass: hz("Db", 2), tones: tones([["Db", 2], ["F", 2], ["Ab", 2], ["C", 3]]) },
      { bass: hz("Ab", 1), tones: tones([["Ab", 2], ["C", 3], ["Eb", 3], ["G", 3]]) },
      { bass: hz("Eb", 2), tones: tones([["Eb", 2], ["G", 2], ["Bb", 2], ["C", 3]]) },
      { bass: hz("F", 1), tones: tones([["F", 2], ["Ab", 2], ["C", 3], ["G", 3]]) },
      { bass: hz("Bb", 1), tones: tones([["Bb", 1], ["Db", 2], ["F", 2], ["Ab", 2]]) },
      { bass: hz("Db", 2), tones: tones([["Db", 2], ["F", 2], ["Ab", 2], ["C", 3]]) },
      { bass: hz("C", 2), tones: tones([["C", 2], ["E", 2], ["G", 2], ["Bb", 2]]) },
    ],
    melody: [
      { bar: 0, beat: 2.5, freq: hz("C", 4), pan: 0 },
      { bar: 2, beat: 3, freq: hz("Eb", 4), pan: -0.15 },
      { bar: 4, beat: 1.5, freq: hz("Ab", 3), pan: 0.1 },
      { bar: 6, beat: 2, freq: hz("F", 4), pan: 0 },
    ],
  });

const effectFiles = {
  step: renderStep,
  swing: renderSwing,
  hit: renderHit,
  door: renderDoor,
  stairs: renderStairs,
  spell: renderSpell,
};

mkdirSync(outDir, { recursive: true });

const report = [];
for (const [name, render] of [
  ["town", town],
  ["cave", cave],
]) {
  const bed = render();
  const wav = join(outDir, `${name}.wav`);
  const mp3 = join(outDir, `${name}.mp3`);
  writeWav(wav, bed.channels, SR);
  encode(wav, mp3, "80k");
  rmSync(wav);
  report.push({
    name,
    seconds: Number(bed.seconds.toFixed(2)),
    seam: Number(bed.seam.toFixed(6)),
    step: Number(bed.step.toFixed(6)),
    bytes: statSync(mp3).size,
  });
}

for (const [name, render] of Object.entries(effectFiles)) {
  const samples = render();
  applyEnv(samples, SR, { attack: 0.004, release: 0.02, curve: 1 });
  highpassDC(samples, SR, 35);
  normalize([samples], name === "spell" ? 0.42 : 0.55);
  const wav = join(outDir, `${name}.wav`);
  const mp3 = join(outDir, `${name}.mp3`);
  writeWav(wav, [samples], SR);
  encode(wav, mp3, "48k");
  rmSync(wav);
  report.push({
    name,
    seconds: Number((samples.length / SR).toFixed(3)),
    bytes: statSync(mp3).size,
  });
}

console.log(JSON.stringify(report, null, 2));
