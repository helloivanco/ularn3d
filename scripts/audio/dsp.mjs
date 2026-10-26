// Offline DSP for the score build: deterministic noise, filters, a stereo
// FDN hall, BS.1770 loudness, true-peak limiting and PCM quantization. Nothing
// here runs in the game; the browser only plays the rendered buffers.
export const TAU = Math.PI * 2;
export const midiHz = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const dbGain = (db) => 10 ** (db / 20);
export const gainDb = (gain) => 20 * Math.log10(Math.max(1e-12, gain));
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// mulberry32: every instrument draws its own seeded stream, so adding a part
// never changes the humanization of another.
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.signed = () => next() * 2 - 1;
  next.range = (low, high) => low + (high - low) * next();
  return next;
}
export const hashSeed = (text) => { let h = 2166136261; for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

// RBJ biquads. `set` may be called per sample for swept filters.
export class Biquad {
  constructor(rate, type = "lowpass", frequency = 1000, q = .707, gain = 0) {
    this.rate = rate; this.type = type; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(frequency, q, gain);
  }
  set(frequency, q = this.q, gain = this.gain) {
    this.q = q; this.gain = gain;
    const w = TAU * clamp(frequency, 10, this.rate * .48) / this.rate, cos = Math.cos(w), sin = Math.sin(w);
    const alpha = sin / (2 * Math.max(.05, q)), A = 10 ** (gain / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case "highpass": b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case "bandpass": b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case "peak": b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; break;
      case "lowshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cos + s); b1 = 2 * A * ((A - 1) - (A + 1) * cos); b2 = A * ((A + 1) - (A - 1) * cos - s);
        a0 = (A + 1) + (A - 1) * cos + s; a1 = -2 * ((A - 1) + (A + 1) * cos); a2 = (A + 1) + (A - 1) * cos - s; break;
      }
      case "highshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cos + s); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - s);
        a0 = (A + 1) - (A - 1) * cos + s; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - s; break;
      }
      default: b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  run(data) { for (let i = 0; i < data.length; i++) data[i] = this.process(data[i]); return data; }
}

// One-pole lowpass, cheap enough for per-voice tone shaping.
export class OnePole {
  constructor(rate, frequency) { this.rate = rate; this.y = 0; this.set(frequency); }
  set(frequency) { this.a = 1 - Math.exp(-TAU * clamp(frequency, 5, this.rate * .49) / this.rate); return this; }
  process(x) { this.y += this.a * (x - this.y); return this.y; }
}

// A stereo pair of channels. Buffers are plain Float32Arrays so stems can be
// summed, measured and written without copies.
export const stereo = (frames) => [new Float32Array(frames), new Float32Array(frames)];
export const panGains = (pan) => { const p = (clamp(pan, -1, 1) + 1) * Math.PI / 4; return [Math.cos(p), Math.sin(p)]; };
export function scaleAll(channels, gain) { for (const data of channels) for (let i = 0; i < data.length; i++) data[i] *= gain; }

// Feedback-delay-network hall (wet only). Eight mutually prime lines, a
// Householder mix, frequency-dependent decay and decorrelated stereo taps.
// For loops, rendering twice and keeping the second pass yields the periodic
// steady state, so tails cross the seam exactly as in continuous playback.
export function hall(input, rate, { decay = 2.4, predelay = .03, damping = 5200, size = 1, early = .5, width = 1, lowCut = 140, loop = true } = {}) {
  const n = input[0].length, base = [1031, 1327, 1523, 1801, 2063, 2377, 2683, 3049];
  const lengths = base.map((d) => Math.round(d * size * rate / 32000));
  const lines = lengths.map((d) => new Float32Array(d)), pos = new Array(8).fill(0);
  const gains = lengths.map((d) => 10 ** (-3 * d / rate / decay));
  const damp = lengths.map(() => new OnePole(rate, damping)), pre = Math.round(predelay * rate);
  const inCut = [new Biquad(rate, "highpass", lowCut, .6), new Biquad(rate, "highpass", lowCut, .6)];
  // Early reflections: a sparse multi-tap with alternating sides.
  const taps = [[.0113, .62, -1], [.0197, .5, 1], [.0271, .44, -1], [.0349, .36, 1], [.0433, .3, -1], [.0521, .24, 1], [.0617, .19, -1], [.0733, .15, 1]]
    .map(([t, g, side]) => [Math.round(t * size * rate), g * early, side]);
  const out = stereo(n), state = new Float32Array(8), history = stereo(n);
  const read = (data, j) => (loop ? data[(j + n) % n] : j >= 0 ? data[j] : 0);
  const passes = loop ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      const l = inCut[0].process(read(input[0], i - pre)), r = inCut[1].process(read(input[1], i - pre));
      history[0][i] = l; history[1][i] = r;
      let sum = 0;
      for (let k = 0; k < 8; k++) { state[k] = damp[k].process(lines[k][pos[k]]) * gains[k]; sum += state[k]; }
      const h = sum * .25;
      for (let k = 0; k < 8; k++) {
        lines[k][pos[k]] = state[k] - h + (k % 2 ? r : l) * .35; pos[k] = (pos[k] + 1) % lengths[k];
      }
      if (pass !== passes - 1) continue;
      let erL = 0, erR = 0;
      for (const [delay, g, side] of taps) {
        const hl = read(history[0], i - delay), hr = read(history[1], i - delay);
        if (side < 0) { erL += hl * g; erR += hr * g * .35; } else { erR += hr * g; erL += hl * g * .35; }
      }
      const wetL = state[0] - state[2] + state[4] - state[6] + state[1] * .5, wetR = state[1] - state[3] + state[5] - state[7] + state[2] * .5;
      const mid = (wetL + wetR) * .5, side = (wetL - wetR) * .5 * width;
      out[0][i] = (mid + side) * .5 + erL * .3;
      out[1][i] = (mid - side) * .5 + erR * .3;
    }
  }
  return out;
}

