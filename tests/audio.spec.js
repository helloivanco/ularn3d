import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

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

test("original music beds and stems have matching loop lengths, headroom and clean seams", () => {
  const manifest = JSON.parse(readFileSync("public/audio/score.json", "utf8"));
  for (const region of ["title", "town", "caves", "volcano"]) {
    expect(manifest[region].seconds).toBe(manifest[`${region}-tension`].seconds);
    for (const name of [region, `${region}-tension`]) {
      const data = readFileSync(`public/audio/${name}.wav`), meta = manifest[name];
      expect(data.toString("ascii", 0, 4)).toBe("RIFF"); expect(data.toString("ascii", 8, 12)).toBe("WAVE");
      expect(meta.rms).toBeGreaterThan(.025); expect(meta.peak).toBeLessThan(.6); expect(meta.seam).toBeLessThan(.015);
      expect(data.readUInt32LE(40)).toBe(data.length - 44);
    }
  }
});

test("Play unlocks audible music, spatial FX and synchronized region transitions", async ({ page }) => {
  await start(page); const first = await page.evaluate(() => ularnAudio.metrics());
  expect(first.contextState).toBe("running"); expect(first.musicSources).toBe(2);
  await room(page); await expect.poll(() => page.evaluate(() => ularnAudio.metrics().playingRegion)).toBe("caves");
  await page.evaluate(() => { setMonster(35, 8, createMonster(GNOME)); paint(); });
  expect((await page.evaluate(() => ularnAudio.metrics())).threat).toBeGreaterThan(0);
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
  await page.route("**/audio/*.wav", (route) => { requests++; return route.fulfill({ status: 404, body: "Missing" }); });
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
