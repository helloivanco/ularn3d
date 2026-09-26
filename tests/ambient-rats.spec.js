import { test, expect } from "@playwright/test";

const faults = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  faults.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

async function dungeonRoom(page) {
  await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 200;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setMonster(x, y, null);
        setItem(x, y, OWALL);
        setKnow(x, y, KNOWNOT);
      }
    for (let x = 5; x < 17; x++)
      for (let y = 4; y < 13; y++) {
        setItem(x, y, OEMPTY);
        setKnow(x, y, KNOWALL);
      }
    // Ring of known wall tops around the room for scurriers.
    for (let x = 4; x <= 17; x++) {
      setKnow(x, 3, KNOWALL);
      setKnow(x, 13, KNOWALL);
    }
    for (let y = 3; y <= 13; y++) {
      setKnow(4, y, KNOWALL);
      setKnow(17, y, KNOWALL);
    }
    paint();
  });
}

test("ambient rats are capped decorative entities on dungeon walls", async ({ page }) => {
  await dungeonRoom(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const a = ularnGraphics.ambientRats();
        return a && a.enabled ? a.count : -1;
      }),
    )
    .toBeGreaterThan(0);

  const info = await page.evaluate(() => {
    const a = ularnGraphics.ambientRats();
    const actors = ularnGraphics.creatures();
    return {
      pool: a.pool,
      count: a.count,
      interactive: a.interactive,
      decorative: a.decorative,
      kind: a.kind,
      rats: a.rats,
      actorCount: actors.length,
      walls: ularnGraphics.walls().length,
    };
  });

  expect(info.pool).toBeLessThanOrEqual(6);
  expect(info.pool).toBeGreaterThanOrEqual(3);
  expect(info.count).toBeLessThanOrEqual(info.pool);
  expect(info.interactive).toBe(false);
  expect(info.decorative).toBe(true);
  expect(info.kind).toBe("ambient-rat");
  expect(info.walls).toBeGreaterThan(0);
  expect(info.actorCount).toBe(0);
  for (const rat of info.rats) {
    expect(rat.interactive).toBe(false);
    expect(rat.decorative).toBe(true);
    expect(rat.position.y).toBeGreaterThan(0.9);
  }

  // Clicking a wall tile must not invent combat/inventory interaction with rats.
  const clickResult = await page.evaluate(() => {
    const before = ularnGraphics.ambientRats();
    const wall = ularnGraphics.walls()[0];
    const canvas = document.querySelector("canvas");
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 1,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 1,
      }),
    );
    const after = ularnGraphics.ambientRats();
    return {
      poolSame: before.pool === after.pool,
      stillDecorative: after.decorative === true && after.interactive === false,
      countCapped: after.count <= after.pool,
      wall,
    };
  });
  expect(clickResult.poolSame).toBe(true);
  expect(clickResult.stillDecorative).toBe(true);
  expect(clickResult.countCapped).toBe(true);

  await page.screenshot({
    path: "test-results/ambient-rats-dungeon.png",
    fullPage: false,
  });
});

test("town has no ambient rats", async ({ page }) => {
  await page.evaluate(() => {
    newcavelevel(0);
    paint();
  });
  await expect
    .poll(() => page.evaluate(() => ularnGraphics.ambientRats().enabled))
    .toBe(false);
  const snap = await page.evaluate(() => ularnGraphics.ambientRats());
  expect(snap.count).toBe(0);
  expect(snap.interactive).toBe(false);
});
