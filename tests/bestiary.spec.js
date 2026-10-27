import { test, expect } from "@playwright/test";

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});
test.afterEach(() => expect(errors).toEqual([]));

test("meeting a creature fills its bestiary page; the rest stay silhouettes", async ({ page }) => {
  await page.evaluate(() => {
    newcavelevel(1);
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) { setMonster(x, y, null); setKnow(x, y, KNOWALL); }
    setItem(player.x + 1, player.y, OEMPTY);
    setMonster(player.x + 1, player.y, createMonster(JACKAL));
    paint();
  });
  await expect(page.locator("#notice-stack")).toContainText("New creature");
  const moves = await page.evaluate(() => player.MOVESMADE);
  await page.locator("#pause").click();
  await page.locator("#open-bestiary").click();
  await expect(page.locator("#bestiary-dialog")).toBeVisible();
  await expect(page.locator("#bestiary-progress")).toHaveText("1 of 66 creatures discovered");
  await expect(page.locator(".beast")).toHaveCount(66);
  await expect(page.locator(".beast:not(.unknown)")).toHaveCount(1);
  await expect(page.locator(".beast:not(.unknown) strong")).toHaveText("jackal");
  // Every card keeps its own height: the next row starts below the last one ends.
  const rows = await page.locator(".beast").evaluateAll((cards) => cards.slice(0, 12).map((card) => card.getBoundingClientRect()));
  for (let i = 1; i < rows.length; i++) if (rows[i].top !== rows[i - 1].top) expect(rows[i].top).toBeGreaterThanOrEqual(rows[i - 1].bottom);
  expect(rows[0].height).toBeGreaterThan(150);
  await page.getByRole("tab", { name: "Slain" }).click();
  await expect(page.locator(".beast")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(moves);
  await page.evaluate(() => { hitm(player.x + 1, player.y, 999); paint(); });
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("ularn3d.profile.v1")));
  expect(profile.species["4"]).toMatchObject({ seen: 1, killed: 1 });
  expect(profile.feats["first-blood"]).toBeTruthy();
});
