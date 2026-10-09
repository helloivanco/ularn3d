import { test, expect } from "@playwright/test";
import { findRoute, isHostile } from "../src/navigation.js";
import { mapClick } from "./map-helper.js";

const faults = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  faults.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.audio.v1", JSON.stringify({ enabled: false }));
  });
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 200;
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) {
      setMonster(x, y, null);
      setItem(x, y, OWALL);
      setKnow(x, y, KNOWNOT);
    }
    for (let x = 5; x < 24; x++) for (let y = 4; y < 14; y++) {
      setItem(x, y, OEMPTY);
      setKnow(x, y, KNOWALL);
    }
    paint();
  });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

async function count(page, floor = 1) {
  return page.evaluate((floor) => LEVELS[floor].monsters.flat().filter((m) => m?.matches(LEMMING)).length, floor);
}

test("new cave floors keep at most one lemming", async ({ page }) => {
  const populations = await page.evaluate(() => {
    const result = [];
    for (const depth of [2, 3, 4]) {
      newcavelevel(depth);
      result.push(LEVELS[depth].monsters.flat().filter((monster) => monster?.matches(LEMMING)).length);
    }
    paint();
    return result;
  });
  for (const population of populations) expect(population).toBeLessThanOrEqual(1);
});

test("a cleared cave does not gain a lemming just because the turn count hits 24", async ({ page }) => {
  await page.evaluate(() => {
    player.MOVESMADE = 23; rmst = 100; paint();
  });
  await page.keyboard.press(".");
  expect(await count(page)).toBe(0);
  await page.evaluate(() => {
    player.MOVESMADE = 47; rmst = 100;
    const random = rnd;
    rnd = (n) => n === 100 ? 1 : random(n);
    paint();
  });
  await page.keyboard.press(".");
  expect(await count(page)).toBe(0);
});

test("periodic cave arrivals stay capped and respect time stop and genocide", async ({ page }) => {
  await page.evaluate(() => {
    for (let x = 11; x < 15; x++) setMonster(x, 8, LEMMING);
    player.MOVESMADE = 24; rmst = 100; randmonst();
  });
  expect(await count(page)).toBe(1);
  const blocked = await page.evaluate(() => {
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) setMonster(x, y, null);
    player.TIMESTOP = 10; randmonst();
    const frozen = LEVELS[level].monsters.flat().filter(Boolean).length;
    player.TIMESTOP = 0; genocide.push(LEMMING);
    const random = rnd;
    rnd = (n) => n === 100 ? 1 : random(n);
    rmst = 1; randmonst(); // Also exercise the upstream random-monster cycle.
    const extinct = LEVELS[level].monsters.flat().filter(Boolean).length;
    return { frozen, extinct };
  });
  expect(blocked).toEqual({ frozen: 0, extinct: 0 });
});

test("extra rodent arrivals are limited to caves and cannot use walls or the hero's tile", async ({ page }) => {
  const result = await page.evaluate(() => {
    // No safe floor exists far enough from the hero in this fixture.
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) setItem(x, y, OWALL);
    setItem(player.x, player.y, OEMPTY);
    player.MOVESMADE = 24; rmst = 100; randmonst();
    const blocked = LEVELS[level].monsters.flat().filter(Boolean).length;
    const other = [];
    for (const depth of [0, 16]) {
      newcavelevel(depth);
      for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) setMonster(x, y, null);
      player.MOVESMADE = 48; rmst = 100; randmonst();
      other.push(LEVELS[level].monsters.flat().filter(Boolean).length);
    }
    paint();
    return { blocked, other };
  });
  expect(result).toEqual({ blocked: 0, other: [0, 0] });
});

