import { test, expect } from "@playwright/test";
const faults = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  faults.set(page, errors);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.addInitScript(() =>
    localStorage.setItem("ularn3d.quality", "balanced"),
  );
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));
async function start(page) {
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
}

test("periodic checkpoints and death leave classic saves untouched", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    for (const key of [
      "checkpoint",
      "checkpointbackup",
      logname,
      logname + "backup",
    ])
      localStorage.setObject(key + "_ularn", { classic: key });
    gtime = 399;
  });
  await page.keyboard.press(".");
  expect(await page.evaluate(() => gtime)).toBe(400);
  const backup = await page.evaluate(
    () => localStorage.getObject("checkpointbackup_ularn")?.classic,
  );
  expect(backup).toBe("checkpointbackup");
  await page.evaluate(() => died(GNOME, true));
  expect(
    await page.evaluate(() => localStorage.getObject("checkpoint_ularn")),
  ).toEqual({ classic: "checkpoint" });
  expect(
    await page.evaluate(() => localStorage.getObject(logname + "_ularn")),
  ).toEqual({ classic: "Adventurer" });
});

test("pausing interrupts native auto-explore without spending another turn", async ({
  page,
}) => {
  await start(page);
  const before = await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setItem(x, y, OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    paint();
    const explorer = Object.create(MazeExplorer);
    explorer.setupExplore();
    // Controlled real explorer step with an asynchronous item-approach delay.
    explorer.findPath = () => [{ x: player.x + 1, y: player.y }];
    explorer.targetNearestItem = () => ({ x: player.x + 1, y: player.y });
    overridePref("explore_pickup", EXPLORE_PICKUP_ALL);
    const napOriginal = nap;
    nap = (ms) => napOriginal(ms === 150 ? 350 : ms);
    explorer.explore();
    document.querySelector("#pause").click();
    return player.MOVESMADE;
  });
  await expect(page.locator("#pause-dialog")).toBeVisible();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(before);
  expect(await page.evaluate(() => activeExplorer === null)).toBe(true);
  await page.locator("#resume-game").click();
  await page.keyboard.press(".");
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(before + 1);
});

test("title renderer batches buildings within its draw-call and triangle budget", async ({
  page,
}) => {
  await page.waitForTimeout(300);
  const metrics = await page.evaluate(() => ularnGraphics.metrics());
  console.log("Title graphics", metrics);
  expect(metrics.drawCalls).toBeLessThan(160);
  expect(metrics.triangles).toBeGreaterThan(4000);
  expect(metrics.triangles).toBeLessThan(25000);
  expect(metrics.lights).toBeLessThanOrEqual(6);
  expect(metrics.environment).toBe(false);
  expect(metrics.shadowMap).toBe(512);
  await page.screenshot({ path: "test-results/optimized-title.png" });
});

test("town stays within a web GPU budget after the poly and light cuts", async ({
  page,
}) => {
  await start(page);
  await page.waitForTimeout(400);
  const metrics = await page.evaluate(() => ularnGraphics.metrics());
  console.log("Town graphics", metrics);
  expect(metrics.drawCalls).toBeLessThan(220);
  expect(metrics.triangles).toBeLessThan(30000);
  expect(metrics.lights).toBeLessThanOrEqual(6);
  expect(metrics.environment).toBe(false);
});

test("all generated floors and changed inventory survive a save and reload", async ({
  page,
}) => {
  test.setTimeout(90000);
  await start(page);
  const saved = await page.evaluate(() => {
    for (let depth = 1; depth <= 20; depth++) newcavelevel(depth);
    take(createObject(OLARNEYE));
    take(createObject(OPOTION, 21));
    learnSpell("pro");
    player.GOLD = 1234;
    player.BANKACCOUNT = 5678;
    paint();
    ularn.save();
    const s = new GameState(false);
    return {
      levels: JSON.stringify(s.LEVELS),
      inventory: JSON.stringify(s.player.inventory),
      spells: s.player.knownSpells,
      x: s.player.x,
      y: s.player.y,
      level: s.level,
      gold: s.player.GOLD,
      bank: s.player.BANKACCOUNT,
    };
  });
  await page.reload();
  await page.locator("#continue").click();
  const loaded = await page.evaluate(() => {
    const s = new GameState(false);
    return {
      levels: JSON.stringify(s.LEVELS),
      inventory: JSON.stringify(s.player.inventory),
      spells: s.player.knownSpells,
      x: s.player.x,
      y: s.player.y,
      level: s.level,
      gold: s.player.GOLD,
      bank: s.player.BANKACCOUNT,
    };
  });
  // Compare large fields as booleans to avoid dumping an entire save on a failure.
  expect(
    loaded.levels === saved.levels,
    "All generated floor contents survived",
  ).toBe(true);
  delete loaded.levels;
  delete saved.levels;
  expect(loaded).toEqual(saved);
});

test("shop purchases and bank deposits and withdrawals use real keyboard prompts", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    player.GOLD = 1000;
    moveNear(ODNDSTORE, true);
    paint();
  });
  await page.keyboard.press("e");
  const purchase = await page.evaluate(() => ({
    price: dnd_item[0].price,
    id: dnd_item[0].itemId,
    count: player.inventory.filter(Boolean).length,
  }));
  await page.keyboard.press("a");
  expect(await page.evaluate(() => player.GOLD)).toBe(1000 - purchase.price);
  expect(
    await page.evaluate(() => player.inventory.filter(Boolean).length),
  ).toBe(purchase.count + 1);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    moveNear(OBANK, true);
    paint();
  });
  await page.keyboard.press("e");
  await page.keyboard.press("d");
  await page.keyboard.type("100");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => player.BANKACCOUNT)).toBe(100);
  await expect
    .poll(() => page.evaluate(() => blocking_callback === bank_parse))
    .toBe(true);
  await page.keyboard.press("w");
  await page.keyboard.type("40");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => player.BANKACCOUNT)).toBe(60);
  expect(await page.evaluate(() => player.GOLD)).toBe(
    1000 - purchase.price - 60,
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#engine-modal")).toBeHidden();
});
