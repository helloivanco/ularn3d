import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";

// Optional FOOTSTEP_BEFORE points at the previous audio.js for an A/B review.
const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const output = process.env.FOOTSTEP_OUTPUT || "docs/audio";
const before = process.env.FOOTSTEP_BEFORE;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
try {
  const page = await browser.newPage();
  await page.route("**/footstep-review", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Footstep review</title>" }));
  if (before) {
    const source = (await readFile(before, "utf8")).replace('"./audio-score.js"', '"/src/audio-score.js"');
    await page.route("**/footstep-before.js", route => route.fulfill({ contentType: "text/javascript", body: source }));
  }
  await page.goto(new URL("/footstep-review", base).href);
  const renders = await page.evaluate(async hasBefore => {
    const results = [];
    for (const entry of [...(hasBefore ? [{ name: "before-stone", module: "/footstep-before.js", surface: "stone" }] : []),
      ...["stone", "grass", "ash"].map(surface => ({ name: `after-${surface}`, module: "/src/audio.js", surface }))]) {
      const { GameAudio } = await import(entry.module);
      const sampleRate = 24000, context = new OfflineAudioContext(2, sampleRate * 2, sampleRate);
      const audio = new GameAudio({ context, music: 0 }); audio.region = "caves"; audio.unlocked = true; audio.prepare();
      if (entry.name.startsWith("before")) {
        const recording = await fetch("/audio/step.mp3");
        audio.sampleCache.set("step", Promise.resolve(await context.decodeAudioData(await recording.arrayBuffer())));
      }
      const schedule = Array.from({ length: 8 }, (_, i) => context.suspend(.15 + i * .14).then(async () => {
        audio.renderFX("step", { surface: entry.surface, foot: i % 2 ? "left" : "right" });
        await Promise.resolve(); await context.resume();
      }));
      const buffer = await context.startRendering(); await Promise.all(schedule);
      const channels = [Array.from(buffer.getChannelData(0)), Array.from(buffer.getChannelData(1))];
      let sum = 0, peak = 0;
      for (const channel of channels) for (const value of channel) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
      results.push({ name: entry.name, sampleRate, rms: Math.sqrt(sum / (buffer.length * 2)), peak, channels });
    }
    return results;
  }, Boolean(before));
  await mkdir(output, { recursive: true });
  const rate = renders[0].sampleRate, gap = Math.round(rate * .35);
  const frames = renders.reduce((sum, entry) => sum + entry.channels[0].length + gap, 0);
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  let offset = 44;
  for (const entry of renders) {
    for (let i = 0; i < entry.channels[0].length; i++) for (const channel of entry.channels) {
      wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channel[i])) * 32767), offset); offset += 2;
    }
    offset += gap * 4;
  }
  const metrics = renders.map(({ channels, ...entry }) => entry);
  if (before) metrics[1].changeDb = 20 * Math.log10(metrics[1].rms / metrics[0].rms);
  await writeFile(`${output}/footsteps-comparison.wav`, wav);
  await writeFile(`${output}/footsteps-review.json`, JSON.stringify({ order: metrics.map(entry => entry.name), secondsPerSegment: 2, gapSeconds: .35, metrics }, null, 2) + "\n");
  console.log(JSON.stringify(metrics));
} finally { await browser.close(); }
