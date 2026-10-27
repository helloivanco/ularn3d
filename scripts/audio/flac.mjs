// A small, dependency-free FLAC encoder (RFC 9639 subset) for the score
// build. 16-bit PCM, fixed 4096-sample blocks, verbatim / fixed / LPC
// subframes with partitioned Rice residuals and stereo decorrelation.
// Lossless, so loops stay sample-exact; browsers decode it natively.
import { createHash } from "node:crypto";

const BLOCK = 4096;

class Bits {
  constructor(size = 1 << 16) { this.bytes = new Uint8Array(size); this.length = 0; this.acc = 0; this.count = 0; }
  grow(extra) {
    if (this.length + extra < this.bytes.length) return;
    const next = new Uint8Array(Math.max(this.bytes.length * 2, this.length + extra + 1024)); next.set(this.bytes); this.bytes = next;
  }
  // Writes up to 24 bits at a time; wider fields are split by callers.
  write(value, bits) {
    if (bits > 24) { this.write(Math.floor(value / 2 ** 24) & ((1 << (bits - 24)) - 1), bits - 24); this.write(value % 2 ** 24, 24); return; }
    // acc only ever holds the < 8 pending bits plus this field: exact in a double.
    this.acc = this.acc * 2 ** bits + (value & ((1 << bits) - 1)); this.count += bits;
    this.grow(4);
    while (this.count >= 8) { this.count -= 8; this.bytes[this.length++] = Math.floor(this.acc / 2 ** this.count) & 255; }
    this.acc %= 2 ** this.count;
  }
  signed(value, bits) { this.write(value < 0 ? value + 2 ** bits : value, bits); }
  unary(zeros) { while (zeros >= 24) { this.write(0, 24); zeros -= 24; } this.write(1, zeros + 1); }
  align() { if (this.count) this.write(0, 8 - this.count); }
  view(from = 0, to = this.length) { return this.bytes.subarray(from, to); }
}

const CRC8 = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255; return c; });
const CRC16 = Array.from({ length: 256 }, (_, n) => { let c = n << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; return c; });
const crc8 = (bytes) => { let c = 0; for (const b of bytes) c = CRC8[c ^ b]; return c; };
const crc16 = (bytes) => { let c = 0; for (const b of bytes) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b]; return c; };

const zigzag = (r) => (r >= 0 ? 2 * r : -2 * r - 1);

// Best partitioned-Rice layout for a residual; returns [bits, order, params].
// Partition sums are merged from the finest order upward; bit counts use the
// standard estimate count * (k + 1) + sum / 2^k, exact enough to choose by.
function riceLayout(residual, warmup, size) {
  let top = 0;
  while (top < 8 && size % (2 << top) === 0 && size / (2 << top) > warmup) top++;
  const parts = 1 << top, len = size / parts, sums = new Float64Array(parts), counts = new Float64Array(parts);
  for (let p = 0; p < parts; p++) {
    const start = p ? p * len - warmup : 0, end = (p + 1) * len - warmup;
    let sum = 0; for (let i = start; i < end; i++) sum += zigzag(residual[i]);
    sums[p] = sum; counts[p] = end - start;
  }
  let best = null, levelSums = sums, levelCounts = counts;
  for (let order = top; order >= 0; order--) {
    const params = []; let total = 6;
    for (let p = 0; p < levelSums.length; p++) {
      const sum = levelSums[p], count = levelCounts[p], mean = sum / Math.max(1, count);
      const guess = mean > 1 ? Math.min(14, Math.floor(Math.log2(mean))) : 0;
      let bestBits = Infinity, bestK = guess;
      for (let k = Math.max(0, guess - 1); k <= Math.min(14, guess + 1); k++) {
        const bits = count * (k + 1) + sum / 2 ** k;
        if (bits < bestBits) { bestBits = bits; bestK = k; }
      }
      params.push(bestK); total += 4 + bestBits;
    }
    if (!best || total < best[0]) best = [total, order, params];
    if (order) {
      const nextSums = new Float64Array(levelSums.length / 2), nextCounts = new Float64Array(levelSums.length / 2);
      for (let p = 0; p < nextSums.length; p++) { nextSums[p] = levelSums[2 * p] + levelSums[2 * p + 1]; nextCounts[p] = levelCounts[2 * p] + levelCounts[2 * p + 1]; }
      levelSums = nextSums; levelCounts = nextCounts;
    }
  }
  return best;
}

