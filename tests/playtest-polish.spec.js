import { test, expect } from "@playwright/test";

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.audio.v1", JSON.stringify({ enabled: false }));
  });
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});
test.afterEach(() => expect(errors).toEqual([]));

test("starting gear and a resumed pack draw their artwork", async ({ page }) => {
  const rows = page.locator("#inventory-list .inventory-item");
  await expect(rows).toHaveCount(2);
  await expect(page.locator("#inventory-list .item-art")).toHaveCount(2);
  await page.locator("#save").click();
  await expect(page.locator("#toast")).toContainText("saved");
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#continue").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  await expect(page.locator("#inventory-list .item-art")).toHaveCount(2);
});

test("a direction prompt offers the eight directions, and spells get their own title", async ({ page }) => {
  await page.evaluate(() => {
    newcavelevel(1);
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) { setMonster(x, y, null); setItem(x, y, OEMPTY); setKnow(x, y, KNOWALL); }
    player.x = 30; player.y = 8;
    setItem(player.x, player.y - 1, createObject(OCLOSEDDOOR, 0));
    paint();
  });
  await page.keyboard.press("o");
  const pick = page.locator("#direction-pick");
  await expect(pick).toBeVisible();
  await expect(page.locator("#interaction-title")).toHaveText("CHOOSE A DIRECTION");
  await expect(page.locator("#ACTIONS")).toBeHidden();
  await pick.getByRole("button", { name: "North", exact: true }).click();
  await expect(pick).toBeHidden();
  expect(await page.evaluate(() => ularn.snapshot().prompt)).toBe(false);

  await page.keyboard.press("c");
  await expect(page.locator("#interaction-title")).toHaveText("CAST A SPELL");
  await expect(page.locator("#ACTIONS")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the next step walks to a shut door when exploring cannot reach past it", async ({ page }) => {
  const door = await page.evaluate(() => {
    newcavelevel(1);
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) { setMonster(x, y, null); setItem(x, y, OWALL); setKnow(x, y, KNOWNOT); }
    // A three-tile room shut by a door two steps east of the hero.
    player.x = 30; player.y = 8;
    const { x, y } = player;
    for (const dx of [-1, 0, 1]) { setItem(x + dx, y, OEMPTY); }
    setItem(x + 2, y, createObject(OCLOSEDDOOR, 0));
    for (let dx = -2; dx <= 3; dx++) for (let dy = -1; dy <= 1; dy++) setKnow(x + dx, y + dy, KNOWALL);
    paint();
    return { x: x + 2, y };
  });
  const step = page.locator("#next-step .step-action").first();
  await expect(step).toContainText("Walk to the door");
  await step.click();
  await expect.poll(() => page.evaluate(() => player.x)).toBe(door.x - 1);
  await expect(page.locator("#next-step .step-action").first()).toContainText("Open the door");
});

test("settings checkboxes sit beside their labels", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-dialog")).toHaveAttribute("open", "");
  for (const id of ["audio-enabled", "feel-numbers", "feel-health", "feel-flashes"]) {
    const box = await page.locator(`#${id}`).boundingBox();
    expect(box.width, id).toBeLessThan(30);
  }
});

test("town destinations read like their signs and hand the keys back to the hero", async ({ page }) => {
  const list = page.locator("#destination");
  await expect(list.locator("option")).toContainText(["Choose a destination…", "DND Store"]);
  await expect(list.locator("option", { hasText: "Bank of Ularn" })).toHaveCount(1);
  await list.selectOption({ label: "Bank of Ularn" });
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("destination");
});

test("a store's listed choices can be clicked to buy", async ({ page }) => {
  await page.evaluate(() => {
    const store = ularn.snapshot().tiles.find((tile) => tile.id === 12);
    player.x = store.x; player.y = store.y; player.GOLD = 1000; paint();
  });
  await page.keyboard.press("E");
  const terminal = page.locator("#LARN");
  await expect(terminal).toContainText("Thrift Shoppe");
  const point = await page.evaluate(() => {
    const pre = document.getElementById("LARN"), walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf("a) leather armor");
      if (at < 0) continue;
      const range = document.createRange(); range.setStart(node, at + 4); range.setEnd(node, at + 8);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return null;
  });
  expect(point).not.toBeNull();
  await page.mouse.move(point.x, point.y);
  await expect(terminal).toHaveClass(/picking/);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => player.GOLD)).toBe(980);
});
