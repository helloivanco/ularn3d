import { test, expect } from "@playwright/test";

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
});
test.afterEach(() => expect(errors).toEqual([]));

const begin = async (page, { name = "Recap Hero", calling = "Rogue", difficulty = "1" } = {}) => {
  await page.locator("#hero-name").fill(name);
  await page.locator(".class-choice", { hasText: calling }).click();
  await page.locator("#difficulty").selectOption(difficulty);
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
};
const die = (page, gold = 0) => page.evaluate((gold) => {
  newcavelevel(3);
  player.GOLD = gold;
  died(createMonster(GNOME), true);
}, gold);

test("death plays out, then a recap names the killer with depth, kills and turns", async ({ page }) => {
  await begin(page);
  await die(page, 120);
  await expect(page.locator("#engine-modal")).toBeHidden();
  expect(await page.evaluate(() => ularnGraphics.metrics().collapsed)).toBe(true);
  await expect(page.locator("#run-recap")).toBeVisible({ timeout: 4000 });
  await expect(page.locator("#recap-title")).toHaveText(/Killed by a gnome/i);
  await expect(page.locator("#recap-stats")).toContainText("Depth 3");
  await expect(page.locator("#recap-stats")).toContainText("Creatures slain");
  await expect(page.locator("#recap-rank")).toHaveText("Your first recorded expedition");
  await expect(page.locator("#try-again")).toBeVisible();
  await expect(page.locator('.terminal-footer [data-key="return"]')).toHaveText("Scoreboard ↵");
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("ularn3d.profile.v1")));
  expect(profile.runs).toBe(1);
  expect(profile.lastRun).toMatchObject({ name: "Recap Hero", character: "Rogue", difficulty: "1" });
});

test("any key skips the fall, and Enter still opens the scoreboard", async ({ page }) => {
  await begin(page);
  await die(page);
  await page.keyboard.press("Space");
  await expect(page.locator("#run-recap")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-card")).toHaveClass(/recap-strip/);
  await expect(page.locator("#score-details")).toBeVisible();
});

test("R tries again at once with the same name, calling and difficulty", async ({ page }) => {
  await begin(page);
  await die(page);
  await expect(page.locator("#try-again")).toBeVisible({ timeout: 4000 });
  await page.keyboard.press("r");
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false, { timeout: 20000 });
  expect(await page.evaluate(() => ({ name: logname, calling: player.char_picked, difficulty: getDifficulty(), over: GAMEOVER })))
    .toEqual({ name: "Recap Hero", calling: "Rogue", difficulty: 1, over: false });
});

test("a richer second run earns a new best, and the title shows records", async ({ page }) => {
  await begin(page);
  await die(page, 10);
  await expect(page.locator("#try-again")).toBeVisible({ timeout: 4000 });
  await page.locator("#try-again").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false, { timeout: 20000 });
  await die(page, 900);
  await expect(page.locator("#recap-chips")).toContainText("New best score!", { timeout: 4000 });
  await expect(page.locator("#recap-rank")).toHaveText("#1 of your 2 recorded expeditions");
  await page.locator("#new-after-death").click();
  await expect(page.locator("#records")).toBeVisible();
  await expect(page.locator("#records-stats")).toContainText("900");
  await expect(page.locator(".class-choice[aria-pressed=true]")).toHaveText("Rogue");
  await expect(page.locator(".class-portrait")).toHaveCount(8);
});

test("victory celebrates before the recap", async ({ page }) => {
  await begin(page);
  await page.evaluate(() => { player.GOLD = 5000; died(DIED_WINNER, false); });
  await expect(page.locator("#notice-stack")).toContainText("The cure is home");
  await expect(page.locator("#run-recap")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#recap-eyebrow")).toHaveText("VICTORY");
  await expect(page.locator(".terminal-card")).toHaveClass(/winner/);
});
