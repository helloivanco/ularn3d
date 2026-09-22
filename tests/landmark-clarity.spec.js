import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "performance"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});

async function arena(page, depth = 2) {
  await page.evaluate((targetDepth) => {
    newcavelevel(targetDepth);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 1000;
    player.TIMESTOP = player.CONFUSE = player.BLINDCOUNT = 0;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setItem(x, y, x < 7 || x > 17 || y < 5 || y > 11 ? OWALL : OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    setMazeMode(true);
    paint();
  }, depth);
}

async function mapClick(page, x, y) {
  const box = await page.locator("#minimap").boundingBox();
  const view = await page.locator("#minimap").evaluate((el) => ({
    x0: +el.dataset.x0,
    y0: +el.dataset.y0,
    cols: +el.dataset.cols,
    rows: +el.dataset.rows,
  }));
  await page.mouse.click(
    box.x + ((x - view.x0 + 0.5) / view.cols) * box.width,
    box.y + ((y - view.y0 + 0.5) / view.rows) * box.height,
  );
}

for (const [action, key] of [["drink", "D"], ["wash", "f"]]) {
  test(`${action} can drain a fountain, removes water actions, and explains the dry state`, async ({ page }) => {
    await arena(page);
    await page.evaluate(() => {
      setItem(player.x, player.y, OFOUNTAIN);
      lookforobject(true, false);
      paint();
    });
    const context = page.locator("#CONTEXT");
    await expect(context.getByRole("button", { name: "drink", exact: true })).toBeVisible();
    await expect(context.getByRole("button", { name: "wash", exact: true })).toBeVisible();

    const drained = await page.evaluate((command) => {
      const originalRnd = rnd;
      // Leave the real command and depletion rules intact. Select harmless
      // water effects and the original one-in-six depletion outcome only.
      rnd = (limit) => limit === 1501 ? 1501 : limit === 100 ? 40 : limit === 12 ? 1 : originalRnd(limit);
      try {
        ularn.key(command);
      } finally {
        rnd = originalRnd;
      }
      return {
        dry: itemAt(player.x, player.y).matches(ODEADFOUNTAIN),
        name: ularn.snapshot().tiles.find((tile) => tile.x === player.x && tile.y === player.y)?.name,
      };
    }, key);
    expect(drained).toEqual({ dry: true, name: "dry fountain" });
    await expect(page.locator("#journal-lines")).toContainText("The fountain runs dry. No water remains");
    await expect(context.getByRole("button", { name: "drink", exact: true })).toHaveCount(0);
    await expect(context.getByRole("button", { name: "wash", exact: true })).toHaveCount(0);

    await page.evaluate(() => {
      ularn.key("h");
      ularn.key("l");
    });
    await expect(page.locator("#journal-lines")).toContainText("There is a dry fountain here. No water remains");
    await page.evaluate(() => ularn.key("D"));
    await expect(page.locator("#journal-lines")).toContainText("There is no water to drink!");
    await page.evaluate(() => ularn.key("f"));
    await expect(page.locator("#journal-lines")).toContainText("There is no water to wash in!");

    if (action === "drink") {
      expect(await page.evaluate(() => ularn.save())).toBe(true);
      await page.reload();
      await page.locator("#continue").click();
      await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
      expect(await page.evaluate(() => itemAt(player.x, player.y).matches(ODEADFOUNTAIN))).toBe(true);
      await expect(context.getByRole("button", { name: "drink", exact: true })).toHaveCount(0);
      await expect(context.getByRole("button", { name: "wash", exact: true })).toHaveCount(0);
    }
  });
}

for (const [direction, key, opposite, destination] of [["up", "<", ">", 1], ["down", ">", "<", 3]]) {
  test(`stairs going ${direction} explain their direction and the ${key} command changes depth correctly`, async ({ page }) => {
    await arena(page);
    await page.evaluate((heading) => {
      setItem(11, 8, heading === "up" ? OSTAIRSUP : OSTAIRSDOWN);
      paint();
      ularn.key("l");
    }, direction);
    await expect(page.locator("#journal-lines")).toContainText(`There is a circular staircase going ${direction} here`);
    await expect(page.locator("#CONTEXT").getByRole("button", { name: `go ${direction}`, exact: true })).toBeVisible();
    expect(await page.evaluate((command) => { ularn.key(command); return level; }, opposite)).toBe(2);
    expect(await page.evaluate((command) => { ularn.key(command); return level; }, key)).toBe(destination);
  });

  test(`clicking the minimap staircase underfoot goes ${direction}`, async ({ page }) => {
    await arena(page);
    await page.evaluate((heading) => {
      setItem(player.x, player.y, heading === "up" ? OSTAIRSUP : OSTAIRSDOWN);
      paint();
    }, direction);
    await mapClick(page, 10, 8);
    await expect.poll(() => page.evaluate(() => ularn.snapshot().level)).toBe(destination);
    await expect(page.locator("#journal-lines")).not.toContainText("There is no place to enter here!");
  });
}

test("clicking a blocked staircase preserves depth and explains the dead end", async ({ page }) => {
  // Ularn deliberately includes a blocked up staircase on volcano floor 1.
  const blockedDepth = await page.evaluate(() => MAXLEVEL);
  await arena(page, blockedDepth);
  await page.evaluate(() => {
    setItem(player.x, player.y, OSTAIRSUP);
    paint();
  });
  await mapClick(page, 10, 8);
  await expect(page.locator("#journal-lines")).toContainText("The stairs lead to a dead end!");
  expect(await page.evaluate(() => ({ level, x: player.x, y: player.y }))).toEqual({ level: blockedDepth, x: 10, y: 8 });
  await expect(page.locator("#journal-lines")).not.toContainText("There is no place to enter here!");
});
