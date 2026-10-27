import { test, expect } from "@playwright/test";

const faults = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  faults.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.audio.v1", JSON.stringify({ enabled: false }));
  });
  await page.goto("/play/"); await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

test("the hero wears its calling's rigged body and swaps it with the calling", async ({ page }) => {
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().heroSkin?.file)).toBe("knight");
  expect(await page.evaluate(() => ularnGraphics.metrics().heroSkin.clip)).toBe("Idle");
  await page.evaluate(() => { player.char_picked = "Wizard"; paint(); });
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().heroSkin?.file)).toBe("mage");
  // The game's own weapon rides the rigged hand.
  expect((await page.evaluate(() => ularnGraphics.heroWeapon())).meshes).toBeGreaterThan(0);
});

test("the undead wear skeleton bodies and other species keep their own", async ({ page }) => {
  await page.evaluate(() => {
    newcavelevel(2); player.x = 33; player.y = 9;
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) { setItem(x, y, OEMPTY); setMonster(x, y, null); setKnow(x, y, KNOWALL); }
    setMonster(31, 9, createMonster(ZOMBIE)); setMonster(35, 9, createMonster(WRAITH)); setMonster(33, 11, createMonster(GNOME));
    paint();
  });
  await expect.poll(() => page.evaluate(() => ularnGraphics.creatures().filter((c) => c.rigged).length)).toBe(2);
  const creatures = await page.evaluate(() => ularnGraphics.creatures());
  expect(creatures.find((c) => c.model === "gnome").rigged).toBe(false);
});
