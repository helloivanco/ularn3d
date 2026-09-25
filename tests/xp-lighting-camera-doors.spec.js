/**
 * Door corridor orientation, constant dungeon lighting, north camera start.
 */
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
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

test("corridor doors orient to block travel along the hall", async ({ page }) => {
  const facings = await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setMonster(x, y, null);
        setItem(x, y, OWALL);
        setKnow(x, y, KNOWALL);
      }
    for (let y = 5; y <= 11; y++) setItem(10, y, OEMPTY);
    setItem(10, 8, OCLOSEDDOOR);
    for (let x = 13; x <= 19; x++) setItem(x, 8, OEMPTY);
    setItem(16, 8, OCLOSEDDOOR);
    setMazeMode(true);
    paint();
    const snap = ularn.snapshot();
    const ns = snap.tiles.find((t) => t.x === 10 && t.y === 8);
    const ew = snap.tiles.find((t) => t.x === 16 && t.y === 8);
    return {
      nsFacing: ns?.doorFacing,
      ewFacing: ew?.doorFacing,
      nsId: ns?.id,
      ewId: ew?.id,
    };
  });
  expect(facings.nsId).toBe(20);
  expect(facings.ewId).toBe(20);
  expect(facings.nsFacing).toBe(0);
  expect(facings.ewFacing).toBeCloseTo(Math.PI / 2, 5);
});

test("closed corridor doors block keypad diagonal corner-cuts", async ({ page }) => {
  const result = await page.evaluate(() => {
    newcavelevel(1);
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setMonster(x, y, null);
        setItem(x, y, OWALL);
        setKnow(x, y, KNOWALL);
      }
    /* Open band around an E–W door so diagonal destinations are walkable;
       closedDoorBlocksDiagonal must still refuse the corner-cut. */
    for (let y = 7; y <= 9; y++)
      for (let x = 7; x <= 13; x++) setItem(x, y, OEMPTY);
    setItem(10, 8, createObject(OCLOSEDDOOR, 0));
    player.WTW = 0;
    player.x = 9;
    player.y = 8;
    const ne = moveplayer(5); /* NE → (10,7); orthogonal (10,8) is closed door */
    const afterNe = { x: player.x, y: player.y };
    const se = moveplayer(7); /* SE → (10,9); orthogonal (10,8) is closed door */
    const afterSe = { x: player.x, y: player.y };
    const eastClosed = moveplayer(2);
    const afterClosed = { x: player.x, y: player.y };
    setItem(10, 8, OOPENDOOR);
    moveplayer(2);
    return {
      ne,
      afterNe,
      se,
      afterSe,
      eastClosed,
      afterClosed,
      final: { x: player.x, y: player.y },
      blocksDiagonal: typeof closedDoorBlocksDiagonal === "function",
    };
  });
  expect(result.blocksDiagonal).toBe(true);
  expect(result.ne).toBe(0);
  expect(result.afterNe).toEqual({ x: 9, y: 8 });
  expect(result.se).toBe(0);
  expect(result.afterSe).toEqual({ x: 9, y: 8 });
  expect(result.eastClosed).toBe(0);
  expect(result.afterClosed).toEqual({ x: 9, y: 8 });
  expect(result.final).toEqual({ x: 10, y: 8 });
});

test("dungeon lighting is constant: unlit floors, no fog, no point lights", async ({ page }) => {
  const lit = await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setMonster(x, y, null);
        setItem(
          x,
          y,
          x === 0 || y === 0 || x === MAXX - 1 || y === MAXY - 1 ? OWALL : OEMPTY,
        );
        setKnow(x, y, KNOWALL);
      }
    paint();
    return ularnGraphics.metrics();
  });
  expect(lit.floorMaterial).toBe("MeshBasicMaterial");
  expect(lit.fogDensity).toBe(0);
  expect(lit.pointLights).toBe(0);
  expect(lit.playerLight).toBe(false);
  expect(lit.sun).toBe(0);
  expect(lit.sunVisible).toBe(false);
  expect(lit.ambient).toBeGreaterThanOrEqual(1.4);
});

test("camera starts north; zoom prefs survive beginExpeditionCamera", async ({ page }) => {
  const initial = await page.evaluate(() => ularnGraphics.metrics());
  expect(Math.abs(initial.cameraOffset[0])).toBeLessThan(0.05);
  expect(initial.cameraOffset[2]).toBeGreaterThan(0);
  expect(Math.abs(initial.cameraYaw)).toBeLessThan(2);

  await page.locator("#zoom-out").click();
  await page.locator("#zoom-out").click();
  const zoomed = await page.evaluate(() => {
    const m = ularnGraphics.metrics();
    return {
      radius: Math.hypot(m.cameraOffset[0], m.cameraOffset[2]),
      elevation: m.cameraOffset[1],
      stored: localStorage.getItem("ularn3d.camera"),
    };
  });
  expect(zoomed.radius).toBeGreaterThan(10);
  expect(zoomed.stored).toBeTruthy();
  const prefs = JSON.parse(zoomed.stored);
  expect(prefs.radius).toBeGreaterThan(10);

  await page.locator("#rotate-left").click();
  const turned = await page.evaluate(() => ularnGraphics.metrics());
  expect(Math.abs(turned.cameraOffset[0])).toBeGreaterThan(0.5);

  const afterReset = await page.evaluate(() => {
    ularnGraphics.beginExpeditionCamera();
    return ularnGraphics.metrics();
  });
  expect(Math.abs(afterReset.cameraOffset[0])).toBeLessThan(0.05);
  expect(afterReset.cameraOffset[2]).toBeGreaterThan(0);
  expect(Math.hypot(afterReset.cameraOffset[0], afterReset.cameraOffset[2])).toBeGreaterThan(10);
  expect(Math.abs(afterReset.cameraOffset[1] - prefs.elevation)).toBeLessThan(0.2);
});