// ITU-R BS.1770-4 K-weighting for any sample rate (libebur128 derivation).
function kWeighting(rate) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = .7071752369554196;
  let K = Math.tan(Math.PI * f0 / rate);
  const Vh = 10 ** (G / 20), Vb = Vh ** .4996667741545416, a0 = 1 + K / Q + K * K;
  const shelf = { b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  f0 = 38.13547087602444; Q = .5003270373238773; K = Math.tan(Math.PI * f0 / rate);
  const d = 1 + K / Q + K * K;
  const high = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / d, a2: (1 - K / Q + K * K) / d };
  return [shelf, high];
}
const runCoefficients = (data, c) => {
  const out = new Float64Array(data.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i], y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
};
// K-weighted mean-square power of each 400 ms block (100 ms hop), summed over
// channels. Loops are measured as heard: twice through, keeping the second
// pass's filter state. Blocks sit on a time grid, so files at different
// rates can be mixed by power for the layered intensities.
export function blockPowers(channels, rate, { loop = true } = {}) {
  const [shelf, high] = kWeighting(rate), n = channels[0].length;
  const weighted = channels.map((data) => {
    const twice = loop ? new Float32Array(n * 2) : data;
    if (loop) { twice.set(data, 0); twice.set(data, n); }
    const y = runCoefficients(runCoefficients(twice, shelf), high);
    return loop ? y.subarray(n) : y;
  });
  const block = Math.round(.4 * rate), powers = [];
  for (let k = 0; Math.round(k * .1 * rate) + block <= n; k++) {
    const start = Math.round(k * .1 * rate);
    let sum = 0;
    for (const y of weighted) for (let i = start; i < start + block; i++) sum += y[i] * y[i];
    powers.push(sum / block);
  }
  return Float64Array.from(powers);
}
// Integrated loudness (LUFS) with absolute and relative gating.
export function gatedLoudness(powers) {
  const lufs = (p) => -0.691 + 10 * Math.log10(Math.max(1e-20, p));
  const gated = [...powers].filter((p) => lufs(p) > -70);
  if (!gated.length) return -Infinity;
  const relative = lufs(gated.reduce((a, b) => a + b, 0) / gated.length) - 10;
  const kept = gated.filter((p) => lufs(p) > relative);
  return lufs(kept.reduce((a, b) => a + b, 0) / kept.length);
}
export const loudness = (channels, rate, options) => gatedLoudness(blockPowers(channels, rate, options));
export function mixPowers(parts) {
  const n = Math.min(...parts.map(([p]) => p.length)), out = new Float64Array(n);
  for (const [p, gain] of parts) for (let i = 0; i < n; i++) out[i] += p[i] * gain * gain;
  return out;
}

// Windowed-sinc resampler (circular for loops), for measuring and limiting
// the runtime sum of beds and layers stored at different rates.
export function resample(data, from, to, { loop = true, frames = Math.round(data.length * to / from) } = {}) {
  const out = new Float32Array(frames), ratio = from / to, cutoff = Math.min(1, to / from) * .94, half = 16, n = data.length;
  for (let i = 0; i < frames; i++) {
    const x = i * ratio, base = Math.floor(x);
    let sum = 0, norm = 0;
    for (let k = base - half + 1; k <= base + half; k++) {
      const t = x - k, w = .5 + .5 * Math.cos(Math.PI * t / half), arg = Math.PI * t * cutoff;
      const h = (Math.abs(arg) < 1e-9 ? 1 : Math.sin(arg) / arg) * w * cutoff;
      const j = loop ? ((k % n) + n) % n : k;
      if (j >= 0 && j < n) sum += data[j] * h;
      norm += h;
    }
    out[i] = sum / (norm || 1);
  }
  return out;
}
// Linear interpolation for slowly varying control curves (gain envelopes).
export function stretch(curve, frames) {
  const out = new Float32Array(frames), ratio = curve.length / frames;
  for (let i = 0; i < frames; i++) { const x = i * ratio, k = Math.floor(x), f = x - k; out[i] = curve[k % curve.length] * (1 - f) + curve[(k + 1) % curve.length] * f; }
  return out;
}