test("one directional action clears a lemming, awards loot/experience, and advances in the same turn", async ({ page }) => {
  const before = await page.evaluate(() => {
    ularn.setAutoLoot(false);
    const monster = createMonster(LEMMING);
    monster.hitpoints = 16; // Old saves can contain tougher individuals.
    monster.inventory = [createObject(ODAGGER)];
    setMonster(11, 8, monster);
    player.LEVEL = 1;
    player.DEXTERITY = 0;
    player.WCLASS = 0;
    player.HALFDAM = 30;
    // Force the original accuracy formula to miss and its attack birth to fire.
    rnd = (n) => n === 100 ? 1 : Math.max(1, Math.floor(n));
    window.weaponEvents = [];
    window.addEventListener("ularn:combat", ({ detail }) => {
      if (detail.kind === "weapon") weaponEvents.push(detail);
    });
    paint();
    return { moves: player.MOVESMADE, kills: player.MONSTKILLED, experience: player.EXPERIENCE };
  });
  await page.keyboard.press("ArrowRight");
  const after = await page.evaluate(() => ({
    moves: player.MOVESMADE, kills: player.MONSTKILLED, experience: player.EXPERIENCE,
    dropped: itemAt(11, 8).matches(ODAGGER), events: weaponEvents,
    position: [player.x, player.y],
  }));
  expect(await count(page)).toBe(0);
  expect(after.moves).toBe(before.moves + 1);
  expect(after.kills).toBe(before.kills + 1);
  expect(after.experience).toBeGreaterThan(before.experience);
  expect(after.dropped).toBe(true);
  expect(after.position).toEqual([11, 8]);
  expect(after.events).toHaveLength(1);
  expect(after.events[0].hit).toBe(true);
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => [player.x, player.y])).toEqual([12, 8]);
});

async function corridor(page) {
  return page.evaluate(() => {
    for (let x = 5; x < 24; x++) for (let y = 4; y < 14; y++) {
      setMonster(x, y, null);
      setItem(x, y, y === 8 && x < 19 ? OEMPTY : OWALL);
      setKnow(x, y, KNOWALL);
    }
    for (let x = 11; x < 14; x++) setMonster(x, 8, LEMMING);
    paint();
    return player.MOVESMADE;
  });
}

test("route planning admits harmless lemmings while threats, walls and hazards remain blocked", () => {
  const state = { x: 0, y: 0, width: 5, height: 1,
    tiles: Array.from({ length: 5 }, (_, x) => ({ x, y: 0 })) };
  state.tiles[1].monster = { id: 1, harmless: true };
  expect(findRoute(state, { x: 4, y: 0 })).toHaveLength(4);
  expect(isHostile(state.tiles[1])).toBe(false);
  for (const monster of [{ id: 2 }, { id: 1, harmless: false }]) {
    state.tiles[1].monster = monster;
    expect(isHostile(state.tiles[1])).toBe(true);
    expect(findRoute(state, { x: 4, y: 0 })).toBe(null);
  }
  state.tiles[1].monster = { id: 1, harmless: true };
  state.tiles[2].hazard = true;
  expect(findRoute(state, { x: 4, y: 0 })).toBe(null);
  state.tiles[2].hazard = false; state.tiles[2].closed = true;
  expect(findRoute(state, { x: 4, y: 0 })).toBe(null);
});

test("click travel crosses a lemming-filled corridor without extra stationary turns", async ({ page }) => {
  const before = await corridor(page);
  await mapClick(page, 18, 8);
  expect(await page.evaluate(() => player.x)).toBe(11);
  await expect.poll(() => page.evaluate(() => player.x)).toBe(18);
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(before + 8);
  expect(await count(page)).toBe(0);
  expect((await page.evaluate(() => ularnGraphics.metrics())).routePoints).toBe(0);
});

test("held movement clears lemmings at the normal step cadence and release stops it", async ({ page }) => {
  const before = await corridor(page);
  await page.keyboard.down("ArrowRight");
  expect(await page.evaluate(() => player.x)).toBe(11);
  await expect.poll(() => page.evaluate(() => player.x)).toBeGreaterThanOrEqual(14);
  await page.keyboard.up("ArrowRight");
  const stopped = await page.evaluate(() => ({ x: player.x, moves: player.MOVESMADE }));
  expect(stopped.moves - before).toBe(stopped.x - 10);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => player.x)).toBe(stopped.x);
});

