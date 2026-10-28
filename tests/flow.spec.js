import { test, expect } from "@playwright/test";

// Flow and controls only: every check drives ordinary keys, clicks or a
// standard-mapping pad, and reads the presentation.
let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
});
test.afterEach(() => expect(errors).toEqual([]));

const open = async (page) => {
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
};
const playing = (page) => expect(page.locator("#hud")).toHaveJSProperty("hidden", false, { timeout: 20000 });
// A quiet, lit room on Depth 1 with the hero at 33,8.
const clearRoom = (page) => page.evaluate(() => {
  newcavelevel(1);
  player.x = 33; player.y = 8; player.HP = player.HPMAX = 80;
  for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) { setMonster(x, y, null); setKnow(x, y, KNOWALL); }
  for (let x = 30; x < 38; x++) for (let y = 7; y < 10; y++) setItem(x, y, OEMPTY);
  paint();
});
const step = (page) => page.locator("#next-step");
// The hero starts at the town's center, and about one town in 30 puts a store,
// home, entrance or shaft there; then the step is that tile's action instead.
const offTownFeatures = (page) => page.evaluate(() => {
  if (itemAt(player.x, player.y).matches(OEMPTY)) return;
  for (let r = 1; r < 6; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        if (itemAt(player.x + dx, player.y + dy).matches(OEMPTY) && !monsterAt(player.x + dx, player.y + dy)) {
          player.x += dx; player.y += dy; paint(); return;
        }
});

test("the title answers Enter at once, and Continue names the saved hero", async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => document.activeElement.id)).toBe("begin");
  await page.keyboard.press("Enter");
  await playing(page);
  await page.evaluate(() => { newcavelevel(2); player.LEVEL = 3; paint(); ularn.save(); });
  await expect.poll(() => page.evaluate(() => ularn.hasSave())).toBe(true);
  await open(page);
  expect(await page.evaluate(() => document.activeElement.id)).toBe("continue");
  await expect(page.locator("#continue-summary")).toHaveText(/^Adventurer · Depth 2 · level 3 · \d+ mobuls left$/);
  await page.keyboard.press("Enter");
  await playing(page);
  expect(await page.evaluate(() => level)).toBe(2);
});

test("the next step walks to the caves, then enters them", async ({ page }) => {
  await open(page);
  await page.locator("#begin").click();
  await playing(page);
  await offTownFeatures(page);
  await expect(step(page)).toBeVisible();
  await expect(step(page)).toContainText("Head into the caves");
  await expect(step(page).locator("kbd")).toHaveText(">");
  await step(page).locator("button").click();
  await expect(step(page)).toContainText("Enter the caves", { timeout: 15000 });
  await expect(step(page).locator("kbd")).toHaveText("E");
  await step(page).locator("button").click();
  await expect.poll(() => page.evaluate(() => level), { timeout: 8000 }).toBe(1);
  await expect(step(page)).toBeVisible();
});

test("a creature in reach becomes the next step, and prompts hide it", async ({ page }) => {
  await open(page);
  await page.locator("#begin").click();
  await playing(page);
  await clearRoom(page);
  // The fixture charts the whole floor, stairs included.
  await expect(step(page)).toContainText("Walk to the stairs down");
  await page.evaluate(() => { setMonster(34, 8, createMonster(KOBOLD)); paint(); });
  await expect(step(page)).toContainText("Attack");
  await expect(step(page)).toContainText("kobold");
  await expect(step(page).locator("kbd")).toHaveText("→");
  await expect(step(page)).toHaveClass(/on-foe/);
  await page.evaluate(() => { setMonster(34, 8, null); paint(); });
  await page.keyboard.press("q");
  await expect(step(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(step(page)).toBeVisible();
});

test("passing your deepest floor is marked once", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("ularn3d.profile.v1")) localStorage.setItem("ularn3d.profile.v1", JSON.stringify({ v: 1, runs: 1, deaths: 1, deepest: 1 }));
  });
  await open(page);
  await page.locator("#begin").click();
  await playing(page);
  await page.evaluate(() => { newcavelevel(1); paint(); });
  await page.waitForTimeout(1200);
  await expect(page.locator("#notice-stack")).not.toContainText("Deepest yet");
  await page.evaluate(() => { newcavelevel(2); paint(); });
  await expect(page.locator("#depth-card .depth-line")).toHaveText("Deeper than ever before");
  await expect(page.locator("#notice-stack")).toContainText("Deepest yet", { timeout: 3000 });
  await expect(page.locator("#notice-stack")).toContainText("Your record was Depth 1.");
});