function writeResidual(out, residual, warmup, size, [, order, params]) {
  out.write(0, 2); out.write(order, 4);
  const len = size >> order;
  params.forEach((k, p) => {
    out.write(k, 4);
    const start = p ? p * len - warmup : 0, end = (p + 1) * len - warmup;
    for (let i = start; i < end; i++) { const u = zigzag(residual[i]); out.unary(Math.floor(u / 2 ** k)); if (k) out.write(u % 2 ** k, k); }
  });
}

const FIXED = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]];
function fixedResidual(x, order) {
  const c = FIXED[order], r = new Array(x.length - order);
  for (let i = order; i < x.length; i++) { let p = 0; for (let j = 0; j < order; j++) p += c[j] * x[i - 1 - j]; r[i - order] = x[i] - p; }
  return r;
}

// Levinson-Durbin on a Welch-windowed block, coefficients quantized with
// error feedback. Precision keeps bps + precision + log2(order) <= 32 so
// 32-bit decoders never overflow.
function lpcCandidates(x, maxOrder, bps) {
  const n = x.length, w = new Float64Array(n);
  for (let i = 0; i < n; i++) { const t = (2 * i - (n - 1)) / (n - 1); w[i] = x[i] * (1 - t * t); }
  const r = new Float64Array(maxOrder + 1);
  for (let lag = 0; lag <= maxOrder; lag++) { let s = 0; for (let i = lag; i < n; i++) s += w[i] * w[i - lag]; r[lag] = s; }
  if (r[0] <= 0) return [];
  r[0] *= 1 + 1e-9;
  const out = [];
  let a = new Float64Array(0), err = r[0];
  for (let m = 1; m <= maxOrder; m++) {
    let acc = r[m]; for (let j = 0; j < m - 1; j++) acc -= a[j] * r[m - 1 - j];
    const k = acc / err, next = new Float64Array(m);
    for (let j = 0; j < m - 1; j++) next[j] = a[j] - k * a[m - 2 - j];
    next[m - 1] = k; a = next; err *= 1 - k * k;
    if (err <= 0) break;
    if (m === 2 || m === 4 || m >= 6) {
      const precision = Math.min(14, 32 - bps - Math.ceil(Math.log2(m)) - 0);
      let cmax = 0; for (const c of a) cmax = Math.max(cmax, Math.abs(c));
      if (!cmax) continue;
      const shift = Math.max(0, Math.min(15, precision - 1 - Math.floor(Math.log2(cmax)) - 1));
      const limit = 2 ** (precision - 1), q = new Array(m);
      let carry = 0;
      for (let j = 0; j < m; j++) { const v = a[j] * 2 ** shift + carry, rounded = Math.round(v); q[j] = Math.max(-limit, Math.min(limit - 1, rounded)); carry = v - q[j]; }
      out.push({ order: m, precision, shift, q });
    }
  }
  return out;
}
function lpcResidual(x, { order, shift, q }) {
  const r = new Array(x.length - order), div = 2 ** shift;
  for (let i = order; i < x.length; i++) { let p = 0; for (let j = 0; j < order; j++) p += q[j] * x[i - 1 - j]; r[i - order] = x[i] - Math.floor(p / div); }
  return r;
}

// Samples that share k trailing zero bits (the score is stored at 14-bit
// precision) are coded k bits narrower: the subframe's "wasted bits".
function encodeSubframe(x, bps) {
  let common = 0; for (const v of x) common |= v;
  let k = 0; while (common && !(common & (1 << k)) && k < bps - 1) k++;
  return k ? encodeSamples(x.map((v) => v >> k), bps - k, k, bps) : encodeSamples(x, bps, 0, bps);
}
function encodeSamples(x, bps, wasted, lpcBps) {
  const size = x.length, extra = 8 + wasted;
  const header = (out, type) => { out.write(type | (wasted ? 1 : 0), 8); if (wasted) out.unary(wasted - 1); };
  let best = { bits: extra + size * bps, write: (out) => { header(out, 0b000010); for (const v of x) out.signed(v, bps); } };
  if (x.every((v) => v === x[0])) return { bits: extra + bps, write: (out) => { header(out, 0); out.signed(x[0], bps); } };
  for (let order = 0; order <= 4 && order < size; order++) {
    const res = fixedResidual(x, order), layout = riceLayout(res, order, size);
    if (!layout) continue;
    const bits = extra + order * bps + layout[0];
    if (bits < best.bits) best = { bits, write: (out) => { header(out, 0b00010000 | (order << 1)); for (let i = 0; i < order; i++) out.signed(x[i], bps); writeResidual(out, res, order, size, layout); } };
  }
  // Coefficient precision is bounded by the full sample width so 32-bit
  // decoders stay exact whether or not they apply the shift first.
  if (size > 32) for (const c of lpcCandidates(x, 8, lpcBps)) {
    const res = lpcResidual(x, c), layout = riceLayout(res, c.order, size);
    if (!layout) continue;
    const bits = extra + c.order * bps + 4 + 5 + c.order * c.precision + layout[0];
    if (bits < best.bits) best = { bits, write: (out) => {
      header(out, 0b01000000 | ((c.order - 1) << 1));
      for (let i = 0; i < c.order; i++) out.signed(x[i], bps);
      out.write(c.precision - 1, 4); out.signed(c.shift, 5);
      for (const v of c.q) out.signed(v, c.precision);
      writeResidual(out, res, c.order, size, layout);
    } };
  }
  return best;
}

