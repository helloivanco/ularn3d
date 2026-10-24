import { test, expect } from "@playwright/test";

const begin = async (page, stored = {}) => {
  await page.addInitScript((prefs) => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.audio.v1", JSON.stringify({ enabled: false }));
    for (const [name, value] of Object.entries(prefs)) localStorage.setItem(`${name}_ularn`, JSON.stringify(value));
  }, stored);
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
};
const where = page => page.evaluate(() => ({ level, x: player.x, y: player.y }));
const lastLog = page => page.evaluate(() => ularn.snapshot().log.slice(-3).join("\n"));
// Every tile known, doors open and no creatures, so travel never stops for danger.
const chartQuietFloor = page => page.evaluate(() => {
  for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) {
    setMonster(x, y, null); setKnow(x, y, KNOWALL);
    if (itemAt(x, y).matches(OCLOSEDDOOR)) setItem(x, y, createObject(OOPENDOOR));
  }
  player.HP = player.HPMAX = 1000;
  paint();
});
const find = (page, name) => page.evaluate(name => {
  const object = (0, eval)(name);
  for (let y = 0; y < MAXY; y++) for (let x = 0; x < MAXX; x++) if (itemAt(x, y).matches(object)) return { x, y };
  return null;
}, name);

test("Explore charts the floor until something needs attention", async ({ page }) => {
  await begin(page);
  expect(await page.evaluate(() => ["explore_toggle", "explore_object", "explore_stairs"].map(getPref))).toEqual([true, true, true]);
  // Defaults are not written, so a later choice in Options still wins.
  expect(await page.evaluate(() => localStorage.getItem("explore_toggle_ularn"))).toBeNull();
  await page.evaluate(() => { newcavelevel(1); player.HP = player.HPMAX = 1000; paint(); });
  const before = await page.evaluate(() => ularn.snapshot().tiles.length);
  await page.locator("#explore").click();
  await expect.poll(() => lastLog(page)).toMatch(/Exploring|Stopped exploring/);
  await expect.poll(() => page.evaluate(() => ularn.snapshot().tiles.length)).toBeGreaterThan(before);
  await expect.poll(() => page.evaluate(() => !activeExplorer), { timeout: 30000 }).toBe(true);
});

test("> and < walk to stairs already seen and still use stairs underfoot", async ({ page }) => {
  await begin(page);
  const entrance = await find(page, "OENTRANCE");
  await page.keyboard.press(">");
  await expect.poll(() => where(page)).toEqual({ level: 0, ...entrance });
  await page.keyboard.press(">");
  await expect.poll(() => where(page).then(at => at.level)).toBe(1);

  // Unseen stairs keep the original answer instead of wandering.
  await page.evaluate(() => { for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) if (itemAt(x, y).matches(OSTAIRSDOWN)) setKnow(x, y, 0); });
  await page.keyboard.press(">");
  await expect.poll(() => lastLog(page)).toContain("no way to go down");
  expect((await where(page)).level).toBe(1);

  await chartQuietFloor(page);
  const down = await find(page, "OSTAIRSDOWN");
  await page.keyboard.press(">");
  await expect.poll(() => where(page), { timeout: 20000 }).toEqual({ level: 1, ...down });
  await page.keyboard.press(">");
  await expect.poll(() => where(page).then(at => at.level)).toBe(2);

  await chartQuietFloor(page);
  const up = await find(page, "OSTAIRSUP");
  await page.evaluate(({ x, y }) => {
    // Step to open floor several moves away (and reachable) so the walk back is real.
    const seen = new Map([[`${x},${y}`, 0]]), queue = [[x, y]];
    let spot = null;
    while (queue.length && !spot) {
      const [cx, cy] = queue.shift(), steps = seen.get(`${cx},${cy}`);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= MAXX || ny >= MAXY || seen.has(`${nx},${ny}`) || itemAt(nx, ny).matches(OWALL)) continue;
        seen.set(`${nx},${ny}`, steps + 1); queue.push([nx, ny]);
        if (steps + 1 >= 8 && itemAt(nx, ny).matches(OEMPTY)) spot = { x: nx, y: ny };
      }
    }
    player.x = spot.x; player.y = spot.y; paint();
  }, up);
  await page.keyboard.press("<");
  await expect.poll(() => where(page), { timeout: 20000 }).toEqual({ level: 2, ...up });
});

test("a player who turned auto explore off keeps it off", async ({ page }) => {
  await begin(page, { explore_toggle: false });
  expect(await page.evaluate(() => getPref("explore_toggle"))).toBe(false);
  await page.locator("#explore").click();
  await expect.poll(() => lastLog(page)).toContain("Auto explore is disabled");
});
