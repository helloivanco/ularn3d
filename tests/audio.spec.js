import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SCORE, STINGERS } from "../src/audio-score.js";

async function start(page) {
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/"); await expect(page.locator("#loading")).toBeHidden();
  expect((await page.evaluate(() => ularnAudio.metrics())).contextState).toBe("not-started");
  await page.locator("#begin").click();
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().playingRegion)).toBe("town");
}
async function room(page, depth = 1) {
  await page.evaluate((depth) => {
    newcavelevel(depth); player.x = 33; player.y = 8; player.HP = player.HPMAX = 1000;
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) {
      setItem(x, y, OEMPTY); setMonster(x, y, null); setKnow(x, y, KNOWALL);
    }
    paint();
  }, depth);
}

test("the score's beds, layers and stingers are mastered, loop-aligned and within budget", () => {
  const manifest = JSON.parse(readFileSync("public/audio/score.json", "utf8"));
  const regions = [...new Set(Object.values(SCORE).map((entry) => entry.bed))];
  expect(regions.sort()).toEqual(["caves", "deep", "town", "volcano"]);
  for (const region of regions) {
    const { seconds, bed, stem, intensity } = manifest.regions[region];
    for (const file of [bed, stem]) {
      const data = readFileSync(`public/audio/${file.file}`);
      expect(data.toString("ascii", 0, 4)).toBe("fLaC"); expect(data.length).toBe(file.bytes);
      // Bed and stem loop over the same span, each to within half a sample.
      expect(Math.abs(file.frames / file.sampleRate - seconds)).toBeLessThanOrEqual(.5 / file.sampleRate + 1e-9);
    }
    expect(stem.channels).toBe(2); expect(stem.layers).toEqual(["stir", "fray"]);
    expect(Math.abs(bed.lufs + 18)).toBeLessThan(.5);
    for (const peak of [bed.truePeakDb, stem.truePeakDb, intensity.fullTruePeakDb]) expect(peak).toBeLessThanOrEqual(-1);
    expect(intensity.stir).toBeGreaterThan(intensity.rest + 1); expect(intensity.full).toBeGreaterThan(intensity.stir + 1.5);
    expect(bed.bytes + stem.bytes).toBeLessThan(9.5e6);
  }
  for (const [name, [start, duration]] of Object.entries(STINGERS)) {
    const cue = manifest.stingers.cues[name];
    expect([cue.start, cue.duration], name).toEqual([start, duration]);
    expect(start + duration).toBeLessThanOrEqual(manifest.stingers.seconds + 1e-6);
    expect(cue.truePeakDb).toBeLessThanOrEqual(-1);
  }
  expect(Object.keys(STINGERS).sort()).toEqual(["cure", "death", "descend", "levelup", "victory"]);
  expect(manifest.totalBytes).toBeLessThan(36e6);
});

test("the browser decodes the FLAC score bit-exactly", async ({ page }) => {
  const manifest = JSON.parse(readFileSync("public/audio/score.json", "utf8"));
  await page.goto("/play/");
  for (const entry of [manifest.regions.town.bed, manifest.regions.town.stem, manifest.stingers]) {
    const decoded = await page.evaluate(async ({ file, rate }) => {
      const buffer = await new OfflineAudioContext(1, 1, rate).decodeAudioData(await (await fetch(`/audio/${file}`)).arrayBuffer());
      // Chromium scales positive samples by 1/32767; take whichever inverse is exact.
      return { frames: buffer.length, sums: Array.from({ length: buffer.numberOfChannels }, (_, c) => {
        const d = buffer.getChannelData(c); let s = 0;
        for (let i = 0; i < d.length; i++) { const a = Math.round(d[i] * 32768), v = Math.fround(a / 32768) === d[i] ? a : Math.round(d[i] * 32767); s = (s + v * ((i % 9973) + 1)) % 2147483647; }
        return s;
      }) };
    }, { file: entry.file, rate: entry.sampleRate });
    expect(decoded.sums, entry.file).toEqual(entry.checksum);
    if (entry.frames) expect(decoded.frames).toBe(entry.frames);
  }
});

