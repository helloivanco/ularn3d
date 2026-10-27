import { test, expect } from "@playwright/test";

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  await page.evaluate(() => {
    newcavelevel(1);
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) { setMonster(x, y, null); setItem(x, y, OEMPTY); setKnow(x, y, KNOWALL); }
    take(createObject(OPOTION, 0)); take(createObject(OSCROLL, 0)); take(createObject(OCOOKIE)); take(createObject(OLONGSWORD));
    paint();
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const row = (page, name) => page.locator("#inventory-list .inventory-item").filter({ hasText: name });

test("clicking a pinned item offers what it can do and sends the classic keys", async ({ page }) => {
  const uses = await page.evaluate(() => Object.fromEntries(ularn.snapshot().inventory.map((item) => [item.name, item.uses.join("")])));
  expect(uses).toMatchObject({ "leather armor": "d", dagger: "d", potion: "qd", scroll: "rd", "fortune cookie": "ed", longsword: "wd" });

  const menu = page.locator("#item-menu");
  await row(page, "potion").click();
  await expect(menu.getByRole("menuitem")).toHaveText(["Quaffq", "Dropd"]);
  const turn = await page.evaluate(() => gtime);
  await menu.getByRole("menuitem", { name: /Quaff/ }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator("#inventory-list")).not.toContainText("potion");
  expect(await page.evaluate(() => gtime)).toBeGreaterThan(turn);

  // The key shown beside a choice picks it from the open menu.
  await row(page, "longsword").click();
  await page.keyboard.press("w");
  await expect.poll(() => page.evaluate(() => player.WIELD?.matches(OLONGSWORD) ?? false)).toBe(true);

  // Escape closes the menu, not into the pause dialog.
  await row(page, "scroll").click();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator("#pause-dialog")).not.toHaveAttribute("open", "");
});

test("standing on a matching item refuses rather than using the floor one", async ({ page }) => {
  await page.evaluate(() => { setItem(player.x, player.y, createObject(OSCROLL, 1)); paint(); });
  const count = await page.evaluate(() => player.inventory.filter(Boolean).length);
  await row(page, "scroll").click();
  await page.locator("#item-menu").getByRole("menuitem", { name: /Read/ }).click();
  expect(await page.evaluate(() => player.inventory.filter(Boolean).length)).toBe(count);
  expect(await page.evaluate(() => itemAt(player.x, player.y).matches(OSCROLL))).toBe(true);
  expect((await page.evaluate(() => ularn.snapshot().log)).join(" ")).toContain("Step off it to use one from your pack");
});
