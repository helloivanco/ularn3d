/**
 * Dungeon walk frame budget vs town (Balanced).
 * Thresholds documented in docs/browser-lag-plan.md (Project store).
 */
import { test, expect } from "@playwright/test";

const faults = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  faults.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() =>
    localStorage.setItem("ularn3d.quality", "balanced"),
  );
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

test("known dungeon walk stays within town frame budget and skips dead GPU work", async ({
  page,
}) => {
  const report = await page.evaluate(async () => {
    const sampleRaf = async (steps) => {
      const frames = [];
      for (const key of steps) {
        ularn.key(key);
        await new Promise((resolve) => {
          let n = 0;
          let last = performance.now();
          const tick = (now) => {
            frames.push(now - last);
            last = now;
            if (++n >= 8) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      }
      return frames;
    };
    const paintTimes = (keys) => {
      const ms = [];
      for (const key of keys) {
        const t0 = performance.now();
        ularn.key(key);
        paint();
        ms.push(performance.now() - t0);
      }
      return ms;
    };

    // Town baseline
    if (typeof level !== "undefined" && level !== 0) newcavelevel(0);
    paint();
    await new Promise((r) => setTimeout(r, 120));
    const townBefore = ularnGraphics.metrics();
    const townPaint = paintTimes(["l", "j", "h", "k", "l", "j"]);
    const townFrames = await sampleRaf(["l", "j", "h", "k"]);
    const townAfter = ularnGraphics.metrics();

    // Classic maze, fully charted — representative dungeon density
    newcavelevel(1);
    player.HP = player.HPMAX = 200;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) setKnow(x, y, KNOWALL);
    paint();
    await new Promise((r) => setTimeout(r, 120));
    const dungeonBefore = ularnGraphics.metrics();
    const dungeonPaint = paintTimes(["l", "j", "h", "k", "l", "j"]);
    const dungeonFrames = await sampleRaf(["l", "j", "h", "k"]);
    const dungeonAfter = ularnGraphics.metrics();

    const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    return {
      town: {
        paintMean: avg(townPaint),
        rafMean: avg(townFrames),
        shadowDelta: townAfter.shadowUpdates - townBefore.shadowUpdates,
        metrics: {
          shadowMapEnabled: townAfter.shadowMapEnabled,
          toneMapping: townAfter.toneMapping,
          floorMaterial: townAfter.floorMaterial,
        },
      },
      dungeon: {
        paintMean: avg(dungeonPaint),
        rafMean: avg(dungeonFrames),
        shadowDelta: dungeonAfter.shadowUpdates - dungeonBefore.shadowUpdates,
        fastPath: dungeonAfter.structureFastPath + dungeonAfter.monsterFastPath,
        metrics: {
          shadowMapEnabled: dungeonAfter.shadowMapEnabled,
          sunCastShadow: dungeonAfter.sunCastShadow,
          toneMapping: dungeonAfter.toneMapping,
          floorMaterial: dungeonAfter.floorMaterial,
          floorMapped: dungeonAfter.floorMapped,
          dustVisible: dungeonAfter.dustVisible,
          fogDensity: dungeonAfter.fogDensity,
          wallInstances: dungeonAfter.wallInstances,
          floorInstances: dungeonAfter.floorInstances,
        },
      },
    };
  });

  expect(report.dungeon.metrics.floorMaterial).toBe("MeshBasicMaterial");
  expect(report.dungeon.metrics.floorMapped).toBe(true);
  expect(report.dungeon.metrics.shadowMapEnabled).toBe(false);
  expect(report.dungeon.metrics.sunCastShadow).toBe(false);
  expect(report.dungeon.metrics.toneMapping).toBe(0);
  expect(report.dungeon.metrics.dustVisible).toBe(false);
  expect(report.dungeon.metrics.fogDensity).toBe(0);
  expect(report.dungeon.shadowDelta).toBe(0);
  expect(report.town.metrics.shadowMapEnabled).toBe(false);

  // Sync sanity: known-floor step must not explode. Textured MeshBasic floors
  // cost a little more than the 1.3.20 unmapped pass; keep a modest CI GL cap.
  expect(report.dungeon.paintMean).toBeLessThanOrEqual(18);
  expect(report.town.paintMean).toBeLessThanOrEqual(18);

  // Frame budget: dungeon rAF mean ≤ 1.35× town on the same machine.
  const ratio = report.dungeon.rafMean / Math.max(0.001, report.town.rafMean);
  expect(ratio).toBeLessThanOrEqual(1.35);

  // Fast paths should fire while walking a fully known floor.
  expect(report.dungeon.fastPath).toBeGreaterThan(0);
  expect(report.dungeon.metrics.floorInstances).toBeGreaterThan(100);
  expect(report.dungeon.metrics.wallInstances).toBeGreaterThan(50);

  console.log(
    "browser-lag budget",
    JSON.stringify({
      townPaint: report.town.paintMean,
      dungeonPaint: report.dungeon.paintMean,
      townRaf: report.town.rafMean,
      dungeonRaf: report.dungeon.rafMean,
      ratio,
      fastPath: report.dungeon.fastPath,
    }),
  );
});

test("empty known dungeon walk does not rebuild floors each step", async ({
  page,
}) => {
  const stats = await page.evaluate(() => {
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
          x === 0 || y === 0 || x === MAXX - 1 || y === MAXY - 1
            ? OWALL
            : OEMPTY,
        );
        setKnow(x, y, KNOWALL);
      }
    paint();
    const before = ularnGraphics.metrics();
    for (const key of ["l", "l", "j", "j", "h", "h", "k", "k"]) ularn.key(key);
    const after = ularnGraphics.metrics();
    return {
      structureFastPath: after.structureFastPath - before.structureFastPath,
      monsterFastPath: after.monsterFastPath - before.monsterFastPath,
      shadowDelta: after.shadowUpdates - before.shadowUpdates,
      floorMapped: after.floorMapped,
      shadowMapEnabled: after.shadowMapEnabled,
    };
  });
  expect(stats.structureFastPath).toBeGreaterThanOrEqual(6);
  expect(stats.shadowDelta).toBe(0);
  expect(stats.floorMapped).toBe(true);
  expect(stats.shadowMapEnabled).toBe(false);
});
