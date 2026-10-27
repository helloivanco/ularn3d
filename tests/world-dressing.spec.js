import { test, expect } from "@playwright/test";

const faults = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  faults.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

test("Cinematic wall torches light the stone and the nearest few cast light", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "cinematic");
    localStorage.setItem("ularn3d.audio.v1", JSON.stringify({ enabled: false }));
  });
  await page.goto("/play/"); await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await page.evaluate(() => { newcavelevel(3); for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) setKnow(x, y, KNOWALL); paint(); });
  await expect.poll(() => page.evaluate(() => ularnGraphics.dressing().torches.length)).toBeGreaterThan(0);
  const torch = (await page.evaluate(() => ularnGraphics.dressing())).torches[0];
  await page.evaluate(([x, z]) => { player.x = Math.round(x); player.y = Math.round(z + 0.5); paint(); }, [torch.x, torch.z]);
  // The hero's light plus up to four torches.
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().pointLights)).toBeGreaterThan(1);
  expect(await page.evaluate(() => ularnGraphics.metrics().pointLights)).toBeLessThanOrEqual(5);
  await page.locator("#pause").click(); await page.locator("#graphics-quality").selectOption("balanced");
  await page.locator("#resume-game").click();
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().pointLights)).toBe(0);
  expect(await page.evaluate(() => ularnGraphics.metrics().wallShade)).toBe(0);
});

test("the town gets lamp posts and lawn dressing, and the caves get none of it", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/"); await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().townLampPosts)).toBeGreaterThan(0);
  expect(await page.evaluate(() => ularnGraphics.metrics().townDecor)).toBeGreaterThan(20);
  await page.evaluate(() => { newcavelevel(1); paint(); });
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().townLampPosts)).toBe(0);
  expect(await page.evaluate(() => ularnGraphics.metrics().townDecor)).toBe(0);
});
