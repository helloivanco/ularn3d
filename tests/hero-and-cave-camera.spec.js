import { test, expect } from "@playwright/test";

let errors;
const begin = async (page) => {
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
};
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.audio.v1", JSON.stringify({ enabled: false }));
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const hero = (page) => page.evaluate(() => {
  const { heroSkin, heroVisible } = ularnGraphics.metrics();
  return { dressed: !!heroSkin, visible: heroVisible };
});

test("the old built-in hero never shows while the rigged one loads", async ({ page }) => {
  // A slow connection: the rigged body arrives well after play begins.
  await page.route("**/models/characters/*.glb", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await begin(page);
  const seen = [];
  for (let i = 0; i < 12; i++) {
    seen.push(await hero(page));
    await page.waitForTimeout(150);
  }
  expect(seen.some(({ dressed }) => !dressed), "the load was slow enough to watch").toBe(true);
  expect(seen.filter(({ dressed, visible }) => !dressed && visible)).toEqual([]);
  await expect.poll(() => hero(page)).toEqual({ dressed: true, visible: true });
});

test("when the rigged hero cannot load, the built-in one shows instead", async ({ page }) => {
  await page.route("**/models/characters/*.glb", (route) => route.abort());
  page.on("console", () => {}); // The fallback logs a warning by design.
  await begin(page);
  await expect.poll(() => hero(page)).toEqual({ dressed: false, visible: true });
});

test("caves open close on the hero, and the old far cave zoom is forgotten", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ularn3d.camera",
    JSON.stringify({ radius: 8.949, elevation: 15.5, caves: { radius: 7.6, elevation: 13 } })));
  await begin(page);
  const town = await page.evaluate(() => ularnGraphics.metrics().cameraOffset);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("ularn3d.camera")));
  const { radius, elevation } = await stored();
  await page.evaluate(() => { const entrance = ularn.snapshot().tiles.find((tile) => tile.id === 54); player.x = entrance.x; player.y = entrance.y; paint(); });
  await page.keyboard.press("E");
  await expect.poll(() => page.evaluate(() => ularn.snapshot().level)).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const [x, y, z] = ularnGraphics.metrics().cameraOffset;
    return Math.round(Math.hypot(x, z) * 10) / 10;
  })).toBe(5.8);
  const cave = await page.evaluate(() => ularnGraphics.metrics().cameraOffset);
  expect(Math.hypot(...cave)).toBeLessThan(0.7 * Math.hypot(...town));
  // Re-centering in the caves keeps the town zoom as it was.
  await page.locator("#camera-reset").click();
  await page.waitForTimeout(600);
  await expect.poll(stored).toMatchObject({ radius, elevation, caveView: { elevation: 10 } });
  expect((await stored()).caves).toBeUndefined();
});
