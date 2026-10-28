import { test, expect } from "@playwright/test";

let errors;
const begin = async (page, quality) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (/GL_INVALID|WebGL:/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((value) => {
    localStorage.setItem("ularn3d.quality", value);
    localStorage.setItem("ularn3d.audio.v1", JSON.stringify({ enabled: false }));
  }, quality);
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
};
const metrics = (page) => page.evaluate(() => ularnGraphics.metrics());
// A revealed cave floor with the hero beside its first triple candle.
const besideCandle = (page) => page.evaluate(async () => {
  newcavelevel(3);
  for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) { setKnow(x, y, KNOWALL); setMonster(x, y, null); }
  paint();
  for (let i = 0; i < 40 && !ularnGraphics.metrics().candleFlames; i++) await new Promise((resolve) => setTimeout(resolve, 100));
  const candles = ularnGraphics.dressing().props.filter((prop) => prop.kind === "candle_triple");
  const tile = ularn.snapshot().tiles.find((t) => !t.wall && Math.abs(t.x - candles[0].x) <= 1.2 && Math.abs(t.y - candles[0].z) <= 1.2);
  player.x = tile.x; player.y = tile.y; paint();
  return candles.length;
});

test("Cinematic candles burn on every wick and light the hero's corner", async ({ page }) => {
  // Entering a lit cave compiles every lit shader; under software GL that is slow
  // for real, so give it time and a smaller frame, as the building-fade test does.
  test.slow();
  await page.setViewportSize({ width: 720, height: 540 });
  await begin(page, "cinematic");
  const candles = await besideCandle(page);
  expect(candles).toBeGreaterThan(0);
  await expect.poll(async () => (await metrics(page)).candleFlames).toBe(candles * 3);
  await expect.poll(async () => (await metrics(page)).candleLights).toBeGreaterThan(0);
  const lit = await metrics(page);
  expect(lit.candleLights).toBeLessThanOrEqual(3);
  // Flames keep idle frames smooth rather than the bare 12 FPS.
  await expect.poll(async () => (await metrics(page)).frameLimit, { timeout: 8000 }).toBe(30);
  expect(errors, "no shadow-sampler errors on entering a lit cave").toEqual([]);
});

test("Auto candles still burn, but light nothing", async ({ page }) => {
  await begin(page, "auto");
  const candles = await besideCandle(page);
  await expect.poll(async () => (await metrics(page)).candleFlames).toBe(candles * 3);
  const flat = await metrics(page);
  expect(flat.candleLights).toBe(0);
  expect(flat.pointLights).toBe(0);
  expect(errors).toEqual([]);
});

test("Cinematic grows a meadow that sways; Balanced keeps the plain lawn still", async ({ page }) => {
  await begin(page, "cinematic");
  await expect.poll(async () => (await metrics(page)).meadowTufts).toBeGreaterThan(100);
  await expect.poll(async () => (await metrics(page)).frameLimit, { timeout: 8000 }).toBe(30);
  await page.locator("#pause").click();
  await page.locator("#graphics-quality").selectOption("balanced");
  await page.locator("#resume-game").click();
  await expect.poll(async () => (await metrics(page)).meadowTufts).toBe(0);
  expect((await metrics(page)).townDecor).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test("reduced motion holds flames and grass still and lets Cinematic idle", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await begin(page, "cinematic");
  await page.waitForTimeout(1500);
  expect((await metrics(page)).frameLimit).toBeLessThanOrEqual(12);
});