test("real threats including mimics disguised as lemmings still stop click travel", async ({ page }) => {
  const before = await page.evaluate(() => {
    setMonster(11, 8, LEMMING);
    const mimic = createMonster(MIMIC); mimic.mimicarg = LEMMING;
    setMonster(11, 9, mimic); paint();
    return { moves: player.MOVESMADE, tile: ularn.snapshot().tiles.find((tile) => tile.x === 11 && tile.y === 9) };
  });
  expect(before.tile.monster.id).toBe(1);
  expect(isHostile(before.tile)).toBe(true);
  await mapClick(page, 18, 8);
  await expect(page.locator("#toast")).toContainText("creature");
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(before.moves);
  await page.evaluate(() => { setMonster(11, 9, GNOME); paint(); });
  await mapClick(page, 18, 8);
  await expect(page.locator("#toast")).toContainText("creature");
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(before.moves);
});

test("harmless contact does not flag attacks or hide nearby interactions and exploration", async ({ page }) => {
  const result = await page.evaluate(() => {
    setMonster(11, 8, LEMMING);
    hitflag = 0; hitplayer(11, 8);
    const harmless = { flag: hitflag, nearby: nearbymonst(), exploration: MazeExplorer.monstersAdjacentTo(10, 8).length };
    setMonster(10, 9, GNOME);
    hitplayer(10, 9);
    return { harmless, hostile: { flag: hitflag, nearby: nearbymonst(), exploration: MazeExplorer.monstersAdjacentTo(10, 8).length } };
  });
  expect(result).toEqual({ harmless: { flag: 0, nearby: false, exploration: 0 }, hostile: { flag: 1, nearby: true, exploration: 1 } });
});

test("shifted running continues through harmless lemmings and ends at the wall", async ({ page }) => {
  await corridor(page);
  await page.evaluate(() => { rnd = (n) => Math.max(1, Math.floor(n)); });
  await page.keyboard.press("Shift+ArrowRight");
  expect(await page.evaluate(() => player.x)).toBe(18);
  expect(await count(page)).toBe(0);
});

test("moving lemmings never reproduce even when the original birth roll succeeds", async ({ page }) => {
  const result = await page.evaluate(() => {
    const monster = setMonster(16, 8, LEMMING);
    const random = rnd;
    rnd = () => 1;
    for (let i = 0; i < 80; i++) {
      const source = i % 2 === 0 ? 16 : 17;
      mmove(source, 8, source === 16 ? 17 : 16, 8);
    }
    rnd = random;
    paint();
    return { same: monsterAt(16, 8) === monster, oldSpotEmpty: !monsterAt(17, 8) };
  });
  expect(result).toEqual({ same: true, oldSpotEmpty: true });
  expect(await count(page)).toBe(1);
});

test("new placements and summon helpers respect the one-per-floor cap without blocking movement", async ({ page }) => {
  const result = await page.evaluate(() => {
    for (let x = 16; x < 20; x++) setMonster(x, 8, LEMMING);
    const rejected = [
      setMonster(20, 8, LEMMING),
      setMonster(21, 8, createMonster(LEMMING)),
      fillmonst(LEMMING, true),
    ];
    createmonster(LEMMING);
    const monster = monsterAt(16, 8);
    mmove(16, 8, 16, 9);
    shuffleMonster(16, 9);
    const present = LEVELS[level].monsters.flat().includes(monster);
    const other = !!setMonster(22, 8, GNOME);
    paint();
    return { rejected, present, other };
  });
  expect(result).toEqual({ rejected: [null, null, null], present: true, other: true });
  expect(await count(page)).toBe(1);
  const secondFloor = await page.evaluate(() => {
    newcavelevel(2);
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) {
      setMonster(x, y, null);
      setItem(x, y, OEMPTY);
    }
    for (let x = 16; x < 20; x++) setMonster(x, 8, LEMMING);
    return setMonster(20, 8, LEMMING);
  });
  expect(secondFloor).toBe(null);
  expect(await count(page, 1)).toBe(1);
  expect(await count(page, 2)).toBe(1);
});

