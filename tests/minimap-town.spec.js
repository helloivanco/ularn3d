import { test, expect } from "@playwright/test";

async function start(page) {
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
}

const mapView = () => {
  const map = document.getElementById("minimap");
  const box = map.getBoundingClientRect();
  const style = getComputedStyle(map.closest(".map-panel"));
  return {
    x0: +map.dataset.x0,
    y0: +map.dataset.y0,
    cols: +map.dataset.cols,
    rows: +map.dataset.rows,
    width: box.width,
    height: box.height,
    cell: box.width / +map.dataset.cols,
    overflow: style.overflow,
    player: { x: player.x, y: player.y, level },
    floor: { width: MAXX, height: MAXY },
  };
};

test("the compact map shows the whole floor and stays put while the player moves", async ({ page }) => {
  await start(page);
  const town = await page.evaluate(mapView);
  expect(town.overflow === "visible" || town.overflow === "hidden").toBeTruthy();
  expect(town).toMatchObject({ x0: 0, y0: 0, cols: town.floor.width, rows: town.floor.height });
  // Square tiles: the canvas takes the floor's own shape.
  expect(Math.abs(town.height - town.width * town.floor.height / town.floor.width)).toBeLessThan(2);
  expect(town.width).toBeGreaterThan(280);

  const dungeon = await page.evaluate(() => {
    newcavelevel(2);
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) setKnow(x, y, KNOWALL);
    const map = document.getElementById("minimap");
    const view = () => {
      const cell = map.width / +map.dataset.columns, rows = map.height / +map.dataset.rows;
      const [r, g, b] = map.getContext("2d").getImageData(Math.round((player.x + .5) * cell), Math.round((player.y + .5) * rows), 1, 1).data;
      return { x0: +map.dataset.x0, y0: +map.dataset.y0, cols: +map.dataset.cols, rows: +map.dataset.rows,
        size: [map.width, map.height], marker: [r, g, b], at: [player.x, player.y] };
    };
    player.x = 6; player.y = 6; paint();
    const first = view();
    player.x = MAXX - 4; player.y = MAXY - 4; paint();
    return { first, after: view(), size: { width: MAXX, height: MAXY } };
  });
  // The frame never scrolls or recenters: the gold marker moves across it.
  expect(dungeon.first).toMatchObject({ x0: 0, y0: 0, cols: dungeon.size.width, rows: dungeon.size.height });
  expect(dungeon.after).toMatchObject({ x0: 0, y0: 0, cols: dungeon.size.width, rows: dungeon.size.height, size: dungeon.first.size });
  expect(dungeon.first.marker).toEqual([244, 214, 146]);
  expect(dungeon.after.marker).toEqual([244, 214, 146]);
  await page.locator("#map-expand").click();
  const expanded = await page.locator("#expanded-map").evaluate(map => ({
    x0: +map.dataset.x0, y0: +map.dataset.y0, cols: +map.dataset.cols, rows: +map.dataset.rows,
  }));
  expect(expanded).toEqual({ x0: 0, y0: 0, cols: dungeon.size.width, rows: dungeon.size.height });
});

