import { test, expect } from "@playwright/test";

// Feedback only observes the engine: these fixtures stage a fight, then read
// the presentation through read-only metrics and the DOM overlays.
let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  await page.evaluate(() => {
    const random = Math.random;
    let seed = 0x1a2b3c4d;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    try { newcavelevel(1); } finally { Math.random = random; }
    player.x = 33; player.y = 8; player.HP = player.HPMAX = 80;
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) { setMonster(x, y, null); setKnow(x, y, KNOWALL); }
    for (let x = 30; x < 38; x++) for (let y = 7; y < 10; y++) setItem(x, y, OEMPTY);
    paint();
  });
  await page.waitForTimeout(700);
});
test.afterEach(() => expect(errors).toEqual([]));

const feel = (page) => page.evaluate(() => ularnFeel.metrics());
const graphics = (page) => page.evaluate(() => ularnGraphics.metrics());

test("a landed blow flashes the creature, shows a number and a wound band, then settles", async ({ page }) => {
  await page.evaluate(() => { setMonster(34, 8, createMonster(TROLL)); paint(); });
  await page.evaluate(() => { hitm(34, 8, 5); paint(); });
  const live = await feel(page);
  expect(live.floaterKinds).toContain("dealt");
  expect(live.nameplate).toBe("troll");
  expect(["Wounded", "Unhurt"]).toContain(live.wound);
  expect((await graphics(page)).impactCounts.flashes).toBeGreaterThan(0);
  await expect.poll(async () => (await feel(page)).floaters, { timeout: 3000 }).toBe(0);
  await expect.poll(async () => (await graphics(page)).flashesLive, { timeout: 3000 }).toBe(0);
  await expect.poll(async () => (await graphics(page)).idle, { timeout: 4000 }).toBe(true);
});

test("a kill leaves a falling corpse that is never picked and drops pop out of the floor", async ({ page }) => {
  await page.evaluate(() => { setMonster(34, 8, createMonster(HOBGOBLIN)); paint(); });
  await page.evaluate(() => { hitm(34, 8, 999); paint(); });
  const metrics = await graphics(page);
  expect(metrics.corpsesLive).toBe(1);
  expect(await page.evaluate(() => ularnGraphics.creatures().length)).toBe(0);
  expect((await feel(page)).floaterKinds).toContain("kill");
  await expect.poll(async () => (await graphics(page)).corpsesLive, { timeout: 3000 }).toBe(0);
  const geometries = (await graphics(page)).geometries;
  for (let i = 0; i < 40; i++) await page.evaluate(() => { setMonster(34, 8, createMonster(HOBGOBLIN)); paint(); hitm(34, 8, 999); paint(); });
  await expect.poll(async () => (await graphics(page)).corpsesLive, { timeout: 4000 }).toBe(0);
  expect((await graphics(page)).geometries).toBeLessThanOrEqual(geometries + 4);
});

test("taking hits wounds the screen edge and low health raises the warning", async ({ page }) => {
  await page.evaluate(() => { player.AC = 0; setMonster(34, 8, createMonster(TROLL)); paint(); });
  await page.evaluate(() => { for (let i = 0; i < 8 && player.HP === player.HPMAX; i++) hitplayer(34, 8); paint(); });
  expect(await page.evaluate(() => player.HP)).toBeLessThan(80);
  const hurt = await feel(page);
  expect(hurt.beats).toContain("hurt");
  expect(hurt.floaterKinds).toContain("taken");
  await page.evaluate(() => { player.HP = 10; paint(); });
  await expect(page.locator("body")).toHaveClass(/low-hp/);
  await page.evaluate(() => { player.HP = 5; paint(); });
  await expect(page.locator("body")).toHaveClass(/critical-hp/);
  await page.evaluate(() => { player.HP = 80; paint(); });
  await expect(page.locator("body")).not.toHaveClass(/low-hp/);
});

test("spending a spell does not throw wound embers", async ({ page }) => {
  const before = await graphics(page);
  await page.evaluate(() => { player.SPELLS = Math.max(0, player.SPELLS - 1); paint(); });
  await page.waitForTimeout(100);
  const after = await graphics(page);
  expect(after.trauma).toBe(0);
  expect((await feel(page)).floaters).toBe(0);
  expect(after.impactCounts.flashes).toBe(before.impactCounts.flashes);
});

test("a level-up raises a banner with its gains and a light column", async ({ page }) => {
  await page.evaluate(() => { player.raiseexperience(30); paint(); });
  await expect(page.locator("#feel-banner")).toBeVisible({ timeout: 4000 });
  await expect(page.locator("#feel-banner .banner-title")).toHaveText(/Level \d+/);
  expect((await graphics(page)).impactCounts.levelUps).toBe(1);
});

test("a new floor shows a depth card without holding back the next move", async ({ page }) => {
  await page.evaluate(() => { newcavelevel(2); paint(); });
  await expect(page.locator("#depth-card")).toBeVisible();
  await expect(page.locator("#depth-card .depth-title")).toHaveText("Depth 2");
  const moves = await page.evaluate(() => player.MOVESMADE);
  await page.evaluate(() => mainloop(null, "."));
  expect(await page.evaluate(() => player.MOVESMADE)).toBeGreaterThan(moves);
});

test("feel settings switch numbers and shake off and never spend a turn", async ({ page }) => {
  const moves = await page.evaluate(() => player.MOVESMADE);
  await page.locator("#pause").click();
  await page.locator("#feel-numbers").uncheck();
  await page.locator("#feel-shake").fill("0");
  await page.locator("#feel-health").uncheck();
  await page.locator("#feel-flashes").check();
  await page.locator("#resume-game").click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ularn3d.feel.v1")))).toMatchObject({ numbers: false, shake: 0, healthBars: false, flashes: false });
  await page.evaluate(() => { setMonster(34, 8, createMonster(TROLL)); paint(); hitm(34, 8, 3); paint(); });
  const metrics = await feel(page);
  expect(metrics.floaters).toBe(0);
  expect(metrics.nameplate).toBe(null);
  expect((await graphics(page)).trauma).toBe(0);
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(moves);
});

test("reduced motion keeps numbers and banners but drops shake and hit-stop", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#pause").click();
  await page.locator("#feel-motion").selectOption("reduced");
  await page.locator("#resume-game").click();
  await page.evaluate(() => { setMonster(34, 8, createMonster(TROLL)); paint(); hitm(34, 8, 6); paint(); });
  const metrics = await graphics(page);
  expect(metrics.trauma).toBe(0);
  expect(metrics.hitStopActive).toBe(false);
  expect((await feel(page)).floaterKinds).toContain("dealt");
});