function utf8Number(n) {
  if (n < 0x80) return [n];
  const bytes = []; let len = n < 0x800 ? 2 : n < 0x10000 ? 3 : n < 0x200000 ? 4 : 5;
  for (let i = len - 1; i > 0; i--) { bytes.unshift(0x80 | (n & 0x3f)); n >>= 6; }
  bytes.unshift(((0xff00 >> len) & 0xff) | n);
  return bytes;
}
const RATE_CODES = { 8000: 4, 16000: 5, 22050: 6, 24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11 };

// int16: one Int16Array per channel (1-8). Returns a Buffer.
export function encodeFlac(int16, rate) {
  const channels = int16.length, total = int16[0].length, out = new Bits(total * channels);
  let minFrame = Infinity, maxFrame = 0;
  out.write(0x664c6143, 32); // "fLaC"
  const info = out.length;
  out.write(0x80, 8); out.write(34, 24); // last metadata block: STREAMINFO
  for (let i = 0; i < 34; i++) out.write(0, 8);
  for (let start = 0, frame = 0; start < total; start += BLOCK, frame++) {
    const size = Math.min(BLOCK, total - start), begin = out.length;
    const block = int16.map((d) => Array.from(d.subarray(start, start + size)));
    let assignment = channels - 1, subframes;
    if (channels === 2) {
      const [L, R] = block, S = L.map((l, i) => l - R[i]), M = L.map((l, i) => Math.floor((l + R[i]) / 2));
      const [l, r, s, m] = [encodeSubframe(L, 16), encodeSubframe(R, 16), encodeSubframe(S, 17), encodeSubframe(M, 16)];
      const options = [[1, [l, r], l.bits + r.bits], [8, [l, s], l.bits + s.bits], [9, [s, r], s.bits + r.bits], [10, [m, s], m.bits + s.bits]];
      const pick = options.reduce((a, b) => (b[2] < a[2] ? b : a));
      assignment = pick[0]; subframes = pick[1];
    } else subframes = block.map((x) => encodeSubframe(x, 16));
    const sizeCode = size === BLOCK ? 12 : 7; // 12 = 4096; 7 = 16-bit size-1 at end of header
    out.write(0b11111111111110, 14); out.write(0, 1); out.write(0, 1);
    out.write(sizeCode, 4); out.write(RATE_CODES[rate] ?? 0, 4); out.write(assignment, 4); out.write(0b100, 3); out.write(0, 1);
    for (const b of utf8Number(frame)) out.write(b, 8);
    if (sizeCode === 7) out.write(size - 1, 16);
    if (!(rate in RATE_CODES)) throw new Error(`Unsupported FLAC rate ${rate}`);
    out.write(crc8(out.view(begin)), 8);
    for (const sub of subframes) sub.write(out);
    out.align(); out.write(crc16(out.view(begin)), 16);
    const bytes = out.length - begin; minFrame = Math.min(minFrame, bytes); maxFrame = Math.max(maxFrame, bytes);
  }
  // STREAMINFO, written after the frames so frame sizes are known.
  const md5 = createHash("md5"), pcm = Buffer.alloc(total * channels * 2);
  for (let i = 0, o = 0; i < total; i++) for (let c = 0; c < channels; c++, o += 2) pcm.writeInt16LE(int16[c][i], o);
  md5.update(pcm);
  const meta = new Bits(34);
  meta.write(BLOCK, 16); meta.write(BLOCK, 16); meta.write(minFrame, 24); meta.write(maxFrame, 24);
  meta.write(rate, 20); meta.write(channels - 1, 3); meta.write(15, 5); meta.write(Math.floor(total / 2 ** 32), 4); meta.write(total % 2 ** 32, 32);
  const bytes = Buffer.from(out.view());
  Buffer.from(meta.view()).copy(bytes, info + 4); md5.digest().copy(bytes, info + 4 + 18);
  return bytes;
}

