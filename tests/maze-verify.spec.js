import { test, expect } from "@playwright/test";

test("stairs stay on the walkable maze graph; no orphan doors; classic density", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);

  const report = await page.evaluate(() => {
    const isDoor = (it) => it && (it.matches(OCLOSEDDOOR) || it.matches(OOPENDOOR));
    const isFloorish = (x, y) => {
      if (x < 0 || y < 0 || x >= MAXX || y >= MAXY) return false;
      const it = itemAt(x, y);
      return it && !it.matches(OWALL) && !isDoor(it);
    };
    const networkPassable = (x, y) => {
      if (!inBounds(x, y)) return false;
      const it = itemAt(x, y);
      return it && !it.matches(OWALL);
    };
    const largest = () => {
      let best = new Set();
      const claimed = new Set();
      for (let y = 0; y < MAXY; y++) {
        for (let x = 0; x < MAXX; x++) {
          const key = `${x},${y}`;
          if (claimed.has(key) || !networkPassable(x, y)) continue;
          const comp = new Set();
          const q = [[x, y]];
          comp.add(key);
          claimed.add(key);
          while (q.length) {
            const [cx, cy] = q.shift();
            for (const [dx, dy] of [
              [0, 1],
              [0, -1],
              [1, 0],
              [-1, 0],
            ]) {
              const nx = cx + dx,
                ny = cy + dy,
                nk = `${nx},${ny}`;
              if (claimed.has(nk) || !networkPassable(nx, ny)) continue;
              claimed.add(nk);
              comp.add(nk);
              q.push([nx, ny]);
            }
          }
          if (comp.size > best.size) best = comp;
        }
      }
      return best;
    };
    const onMain = (what, main) => {
      const at = findItemXY(what);
      return !!(at && main.has(`${at.x},${at.y}`));
    };
    const analyze = (depth, label) => {
      LEVELS[depth] = null;
      newcavelevel(depth);
      const main = largest();
      let walls = 0,
        open = 0,
        doors = 0,
        orphanDoors = 0,
        gold = 0,
        groundLoot = 0;
      for (let y = 0; y < MAXY; y++) {
        for (let x = 0; x < MAXX; x++) {
          const it = itemAt(x, y);
          if (it.matches(OWALL)) walls++;
          else open++;
          if (isDoor(it)) {
            doors++;
            if (
              !(isFloorish(x - 1, y) && isFloorish(x + 1, y)) &&
              !(isFloorish(x, y - 1) && isFloorish(x, y + 1))
            )
              orphanDoors++;
          }
          if (it.matches(OGOLDPILE)) gold++;
          if (
            !it.matches(OEMPTY) &&
            !it.matches(OWALL) &&
            !isDoor(it) &&
            !it.matches(OSTAIRSUP) &&
            !it.matches(OSTAIRSDOWN) &&
            !it.matches(OHOMEENTRANCE) &&
            !it.matches(OPIT) &&
            !it.matches(OIVTRAPDOOR) &&
            !it.matches(OTRAPARROWIV) &&
            !it.matches(OIVDARTRAP) &&
            !it.matches(OIVTELETRAP) &&
            !it.matches(OALTAR) &&
            !it.matches(OSTATUE) &&
            !it.matches(OFOUNTAIN) &&
            !it.matches(OTHRONE) &&
            !it.matches(OMIRROR) &&
            !it.matches(OELEVATORUP) &&
            !it.matches(OELEVATORDOWN) &&
            !it.matches(OBANK2) &&
            !it.matches(OVOLUP)
          ) {
            groundLoot++;
          }
        }
      }
      const needDown = depth > 0 && depth != DBOTTOM && depth != VBOTTOM;
      const needUp =
        depth > 1 && (ULARN && depth == MAXLEVEL ? true : depth != MAXLEVEL);
      const home = depth === 1 ? findItemXY(OHOMEENTRANCE) : null;
      return {
        label,
        depth,
        walls,
        open,
        doors,
        orphanDoors,
        gold,
        groundLoot,
        wallPct: Math.round((100 * walls) / (MAXX * MAXY)),
        mainSize: main.size,
        downOnMain: needDown ? onMain(OSTAIRSDOWN, main) : true,
        upOnMain: needUp ? onMain(OSTAIRSUP, main) : true,
        hasDown: needDown ? !!findItemXY(OSTAIRSDOWN) : true,
        hasUp: needUp ? !!findItemXY(OSTAIRSUP) : true,
        hasHome: depth === 1 ? !!home : true,
        homeApproachOk:
          depth !== 1
            ? true
            : !!(
                home &&
                inBounds(home.x, home.y - 1) &&
                !itemAt(home.x, home.y - 1).matches(OWALL) &&
                (main.has(`${home.x},${home.y - 1}`) ||
                  main.has(`${home.x},${home.y}`))
              ),
        traversalOk: levelTraversalOk(depth),
      };
    };

    const rows = [];
    for (const d of [1, 2, 3, 5, 7, 10, 12, 15]) rows.push(analyze(d, "d" + d));
    for (let i = 0; i < 8; i++) {
      LEVELS[7] = null;
      for (let k = 0; k < 40 * (i + 1); k++) rnd(97);
      rows.push(analyze(7, "d7r" + i));
    }

    /* Rock-enclosed stairs regression: force a bad pocket then ensure harden clears it. */
    LEVELS[4] = null;
    newcavelevel(4);
    /* Carve a sealed 3×3 pocket and plant down stairs inside it. */
    for (let y = 2; y <= 4; y++)
      for (let x = 2; x <= 4; x++) setItem(x, y, OEMPTY);
    for (let y = 1; y <= 5; y++) {
      setItem(1, y, OWALL);
      setItem(5, y, OWALL);
    }
    for (let x = 1; x <= 5; x++) {
      setItem(x, 1, OWALL);
      setItem(x, 5, OWALL);
    }
    const oldDown = findItemXY(OSTAIRSDOWN);
    if (oldDown) setItem(oldDown.x, oldDown.y, OEMPTY);
    setItem(3, 3, OSTAIRSDOWN);
    const before = largest().has("3,3");
    ensureMazeConnectivity();
    ensureLevelStairs(4);
    const afterMain = largest();
    const afterDown = findItemXY(OSTAIRSDOWN);
    const pocketFixed = !!(
      afterDown &&
      afterMain.has(`${afterDown.x},${afterDown.y}`) &&
      levelTraversalOk(4)
    );

    return { rows, pocket: { beforeOnMain: before, fixed: pocketFixed, afterDown } };
  });

  for (const r of report.rows) {
    expect(r.orphanDoors, JSON.stringify(r)).toBe(0);
    expect(r.open).toBeGreaterThan(200);
    expect(r.open).toBeLessThan(900);
    expect(r.wallPct).toBeGreaterThan(35);
    expect(r.groundLoot, JSON.stringify(r)).toBeLessThan(70);
    expect(r.groundLoot, JSON.stringify(r)).toBeGreaterThan(10);
    expect(r.hasDown, JSON.stringify(r)).toBe(true);
    expect(r.hasUp, JSON.stringify(r)).toBe(true);
    expect(r.downOnMain, JSON.stringify(r)).toBe(true);
    expect(r.upOnMain, JSON.stringify(r)).toBe(true);
    expect(r.traversalOk, JSON.stringify(r)).toBe(true);
    if (r.depth === 1) {
      expect(r.hasHome).toBe(true);
      expect(r.homeApproachOk, JSON.stringify(r)).toBe(true);
    }
  }
  expect(report.pocket.beforeOnMain).toBe(false);
  expect(report.pocket.fixed, JSON.stringify(report.pocket)).toBe(true);
  expect(errors).toEqual([]);
});

test("adventurer name persists across a new expedition on this device", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.heroName", "Ivan Persist");
  });
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("#hero-name")).toHaveValue("Ivan Persist");
  await page.locator("#hero-name").fill("Cave Walker");
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  const stored = await page.evaluate(() => localStorage.getItem("ularn3d.heroName"));
  expect(stored).toBe("Cave Walker");
});
