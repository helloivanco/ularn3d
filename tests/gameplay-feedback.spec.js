import { test, expect } from "@playwright/test";

async function start(page) {
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "performance"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
}

async function emptyArena(page) {
  await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 1000;
    player.STEALTH = player.HASTESELF = player.HASTEMONST = player.TIMESTOP = player.HOLDMONST = 0;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setItem(x, y, x < 7 || x > 17 || y < 5 || y > 11 ? OWALL : OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    setMazeMode(true);
    paint();
  });
}

test("auto-loot toggles without a turn, gold always loots, and the toggle survives save/resume", async ({ page }) => {
  await start(page);
  await emptyArena(page);
  const initial = await page.evaluate(() => {
    const before = ularn.snapshot();
    ularn.setAutoLoot(false);
    setItem(11, 8, createGold(35));
    const toggled = ularn.snapshot();
    ularn.key("l");
    return { before, toggled, after: ularn.snapshot(), item: itemAt(11, 8).id, emptyID: OEMPTY.id };
  });
  expect(initial.before.autoLoot).toBe(true);
  expect(initial.toggled.autoLoot).toBe(false);
  expect(initial.toggled.moves).toBe(initial.before.moves);
  expect(initial.item).toBe(initial.emptyID);
  expect(initial.after.gold).toBe(initial.before.gold + 35);
  const potionLeft = await page.evaluate(() => {
    setItem(9, 8, createObject(OPOTION, 0));
    ularn.key("h");
    return { id: itemAt(9, 8).id, potionID: OPOTION.id, autoLoot: ularn.snapshot().autoLoot };
  });
  expect(potionLeft.autoLoot).toBe(false);
  expect(potionLeft.id).toBe(potionLeft.potionID);
  await page.evaluate(() => ularn.save());
  await page.reload();
  await page.locator("#continue").click();
  await expect.poll(() => page.evaluate(() => ularn.snapshot()?.autoLoot)).toBe(false);
});

test("dungeon monsters pursue and attack on player turns with stable identity and facing", async ({ page }) => {
  await start(page);
  await emptyArena(page);
  const before = await page.evaluate(() => {
    setMonster(14, 8, createMonster(GNOME));
    monsterAt(14, 8).awake = true;
    window.attacks = 0;
    const attack = hitplayer;
    hitplayer = function (...args) { window.attacks++; return attack(...args); };
    paint();
    return ularn.snapshot().tiles.find((tile) => tile.x === 14 && tile.y === 8).monster;
  });
  const after = await page.evaluate(() => {
    ularn.key(".");
    const first = ularn.snapshot().tiles.find((tile) => tile.monster);
    for (let turn = 0; turn < 5; turn++) ularn.key(".");
    return { first, attacks: window.attacks, snapshot: ularn.snapshot() };
  });
  expect(after.first.x).toBeLessThan(14);
  expect(after.first.monster.uid).toBe(before.uid);
  expect(after.first.monster.facing.x).toBe(-1);
  expect(after.attacks).toBeGreaterThan(0);
  expect(after.snapshot.moves).toBeGreaterThanOrEqual(6);
});

test("snapshot carries safe inventory, all active effect timers, and hidden-safe glyphs", async ({ page }) => {
  await start(page);
  await emptyArena(page);
  const result = await page.evaluate(() => {
    player.PROTECTIONTIME = 42;
    player.STRCOUNT = 17;
    setItem(11, 8, OIVTRAPDOOR);
    setMonster(11, 8, createMonster(DEMONLORD));
    paint();
    const snapshot = ularn.snapshot();
    return { snapshot, floorSymbol: OEMPTY.ularnchar };
  });
  expect(result.snapshot.effectDetails).toEqual(expect.arrayContaining([
    { id: "PROTECTIONTIME", name: "Protection +2", turns: 42 },
    { id: "STRCOUNT", name: "Strength", turns: 17 },
  ]));
  expect(result.snapshot.inventory.find((item) => item.equipped.includes("WIELD"))).toMatchObject({ slot: expect.any(Number), name: expect.any(String) });
  expect(result.snapshot.inventory.every((item) => !/<[^>]*>/.test(item.name))).toBe(true);
  expect(result.snapshot.tiles.find((tile) => tile.x === 11 && tile.y === 8)).toMatchObject({ symbol: result.floorSymbol, monster: null });
});

test("resolved weapon attacks and spells report exact visible combat paths without prompt sounds", async ({ page }) => {
  await start(page);
  await emptyArena(page);
  await page.evaluate(() => {
    window.combatEvents = [];
    window.addEventListener("ularn:combat", (event) => window.combatEvents.push(event.detail));
    setMonster(11, 8, createMonster(GNOME));
    hitmonster(11, 8);
    setMonster(11, 8, null);
    setKnow(11, 8, KNOWALL);
    player.INTELLIGENCE = 30;
    player.LEVEL = 5;
    player.SPELLS = player.SPELLMAX = 20;
    learnSpell("mle");
    // Fix only random draws so this acceptance/path assertion cannot fail at
    // the original engine's intentional random spell failure check.
    rnd = () => 1;
    paint();
    ularn.key("c");
    ularn.key("m");
    ularn.key("l");
    ularn.key("e");
  });
  const prompted = await page.evaluate(() => window.combatEvents);
  expect(prompted.filter((event) => event.kind === "weapon")).toHaveLength(1);
  expect(prompted[0]).toMatchObject({ weapon: { type: "dagger" }, from: { x: 10, y: 8 }, to: { x: 11, y: 8 } });
  expect(prompted.filter((event) => event.kind === "spell")).toHaveLength(0);
  await page.evaluate(() => ularn.key("l"));
  await expect.poll(() => page.evaluate(() => window.combatEvents.filter((event) => event.kind === "spell" && event.phase === "impact").length)).toBe(1);
  const events = await page.evaluate(() => window.combatEvents.filter((event) => event.kind === "spell"));
  expect(events.filter((event) => event.phase === "cast")).toHaveLength(1);
  expect(events.every((event) => event.spell.code === "mle")).toBe(true);
  expect(new Set(events.map((event) => event.castId)).size).toBe(1);
  expect(events[0].castId).toEqual(expect.any(Number));
  expect(events.filter((event) => event.phase === "projectile").map((event) => event.to)).toEqual([
    { x: 11, y: 8 }, { x: 12, y: 8 }, { x: 13, y: 8 },
  ]);
});
