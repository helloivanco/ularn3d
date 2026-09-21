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

test("dungeon maps are square at the same footprint and town is a smaller square", async ({ page }) => {
  await start(page);
  await page.screenshot({ path: "test-results/town_square_map.png" });
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
  expect(shape.maxx).toBe(34);
  expect(shape.maxy).toBe(34);
  expect(shape.area).toBe(1156);
  expect(shape.maxx / shape.maxy).toBe(1);
  expect(shape.dungeon).toEqual({ width: 34, height: 34 });
  expect(shape.bounds.x1 - shape.bounds.x0 + 1).toBe(18);
  expect(shape.bounds.y1 - shape.bounds.y0 + 1).toBe(18);
  expect(shape.town.open).toBeLessThan(400);
  expect(shape.storesInside).toBe(true);
  expect(shape.town.stores).toBeGreaterThan(0);
});

test("character stats sit beside the adventurer frame and the map shows the whole floor", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    setItem(player.x + 1, player.y, createObject(OBOOK, 1));
    setItem(player.x + 1, player.y + 1, createObject(OSCROLL, 0));
    paint();
  });
  await page.waitForTimeout(400);
  await expect(page.locator("#attributes")).toBeVisible();
  await expect(page.locator("#attributes")).toHaveText(/STR=\d+\s+INT=\d+\s+WIS=\d+\s+CON=\d+\s+DEX=\d+/);
  await expect(page.locator("#gold")).toBeVisible();
  const layout = await page.evaluate(() => {
    const stats = document.getElementById("attributes").getBoundingClientRect();
    const hero = document.querySelector(".hero-panel").getBoundingClientRect();
    const journal = document.querySelector(".journal").getBoundingClientRect();
    const map = document.getElementById("minimap");
    const box = map.getBoundingClientRect();
    const cols = +map.dataset.cols;
    const rows = +map.dataset.rows;
    return {
      statsVisible: stats.width > 80 && stats.height > 20,
      labels: document.getElementById("attributes").innerText.replace(/\s+/g, " ").trim(),
      besideHero: Math.abs(stats.top - hero.top) < 80 && stats.left >= hero.right - 12,
      journalMoved: journal.left >= stats.right - 8,
      cellWidth: box.width / cols,
      cellHeight: box.height / rows,
      boxWidth: box.width,
      canvas: { w: map.width, h: map.height },
      cols,
      mapWidth: ularn.snapshot().width,
    };
  });
  expect(layout.statsVisible).toBe(true);
  expect(layout.labels).toMatch(/^STR=\d+ INT=\d+ WIS=\d+ CON=\d+ DEX=\d+$/);
  expect(layout.besideHero).toBe(true);
  expect(layout.journalMoved).toBe(true);
  expect(layout.cellWidth).toBeGreaterThanOrEqual(12);
  expect(layout.cellHeight).toBeGreaterThanOrEqual(12);
  expect(layout.boxWidth).toBeGreaterThan(240);
  expect(layout.boxWidth).toBeLessThan(520);
  expect(layout.cols).toBeGreaterThanOrEqual(18);
  await page.screenshot({ path: "test-results/hud_stats_beside_hero.png" });
});

test("camera angle is retained on cave entry and floor transitions", async ({ page }) => {
  await start(page);
  await page.locator("#rotate-left").click();
  await page.locator("#rotate-left").click();
  const turned = await page.evaluate(() => ularnGraphics.metrics().cameraOffset);
  await page.evaluate(() => {
    moveNear(OENTRANCE, true);
    dungeon();
    paint();
  });
  const cave = await page.evaluate(() => ({
    level: ularn.snapshot().level,
    offset: ularnGraphics.metrics().cameraOffset,
  }));
  expect(cave.level).toBe(1);
  cave.offset.forEach((value, index) => expect(Math.abs(value - turned[index])).toBeLessThan(0.05));
  await page.evaluate(() => {
    newcavelevel(2);
    paint();
  });
  const nextFloor = await page.evaluate(() => ularnGraphics.metrics().cameraOffset);
  nextFloor.forEach((value, index) => expect(Math.abs(value - turned[index])).toBeLessThan(0.05));
  await page.screenshot({ path: "test-results/dungeon_camera_after_floor_change.png" });
});

test("walking over a shrine never summons a Demon Prince; damaging it can", async ({ page }) => {
  await start(page);
  const walked = await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 1000;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setItem(x, y, x < 7 || x > 17 || y < 5 || y > 11 ? OWALL : OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    setItem(11, 8, OALTAR);
    setMazeMode(true);
    const originalRnd = rnd;
    rnd = (limit) => (limit === 100 ? 1 : originalRnd(limit));
    const princes = [];
    for (let i = 0; i < 8; i++) {
      ularn.key("l");
      ularn.key("h");
      for (let x = 0; x < MAXX; x++)
        for (let y = 0; y < MAXY; y++) {
          const monster = monsterAt(x, y);
          if (monster?.matches(DEMONPRINCE)) princes.push({ x, y, i });
        }
    }
    rnd = originalRnd;
    return {
      princes,
      onAltar: itemAt(11, 8).matches(OALTAR),
      gold: player.GOLD,
    };
  });
  expect(walked.princes).toEqual([]);
  expect(walked.onAltar).toBe(true);

  const damaged = await page.evaluate(() => {
    player.x = 10;
    player.y = 8;
    player.INTELLIGENCE = 30;
    player.LEVEL = 20;
    player.SPELLS = player.SPELLMAX = 40;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) setMonster(x, y, null);
    setItem(11, 8, OALTAR);
    learnSpell("vpr");
    const originalRnd = rnd;
    rnd = () => 1;
    ularn.key("c");
    ularn.key("v");
    ularn.key("p");
    ularn.key("r");
    rnd = originalRnd;
    const found = [];
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        const monster = monsterAt(x, y);
        if (monster?.matches(DEMONPRINCE)) found.push({ x, y });
      }
    return { found, altar: itemAt(11, 8).matches(OALTAR) };
  });
  expect(damaged.found.length).toBeGreaterThan(0);
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
