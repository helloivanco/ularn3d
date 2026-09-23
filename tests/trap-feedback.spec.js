import { test, expect } from "@playwright/test";

test("pit dart and elevator journal lines stay classic and clear", async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);

  const log = await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 500;
    player.STRENGTH = 20;
    for (let x = 5; x < 16; x++)
      for (let y = 5; y < 12; y++) {
        setItem(x, y, OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    setMazeMode(true);
    LOG.length = 0;
    setItem(10, 8, ODARTRAP);
    lookforobject(true, false);
    const dart = LOG.slice();
    LOG.length = 0;
    setItem(10, 8, OELEVATORUP);
    // Stay in dungeon so the elevator does not dump to town mid-assert.
    const levelBefore = level;
    lookforobject(true, false);
    const elevator = LOG.slice();
    return { dart, elevator, levelBefore, levelAfter: level };
  });

  expect(log.dart.some((line) => /dart trap/i.test(line))).toBe(true);
  expect(log.elevator.some((line) => /express elevator going up/i.test(line))).toBe(true);
  expect(errors).toEqual([]);
});