// Reference decoder for the build's own round-trip check.
export function decodeFlac(buffer) {
  let pos = 0, acc = 0, count = 0;
  const bit = () => { if (!count) { acc = buffer[pos++]; count = 8; } count--; return (acc >> count) & 1; };
  const read = (n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + bit(); return v; };
  const signed = (n) => { const v = read(n); return v >= 2 ** (n - 1) ? v - 2 ** n : v; };
  const alignByte = () => { count = 0; };
  if (read(32) !== 0x664c6143) throw new Error("Not FLAC");
  let last = 0, rate = 0, channels = 0, total = 0;
  while (!last) {
    last = read(1); const type = read(7), length = read(24);
    if (type === 0) { read(16); read(16); read(24); read(24); rate = read(20); channels = read(3) + 1; read(5); total = read(4) * 2 ** 32 + read(32); for (let i = 0; i < 16; i++) read(8); }
    else for (let i = 0; i < length; i++) read(8);
  }
  const out = Array.from({ length: channels }, () => new Int16Array(total));
  let written = 0;
  while (written < total) {
    if (read(14) !== 0b11111111111110) throw new Error("Lost sync");
    read(2); const sizeCode = read(4); read(4); const assignment = read(4); read(3); read(1);
    let first = read(8); if (first & 0x80) { let extra = 0; while (first & (0x40 >> extra)) extra++; for (let i = 0; i < extra; i++) read(8); }
    const size = sizeCode === 12 ? BLOCK : sizeCode === 7 ? read(16) + 1 : sizeCode === 6 ? read(8) + 1 : 192;
    read(8);
    const subs = [];
    for (let c = 0; c < channels; c++) {
      let bps = (assignment === 8 && c === 1) || (assignment === 9 && c === 0) || (assignment === 10 && c === 1) ? 17 : 16;
      read(1); const type = read(6); let wasted = 0;
      if (read(1)) { wasted = 1; while (!bit()) wasted++; }
      bps -= wasted;
      const x = new Array(size);
      if (type === 0) { const v = signed(bps); x.fill(v); }
      else if (type === 1) for (let i = 0; i < size; i++) x[i] = signed(bps);
      else {
        const lpc = type >= 32, order = lpc ? type - 31 : type - 8;
        for (let i = 0; i < order; i++) x[i] = signed(bps);
        let q = [], shift = 0;
        if (lpc) { const precision = read(4) + 1; shift = signed(5); for (let i = 0; i < order; i++) q.push(signed(precision)); }
        read(2); const porder = read(4), len = size >> porder;
        const res = [];
        for (let p = 0; p < 1 << porder; p++) {
          const k = read(4), n = p ? len : len - order;
          for (let i = 0; i < n; i++) { let z = 0; while (!bit()) z++; const u = z * 2 ** k + read(k); res.push(u & 1 ? -(u + 1) / 2 : u / 2); }
        }
        for (let i = order; i < size; i++) {
          let p = 0;
          if (lpc) { for (let j = 0; j < order; j++) p += q[j] * x[i - 1 - j]; p = Math.floor(p / 2 ** shift); }
          else { const c = FIXED[order]; for (let j = 0; j < order; j++) p += c[j] * x[i - 1 - j]; }
          x[i] = res[i - order] + p;
        }
      }
      if (wasted) for (let i = 0; i < size; i++) x[i] *= 2 ** wasted;
      subs.push(x);
    }
    alignByte(); read(16);
    for (let i = 0; i < size; i++) {
      let l = subs[0][i], r = subs[1]?.[i];
      if (assignment === 8) r = l - r; else if (assignment === 9) l = r + l;
      else if (assignment === 10) { const m = l * 2 + (r & 1); l = (m + r) >> 1; r = (m - r) >> 1; }
      out[0][written + i] = l; if (channels > 1) out[1][written + i] = r;
    }
    written += size;
  }
  return { channels: out, rate };
}