// 4x oversampled true peak (Kaiser-windowed sinc, 16 taps per phase).
const besselI0 = (x) => { let sum = 1, term = 1; for (let k = 1; k < 30; k++) { term *= (x / (2 * k)) ** 2; sum += term; } return sum; };
const PHASES = 4, TAPS = 16;
const POLYPHASE = Array.from({ length: PHASES }, (_, p) => {
  const taps = new Float64Array(TAPS), beta = 7, half = TAPS / 2;
  let sum = 0;
  for (let k = 0; k < TAPS; k++) {
    const t = k - half + 1 - p / PHASES, x = Math.PI * t;
    const sinc = Math.abs(t) < 1e-9 ? 1 : Math.sin(x) / x;
    const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - (t / half) ** 2))) / besselI0(beta);
    taps[k] = sinc * w; sum += taps[k];
  }
  for (let k = 0; k < TAPS; k++) taps[k] /= sum;
  return taps;
});
export function truePeakEnvelope(data, loop = true) {
  const n = data.length, env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let peak = Math.abs(data[i]);
    for (let p = 1; p < PHASES; p++) {
      let y = 0; const taps = POLYPHASE[p];
      for (let k = 0; k < TAPS; k++) {
        let j = i + k - TAPS / 2 + 1;
        if (loop) j = (j + n) % n; else if (j < 0 || j >= n) continue;
        y += data[j] * taps[k];
      }
      peak = Math.max(peak, Math.abs(y));
    }
    env[i] = peak;
  }
  return env;
}
export function truePeak(channels, loop = true) {
  let peak = 0;
  for (const data of channels) { const env = truePeakEnvelope(data, loop); for (let i = 0; i < env.length; i++) if (env[i] > peak) peak = env[i]; }
  return peak;
}
export const samplePeak = (channels) => { let peak = 0; for (const d of channels) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); return peak; };

// Lookahead true-peak limiter gain. The curve is a hold-minimum followed by a
// box filter of the same length, so it is fully down before each peak, then
// releases exponentially. Circular for loops. Returned rather than applied so
// one curve can limit the runtime sum of a bed and its layers together.
export function limiterGain(channels, rate, { ceiling = dbGain(-1.2), lookahead = .006, release = .12, loop = true } = {}) {
  const n = channels[0].length, w = Math.max(2, Math.round(lookahead * rate));
  const envs = channels.map((d) => truePeakEnvelope(d, loop));
  const want = new Float32Array(n);
  for (let i = 0; i < n; i++) { let p = 0; for (const e of envs) p = Math.max(p, e[i]); want[i] = p > ceiling ? ceiling / p : 1; }
  const at = (i) => want[loop ? (i + n) % n : clamp(i, 0, n - 1)];
  const held = new Float32Array(n);
  for (let i = 0; i < n; i++) { let m = 1; for (let k = 0; k <= w; k++) m = Math.min(m, at(i + k)); held[i] = m; }
  const rel = Math.exp(-1 / (release * rate)), smooth = new Float32Array(n);
  let g = 1;
  for (let pass = loop ? 0 : 1; pass < 2; pass++) for (let i = 0; i < n; i++) { g = held[i] < g ? held[i] : rel * g + (1 - rel) * held[i]; if (pass) smooth[i] = g; }
  // Centered box average of the held minimum: reaches it before each peak.
  const final = new Float32Array(n), at2 = (i) => smooth[loop ? ((i % n) + n) % n : clamp(i, 0, n - 1)];
  let acc = 0; for (let k = -w; k <= 0; k++) acc += at2(k);
  for (let i = 0; i < n; i++) {
    final[i] = acc / (w + 1);
    acc += at2(i + 1) - at2(i - w);
  }
  return final;
}

// Quantize to 16-bit words. Below 16 bits of precision, deterministic TPDF
// dither decorrelates the error and the low bits stay zero for FLAC.
export function toInt16(channels, { bits = 16, seed = 1 } = {}) {
  const step = 2 ** (16 - bits), random = rng(seed), top = 32768 - step;
  return channels.map((data) => {
    const out = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const dither = bits < 16 ? random() - random() : 0;
      out[i] = clamp(Math.round(data[i] * 32768 / step + dither) * step, -32768, top);
    }
    return out;
  });
}
export const fromInt16 = (channels) => channels.map((data) => Float32Array.from(data, (v) => v / 32768));

