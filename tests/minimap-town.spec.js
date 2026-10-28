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

test("charting a way says so once and lights the map in its arrow's color", async ({ page }) => {
  await start(page);
  const notices = () => page.locator(".notice", { hasText: "A way down found" });
  // Arriving: nothing is announced for what the floor already shows.
  await page.evaluate(() => {
    newcavelevel(2);
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setItem(x, y, x < 4 || x > 22 || y < 3 || y > 15 ? OWALL : OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    setItem(18, 8, OSTAIRSDOWN);
    setKnow(18, 8, 0);
    player.x = 10; player.y = 8; paint();
  });
  await expect(page.locator(".notice", { hasText: /A way (up|down) found/ })).toHaveCount(0);
  // Seeing the stairs: one notice, and the map panel glows red.
  await page.evaluate(() => { setKnow(18, 8, KNOWALL); paint(); });
  await expect(notices()).toHaveCount(1);
  await expect(notices()).toContainText("red arrow");
  await expect(page.locator(".map-panel")).toHaveClass(/way-found.*down|down.*way-found/);
  // Walking about the same floor does not repeat it.
  await page.evaluate(() => { player.x = 12; paint(); player.x = 10; paint(); });
  await expect(notices()).toHaveCount(1);
});

test("a real descent: arrows appear only once stairs are seen, and keep pointing at them", async ({ page }) => {
  test.setTimeout(150000);
  await start(page);
  // Every stop: the map holds still, each arrow belongs to a charted way and
  // points at it from the hero, and every charted way has its arrow.
  const check = () => page.evaluate(() => {
    const map = document.getElementById("minimap"), compass = JSON.parse(map.dataset.compass);
    const snap = ularn.snapshot(), problems = [];
    if (+map.dataset.x0 || +map.dataset.y0 || +map.dataset.columns !== MAXX || +map.dataset.rows !== MAXY) problems.push("map moved");
    const ways = { up: [5, 56, 93], down: [13, 54] };
    for (const arrow of compass) {
      const tile = snap.tiles.find((t) => t.x === arrow.x && t.y === arrow.y);
      if (!tile || !(getKnow(arrow.x, arrow.y) & HAVESEEN)) problems.push(`${arrow.direction} arrow to an unseen tile`);
      if (!ways[arrow.direction].includes(tile?.id)) problems.push(`${arrow.direction} arrow to a non-exit`);
      const want = Math.round(Math.atan2(arrow.y - player.y, arrow.x - player.x) * 180 / Math.PI);
      if (arrow.angle !== want) problems.push(`${arrow.direction} arrow at ${arrow.angle}, not ${want}`);
    }
    for (const [direction, ids] of Object.entries(ways)) {
      const charted = snap.tiles.some((t) => ids.includes(t.id) && !t.stair?.blocked && (t.x !== player.x || t.y !== player.y));
      if (charted !== compass.some((arrow) => arrow.direction === direction)) problems.push(`${direction}: charted ${charted}, arrow ${!charted}`);
    }
    return { level, at: [player.x, player.y], arrows: compass.map((a) => a.direction).sort().join(","), problems };
  });
  // Exploring stops for creatures and never opens doors, so keep the way clear.
  const calm = () => page.evaluate(() => {
    player.HP = player.HPMAX = 2000;
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) {
      if (monsterAt(x, y) && Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) <= 6) setMonster(x, y, null);
      if (itemAt(x, y).matches(OCLOSEDDOOR)) setItem(x, y, createObject(OOPENDOOR));
    }
  });
  const explore = async (until) => {
    const seen = [];
    for (let i = 0; i < 40; i++) {
      await calm();
      await page.locator("#explore").click();
      await expect.poll(() => page.evaluate(() => !activeExplorer), { timeout: 20000 }).toBe(true);
      const view = await check();
      expect(view.problems, JSON.stringify(view)).toEqual([]);
      seen.push(view);
      if (until(view)) break;
    }
    return seen;
  };

  // Into the caves through the entrance: the red arrow already points there in town.
  expect((await check()).arrows).toBe("down");
  await page.keyboard.press(">");
  await expect.poll(() => page.evaluate(() => itemAt(player.x, player.y).matches(OENTRANCE))).toBe(true);
  await page.keyboard.press(">");
  await expect.poll(() => page.evaluate(() => level)).toBe(1);
  const arrival = await check();
  expect(arrival.problems).toEqual([]);
  const depth1 = await explore((view) => view.arrows.includes("down"));
  expect(depth1.at(-1).arrows).toContain("down");

  // A new floor: nothing is charted on arrival, so no arrows until exploring finds a way.
  await calm();
  await page.evaluate(() => { const down = ularn.snapshot().tiles.find((t) => t.id === 13); player.x = down.x; player.y = down.y; paint(); });
  await page.keyboard.press(">");
  await expect.poll(() => page.evaluate(() => level)).toBe(2);
  const fresh = await check();
  expect(fresh.problems).toEqual([]);
  const charted = await page.evaluate(() => ularn.snapshot().tiles.filter((t) => [5, 13].includes(t.id)).length);
  if (!charted) expect(fresh.arrows).toBe("");
  const depth2 = await explore((view) => view.arrows === "down,up");
  expect(depth2.some((view) => view.arrows)).toBe(true);
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
