/**
 * Baseline / after harness for dungeon vs town walk cost (Balanced quality).
 * Usage: node scripts/profile-browser-lag.mjs [baseURL]
 */
import { chromium } from "playwright";

const baseURL = process.argv[2] || process.env.TEST_URL || "http://localhost:5173";
const chrome = process.env.CHROME_PATH || "/usr/bin/google-chrome";

const browser = await chromium.launch({
  executablePath: chrome,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
await page.goto(`${baseURL}/play/`, { waitUntil: "networkidle" });
await page.click("#continue, #start, button:has-text('Begin'), .class-choice");
// Start fresh game if needed
const started = await page.evaluate(async () => {
  if (typeof ularn?.start === "function") {
    try {
      ularn.start("Adventurer", "Profiler");
      return true;
    } catch {}
  }
  return !!document.querySelector("#world canvas");
});
if (!started) {
  await page.locator(".class-choice").first().click().catch(() => {});
  await page.locator("#start, #begin, button.primary").first().click().catch(() => {});
}
await page.waitForFunction(() => window.ularnGraphics && ularn?.snapshot?.()?.maze, {
  timeout: 30000,
});

const sampleWalk = async (label, setup) => {
  const result = await page.evaluate(async ({ label, setup }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (setup === "town") {
      if (typeof level !== "undefined" && level !== 0) newcavelevel(0);
      paint();
    } else {
      newcavelevel(1);
      player.x = 10;
      player.y = 8;
      player.HP = player.HPMAX = 200;
      for (let x = 0; x < MAXX; x++)
        for (let y = 0; y < MAXY; y++) {
          setMonster(x, y, null);
          setItem(
            x,
            y,
            x === 0 || y === 0 || x === MAXX - 1 || y === MAXY - 1 ? OWALL : OEMPTY,
          );
          setKnow(x, y, KNOWALL);
        }
      paint();
    }
    await sleep(200);
    // Force a few live frames so renderer.info is populated.
    ularnGraphics.metrics();
    const keys = ["l", "l", "j", "j", "h", "h", "k", "k", "l", "j", "h", "k"];
    const keyMs = [];
    const paintMs = [];
    const frameMs = [];
    const before = ularnGraphics.metrics();
    for (const key of keys) {
      const t0 = performance.now();
      ularn.key(key);
      keyMs.push(performance.now() - t0);
      const t1 = performance.now();
      paint();
      paintMs.push(performance.now() - t1);
      await sleep(50);
      frameMs.push(ularnGraphics.metrics().frameMs || 0);
    }
    // Collect rAF frame elapsed during continuous walk animation window.
    const rafSamples = [];
    await new Promise((resolve) => {
      let n = 0;
      let last = performance.now();
      const tick = (now) => {
        rafSamples.push(now - last);
        last = now;
        if (++n >= 24) resolve();
        else requestAnimationFrame(tick);
      };
      ularn.key("l");
      requestAnimationFrame(tick);
    });
    const after = ularnGraphics.metrics();
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
    const max = (arr) => Math.max(...arr);
    return {
      label,
      setup,
      keyMean: mean(keyMs),
      keyMax: max(keyMs),
      paintMean: mean(paintMs),
      paintMax: max(paintMs),
      frameMsMean: mean(frameMs),
      rafMean: mean(rafSamples),
      rafMax: max(rafSamples),
      before,
      after: {
        drawCalls: after.drawCalls,
        triangles: after.triangles,
        floorInstances: after.floorInstances,
        wallInstances: after.wallInstances,
        propGroups: after.propGroups,
        shadowUpdates: after.shadowUpdates,
        shadowMap: after.shadowMap,
        floorMaterial: after.floorMaterial,
        pixelRatio: after.pixelRatio,
        sunVisible: after.sunVisible,
        fogDensity: after.fogDensity,
        pointLights: after.pointLights,
        frameMs: after.frameMs,
      },
      shadowDelta: after.shadowUpdates - before.shadowUpdates,
    };
  }, { label, setup });
  return result;
};

const town = await sampleWalk("town", "town");
const dungeon = await sampleWalk("dungeon-empty", "dungeon");
const out = { baseURL, town, dungeon, ratio: {
  key: dungeon.keyMean / Math.max(0.001, town.keyMean),
  paint: dungeon.paintMean / Math.max(0.001, town.paintMean),
  raf: dungeon.rafMean / Math.max(0.001, town.rafMean),
}};
console.log(JSON.stringify(out, null, 2));
await browser.close();
