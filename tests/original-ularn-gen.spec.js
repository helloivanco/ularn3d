import { test, expect } from "@playwright/test";

test("original Ularn stairs, doors, and 100+ generated floors", async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);

  const report = await page.evaluate(() => {
    const isDoor = (it) => it && (it.matches(OCLOSEDDOOR) || it.matches(OOPENDOOR));
    const summary = {
      generated: 0,
      procedural: 0,
      canned: 0,
      proceduralDoorTiles: 0,
      unauthorizedDoors: 0,
      cannedDoors: 0,
      validTreasureDoors: 0,
      invalidTreasureDoors: 0,
      treasureRooms: 0,
      inaccessibleTreasureRooms: 0,
      corridorDoorsOnProcedural: 0,
      byDepth: {},
      problemCount: 0,
      problems: [],
    };
    const problems = [];
    const depths = [];
    for (let n = 0; n < 6; n++) {
      for (const d of [1, 2, 5, 8, 10, 11, 14, 15, 16, 17, 18, 19, 20]) depths.push(d);
    }
    for (let n = 0; n < 4; n++) {
      for (const d of [3, 4, 6, 7, 9, 12, 13]) depths.push(d);
    }

    for (const depth of depths) {
      LEVELS[depth] = null;
      newcavelevel(depth);
      summary.generated++;
      const canned = !!lastLevelCanned;
      if (canned) summary.canned++;
      else summary.procedural++;

      const bucket =
        summary.byDepth[depth] ||
        (summary.byDepth[depth] = {
          n: 0,
          down: 0,
          up: 0,
          home: 0,
          eye: 0,
          potion: 0,
          volup: 0,
          pit: 0,
          trap: 0,
          traversal: 0,
          proc: 0,
          canned: 0,
          doors: 0,
        });
      bucket.n++;
      if (canned) bucket.canned++;
      else bucket.proc++;
      if (findItemXY(OSTAIRSDOWN)) bucket.down++;
      if (findItemXY(OSTAIRSUP)) bucket.up++;
      if (findItemXY(OHOMEENTRANCE)) bucket.home++;
      if (findItemXY(OLARNEYE)) bucket.eye++;
      if (findItemXY(OPOTION, 21)) bucket.potion++;
      if (findItemXY(OVOLUP)) bucket.volup++;
      if (findItemXY(OPIT)) bucket.pit++;
      if (findItemXY(OIVTRAPDOOR)) bucket.trap++;
      if (levelTraversalOk(depth)) bucket.traversal++;

      let doorTiles = 0;
      for (let y = 0; y < MAXY; y++) {
        for (let x = 0; x < MAXX; x++) {
          if (!isDoor(itemAt(x, y))) continue;
          doorTiles++;
          const src = doorSources.get(`${x},${y}`);
          if (!src) {
            summary.unauthorizedDoors++;
            problems.push({ depth, x, y, why: "no-source" });
            continue;
          }
          if (src.source === "canned") {
            summary.cannedDoors++;
            if (!canned) problems.push({ depth, x, y, why: "canned-mark-on-procedural" });
          } else if (src.source === "treasure-room") {
            if (!treasureDoorOk(x, y, src.room)) {
              summary.invalidTreasureDoors++;
              problems.push({ depth, x, y, why: "bad-treasure-door" });
            } else summary.validTreasureDoors++;
            if (canned) problems.push({ depth, x, y, why: "treasure-door-on-canned" });
          } else {
            summary.unauthorizedDoors++;
            problems.push({ depth, x, y, why: `bad-source:${src.source}` });
          }
        }
      }
      bucket.doors += doorTiles;
      if (!canned) {
        summary.proceduralDoorTiles += doorTiles;
        for (let y = 0; y < MAXY; y++) {
          for (let x = 0; x < MAXX; x++) {
            if (!isDoor(itemAt(x, y))) continue;
            const src = doorSources.get(`${x},${y}`);
            if (!src || src.source !== "treasure-room") summary.corridorDoorsOnProcedural++;
          }
        }
      }
      summary.treasureRooms += treasureRooms.length;
      for (const room of treasureRooms) {
        if (!roomInteriorReachable(room)) {
          summary.inaccessibleTreasureRooms++;
          problems.push({ depth, why: "inaccessible-treasure-room" });
        }
      }

      const down = !!findItemXY(OSTAIRSDOWN);
      const up = !!findItemXY(OSTAIRSUP);
      if (depth === 1) {
        if (up) problems.push({ depth, why: "d1-has-up-stairs" });
        if (!down) problems.push({ depth, why: "d1-missing-down-stairs" });
        if (!findItemXY(OHOMEENTRANCE)) problems.push({ depth, why: "d1-missing-home" });
        if (canned) problems.push({ depth, why: "d1-was-canned" });
      }
      if (depth >= 2 && depth <= 14) {
        if (!down) problems.push({ depth, why: "missing-down" });
        if (!up) problems.push({ depth, why: "missing-up" });
      }
      if (depth === 15) {
        if (down) problems.push({ depth, why: "d15-has-down-stairs" });
        if (!up) problems.push({ depth, why: "d15-missing-deadend-up" });
        if (!findItemXY(OLARNEYE)) problems.push({ depth, why: "d15-missing-eye" });
      }
      if (depth === 16) {
        if (!findItemXY(OVOLUP)) problems.push({ depth, why: "v1-missing-shaft" });
        if (!up) problems.push({ depth, why: "v1-missing-deadend-up" });
        if (!down) problems.push({ depth, why: "v1-missing-down" });
      }
      if (depth >= 18) {
        if (!findItemXY(OPIT) || !findItemXY(OIVTRAPDOOR))
          problems.push({ depth, why: "missing-pit-or-trapdoor" });
      }
      if (depth === 20) {
        if (down) problems.push({ depth, why: "v5-has-down-stairs" });
        if (!findItemXY(OPOTION, 21)) problems.push({ depth, why: "v5-missing-cure" });
      }
      if (!levelTraversalOk(depth)) problems.push({ depth, why: "traversal-failed" });
    }

    summary.problemCount = problems.length;
    summary.problems = problems.slice(0, 12);
    return summary;
  });

  console.log(`ULARNGEN ${JSON.stringify(report)}`);
  expect(report.generated).toBeGreaterThanOrEqual(100);
  expect(report.procedural).toBeGreaterThan(0);
  expect(report.canned).toBeGreaterThan(0);
  expect(report.unauthorizedDoors).toBe(0);
  expect(report.invalidTreasureDoors).toBe(0);
  expect(report.inaccessibleTreasureRooms).toBe(0);
  expect(report.corridorDoorsOnProcedural).toBe(0);
  expect(report.problemCount).toBe(0);
  expect(report.byDepth[1].home).toBe(report.byDepth[1].n);
  expect(report.byDepth[1].up).toBe(0);
  expect(report.byDepth[1].down).toBe(report.byDepth[1].n);
  expect(report.byDepth[15].down).toBe(0);
  expect(report.byDepth[15].up).toBe(report.byDepth[15].n);
  expect(report.byDepth[15].eye).toBe(report.byDepth[15].n);
  expect(report.byDepth[16].volup).toBe(report.byDepth[16].n);
  expect(report.byDepth[20].down).toBe(0);
  expect(report.byDepth[20].potion).toBe(report.byDepth[20].n);
  expect(report.byDepth[20].pit).toBe(report.byDepth[20].n);
  expect(report.byDepth[20].trap).toBe(report.byDepth[20].n);
  expect(errors).toEqual([]);
});
