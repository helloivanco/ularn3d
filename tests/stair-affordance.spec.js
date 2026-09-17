import { test, expect } from "@playwright/test";
import { itemModel } from "../src/models.js";

test("blocked stairs have a solid landing obstruction instead of a travel arrow", () => {
  for (const [id, direction] of [[5, "up"], [13, "down"]]) {
    const blocked = itemModel({ id, name: "stairs", stair: { direction, blocked: true } });
    const open = itemModel({ id, name: "stairs", stair: { direction, blocked: false } });
    const obstruction = blocked.getObjectByName("stair-blockage");
    expect(obstruction?.children.filter((child) => child.isMesh).length).toBeGreaterThan(4);
    expect(blocked.getObjectByName(`${direction}-arrow`)).toBeUndefined();
    expect(open.getObjectByName("stair-blockage")).toBeUndefined();
    expect(open.getObjectByName(`${direction}-arrow`)).toBeDefined();
    expect(blocked.userData).toMatchObject({ stairDirection: direction, stairBlocked: true });
  }
  // The volcanic shaft and home exit retain their existing usable appearance.
  for (const id of [56, 93]) {
    const exit = itemModel({ id, name: "exit" });
    expect(exit.getObjectByName("stair-blockage")).toBeUndefined();
    expect(exit.getObjectByName("up-arrow")).toBeDefined();
  }
});

test("known dead-end stairs match the level rules without exposing hidden tiles", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);

  for (const [depth, upBlocked, downBlocked] of [
    [2, false, false], [15, true, true], [16, true, false],
    [18, false, true], [19, false, true],
  ]) {
    const result = await page.evaluate((depth) => {
      newcavelevel(depth);
      player.x = 10;
      player.y = 8;
      player.BLINDCOUNT = 0;
      player.HP = player.HPMAX = 1000;
      setMazeMode(true);
      for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) {
        setMonster(x, y, null);
        setItem(x, y, OWALL);
        setKnow(x, y, KNOWNOT);
      }
      for (let x = 5; x < 17; x++) for (let y = 4; y < 13; y++) {
        setItem(x, y, OEMPTY);
        setKnow(x, y, KNOWALL);
      }
      setItem(8, 7, OSTAIRSUP);
      setItem(9, 7, OSTAIRSDOWN);
      if (depth === 16) setItem(10, 6, OVOLUP);
      setItem(50, 2, OSTAIRSUP); // Unexplored stairs must remain absent.
      setItem(12, 8, OSTAIRSUP);
      const hiddenMonster = createMonster(GNOME);
      hiddenMonster.isVisible = () => false;
      setMonster(12, 8, hiddenMonster);
      paint();
      const snapshot = ularn.snapshot();
      return {
        up: snapshot.tiles.find((tile) => tile.x === 8 && tile.y === 7),
        down: snapshot.tiles.find((tile) => tile.x === 9 && tile.y === 7),
        unseen: snapshot.tiles.find((tile) => tile.x === 50 && tile.y === 2),
        masked: snapshot.tiles.find((tile) => tile.x === 12 && tile.y === 8),
        landmarks: ularnGraphics.landmarks(),
      };
    }, depth);

    for (const [key, x, blocked] of [["up", 8, upBlocked], ["down", 9, downBlocked]]) {
      expect(result[key].stair).toEqual({ direction: key, blocked });
      expect(result[key].name.includes("dead end")).toBe(blocked);
      expect(result.landmarks.find((landmark) => landmark.tile.x === x && landmark.tile.y === 7))
        .toMatchObject({ stairDirection: key, stairBlocked: blocked });
    }
    expect(result.unseen).toBeUndefined();
    expect(result.masked).toMatchObject({ id: 0, name: "The floor", stair: null });
    expect(result.landmarks.some((landmark) => landmark.tile.x === 12 && landmark.tile.y === 8)).toBe(false);

    if (depth === 16) {
      const shaft = result.landmarks.filter((landmark) => landmark.tile.x === 10 && landmark.tile.y === 6);
      expect(shaft).toHaveLength(1);
      expect(shaft[0]).toMatchObject({ stairDirection: "up", stairBlocked: false, label: "SURFACE SHAFT" });
      await page.waitForTimeout(350);
      await page.screenshot({ path: testInfo.outputPath("blocked-and-open-stairs.png") });
    }
  }
  expect(errors).toEqual([]);
});