test("found stairs point the way from the player: green up, red down", async ({ page }) => {
  await start(page);
  const compass = await page.evaluate(() => {
    newcavelevel(2);
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setItem(x, y, x < 4 || x > 22 || y < 3 || y > 15 ? OWALL : OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    setItem(18, 8, OSTAIRSUP);
    setItem(10, 14, OSTAIRSDOWN);
    setKnow(18, 8, 0);
    setKnow(10, 14, 0);
    player.x = 10; player.y = 8; paint();
    const map = document.getElementById("minimap");
    const read = () => JSON.parse(map.dataset.compass);
    // A pixel on an arrow's shaft, just past the player's marker.
    const along = (degrees) => {
      const cell = map.width / +map.dataset.columns, unit = Math.min(2, devicePixelRatio || 1);
      const radius = Math.max(cell * .85, 3.5 * unit), reach = radius + 6 * unit, angle = degrees * Math.PI / 180;
      const x = (player.x + .5) * cell + Math.cos(angle) * reach, y = (player.y + .5) * map.height / +map.dataset.rows + Math.sin(angle) * reach;
      return [...map.getContext("2d").getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
    };
    const unseen = read();
    setKnow(18, 8, KNOWALL); paint();
    const upOnly = read(), upShaft = along(0);
    setKnow(10, 14, KNOWALL); paint();
    const both = read(), downShaft = along(90);
    // Walk past the stairs: the arrows turn to keep pointing at them.
    player.x = 20; player.y = 12; paint();
    const moved = read(), movedUp = along(moved[0].angle);
    return { unseen, upOnly, upShaft, both, downShaft, moved, movedUp };
  });
  expect(compass.unseen).toEqual([]);
  expect(compass.upOnly).toEqual([{ direction: "up", x: 18, y: 8, angle: 0 }]);
  expect(compass.upShaft).toEqual([110, 207, 122]);
  expect(compass.both).toEqual([{ direction: "up", x: 18, y: 8, angle: 0 }, { direction: "down", x: 10, y: 14, angle: 90 }]);
  expect(compass.downShaft).toEqual([224, 112, 112]);
  expect(compass.moved).toEqual([{ direction: "up", x: 18, y: 8, angle: -117 }, { direction: "down", x: 10, y: 14, angle: 169 }]);
  expect(compass.movedUp).toEqual([110, 207, 122]);
});

test("the D1 town exit is reachable and returns the player to town every time", async ({ page }) => {
  await start(page);
  const trials = await page.evaluate(() => {
    const walk = (sx, sy, tx, ty) => {
      const open = (x, y) => {
        if (!inBounds(x, y)) return false;
        const item = itemAt(x, y);
        return item && !item.matches(OWALL) && !item.matches(OCLOSEDDOOR);
      };
      const seen = new Set([`${sx},${sy}`]);
      const q = [[sx, sy]];
      while (q.length) {
        const [x, y] = q.shift();
        if (x === tx && y === ty) return true;
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const nx = x + dx,
            ny = y + dy,
            key = `${nx},${ny}`;
          if (seen.has(key) || !open(nx, ny)) continue;
          seen.add(key);
          q.push([nx, ny]);
        }
      }
      return false;
    };

    const results = [];
    for (let trial = 0; trial < 8; trial++) {
      LEVELS[1] = null;
      moveNear(OENTRANCE, true);
      dungeon();
      const exit = findItemXY(OHOMEENTRANCE);
      const spawn = { x: player.x, y: player.y, level };
      const connected = !!(exit && walk(player.x, player.y, exit.x, exit.y));
      const approach = exit && inBounds(exit.x, exit.y - 1) && !itemAt(exit.x, exit.y - 1).matches(OWALL);
      if (exit && approach) {
        player.x = exit.x;
        player.y = exit.y - 1;
        setMonster(exit.x, exit.y, null);
        setMonster(player.x, player.y, null);
        ularn.key("j");
      }
      const b = townBounds();
      results.push({
        trial,
        spawn,
        exit,
        connected,
        approach,
        after: {
          level,
          x: player.x,
          y: player.y,
          inTown: inTown(player.x, player.y),
          plaza: b,
        },
      });
    }
    return results;
  });

  expect(trials).toHaveLength(8);
  for (const trial of trials) {
    expect(trial.exit, `trial ${trial.trial} missing home exit`).toBeTruthy();
    expect(trial.spawn.level).toBe(1);
    expect(trial.connected, `trial ${trial.trial} exit unreachable from ${trial.spawn.x},${trial.spawn.y}`).toBe(true);
    expect(trial.after.level).toBe(0);
    expect(trial.after.inTown).toBe(true);
  }
});

test("walking back to town from D1 works a second time in the same expedition", async ({ page }) => {
  await start(page);
  const roundTrip = await page.evaluate(() => {
    const goHome = () => {
      const exit = findItemXY(OHOMEENTRANCE);
      player.x = exit.x;
      player.y = exit.y - 1;
      setMonster(exit.x, exit.y, null);
      setMonster(player.x, player.y, null);
      ularn.key("j");
      return { level, inTown: inTown(player.x, player.y), x: player.x, y: player.y };
    };
    moveNear(OENTRANCE, true);
    dungeon();
    const first = goHome();
    moveNear(OENTRANCE, true);
    dungeon();
    const second = goHome();
    return { first, second };
  });
  expect(roundTrip.first).toMatchObject({ level: 0, inTown: true });
  expect(roundTrip.second).toMatchObject({ level: 0, inTown: true });
});
