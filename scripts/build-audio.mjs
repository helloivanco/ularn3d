import { mkdir, writeFile } from "node:fs/promises";
import { SCORE } from "../src/audio-score.js";

// An original modal folk score. E-minor's recurring E–G–B–A–G phrase connects
// the hopeful town arrangement with the quieter caves and volcanic ostinato.
const RATE = 22050, TAU = Math.PI * 2;
let seed = 0x24e138;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const pitch = (midi) => 440 * 2 ** ((midi - 69) / 12);
function track(seconds, stereo = true) {
  return Array.from({ length: stereo ? 2 : 1 }, () => new Float32Array(Math.round(seconds * RATE)));
}
function note(buffer, at, midi, duration, instrument, velocity = .12, pan = 0) {
  const frequency = pitch(midi), length = Math.floor(duration * RATE), start = Math.round(at * RATE), n = buffer[0].length;
  const phase = random() * TAU;
  for (let i = 0; i < length; i++) {
    const t = i / RATE, release = Math.min(1, (duration - t) / (instrument === "strings" ? .7 : .18));
    let wave, envelope;
    if (instrument === "lute") {
      envelope = (1 - Math.exp(-t * 600)) * Math.exp(-t * 3.8) * release;
      wave = 0;
      for (let h = 1; h <= 7; h++) wave += Math.sin(TAU * frequency * h * t + phase) / (h ** 1.55) * Math.exp(-t * h * 1.1);
    } else if (instrument === "flute") {
      envelope = Math.min(1, t / .09) * Math.min(1, release) * (.8 + .2 * Math.sin(Math.PI * t / duration));
      const vibrato = .003 * Math.sin(TAU * 4.8 * t) * Math.min(1, t * 3);
      wave = Math.sin(TAU * frequency * t + vibrato * frequency / 5) + .19 * Math.sin(TAU * frequency * 2 * t) + .035 * (random() * 2 - 1);
    } else if (instrument === "bell") {
      envelope = (1 - Math.exp(-t * 1000)) * Math.exp(-t * 2.1) * release;
      wave = Math.sin(TAU * frequency * t) + .33 * Math.sin(TAU * frequency * 2.71 * t) * Math.exp(-t * 4) + .12 * Math.sin(TAU * frequency * 4.09 * t) * Math.exp(-t * 6);
    } else if (instrument === "bass") {
      envelope = Math.min(1, t / .05) * release * Math.exp(-t * .9);
      wave = Math.sin(TAU * frequency * t) + .25 * Math.sin(TAU * frequency * 2 * t);
    } else {
      envelope = Math.min(1, t / .4) * release;
      wave = 0;
      for (let h = 1; h <= 6; h++) wave += (Math.sin(TAU * frequency * h * t + .2 * Math.sin(TAU * 4.4 * t + phase)) + Math.sin(TAU * frequency * 1.003 * h * t + phase)) / (h ** 1.5) * .3;
    }
    const value = wave * envelope * velocity, index = (start + i) % n;
    if (buffer.length === 1) buffer[0][index] += value;
    else {
      buffer[0][index] += value * Math.sqrt((1 - pan) / 2);
      buffer[1][index] += value * Math.sqrt((1 + pan) / 2);
    }
  }
}
function drum(buffer, at, low = true, velocity = .1) {
  const length = Math.floor(RATE * (low ? .5 : .16)), start = Math.round(at * RATE), n = buffer[0].length;
  let filtered = 0;
  for (let i = 0; i < length; i++) {
    const t = i / RATE; filtered = filtered * .55 + (random() * 2 - 1) * .45;
    const value = (low ? Math.sin(TAU * (62 * t + 28 * (1 - Math.exp(-t * 20)) / 20)) * Math.exp(-t * 11) + filtered * Math.exp(-t * 25) * .15 : filtered * Math.exp(-t * 35)) * velocity * Math.min(1, t / .003);
    buffer.forEach((channel) => { channel[(start + i) % n] += value; });
  }
}
function room(buffer) {
  const copies = buffer.map((channel) => new Float32Array(channel));
  for (let c = 0; c < buffer.length; c++) for (const [delay, amount] of [[.13, .2], [.23, .13], [.37, .09], [.56, .06]]) {
    const offset = Math.round(delay * RATE), source = copies[(c + 1) % buffer.length], n = source.length;
    for (let i = 0; i < n; i++) buffer[c][(i + offset) % n] += source[i] * amount;
  }
}
function normalize(buffer, peak = .42) {
  let maximum = 0;
  buffer.forEach((channel) => { for (const value of channel) maximum = Math.max(maximum, Math.abs(value)); });
  const scale = maximum ? peak / maximum : 0;
  buffer.forEach((channel) => { for (let i = 0; i < channel.length; i++) channel[i] *= scale; });
}
function wav(buffer) {
  const channels = buffer.length, length = buffer[0].length, bytes = length * channels * 2;
  const out = Buffer.alloc(44 + bytes);
  out.write("RIFF", 0); out.writeUInt32LE(36 + bytes, 4); out.write("WAVEfmt ", 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(channels, 22); out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * channels * 2, 28); out.writeUInt16LE(channels * 2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(bytes, 40);
  for (let i = 0; i < length; i++) for (let c = 0; c < channels; c++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buffer[c][i])) * 32767), 44 + (i * channels + c) * 2);
  return out;
}
function measures(buffer) {
  let peak = 0, sum = 0, seam = 0;
  for (const channel of buffer) {
    for (const value of channel) { peak = Math.max(peak, Math.abs(value)); sum += value * value; }
    seam = Math.max(seam, Math.abs(channel[0] - channel.at(-1)));
  }
  return { seconds: buffer[0].length / RATE, channels: buffer.length, sampleRate: RATE, peak, rms: Math.sqrt(sum / (buffer.length * buffer[0].length)), seam };
}
await mkdir("public/audio", { recursive: true }); await mkdir("docs/audio", { recursive: true });
const metadata = {}, previews = [];
const melody = [64, 67, 71, 69, 67, 64, 62, 59];
for (const [region, score] of Object.entries(SCORE)) {
  const beat = 60 / score.tempo, bar = beat * score.beats, seconds = bar * 16;
  const bed = track(seconds), tension = track(seconds, false);
  const roots = region === "town" ? [52, 48, 55, 50, 45, 52, 48, 50] : [40, 36, 38, 35, 40, 43, 36, 35];
  for (let b = 0; b < 16; b++) {
    const at = b * bar, root = roots[b % roots.length], third = [48, 55, 50, 36, 38, 43].includes(root) ? 4 : 3;
    const chord = [root, root + third, root + 7];
    if (region === "town") {
      for (let subdivision = 0; subdivision < 6; subdivision++) note(bed, at + subdivision * beat / 2, chord[subdivision % 3] + (subdivision > 2 ? 12 : 0), 1.1, "lute", .13, subdivision % 2 ? .25 : -.25);
      note(bed, at, root - 12, bar + .2, "bass", .08, -.1);
      if (b % 4 !== 3) note(bed, at + beat * .6, melody[b % 8] + (b > 7 ? 12 : 0), beat * 1.8, "flute", .055, .18);
      if (b % 2 === 0) drum(bed, at, true, .018);
    } else {
      for (const tone of chord) note(bed, at, tone + (region === "title" ? 12 : 0), bar + 1.3, "strings", region === "volcano" ? .07 : .06, (tone - root - 3) * .07);
      if (region === "title") {
        for (let i = 0; i < 4; i++) note(bed, at + i * beat, chord[i % 3] + 24, 1.4, "lute", .045, .2);
        if (b % 2 === 0) note(bed, at + beat, melody[b % 8], beat * 2, "flute", .045, -.15);
      } else if (region === "caves") {
        if (b % 2 === 0) note(bed, at + beat * 2.2, melody[b % 8] - 12, 2, "bell", .035, .4 - b % 3 * .4);
        if (b % 4 === 1) note(bed, at + beat * .5, root + 19, bar, "flute", .023, -.2);
      } else {
        note(bed, at, root - 12, bar, "bass", .09);
        for (let i = 0; i < 4; i++) { note(bed, at + i * beat, root + (i % 2 ? 7 : 12), .45, "lute", .05, i % 2 ? .25 : -.25); drum(bed, at + i * beat, true, i === 0 ? .07 : .035); }
        if (b % 4 === 0) note(bed, at + beat, melody[b % 8], beat * 2, "strings", .045);
      }
    }
    for (let i = 0; i < score.beats; i++) {
      drum(tension, at + i * beat, i % 2 === 0, i % 2 === 0 ? .18 : .08);
      if (i % 2 === 0) note(tension, at + i * beat, root - (root > 45 ? 12 : 0), beat * .7, "bass", .13);
      drum(tension, at + (i + .5) * beat, false, .035);
    }
  }
  room(bed); room(tension); normalize(bed, .42); normalize(tension, .5);
  for (const [name, buffer] of [[region, bed], [`${region}-tension`, tension]]) {
    await writeFile(`public/audio/${name}.wav`, wav(buffer)); metadata[name] = { title: score.title, tempo: score.tempo, beats: score.beats, ...measures(buffer) };
  }
  if (region !== "title") previews.push(bed);
}
// A short, shareable excerpt demonstrates all three locations without a browser.
const demo = track(18);
previews.forEach((buffer, part) => {
  const offset = Math.round(6 * part * RATE);
  for (let c = 0; c < 2; c++) for (let i = 0; i < 6 * RATE; i++) {
    const envelope = Math.min(1, i / (RATE * .15), (6 * RATE - i) / (RATE * .2));
    demo[c][offset + i] = buffer[c][i] * envelope;
  }
});
await writeFile("docs/audio/soundtrack-preview.wav", wav(demo));
await writeFile("public/audio/score.json", JSON.stringify(metadata, null, 2) + "\n");
console.log(JSON.stringify(metadata, null, 2));
