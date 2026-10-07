import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Hardware measurements intentionally do not use the functional suite's SwiftShader flags.
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const urls = process.argv.slice(2);
if (!urls.length) urls.push(process.env.TEST_URL || "http://127.0.0.1:5173");
const reports = [];
try {
  for (const url of urls) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("ularn3d.quality", "auto");
      window.intervals = []; window.renderCosts = []; window.drawCounts = []; window.previousFrame = null;
      const requestFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => requestFrame((time) => {
        const before = window.ularnGraphics?.metrics().renderedFrames, started = performance.now();
        callback(time);
        const after = window.ularnGraphics?.metrics();
        if (before !== undefined && after.renderedFrames > before) {
          if (previousFrame !== null && started - previousFrame < 150) intervals.push(started - previousFrame);
          previousFrame = started; renderCosts.push(performance.now() - started); drawCounts.push(after.drawCalls);
        }
      });
    });
    const gameURL = new URL(url); if (gameURL.pathname === "/") gameURL.pathname = "/play/";
    await page.goto(gameURL.href); await page.locator("#loading").waitFor({ state: "hidden" }); await page.locator("#begin").click();
    await page.waitForFunction(() => document.querySelector("#hud").hidden === false);
    await page.evaluate(() => {
      const random = Math.random;
      let seed = 0x1a2b3c4d;
      Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      try { newcavelevel(1); } finally { Math.random = random; }
      player.x = 33; player.y = 8; player.HP = player.HPMAX = 1000;
      for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) {
        setMonster(x, y, null); setKnow(x, y, KNOWALL);
      }
      for (let x = 30; x < 38; x++) for (let y = 7; y < 10; y++) setItem(x, y, OEMPTY);
      paint();
    });
    await page.waitForTimeout(500);
    const start = await page.evaluate(() => {
      intervals.length = renderCosts.length = drawCounts.length = 0; previousFrame = null;
      return { at: performance.now(), frames: ularnGraphics.metrics().renderedFrames };
    });
    for (let i = 0; i < 36; i++) { await page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight"); await page.waitForTimeout(140); }
    const report = await page.evaluate((start) => {
      const stats = (values) => { const sorted = [...values].sort((a, b) => a - b); return {
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
        p95: sorted[Math.floor(sorted.length * .95)], samples: values.length }; };
      const gl = document.querySelector("#world canvas").getContext("webgl2"), extension = gl.getExtension("WEBGL_debug_renderer_info");
      const graphics = ularnGraphics.metrics();
      return { gpu: extension && gl.getParameter(extension.UNMASKED_RENDERER_WEBGL),
        averageFps: (graphics.renderedFrames - start.frames) * 1000 / (performance.now() - start.at),
        drawCalls: { minimum: Math.min(...drawCounts), maximum: Math.max(...drawCounts), ...stats(drawCounts) },
        fixture: ularn.snapshot().tiles.map(({x,y,id}) => `${x},${y}:${id}`).join("|"),
        frames: intervals.length ? stats(intervals) : { mean: graphics.frameMs, p95: graphics.activeFrameP95 },
        render: renderCosts.length ? stats(renderCosts) : { p95: graphics.renderP95 }, graphics,
        audio: window.ularnAudio?.metrics() || null };
    }, start);
    if (process.env.BENCHMARK_COMBAT === "1") {
      await page.evaluate(() => {
        const weapon = createObject(OLONGSWORD);
        player.inventory[player.inventory.indexOf(player.WIELD)] = weapon;
        player.WIELD = weapon; recalc(); paint();
      });
      await page.waitForTimeout(400);
      const combatStart = await page.evaluate(() => {
        intervals.length = renderCosts.length = drawCounts.length = 0; previousFrame = null;
        return { at: performance.now(), frames: ularnGraphics.metrics().renderedFrames };
      });
      for (let i = 0; i < 24; i++) {
        await page.evaluate(() => { setMonster(player.x + 1, player.y, LEMMING); paint(); });
        await page.keyboard.press("ArrowRight"); await page.waitForTimeout(140);
        await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(140);
      }
      report.combat = await page.evaluate((start) => {
        const graphics = ularnGraphics.metrics(), sorted = [...intervals].sort((a, b) => a - b);
        return { averageFps: (graphics.renderedFrames - start.frames) * 1000 / (performance.now() - start.at),
          frameP95: sorted[Math.floor(sorted.length * .95)], inputLatencyP95: graphics.inputLatencyP95,
          drawCalls: Math.max(...drawCounts), swings: graphics.attackSequence, impacts: graphics.weaponImpacts,
          weaponModel: graphics.weaponModel, trailPoints: graphics.bladeTrailPoints, errors: [] };
      }, combatStart);
    }
    const persistence = await page.evaluate(async () => {
      for (let depth = 2; depth <= 20; depth++) newcavelevel(depth);
      setItem(player.x, player.y, OEMPTY); setMonster(player.x, player.y, null);
      paint();
      const started = performance.now(); ularn.save(); const manualSaveMs = performance.now() - started;
      ularn.key(".");
      await new Promise((resolve) => setTimeout(resolve, 2400));
      return { manualSaveMs, background: window.ularnPersistence?.metrics() || null };
    });
    report.fixture = createHash("sha256").update(report.fixture).digest("hex");
    reports.push({ url, ...report, persistence, errors });
    await page.close();
  }
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/graphics-benchmark.json", JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
  if (reports.some((report) => report.errors.length)) process.exitCode = 1;
} finally { await browser.close(); }
