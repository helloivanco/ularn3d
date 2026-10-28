/**
 * Original Ularn sound effects: footfall, swing, hit, door, stairs and spell.
 * Synthesized here; no sampled or transcribed recordings. (The music is the
 * orchestral score from scripts/build-audio.mjs.)
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

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
