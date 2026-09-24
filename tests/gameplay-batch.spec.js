import { test, expect } from "@playwright/test";

const faults = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  faults.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

test("DnD shop shows discovered scroll names and catalog prices", async ({ page }) => {
  const result = await page.evaluate(() => {
    initpricelist();
    player.knownScrolls = [];
    player.knownPotions = [];
    const pages = [];
    for (let page = 0; page * 26 < MAXITM; page++) {
      const start = page * 26;
      const slot = [];
      for (let i = start; i < Math.min(start + 26, MAXITM); i++) {
        const d = dnd_item[i];
        if (!d || (d.qty <= 0 && !d.infinite)) continue;
        const item = createObject(d.itemId, d.arg);
        slot.push({
          i,
          id: d.itemId,
          arg: d.arg,
          price: dndItemPrice(i),
          catalog: d.price,
          name: item.toString(true),
          infinite: !!d.infinite,
        });
      }
      pages.push(slot);
    }
    const portal = pages.flat().find((s) => s.id === OSCROLL.id && s.arg === 24);
    const scrolls = pages.flat().filter((s) => s.id === OSCROLL.id && s.qty !== 0);
    const unknownStill = !player.knownScrolls[0] && !player.knownScrolls[24];
    return {
      pageCount: pages.length,
      portal,
      lastPageHasPortal: pages[pages.length - 1].some((s) => s.arg === 24 && s.id === OSCROLL.id),
      allScrollsPriced: scrolls.every((s) => s.price === s.catalog && s.price > 0),
      enchantNamed: scrolls.find((s) => s.arg === 0)?.name.includes("enchant armor"),
      unknownStill,
    };
  });
  expect(result.portal.price).toBe(2500);
  expect(result.portal.infinite).toBe(true);
  expect(result.lastPageHasPortal).toBe(true);
  expect(result.allScrollsPriced).toBe(true);
  expect(result.enchantNamed).toBe(true);
  expect(result.unknownStill).toBe(true);
});

test("loot goblin flees, drops equal loot, and despawns after 200 turns", async ({ page }) => {
  const result = await page.evaluate(() => {
    newcavelevel(1);
    setMazeMode(true);
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setMonster(x, y, null);
        setItem(x, y, OEMPTY);
        setKnow(x, y, KNOWALL);
      }
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 500;
    const goblin = createMonster(LOOTGOBLIN);
    setMonster(12, 8, goblin);
    goblin.awake = true;
    goblin.lootGoblinTurns = 0;
    const beforeDrop = goblin.inventory.length;
    const dropIds = new Set();
    for (let i = 0; i < 40; i++) dropIds.add(createEqualChanceItem().id);
    // Flee: after movemt, should not be adjacent attack and should move away or stay non-attacking.
    const distBefore = Math.abs(12 - player.x) + Math.abs(8 - player.y);
    movemt(12, 8);
    const after = (() => {
      for (let x = 0; x < MAXX; x++)
        for (let y = 0; y < MAXY; y++) {
          const m = monsterAt(x, y);
          if (m && m.matches(LOOTGOBLIN)) return { x, y, turns: m.lootGoblinTurns };
        }
      return null;
    })();
    const distAfter = after ? Math.abs(after.x - player.x) + Math.abs(after.y - player.y) : -1;
    // Despawn after 200 move turns (counter increments before the check).
    const g2 = createMonster(LOOTGOBLIN);
    setMonster(14, 8, g2);
    g2.lootGoblinTurns = 198;
    movemt(14, 8);
    const stillThere = !!monsterAt(14, 8) || (() => {
      for (let x = 0; x < MAXX; x++)
        for (let y = 0; y < MAXY; y++) {
          const m = monsterAt(x, y);
          if (m && m.matches(LOOTGOBLIN) && m.lootGoblinTurns === 199) return true;
        }
      return false;
    })();
    const g3 = createMonster(LOOTGOBLIN);
    setMonster(16, 8, g3);
    g3.lootGoblinTurns = 199;
    movemt(16, 8);
    const despawned = !monsterAt(16, 8);
    return {
      beforeDrop,
      dropVariety: dropIds.size,
      distBefore,
      distAfter,
      after,
      symbol: monsterlist[LOOTGOBLIN].char,
      stillThereAfter198: stillThere,
      despawned,
    };
  });
  expect(result.symbol).toBe("?");
  expect(result.beforeDrop).toBeGreaterThanOrEqual(1);
  expect(result.dropVariety).toBeGreaterThan(5);
  expect(result.distAfter).toBeGreaterThanOrEqual(result.distBefore);
  expect(result.stillThereAfter198).toBe(true);
  expect(result.despawned).toBe(true);
});

test("spell direction prompt exposes aim assist spokes", async ({ page }) => {
  const result = await page.evaluate(() => {
    newcavelevel(1);
    setMazeMode(true);
    player.x = 10;
    player.y = 8;
    player.SPELLS = 50;
    player.INTELLIGENCE = 25;
    player.LEVEL = 10;
    let aiming = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (blocking_callback === getdirectioninput) getdirectioninput(ESC);
      speldamage(1); // magic missile
      const snap = ularn.snapshot();
      if (snap.aimAssist && snap.prompt) {
        aiming = true;
        getdirectioninput(ESC);
        break;
      }
    }
    const after = ularn.snapshot();
    return { aiming, afterAim: after.aimAssist };
  });
  expect(result.aiming).toBe(true);
  expect(result.afterAim).toBeFalsy();
});
