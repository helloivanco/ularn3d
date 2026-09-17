import { test, expect } from "@playwright/test";

async function start(page) {
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
}

test("gold is always auto-looted even when auto-loot is off", async ({ page }) => {
  await start(page);
  const result = await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setItem(x, y, x < 7 || x > 17 || y < 5 || y > 11 ? OWALL : OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    setMazeMode(true);
    ularn.setAutoLoot(false);
    const before = player.GOLD;
    setItem(11, 8, createGold(42));
    ularn.key("l");
    return {
      gold: player.GOLD,
      before,
      tile: itemAt(11, 8).id,
      empty: OEMPTY.id,
      autoLoot: ularn.snapshot().autoLoot,
    };
  });
  expect(result.autoLoot).toBe(false);
  expect(result.gold).toBe(result.before + 42);
  expect(result.tile).toBe(result.empty);
});

test("dungeon maps are more square at the same footprint and town is a smaller square", async ({ page }) => {
  await start(page);
  const shape = await page.evaluate(() => {
    const town = ularn.snapshot();
    const bounds = townBounds();
    const townTiles = town.tiles.filter((tile) => !tile.wall);
    const stores = town.tiles.filter((tile) => tile.store);
    newcavelevel(3);
    const dungeon = ularn.snapshot();
    return {
      maxx: MAXX,
      maxy: MAXY,
      area: MAXX * MAXY,
      town: { width: town.width, height: town.height, open: townTiles.length, stores: stores.length },
      bounds,
      dungeon: { width: dungeon.width, height: dungeon.height },
      storesInside: stores.every((tile) => tile.x >= bounds.x0 && tile.x <= bounds.x1 && tile.y >= bounds.y0 && tile.y <= bounds.y1),
    };
  });
  expect(shape.maxx).toBe(38);
  expect(shape.maxy).toBe(30);
  expect(shape.area).toBe(1140);
  expect(shape.maxx / shape.maxy).toBeLessThan(1.4);
  expect(shape.dungeon).toEqual({ width: 38, height: 30 });
  expect(shape.bounds.x1 - shape.bounds.x0 + 1).toBe(18);
  expect(shape.bounds.y1 - shape.bounds.y0 + 1).toBe(18);
  expect(shape.town.open).toBeLessThan(400);
  expect(shape.storesInside).toBe(true);
  expect(shape.town.stores).toBeGreaterThan(0);
});

test("character stats sit beside the journal and the map glyphs are large enough to read", async ({ page }) => {
  await start(page);
  await expect(page.locator("#attributes")).toBeVisible();
  await expect(page.locator("#attributes")).toContainText("STR");
  await expect(page.locator("#attributes")).toContainText("DEX");
  await expect(page.locator("#gold")).toBeVisible();
  const layout = await page.evaluate(() => {
    const stats = document.getElementById("attributes").getBoundingClientRect();
    const journal = document.querySelector(".journal").getBoundingClientRect();
    const map = document.getElementById("minimap");
    const box = map.getBoundingClientRect();
    return {
      statsVisible: stats.width > 80 && stats.height > 40,
      besideJournal: Math.abs(stats.top - journal.top) < 80 && stats.left >= journal.right - 8,
      cellWidth: box.width / ularn.snapshot().width,
      cellHeight: box.height / ularn.snapshot().height,
      canvas: { w: map.width, h: map.height },
    };
  });
  expect(layout.statsVisible).toBe(true);
  expect(layout.besideJournal).toBe(true);
  expect(layout.cellWidth).toBeGreaterThan(14);
  expect(layout.cellHeight).toBeGreaterThan(14);
  expect(layout.canvas.w).toBeGreaterThan(700);
  expect(layout.canvas.h).toBeGreaterThan(500);
});

test("camera angle is restored after a floor change", async ({ page }) => {
  await start(page);
  await page.locator("#rotate-left").click();
  await page.locator("#rotate-left").click();
  const turned = await page.evaluate(() => ularnGraphics.metrics().cameraOffset);
  await page.evaluate(() => {
    newcavelevel(1);
    paint();
  });
  const after = await page.evaluate(() => ularnGraphics.metrics().cameraOffset);
  expect(after.map((value) => Number(value.toFixed(3)))).toEqual(
    turned.map((value) => Number(value.toFixed(3))),
  );
});

test("book and scroll models carry a clear B and S", async ({ page }) => {
  await start(page);
  const letters = await page.evaluate(async () => {
    const { itemModel } = await import("/src/models.js");
    const book = itemModel({ id: 43, name: "a book", store: false, wall: false });
    const scroll = itemModel({ id: 41, name: "a magic scroll", store: false, wall: false });
    const maps = [];
    book.traverse((obj) => {
      if (obj.material?.map?.image) maps.push(obj.material.map.image);
    });
    scroll.traverse((obj) => {
      if (obj.material?.map?.image) maps.push(obj.material.map.image);
    });
    const read = (canvas) => {
      const ctx = canvas.getContext("2d");
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 420) ink++;
      return { ink, size: canvas.width };
    };
    return maps.map(read);
  });
  expect(letters.length).toBeGreaterThanOrEqual(2);
  expect(letters.every((letter) => letter.ink > 400 && letter.size >= 64)).toBe(true);
});
