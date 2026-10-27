// Composes, renders and masters the original Ularn score. Reproducible:
// every note, humanization and noise source is seeded, and nothing is
// sampled or downloaded. See docs/AUDIO.md for the musical structure.
//
//   npm run audio:build            all regions, stingers and the preview
//   npm run audio:build -- caves   one region (stingers and preview kept)
import { mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { SCORE, STINGERS } from "../src/audio-score.js";
import { PIECES, STINGER_PIECES } from "./audio/score.mjs";
import { renderPiece } from "./audio/render.mjs";
import { blockPowers, gatedLoudness, mixPowers, truePeak, limiterGain, resample, stretch, toInt16, fromInt16, gainDb, dbGain, scaleAll, hashSeed, samplePeak } from "./audio/dsp.mjs";
import { encodeFlac, decodeFlac } from "./audio/flac.mjs";

const BED_RATE = 32000, STEM_RATE = 24000, BITS = 14, STEM_BITS = 12;
const TARGET = -18, STINGER_TARGET = -17, CEILING = dbGain(-1.3);
// Each intensity layer lifts the region's loudness by this much (LU).
const LIFT = { a: 1.5, b: 2.2 };
const OUT = "public/audio", DOCS = "docs/audio";

const round = (value, digits = 2) => Number(value.toFixed(digits));
const mono = ([l, r]) => l.map((v, i) => (v + r[i]) / 2);
const log = (...args) => console.error(...args);

// Solve for the gain (dB) that lifts `base` loudness by `lift` LU.
function trimFor(basePowers, layerPowers, lift) {
  const goal = gatedLoudness(basePowers) + lift;
  let low = -40, high = 40;
  for (let k = 0; k < 40; k++) {
    const mid = (low + high) / 2, level = gatedLoudness(mixPowers([[basePowers, 1], [layerPowers, dbGain(mid)]]));
    if (level < goal) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

async function writeFlac(name, int16, rate) {
  const bytes = encodeFlac(int16, rate), back = decodeFlac(bytes);
  for (let c = 0; c < int16.length; c++) for (let i = 0; i < int16[c].length; i++) if (back.channels[c][i] !== int16[c][i]) throw new Error(`${name}: FLAC round trip differs at ${c}:${i}`);
  await writeFile(`${OUT}/${name}.flac`, bytes);
  return bytes.length;
}
// Order-independent fingerprint of the PCM, checked against the browser decode.
const checksum = (int16) => int16.map((d) => { let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i] * ((i % 9973) + 1)) % 2147483647; return s; });

async function region(id) {
  const piece = PIECES[id](), seconds = piece.seconds, started = performance.now();
  log(`${id}: ${piece.events.length} notes, ${seconds.toFixed(2)} s`);
  const bed = renderPiece(piece, BED_RATE, { only: (e) => e.bus === "bed" }).bed;
  const stems = renderPiece(piece, STEM_RATE, { only: (e) => e.bus !== "bed" });
  const layers = { a: mono(stems.a), b: mono(stems.b) };
  // Bed at the target; layers trimmed to their loudness lift over it.
  const bedPowers = () => blockPowers(bed, BED_RATE);
  const dual = (data) => blockPowers([data, data], STEM_RATE);
  scaleAll(bed, dbGain(TARGET - gatedLoudness(bedPowers())));
  const trimA = trimFor(bedPowers(), dual(layers.a), LIFT.a);
  scaleAll([layers.a], dbGain(trimA));
  const withA = mixPowers([[bedPowers(), 1], [dual(layers.a), 1]]);
  const trimB = trimFor(withA, dual(layers.b), LIFT.b);
  scaleAll([layers.b], dbGain(trimB));
  // Limit the full-intensity runtime sum (bed + both layers on both speakers)
  // with one shared gain curve, then each file on its own as a backstop.
  const frames = bed[0].length, up = (data) => resample(data, STEM_RATE, BED_RATE, { frames });
  const layered = up(layers.a.map((v, i) => v + layers.b[i]));
  const full = bed.map((d) => d.map((v, i) => v + layered[i]));
  const shared = limiterGain(full, BED_RATE, { ceiling: CEILING });
  for (const d of bed) for (let i = 0; i < frames; i++) d[i] *= shared[i];
  const sharedStem = stretch(shared, layers.a.length);
  for (const d of [layers.a, layers.b]) for (let i = 0; i < d.length; i++) d[i] *= sharedStem[i];
  for (const files of [bed, [layers.a], [layers.b]]) { const g = limiterGain(files, files === bed ? BED_RATE : STEM_RATE, { ceiling: CEILING }); for (const d of files) for (let i = 0; i < d.length; i++) d[i] *= g[i]; }
  // 14-bit precision with TPDF dither, stored as 16-bit FLAC.
  const bedPcm = toInt16(bed, { bits: BITS, seed: hashSeed(`${id}:bed`) });
  const stemPcm = toInt16([layers.a, layers.b], { bits: STEM_BITS, seed: hashSeed(`${id}:stem`) });
  const bedBytes = await writeFlac(id, bedPcm, BED_RATE), stemBytes = await writeFlac(`${id}-tension`, stemPcm, STEM_RATE);
  // Measure what ships.
  const [qBed, [qa, qb]] = [fromInt16(bedPcm), fromInt16(stemPcm)];
  const pb = blockPowers(qBed, BED_RATE), pa = dual(qa), pB = dual(qb);
  const qLayered = up(qa.map((v, i) => v + qb[i])), qFull = qBed.map((d) => d.map((v, i) => v + qLayered[i]));
  const seam = Math.max(...qBed.map((d) => Math.abs(d[0] - d.at(-1))), ...[qa, qb].map((d) => Math.abs(d[0] - d.at(-1))));
  log(`  rendered and mastered in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  return {
    title: piece.title, tempo: piece.tempo, beats: piece.beats, bars: piece.bars, seconds,
    bed: { file: `${id}.flac`, sampleRate: BED_RATE, channels: 2, frames: bedPcm[0].length, bytes: bedBytes, checksum: checksum(bedPcm),
      lufs: round(gatedLoudness(pb)), truePeakDb: round(gainDb(truePeak(qBed))), samplePeak: round(samplePeak(qBed), 4) },
    stem: { file: `${id}-tension.flac`, sampleRate: STEM_RATE, channels: 2, layers: ["stir", "fray"], frames: stemPcm[0].length, bytes: stemBytes, checksum: checksum(stemPcm),
      trimDb: [round(trimA, 1), round(trimB, 1)], truePeakDb: round(gainDb(truePeak([qa, qb]))) },
    intensity: { rest: round(gatedLoudness(pb)), stir: round(gatedLoudness(mixPowers([[pb, 1], [pa, 1]]))), full: round(gatedLoudness(mixPowers([[pb, 1], [pa, 1], [pB, 1]]))),
      fullTruePeakDb: round(gainDb(truePeak(qFull))) },
    seam: round(seam, 5),
  };
}

async function stingers() {
  const total = Math.max(...Object.values(STINGERS).map(([start, length]) => start + length));
  const sprite = [new Float32Array(Math.round(total * BED_RATE)), new Float32Array(Math.round(total * BED_RATE))], cues = {};
  for (const [id, [start, length]] of Object.entries(STINGERS)) {
    const piece = STINGER_PIECES[id](), audio = renderPiece(piece, BED_RATE, { loop: false, length }).s;
    scaleAll(audio, dbGain(STINGER_TARGET - gatedLoudness(blockPowers(audio, BED_RATE, { loop: false }))));
    const g = limiterGain(audio, BED_RATE, { ceiling: CEILING, loop: false }), fade = Math.round(.5 * BED_RATE), n = audio[0].length;
    for (const d of audio) for (let i = 0; i < n; i++) d[i] *= g[i] * Math.min(1, (n - 1 - i) / fade);
    const offset = Math.round(start * BED_RATE);
    for (let c = 0; c < 2; c++) sprite[c].set(audio[c], offset);
    cues[id] = { start, duration: length, lufs: round(gatedLoudness(blockPowers(audio, BED_RATE, { loop: false }))), truePeakDb: round(gainDb(truePeak(audio, false))) };
    log(`stinger ${id}: ${cues[id].lufs} LUFS, ${cues[id].truePeakDb} dBTP`);
  }
  const pcm = toInt16(sprite, { bits: BITS, seed: hashSeed("stingers") });
  return { file: "stingers.flac", sampleRate: BED_RATE, channels: 2, seconds: total, bytes: await writeFlac("stingers", pcm, BED_RATE), checksum: checksum(pcm), cues };
}

// A shareable listening preview: each region rising from rest to full
// intensity, then every stinger.
async function preview(manifest) {
  const rate = STEM_RATE, segment = 13, parts = [];
  for (const id of Object.keys(PIECES)) {
    const read = async (file) => decodeFlac(await readFile(`${OUT}/${file}`));
    const bed = await read(manifest.regions[id].bed.file), stem = await read(manifest.regions[id].stem.file);
    const [l, r] = fromInt16(bed.channels).map((d) => resample(d, BED_RATE, rate, { loop: true })), [a, b] = fromInt16(stem.channels);
    const n = segment * rate, out = [new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      const t = i / n, ga = Math.min(1, Math.max(0, (t - .35) / .2)), gb = Math.min(1, Math.max(0, (t - .62) / .2));
      const env = Math.min(1, i / (rate * .3), (n - i) / (rate * .6)), s = a[i] * ga + b[i] * gb;
      out[0][i] = (l[i] + s) * env; out[1][i] = (r[i] + s) * env;
    }
    parts.push(out);
  }
  const sprite = fromInt16(decodeFlac(await readFile(`${OUT}/stingers.flac`)).channels).map((d) => resample(d, BED_RATE, rate, { loop: false }));
  for (const [start, length] of Object.values(STINGERS)) parts.push(sprite.map((d) => d.subarray(Math.round(start * rate), Math.round((start + length) * rate))));
  const gap = Math.round(.4 * rate), size = parts.reduce((s, p) => s + p[0].length + gap, 0), all = [new Float32Array(size), new Float32Array(size)];
  let at = 0; for (const p of parts) { for (let c = 0; c < 2; c++) all[c].set(p[c], at); at += p[0].length + gap; }
  const bytes = encodeFlac(toInt16(all, { bits: BITS, seed: 7 }), rate);
  await writeFile(`${DOCS}/soundtrack-preview.flac`, bytes);
  return { file: "docs/audio/soundtrack-preview.flac", seconds: round(size / rate, 1), bytes: bytes.length };
}

await mkdir(OUT, { recursive: true }); await mkdir(DOCS, { recursive: true });
const only = process.argv.slice(2).filter((id) => PIECES[id]);
let manifest = { regions: {} };
try { manifest = JSON.parse(await readFile(`${OUT}/score.json`, "utf8")); } catch {}
if (!manifest.regions) manifest = { regions: {} };
for (const id of only.length ? only : Object.keys(PIECES)) manifest.regions[id] = await region(id);
if (!only.length) {
  manifest.stingers = await stingers();
  // Retire the previous PCM score.
  for (const name of ["title", "town", "caves", "volcano"]) for (const suffix of ["", "-tension"]) await rm(`${OUT}/${name}${suffix}.wav`, { force: true });
  await rm(`${DOCS}/soundtrack-preview.wav`, { force: true });
  manifest.preview = await preview(manifest);
}
const files = [...Object.values(manifest.regions).flatMap((r) => [r.bed.bytes, r.stem.bytes]), manifest.stingers?.bytes ?? 0];
manifest = {
  method: "Original composition; offline additive, subtractive, Karplus-Strong and formant synthesis in scripts/audio. No samples.",
  sampleRates: { bed: BED_RATE, stem: STEM_RATE }, bits: { bed: BITS, stem: STEM_BITS }, targetLufs: TARGET, ceilingDbtp: round(gainDb(CEILING), 1),
  totalBytes: files.reduce((a, b) => a + b, 0), regions: manifest.regions, stingers: manifest.stingers, preview: manifest.preview,
};
if (!only.length) for (const [id, entry] of Object.entries(SCORE)) if (!manifest.regions[entry.bed]) throw new Error(`Missing region ${id}`);
await writeFile(`${OUT}/score.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ totalMB: round(manifest.totalBytes / 1e6), regions: Object.fromEntries(Object.entries(manifest.regions).map(([id, r]) => [id, { MB: round((r.bed.bytes + r.stem.bytes) / 1e6), ...r.intensity, bedTP: r.bed.truePeakDb, stemTP: r.stem.truePeakDb, trim: r.stem.trimDb }])) }, null, 2));
