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
async function snap(page) {
  return page.evaluate(() => ularn.snapshot());
}
async function mapClick(page, x, y) {
  const b = await page.locator("#minimap").boundingBox();
  const size = await page.evaluate(() => ({ w: MAXX, h: MAXY }));
  await page.mouse.click(
    b.x + ((x + 0.5) / size.w) * b.width,
    b.y + ((y + 0.5) / size.h) * b.height,
  );
}

test("automatic travel stops immediately when a step causes damage", async ({
  page,
}) => {
  await start(page);
  const moves = await page.evaluate(() => {
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 100;
    for (let x = 5; x < 20; x++)
      for (let y = 3; y < 14; y++) {
        setItem(x, y, OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    paint();
    const original = ularn.key;
    ularn.key = function (...args) {
      original.apply(this, args);
      player.HP -= 3;
      paint();
    };
    return player.MOVESMADE;
  });
  await mapClick(page, 16, 8);
  await expect(page.locator("#toast")).toContainText("hurt");
  await page.waitForTimeout(600);
  expect((await snap(page)).moves).toBe(moves + 1);
});

test("travel avoids known traps and stops for confusion", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    player.x = 10;
    player.y = 8;
    for (let x = 6; x < 20; x++)
      for (let y = 3; y < 14; y++) {
        setItem(x, y, OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    setItem(11, 8, ODARTRAP);
    paint();
  });
  await mapClick(page, 14, 8);
  await expect
    .poll(async () => [(await snap(page)).x, (await snap(page)).y])
    .toEqual([14, 8]);
  expect((await snap(page)).hp).toBe(10);
  const moves = await page.evaluate(() => {
    player.CONFUSE = 10;
    paint();
    return player.MOVESMADE;
  });
  await mapClick(page, 18, 8);
  await expect(page.locator("#toast")).toContainText("confused");
  expect((await snap(page)).moves).toBe(moves);
});

test("save failure is visible and resume preserves classic saves", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    localStorage.setObject(logname + "_ularn", { classic: "sentinel" });
    localStorage.setObject("checkpoint_ularn", { classic: "sentinel" });
    ularn.save();
  });
  await page.reload();
  await page.locator("#continue").click();
  expect(
    await page.evaluate(() => localStorage.getObject(logname + "_ularn")),
  ).toEqual({
    classic: "sentinel",
  });
  expect(
    await page.evaluate(() => localStorage.getObject("checkpoint_ularn")),
  ).toEqual({ classic: "sentinel" });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "ularn3d.expedition.v1")
        throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, k, v);
    };
  });
  await page.locator("#save").click();
  await expect(page.locator("#toast")).toContainText("Saving unavailable");
  await page.locator("#pause").click();
  await page.locator("#save-exit").click();
  await expect(page.locator("#pause-status")).toContainText(
    "Saving unavailable",
  );
  await expect(page.locator("#pause-dialog")).toBeVisible();
});

test("mobile shop action tray stays inside its scrollable panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.evaluate(() => {
    moveNear(ODNDSTORE, true);
    paint();
  });
  await page.keyboard.press("e");
  await expect(page.locator("#engine-modal")).toBeVisible();
  expect(
    await page
      .locator("#interaction")
      .evaluate((e) => e.parentElement.classList.contains("terminal-card")),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile-shop.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#engine-modal")).toBeHidden();
});

test("dragging or pinching the world never issues a movement command", async ({
  page,
}) => {
  await start(page);
  const before = (await snap(page)).moves;
  await page.mouse.move(750, 500);
  await page.mouse.down();
  await page.mouse.move(820, 550, { steps: 4 });
  await page.mouse.move(750, 500, { steps: 4 });
  await page.mouse.up();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: 700, y: 500, id: 1 },
      { x: 800, y: 500, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 730, y: 500, id: 1 },
      { x: 820, y: 500, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  expect((await snap(page)).moves).toBe(before);
});

