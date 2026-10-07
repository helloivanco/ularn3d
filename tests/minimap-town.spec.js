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

test("the compact map follows the player and Expand shows the entire floor", async ({ page }) => {
  await start(page);
  const town = await page.evaluate(mapView);
  expect(town.overflow === "visible" || town.overflow === "hidden").toBeTruthy();
  expect(town.cols).toBeGreaterThanOrEqual(18);
  expect(town.rows).toBe(13);
  expect(town.cell).toBeGreaterThanOrEqual(11);
  const afterWalk = await page.evaluate(() => {
    const origin = { x: player.x, y: player.y };
    ularn.key("l");
    ularn.key("j");
    ularn.key("l");
    paint();
    const map = document.getElementById("minimap");
    return {
      moved: player.x !== origin.x || player.y !== origin.y,
      x0: +map.dataset.x0,
      y0: +map.dataset.y0,
      cols: +map.dataset.cols,
      rows: +map.dataset.rows,
    };
  });
  expect(afterWalk.moved).toBe(true);
  expect(afterWalk).toMatchObject({
    cols: town.cols,
    rows: town.rows,
  });

  const dungeon = await page.evaluate(() => {
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) setKnow(x, y, KNOWALL);
    newcavelevel(2);
    player.x = 6;
    player.y = 6;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) setKnow(x, y, KNOWALL);
    paint();
    const map = document.getElementById("minimap");
    const first = {
      x0: +map.dataset.x0,
      y0: +map.dataset.y0,
      cols: +map.dataset.cols,
      rows: +map.dataset.rows,
      cell: map.getBoundingClientRect().width / +map.dataset.cols,
    };
    player.x = MAXX - 4;
    player.y = MAXY - 4;
    paint();
    return {
      first,
      after: {
        x0: +map.dataset.x0,
        y0: +map.dataset.y0,
        cols: +map.dataset.cols,
        rows: +map.dataset.rows,
      },
      size: { width: MAXX, height: MAXY },
    };
  });
  expect(dungeon.first.cols).toBeLessThan(dungeon.size.width);
  expect(dungeon.first.rows).toBeLessThan(dungeon.size.height);
  expect(dungeon.first.cell).toBeGreaterThanOrEqual(11);
  expect(dungeon.after.x0).toBeGreaterThan(dungeon.first.x0);
  expect(dungeon.after.y0).toBeGreaterThan(dungeon.first.y0);
  await page.locator("#map-expand").click();
  const expanded = await page.locator("#expanded-map").evaluate(map => ({
    x0: +map.dataset.x0, y0: +map.dataset.y0, cols: +map.dataset.cols, rows: +map.dataset.rows,
  }));
  expect(expanded).toEqual({ x0: 0, y0: 0, cols: dungeon.size.width, rows: dungeon.size.height });

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
