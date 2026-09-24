import { test, expect } from "@playwright/test";
test("maze floors are connected and loot is classic-scale", async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);

  const report = await page.evaluate(() => {
    const rows = [];
    const isDoor = (it) => it && (it.matches(OCLOSEDDOOR) || it.matches(OOPENDOOR));
    const isFloorish = (x, y) => {
      if (x < 0 || y < 0 || x >= MAXX || y >= MAXY) return false;
      const it = itemAt(x, y);
      return it && !it.matches(OWALL) && !isDoor(it);
    };
    const analyze = (depth, label) => {
      LEVELS[depth] = null;
      newcavelevel(depth);
      let walls = 0, open = 0, doors = 0, orphanDoors = 0, gold = 0, groundLoot = 0;
      for (let y = 0; y < MAXY; y++) {
        for (let x = 0; x < MAXX; x++) {
          const it = itemAt(x, y);
          if (it.matches(OWALL)) walls++;
          else open++;
          if (isDoor(it)) {
            doors++;
            if (!(isFloorish(x - 1, y) && isFloorish(x + 1, y)) &&
                !(isFloorish(x, y - 1) && isFloorish(x, y + 1))) orphanDoors++;
          }
          if (it.matches(OGOLDPILE)) gold++;
          if (!it.matches(OEMPTY) && !it.matches(OWALL) && !isDoor(it) &&
              !it.matches(OSTAIRSUP) && !it.matches(OSTAIRSDOWN) && !it.matches(OHOMEENTRANCE) &&
              !it.matches(OPIT) && !it.matches(OIVTRAPDOOR) && !it.matches(OTRAPARROWIV) &&
              !it.matches(OIVDARTRAP) && !it.matches(OIVTELETRAP) &&
              !it.matches(OALTAR) && !it.matches(OSTATUE) && !it.matches(OFOUNTAIN) &&
              !it.matches(OTHRONE) && !it.matches(OMIRROR) &&
              !it.matches(OELEVATORUP) && !it.matches(OELEVATORDOWN) &&
              !it.matches(OBANK2) && !it.matches(OVOLUP)) {
            groundLoot++;
          }
        }
      }
      rows.push({ label, depth, walls, open, doors, orphanDoors, gold, groundLoot,
        wallPct: Math.round(100 * walls / (MAXX * MAXY)) });
    };
    for (const d of [1, 2, 3, 5, 7, 10, 12, 15]) analyze(d, "d" + d);
    for (let i = 0; i < 6; i++) {
      LEVELS[7] = null;
      for (let k = 0; k < 40 * (i + 1); k++) rnd(97);
      analyze(7, "d7r" + i);
    }
    // portal consume
    LEVELS[1] = null; newcavelevel(1);
    player.x = 10; player.y = 8; setItem(10, 8, OEMPTY);
    read_scroll(createObject(OSCROLL, 24));
    const hadLink = !!townPortalLink;
    const txy = townPortalLink ? { x: townPortalLink.townX, y: townPortalLink.townY } : null;
    if (townPortalLink) {
      player.x = townPortalLink.townX; player.y = townPortalLink.townY;
      activateTownPortal();
    }
    return {
      rows,
      portal: {
        hadLink,
        linkGone: townPortalLink == null,
        level,
        dungeonClear: LEVELS[1]?.items[10][8]?.id !== 102,
        townClear: txy ? LEVELS[0]?.items[txy.x][txy.y]?.id !== 102 : true,
      },
    };
  });

  for (const r of report.rows) {
    expect(r.orphanDoors, JSON.stringify(r)).toBe(0);
    expect(r.open).toBeGreaterThan(250);
    expect(r.open).toBeLessThan(900);
    expect(r.wallPct).toBeGreaterThan(35);
    // Classic makeobject is roughly ~25–55 carryable/gold piles; allow headroom.
    expect(r.groundLoot, JSON.stringify(r)).toBeLessThan(70);
    expect(r.groundLoot, JSON.stringify(r)).toBeGreaterThan(10);
  }
  expect(report.portal.hadLink).toBe(true);
  expect(report.portal.linkGone).toBe(true);
  expect(report.portal.level).toBe(1);
  expect(report.portal.dungeonClear).toBe(true);
  expect(report.portal.townClear).toBe(true);
  console.log("MAZE_REPORT", JSON.stringify(report, null, 2));
  expect(errors).toEqual([]);
});