test("quality switching, WebGL loss and restoration preserve gameplay", async ({
  page,
}) => {
  test.setTimeout(90000);
  await start(page);
  await page.locator("#pause").click();
  await page.locator("#graphics-quality").selectOption("cinematic");
  expect(await page.evaluate(() => ularnGraphics.metrics().quality)).toBe(
    "cinematic",
  );
  await page.locator("#resume-game").click();
  await page.screenshot({ path: "test-results/cinematic-town.png" });
  await page.evaluate(() => {
    const gl = document.querySelector("#world canvas").getContext("webgl2");
    window.lossExtension = gl.getExtension("WEBGL_lose_context");
    lossExtension.loseContext();
  });
  await expect(page.locator("#graphics-status")).toBeVisible();
  const before = await snap(page);
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => ularn.key("."));
  expect((await snap(page)).moves).toBe(before.moves);
  await page.evaluate(() => lossExtension.restoreContext());
  await expect(page.locator("#graphics-status")).toBeHidden({ timeout: 20000 });
  await page.keyboard.press(".");
  expect((await snap(page)).moves).toBeGreaterThan(before.moves);
  expect(await page.evaluate(() => ularnGraphics.metrics().contextLost)).toBe(
    false,
  );
});

test("all creature and item models render; level changes release GPU resources", async ({
  page,
}) => {
  test.setTimeout(90000);
  await start(page);
  await page.evaluate(() => {
    newcavelevel(20);
    player.x = 33;
    player.y = 8;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setItem(x, y, OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    for (let id = 1; id < monsterlist.length; id++) {
      if (!monsterlist[id]) continue;
      const x = 2 + (id % 60),
        y = 2 + Math.floor(id / 60);
      setMonster(x, y, createMonster(id));
    }
    for (let id = 1; id < itemlist.length; id++) {
      if (!itemlist[id]) continue;
      setItem(2 + (id % 60), 6 + Math.floor(id / 60), createObject(id));
    }
    paint();
  });
  await page.screenshot({ path: "test-results/volcano-models.png" });
  async function cycle() {
    await page.evaluate(() => {
      for (const l of [0, 1, 16, 20]) {
        newcavelevel(l);
        paint();
      }
    });
    await page.waitForTimeout(200);
    return page.evaluate(() => ularnGraphics.metrics());
  }
  await cycle();
  const before = await cycle();
  const after = await cycle();
  expect(after.geometries).toBeLessThanOrEqual(before.geometries + 5);
  expect(after.textures).toBeLessThanOrEqual(before.textures + 2);
});

test("clicking a building roof selects that building rather than the floor behind it", async ({
  page,
}) => {
  await start(page);
  const tile = await page.evaluate(() => {
    const home = ularn.snapshot().tiles.find((t) => t.id === 69);
    player.x = home.x;
    player.y = home.y + 3;
    if (player.y > 15) player.y = home.y - 3;
    paint();
    return home;
  });
  await page.locator("#camera-reset").click();
  const s = await snap(page);
  // Project the front roof into the viewport using the documented reset camera.
  const offset = [2.8, 15.5, 8.5],
    [ox, oy, oz] = offset,
    length = Math.hypot(...offset),
    horizontal = Math.hypot(ox, oz);
  const relative = [tile.x - s.x - ox, 1.6 - oy, tile.y + 0.5 - s.y - oz];
  const dot = (a, b) => a.reduce((v, n, i) => v + n * b[i], 0);
  const depth = -dot(
    relative,
    offset.map((n) => n / length),
  );
  const right = [oz / horizontal, 0, -ox / horizontal];
  const up = [
    (-ox * oy) / (horizontal * length),
    horizontal / length,
    (-oz * oy) / (horizontal * length),
  ];
  const scale = 1000 / (2 * Math.tan((37 * Math.PI) / 360));
  const point = {
    x: 720 + (dot(relative, right) / depth) * scale,
    y: 500 - (dot(relative, up) / depth) * scale,
  };
  await page.mouse.move(point.x, point.y);
  await expect(page.locator("#tile-label")).toContainText(/home/i);
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => [(await snap(page)).x, (await snap(page)).y])
    .toEqual([tile.x, tile.y]);
});

test("travel also stops for damage after regeneration raises health", async ({
  page,
}) => {
  await start(page);
  const initial = await page.evaluate(() => {
    player.x = 10;
    player.y = 8;
    player.HP = 50;
    player.HPMAX = 100;
    for (let x = 5; x < 22; x++)
      for (let y = 3; y < 14; y++) {
        setItem(x, y, OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    paint();
    let steps = 0;
    const key = ularn.key;
    ularn.key = function (...args) {
      key.apply(this, args);
      player.HP = ++steps === 1 ? 60 : 59;
      paint();
    };
    return player.MOVESMADE;
  });
  await mapClick(page, 18, 8);
  await expect(page.locator("#toast")).toContainText("hurt");
  await page.waitForTimeout(400);
  expect((await snap(page)).moves).toBe(initial + 2);
});