test("Play unlocks audible music, spatial FX and synchronized region transitions", async ({ page }) => {
  await start(page); const first = await page.evaluate(() => ularnAudio.metrics());
  expect(first.contextState).toBe("running"); expect(first.musicSources).toBe(2);
  await room(page); await expect.poll(() => page.evaluate(() => ularnAudio.metrics().playingRegion)).toBe("caves");
  await page.evaluate(() => { setMonster(35, 8, createMonster(GNOME)); paint(); });
  const near = await page.evaluate(() => ularnAudio.metrics());
  expect(near.threat).toBeGreaterThan(0); expect(near.layers[0]).toBeGreaterThan(.5); expect(near.layers[1]).toBe(0);
  await page.evaluate(() => { setMonster(36, 9, createMonster(GNOME)); setMonster(35, 7, createMonster(GNOME)); paint(); });
  expect((await page.evaluate(() => ularnAudio.metrics())).layers).toEqual([1, 1]);
  await room(page, 9); await expect.poll(() => page.evaluate(() => ularnAudio.metrics().playingRegion)).toBe("deep");
  expect((await page.evaluate(() => ularnAudio.metrics())).layers).toEqual([0, 0]);
  await room(page, 16); await room(page, 2); await room(page, 16);
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().playingRegion)).toBe("volcano");
  expect((await page.evaluate(() => ularnAudio.metrics())).musicSources).toBeLessThanOrEqual(4);
  await page.waitForTimeout(2000);
  const settled = await page.evaluate(() => ularnAudio.metrics());
  expect(settled.musicSources).toBe(2); expect(settled.cachedTracks).toBeLessThanOrEqual(2);
});

test("mute and independent volume controls persist without spending turns", async ({ page }) => {
  await start(page); const turns = await page.evaluate(() => player.MOVESMADE);
  await page.locator("#pause").click();
  await page.locator("#music-volume").fill("0");
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().musicSources)).toBe(0);
  await page.locator("#effects-volume").fill("27");
  expect((await page.evaluate(() => ularnAudio.metrics())).effectsVolume).toBe(.27);
  await page.locator("#audio-enabled").uncheck();
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().contextState)).toBe("suspended");
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(turns);
  await page.locator("#resume-game").click(); await page.locator("#save").click();
  await page.reload(); await page.locator("#continue").click();
  await expect(page.locator("#sound")).toHaveAttribute("aria-pressed", "false");
  const restored = await page.evaluate(() => ularnAudio.metrics());
  expect(restored.musicVolume).toBe(0); expect(restored.effectsVolume).toBe(.27); expect(restored.contextState).toBe("not-started");
  await page.locator("#sound").click(); await page.locator("#pause").click(); await page.locator("#music-volume").fill("45");
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().musicSources)).toBe(2);
});

test("hidden windows silence and release sources, then resume music without stale FX", async ({ page }) => {
  await start(page); await room(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ularn:combat", { detail: { kind: "weapon", level, from: {x:33,y:8}, to:{x:34,y:8}, weapon:{type:"sword"}, hit:true } })));
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().lastEffect)).toBe("weapon");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().contextState)).toBe("suspended");
  const hidden = await page.evaluate(() => ularnAudio.metrics()); expect(hidden.musicSources).toBe(0); expect(hidden.effectVoices).toBe(0);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().contextState)).toBe("running");
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().musicSources)).toBe(2);
  expect((await page.evaluate(() => ularnAudio.metrics())).effectsPlayed).toBe(hidden.effectsPlayed);
});

test("engine action sounds occur only after actual actions; cancelled prompts stay quiet", async ({ page }) => {
  await start(page); await room(page);
  await page.keyboard.press("q"); await page.keyboard.press("Escape");
  const baseline = await page.evaluate(() => ularnAudio.metrics().effectsPlayed);
  await page.evaluate(() => {
    player.inventory[5] = createObject(OPOTION, 12); setItem(34, 8, OCLOSEDDOOR); paint();
  });
  await page.keyboard.press("q"); await page.keyboard.press("f");
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().lastEffect)).toBe("potion");
  await page.evaluate(() => { window.audioTestRandom = rnd; rnd = (n) => n === 11 ? 1 : audioTestRandom(n); });
  await page.keyboard.press("o"); await page.keyboard.press("l");
  expect((await page.evaluate(() => ularnAudio.metrics())).lastEffect).toBe("potion");
  await page.evaluate(() => { rnd = (n) => n === 11 ? 11 : audioTestRandom(n); });
  await page.keyboard.press("o"); await page.keyboard.press("l");
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().lastEffect)).toBe("door");
  await page.evaluate(() => { rnd = audioTestRandom; });
  expect((await page.evaluate(() => ularnAudio.metrics())).effectsPlayed).toBeGreaterThan(baseline);
  await page.evaluate(() => { player.inventory[6] = createObject(OSCROLL, 3); paint(); });
  await page.keyboard.press("r"); await page.keyboard.press("g");
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().lastEffect)).toBe("read");
});