test("time stop and other monsters retain their combat rules", async ({ page }) => {
  const result = await page.evaluate(() => {
    const lemming = setMonster(11, 8, LEMMING);
    player.TIMESTOP = 10;
    hitmonster(11, 8);
    const held = monsterAt(11, 8) === lemming;
    player.TIMESTOP = 0;
    setMonster(11, 8, null);
    const gnome = setMonster(11, 8, GNOME), hp = gnome.hitpoints;
    player.LEVEL = 1;
    player.DEXTERITY = 0;
    player.WCLASS = 0;
    const random = rnd;
    rnd = (n) => Math.max(1, Math.floor(n));
    hitmonster(11, 8);
    rnd = random;
    return { held, gnomeUnhurt: monsterAt(11, 8) === gnome && gnome.hitpoints === hp };
  });
  expect(result).toEqual({ held: true, gnomeUnhurt: true });
});

test("Continue thins an old lemming swarm to one and the player can clear it", async ({ page }) => {
  await page.evaluate(() => {
    // Recreate a pre-upgrade save without going through today's spawn limit.
    for (let x = 11; x < 18; x++) LEVELS[level].monsters[x][8] = createMonster(LEMMING);
    paint();
    ularn.save();
  });
  await page.reload();
  await page.locator("#continue").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  expect(await count(page)).toBe(1);
  const result = await page.evaluate(() => {
    const monster = monsterAt(11, 8);
    return { present: !!monster, rejected: setMonster(22, 8, LEMMING) };
  });
  expect(result).toEqual({ present: true, rejected: null });
  expect(await count(page)).toBe(1);
  await page.keyboard.press("ArrowRight");
  expect(await count(page)).toBe(0);
  await page.locator("#save").click();
  await page.reload();
  await page.locator("#continue").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  expect(await count(page)).toBe(0);
});

test("online rooms retain the native population cap and thinning", async ({ page }) => {
  const result = await page.evaluate(() => {
    PARTY_ON = true;
    setMonster(16, 8, LEMMING);
    const rejected = setMonster(20, 8, LEMMING);
    LEVELS[level].monsters[22][8] = createMonster(LEMMING);
    thinLemmings();
    return { rejected, population: LEVELS[level].monsters.flat().filter(monster => monster?.matches(LEMMING)).length };
  });
  expect(result).toEqual({ rejected: null, population: 1 });
});

test("classic edition retains the native one-lemming cap without loading solo 3D adapters", async ({ page }) => {
  await page.goto("/engine/larn_local.html?ularn=true");
  await page.waitForFunction(() => typeof createMonster === "function");
  const result = await page.evaluate(() => {
    ULARN = true;
    monsterlist = ULARN_monsterlist;
    level = 1;
    player = new Player();
    player.x = 10;
    player.y = 8;
    LEVELS[1] = {
      items: Array.from({ length: MAXX }, () => Array(MAXY).fill(OEMPTY)),
      monsters: Array.from({ length: MAXX }, () => Array(MAXY).fill(null)),
      know: Array.from({ length: MAXX }, () => Array(MAXY).fill(KNOWALL)),
    };
    for (let x = 16; x < 22; x++) setMonster(x, 8, LEMMING);
    const before = LEVELS[1].monsters.flat().filter(Boolean).length;
    rnd = () => 1;
    mmove(16, 8, 16, 9);
    const after = LEVELS[1].monsters.flat().filter(Boolean).length;
    return { before, after, bridgeLoaded: typeof window.ularn !== "undefined" };
  });
  expect(result).toEqual({ before: 1, after: 1, bridgeLoaded: false });
});
