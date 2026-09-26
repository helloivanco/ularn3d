import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("ularn3d.quality", "balanced"),
  );
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});

test("dungeon floors keep MeshBasic with stone maps (not flat white)", async ({
  page,
}) => {
  const stats = await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
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
    const m = ularnGraphics.metrics();
    return {
      floorMaterial: m.floorMaterial,
      floorMapped: m.floorMapped,
      wallMapped: m.wallMapped,
      fogDensity: m.fogDensity,
      pointLights: m.pointLights,
    };
  });
  expect(stats.floorMaterial).toBe("MeshBasicMaterial");
  expect(stats.floorMapped).toBe(true);
  expect(stats.wallMapped).toBe(true);
  expect(stats.fogDensity).toBe(0);
  expect(stats.pointLights).toBe(0);
});

test("walking does not write the expedition to disk every move", async ({
  page,
}) => {
  const report = await page.evaluate(async () => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
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
    // New game start() already persisted once; count only walk-driven writes.
    const before = ularn.saveStats();
    for (const key of ["l", "l", "j", "j", "h", "h", "k", "k"]) ularn.key(key);
    // Former path debounced ~2s — wait past that window to prove no auto disk write.
    await new Promise((r) => setTimeout(r, 2500));
    const afterWalk = ularn.saveStats();
    const saved = ularn.save();
    const afterSave = ularn.saveStats();
    return { before, afterWalk, saved, afterSave };
  });
  expect(report.afterWalk.diskWrites).toBe(report.before.diskWrites);
  expect(report.afterWalk.dirty).toBe(true);
  expect(report.saved).toBe(true);
  expect(report.afterSave.diskWrites).toBe(report.before.diskWrites + 1);
  expect(report.afterSave.dirty).toBe(false);
});