test("audio context failure leaves gameplay working and an explicit gesture can retry", async ({ page }) => {
  await page.addInitScript(() => { window.NativeAudioContext = window.AudioContext; window.AudioContext = class { constructor() { throw new Error("Unavailable"); } }; });
  await page.goto("/play/"); await expect(page.locator("#loading")).toBeHidden(); await page.locator("#begin").click();
  await expect(page.locator("#toast")).toContainText("Sound could not start");
  const before = await page.evaluate(() => player.MOVESMADE); await page.keyboard.press("."); expect(await page.evaluate(() => player.MOVESMADE)).toBe(before + 1);
  await page.evaluate(() => { window.AudioContext = NativeAudioContext; });
  await page.getByRole("button", { name: "Resume sound", exact: true }).click();
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().playingRegion)).toBe("town");
});

test("missing music never disables FX or retries on every gameplay action", async ({ page }) => {
  let requests = 0;
  await page.route("**/audio/*.flac", (route) => { requests++; return route.fulfill({ status: 404, body: "Missing" }); });
  await page.goto("/play/"); await expect(page.locator("#loading")).toBeHidden(); await page.locator("#begin").click();
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().status)).toBe("error");
  const count = requests; await page.keyboard.press("."); await page.keyboard.press(".");
  expect(requests).toBe(count);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ularn:combat", { detail: { kind:"weapon", level, weapon:{type:"hammer"}, hit:true } })));
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().lastEffect)).toBe("weapon");
});

test("actual rendered action samples have audible energy, headroom and distinct timbres", async ({ page }) => {
  await page.goto("/play/");
  const rendered = await page.evaluate(async () => {
    const { GameAudio } = await import("/src/audio.js"); const results = [];
    for (const type of ["unarmed", "sword", "hammer", "dagger", "axe"]) {
      const context = new OfflineAudioContext(2, 48000, 48000);
      const audio = new GameAudio({ context, music: 0 }); audio.renderFX("weapon", { weapon: {type}, hit:true });
      const buffer = await context.startRendering(), data = buffer.getChannelData(0); let sum=0, peak=0;
      for (const value of data) { sum+=value*value; peak=Math.max(peak,Math.abs(value)); }
      results.push({type,rms:Math.sqrt(sum/data.length),peak}); await audio.dispose();
    }
    return results;
  });
  expect(new Set(rendered.map((entry) => entry.rms.toFixed(5))).size).toBe(5);
  for (const entry of rendered) { expect(entry.rms).toBeGreaterThan(.003); expect(entry.peak).toBeLessThan(.95); }
});

test("an ending cue survives a full combat pool and music stays stopped", async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const { GameAudio } = await import("/src/audio.js");
    window.endingAudio = new GameAudio({music:0}); await endingAudio.unlock();
    for (let i=0;i<24;i++) endingAudio.voice({duration:2,volume:.005});
    const full = endingAudio.voices.size; endingAudio.finish("victory");
    await new Promise((resolve) => setTimeout(resolve,30));
    return {full, voices:endingAudio.voices.size,last:endingAudio.metrics().lastEffect,music:endingAudio.musicSources.size};
  });
  expect(result.full).toBe(24); expect(result.voices).toBe(4); expect(result.last).toBe("victory"); expect(result.music).toBe(0);
  await page.evaluate(() => endingAudio.dispose());
});