test("the recap takes focus and does not repeat a hero named after their calling", async ({ page }) => {
  await open(page);
  await page.locator("#begin").click();
  await playing(page);
  await page.evaluate(() => { newcavelevel(2); died(createMonster(GNOME), true); });
  await expect(page.locator("#run-recap")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#recap-line")).toHaveText(/^Adventurer, [a-z ]+ · level 1$/);
  await expect(page.locator("#recap-stats")).not.toContainText(/\b1 mobuls/);
  await expect.poll(() => page.evaluate(() => document.activeElement.id)).toBe("run-recap");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement.id)).toBe("try-again");
});

// A standard-mapping pad the page polls like a real one.
const withPad = (page) => page.addInitScript(() => {
  const pad = { id: "Test pad (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad; window.__polls = 0;
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => { window.__polls++; return [pad, null, null, null]; } });
});
// Software rendering stretches frames, so wait for the page to read the pad, not the clock.
const polled = (page, count = 2) => page.evaluate((count) => new Promise((resolve) => {
  const start = __polls, check = () => (__polls - start >= count ? resolve() : setTimeout(check, 10));
  check();
}), count);
const hold = (page, index, on) => page.evaluate(([i, on]) => { __pad.buttons[i].pressed = on; __pad.buttons[i].value = on ? 1 : 0; }, [index, on]);
const tap = async (page, index) => {
  await hold(page, index, true);
  await polled(page);
  await hold(page, index, false);
  await polled(page);
};
const PAD = { A: 0, B: 1, MENU: 9, DOWN: 13, RIGHT: 15 };

test("a controller reaches the title, play, the menu and the next step", async ({ page }) => {
  await withPad(page);
  await open(page);
  // The d-pad walks focus; A chooses.
  await tap(page, PAD.DOWN);
  expect(await page.evaluate(() => document.activeElement.closest("#welcome") !== null)).toBe(true);
  await page.evaluate(() => document.getElementById("begin").focus());
  await tap(page, PAD.A);
  await playing(page);
  await clearRoom(page);
  await expect(page.locator("body")).toHaveClass(/pad-active/);
  await expect(step(page).locator("kbd")).toHaveText("A");
  // The d-pad walks the hero.
  const x = await page.evaluate(() => player.x);
  await tap(page, PAD.RIGHT);
  await expect.poll(() => page.evaluate(() => player.x)).toBe(x + 1);
  // Menu pauses, B returns.
  await tap(page, PAD.MENU);
  await expect(page.locator("#pause-dialog")).toHaveJSProperty("open", true);
  await tap(page, PAD.B);
  await expect(page.locator("#pause-dialog")).toHaveJSProperty("open", false);
  // A takes the next step: here, the blow at a kobold in reach.
  await page.evaluate(() => { setMonster(player.x + 1, player.y, createMonster(KOBOLD)); paint(); });
  await expect(step(page)).toContainText("Attack");
  const moves = await page.evaluate(() => player.MOVESMADE);
  await tap(page, PAD.A);
  await expect.poll(() => page.evaluate(() => player.MOVESMADE)).toBeGreaterThan(moves);
  // A key press hands the prompt back to the keyboard.
  await page.keyboard.press("Shift");
  await expect(page.locator("body")).not.toHaveClass(/pad-active/);
});

test("after a fall, one press of A skips the fall and one more tries again", async ({ page }) => {
  await withPad(page);
  await open(page);
  await page.locator("#begin").click();
  await playing(page);
  await page.evaluate(() => { newcavelevel(2); died(createMonster(GNOME), true); });
  await tap(page, PAD.A);
  await expect(page.locator("#run-recap")).toBeVisible({ timeout: 5000 });
  // Try again reloads the page, so wait for that instead of the next poll.
  const reloaded = page.waitForEvent("load");
  await hold(page, PAD.A, true);
  await reloaded;
  await expect.poll(() => page.evaluate(() => ({ over: GAMEOVER, level, playing: document.body.classList.contains("playing") })), { timeout: 20000 })
    .toEqual({ over: false, level: 0, playing: true });
});
