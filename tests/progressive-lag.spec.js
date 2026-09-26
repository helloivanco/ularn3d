/**
 * Progressive lag: move cost and journal/DOM stay bounded as turns accumulate.
 * Audit: Project store docs/progressive-lag-audit.md
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
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.perf", "1");
  });
  await page.goto("/play/?perf=1");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

test("move processing stays bounded across 10 / 100 / 500 / 1000 steps", async ({
  page,
}) => {
  const report = await page.evaluate(() => {
    const prepareQuietFloor = () => {
      newcavelevel(1);
      player.x = 10;
      player.y = 8;
      player.HP = player.HPMAX = 500;
      player.SPELLS = player.SPELLMAX = 50;
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
    };

    prepareQuietFloor();
    const keys = ["l", "j", "h", "k"];
    const sampleAt = (moves) => {
      const times = [];
      ularnPerf.moveSamples.length = 0;
      const slicesBefore = ularn.perfStats().logSlices;
      const revBefore = ularnGraphics.metrics().revFastPath;
      for (let i = 0; i < moves; i++) {
        const key = keys[i % keys.length];
        const t0 = performance.now();
        ularn.key(key);
        paint();
        times.push(performance.now() - t0);
      }
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      const sorted = [...times].sort((a, b) => a - b);
      const p95 =
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
      const perf = ularn.perfStats();
      const metrics = ularnGraphics.metrics();
      return {
        moves,
        mean,
        p95,
        logLines: perf.logLines,
        logCap: perf.logCap,
        journalNodes: document.getElementById("journal-lines").children.length,
        logSlicesDelta: perf.logSlices - slicesBefore,
        revFastPathDelta: metrics.revFastPath - revBefore,
        structureFastPath: metrics.structureFastPath,
        heapUsed: performance.memory?.usedJSHeapSize ?? null,
        floorMapped: metrics.floorMapped,
      };
    };

    return {
      at10: sampleAt(10),
      at100: sampleAt(100),
      at500: sampleAt(500),
      at1000: sampleAt(1000),
    };
  });

  for (const point of ["at10", "at100", "at500", "at1000"]) {
    expect(report[point].floorMapped).toBe(true);
    expect(report[point].logLines).toBeLessThanOrEqual(report[point].logCap);
    expect(report[point].journalNodes).toBeLessThanOrEqual(
      report[point].logCap,
    );
    expect(report[point].mean).toBeLessThanOrEqual(25);
    expect(report[point].p95).toBeLessThanOrEqual(40);
  }

  // Progressive: late blocks must not be dramatically worse than early ones.
  expect(report.at1000.mean).toBeLessThanOrEqual(report.at10.mean * 3 + 4);
  expect(report.at500.mean).toBeLessThanOrEqual(report.at10.mean * 3 + 4);

  // Quiet known-floor walks should mostly reuse the cached log view.
  expect(report.at1000.logSlicesDelta).toBeLessThan(report.at1000.moves * 0.5);
  expect(report.at100.revFastPathDelta).toBeGreaterThan(50);

  console.log("progressive-lag", JSON.stringify(report));
});

test("journal soft-cap bounds LOG and DOM; idle paints do not re-slice", async ({
  page,
}) => {
  const report = await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 500;
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

    const cap = LOG_JOURNAL_CAP;
    for (let i = 0; i < cap + 120; i++) updateLog(`Cap stress line ${i + 1}`);
    paint();
    const journal = document.getElementById("journal-lines");
    const lines = LOG.filter((line) => String(line).trim());
    const snapshotLog = ularn
      .snapshot()
      .log.filter((line) => String(line).trim());
    const slicesBefore = ularn.perfStats().logSlices;
    for (let i = 0; i < 20; i++) paint();
    const slicesAfter = ularn.perfStats().logSlices;
    return {
      cap,
      engineCount: lines.length,
      snapshotCount: snapshotLog.length,
      rendered: journal.children.length,
      hasOldest: journal.innerText.includes("Cap stress line 1"),
      hasNewest: journal.innerText.includes(`Cap stress line ${cap + 120}`),
      slicesOnIdlePaint: slicesAfter - slicesBefore,
      canScroll: journal.scrollHeight > journal.clientHeight + 1,
    };
  });

  expect(report.engineCount).toBe(report.cap);
  expect(report.snapshotCount).toBe(report.cap);
  expect(report.rendered).toBe(report.cap);
  expect(report.hasOldest).toBe(false);
  expect(report.hasNewest).toBe(true);
  expect(report.slicesOnIdlePaint).toBe(0);
  expect(report.canScroll).toBe(true);
});