test("footsteps are short, quiet, varied and rate limited without using gameplay randomness", async ({ page }) => {
  await page.goto("/play/");
  const result = await page.evaluate(async () => {
    const { GameAudio } = await import("/src/audio.js");
    const rendered = [];
    for (const surface of ["grass", "stone", "ash"]) {
      const context = new OfflineAudioContext(2, 24000, 48000);
      const audio = new GameAudio({ context, music: 0 });
      audio.renderFX("step", { surface, foot: "left" });
      audio.renderFX("step", { surface, foot: "right" });
      const accepted = audio.metrics().effectsPlayed;
      const buffer = await context.startRendering(), data = buffer.getChannelData(0);
      let sum = 0, peak = 0, tail = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i]));
        if (i > 48000 * .15) tail = Math.max(tail, Math.abs(data[i]));
      }
      rendered.push({ surface, rms: Math.sqrt(sum / data.length), peak, tail, accepted });
    }
    const audio = new GameAudio({ context: new OfflineAudioContext(2, 24000, 48000) });
    audio.menu = true; audio.renderFX("step"); audio.menu = false;
    audio.ended = true; audio.renderFX("step");
    return { rendered, suppressed: audio.metrics().effectsPlayed };
  });
  expect(result.suppressed).toBe(0);
  expect(new Set(result.rendered.map(entry => entry.rms.toFixed(7))).size).toBe(3);
  for (const footstep of result.rendered) {
    expect(footstep.accepted).toBe(1);
    expect(footstep.rms).toBeGreaterThan(.0001);
    expect(footstep.rms).toBeLessThan(.004);
    expect(footstep.peak).toBeLessThan(.03);
    expect(footstep.tail).toBeLessThan(.0001);
  }
});

test("orchestral stingers duck the score, fall back with music off and end the expedition", async ({ page }) => {
  await start(page);
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().stingersReady)).toBe(true);
  const played = await page.evaluate(async () => {
    const out = [], wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const [kind, detail] of [["levelup", {}], ["arrive", { depth: 3, first: true }], ["cure", {}]]) {
      ularnAudio.play(kind, detail); await wait(30);
      out.push([kind, ularnAudio.metrics().lastStinger, ularnAudio.metrics().duck]);
    }
    ularnAudio.play("arrive", { depth: 3 }); await wait(30);
    out.push(["revisit", ularnAudio.metrics().lastStinger, ularnAudio.metrics().lastEffect]);
    return out;
  });
  expect(played[0].slice(0, 2)).toEqual(["levelup", "levelup"]); expect(played[0][2]).toBeLessThan(.5);
  expect(played[1].slice(0, 2)).toEqual(["arrive", "descend"]);
  expect(played[2].slice(0, 2)).toEqual(["cure", "cure"]);
  expect(played[3]).toEqual(["revisit", "cure", "arrive"]);
  const muted = await page.evaluate(() => { ularnAudio.configure({ music: 0 }); ularnAudio.play("levelup"); return ularnAudio.metrics(); });
  expect(muted.lastStinger).toBe("cure"); expect(muted.lastEffect).toBe("levelup");
  const ending = await page.evaluate(async () => {
    ularnAudio.configure({ music: .55 }); ularnAudio.finish("victory");
    await new Promise((resolve) => setTimeout(resolve, 30));
    return ularnAudio.metrics();
  });
  expect(ending.lastStinger).toBe("victory"); expect(ending.musicSources).toBe(0); expect(ending.effectVoices).toBe(1);
});

test("fountains and altars sound only when the engine performs them", async ({ page }) => {
  await start(page); await room(page);
  const before = await page.evaluate(() => ularnAudio.metrics().effectsPlayed);
  // Pin the draught to "nothing happens" so the hero stays put.
  await page.evaluate(() => { window.audioTestRandom = rnd; rnd = (n) => n === 1501 ? 1500 : n === 100 ? 30 : n === 12 ? 11 : audioTestRandom(n); setItem(player.x, player.y, createObject(OEMPTY)); drink_fountain(); });
  expect((await page.evaluate(() => ularnAudio.metrics())).effectsPlayed).toBe(before);
  await page.evaluate(() => { setItem(player.x, player.y, createObject(OFOUNTAIN)); drink_fountain(); rnd = audioTestRandom; });
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().lastEffect)).toBe("fountain");
  await page.evaluate(() => { setItem(player.x, player.y, createObject(OALTAR)); act_donation_pray(ESC); });
  expect((await page.evaluate(() => ularnAudio.metrics())).lastEffect).toBe("fountain");
  await page.evaluate(() => act_donation_pray(0));
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().lastEffect)).toBe("altar");
});
