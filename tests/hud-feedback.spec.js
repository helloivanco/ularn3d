import { test, expect } from "@playwright/test";

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});
test.afterEach(() => expect(errors).toEqual([]));

test("bottom HUD, symbol map, pinned inventory, and loot shortcut stay in sync", async ({ page }) => {
  await expect(page.locator(".quest-panel, .map-legend")).toHaveCount(0);
  const map = await page.locator("#minimap").boundingBox();
  expect(map.width).toBeGreaterThan(240);
  expect(map.width).toBeLessThan(400);
  const hero = await page.locator(".hero-panel").boundingBox();
  expect(hero.y).toBeGreaterThan(750);
  await expect(page.locator("#inventory-list")).toContainText("dagger");
  await expect(page.locator("#inventory-list .equipped").filter({ hasText: "dagger" })).toContainText("wielded");
  const before = await page.evaluate(() => player.MOVESMADE);
  await page.keyboard.press("F2");
  await expect(page.locator("#auto-loot")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => ularn.snapshot().autoLoot)).toBe(false);
  await page.keyboard.press("F3");
  await expect(page.locator("#inventory-panel")).toBeHidden();
  await page.locator("#inventory-pin").click();
  await expect(page.locator("#inventory-panel")).toBeVisible();
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(before);
  await page.locator("#save").click();
  await page.reload();
  await page.locator("#continue").click();
  await expect(page.locator("#inventory-panel")).toBeVisible();
  await expect(page.locator("#auto-loot")).toHaveAttribute("aria-pressed", "false");
});

test("effect rail and persistent pack refresh from engine changes without opening menus", async ({ page }) => {
  await expect(page.locator("#effects-panel")).toBeHidden();
  await page.evaluate(() => {
    player.HASTESELF = 17;
    player.HALFDAM = 8;
    player.inventory[5] = createObject(OPOTION, 0);
    paint();
  });
  await expect(page.locator("#effects-panel")).toBeVisible();
  await expect(page.locator("#effects")).toContainText("17");
  await expect(page.locator("#effects .harmful")).toContainText("8");
  await expect(page.locator("#inventory-list")).toContainText("potion");
  await expect(page.locator("#engine-modal")).toBeHidden();
  await page.evaluate(() => {
    player.HASTESELF = player.HALFDAM = 0;
    player.inventory[5] = null;
    paint();
  });
  await expect(page.locator("#effects-panel")).toBeHidden();
  await expect(page.locator("#inventory-list")).not.toContainText("potion");
});

test("every spell and weapon family has a distinct sound and voices are released", async ({ page }) => {
  await page.locator("#sound").click();
  const result = await page.evaluate(async () => {
    const { GameAudio, spellProfile, weaponProfile } = await import("/src/audio.js");
    const profiles = spelname.map((name, id) => JSON.stringify(spellProfile({name, id})));
    const weapons = ["unarmed", "axe", "spear", "lance", "dagger", "flail", "hammer", "staff", "sword", "blunt"].map(type => JSON.stringify(weaponProfile(type)));
    window.testAudio = new GameAudio();
    for (let i = 0; i < 60; i++) testAudio.play("spell", { spell: { id: i % 39, name: spelname[i % 39] } });
    return { spells: new Set(profiles).size, count: spelname.length, weapons: new Set(weapons).size, voices: testAudio.voices.size, cap: testAudio.maxVoices };
  });
  expect(result.spells).toBe(result.count);
  expect(result.weapons).toBe(10);
  expect(result.voices).toBeLessThanOrEqual(result.cap);
  await page.evaluate(async () => {
    await testAudio.suspend();
    if (testAudio.voices.size !== 0) throw new Error("Muted voices were not released");
    testAudio.play("weapon", { weapon: { type: "sword" } });
  });
  await expect.poll(() => page.evaluate(() => testAudio.context.state)).toBe("running");
  await expect.poll(() => page.evaluate(() => testAudio.voices.size)).toBe(0);
  await page.evaluate(() => testAudio.context.close());
});
