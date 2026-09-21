import { test, expect } from "@playwright/test";
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const list = [];
  errors.set(page, list);
  page.on("pageerror", (error) => list.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") list.push(message.text());
  });
  await page.addInitScript(() =>
    localStorage.setItem("ularn3d.quality", "balanced"),
  );
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
async function start(page, name = "Test Hero") {
  await page.locator("#hero-name").fill(name);
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
}
async function snap(page) {
  return page.evaluate(() => window.ularn.snapshot());
}
test("title, guide, class selection, and WebGL render", async ({ page }) => {
  await expect(page.locator("#world canvas")).toBeVisible();
  await expect(page.locator(".class-choice")).toHaveCount(8);
  await page.getByRole("button", { name: "How to play" }).click();
  await expect(page.locator("#guide-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close field guide" }).click();
  await page.getByRole("button", { name: "Wizard", exact: true }).click();
  await start(page);
  const s = await snap(page);
  expect(s.character).toBe("Wizard");
  expect(s.dungeonFloors).toBe(15);
  expect(s.volcanoFloors).toBe(5);
  expect(s.timeLeft).toBe(400);
});
test("movement, waiting, inventory, and exact save restoration", async ({
  page,
}) => {
  await start(page);
  const before = await snap(page);
  await page.keyboard.press(before.x > 0 ? "ArrowLeft" : "ArrowRight");
  const after = await snap(page);
  expect(after.x).not.toBe(before.x);
  expect(after.moves).toBeGreaterThan(before.moves);
  await page.locator('.actionbar [data-key="i"]').click();
  await expect(page.locator("#engine-modal")).toBeVisible();
  await expect(page.locator("#LARN")).toContainText("dagger");
  await page.keyboard.press("Escape");
  await page.keyboard.press(".");
  await page.locator("#save").click();
  await expect(page.locator("#toast")).toContainText("saved");
  const saved = await snap(page);
  await page.keyboard.press("S");
  expect((await snap(page)).over).toBe(false);
  await page.reload();
  await page.locator("#continue").click();
  const loaded = await snap(page);
  for (const key of [
    "x",
    "y",
    "hp",
    "mana",
    "gold",
    "xp",
    "moves",
    "character",
    "level",
    "timeLeft",
  ])
    expect(loaded[key], key).toEqual(saved[key]);
  expect(loaded.inventory).toEqual(saved.inventory);
});
test("enter the dungeon through original movement and contextual commands", async ({
  page,
}) => {
  await start(page);
  const s = await snap(page),
    entry = s.tiles.find((t) => t.id === 54);
  expect(entry).toBeTruthy();
  // Walk ordinary engine directions, with the same turn handling as the keyboard.
  await page.evaluate(({ x, y }) => {
    for (let guard = 0; guard < 90; guard++) {
      const s = ularn.snapshot();
      if (s.x === x && s.y === y) break;
      if (s.prompt) ularn.key("escape");
      ularn.key(s.x < x ? "l" : s.x > x ? "h" : s.y < y ? "j" : "k");
    }
  }, entry);
  let at = await snap(page);
  expect([at.x, at.y]).toEqual([entry.x, entry.y]);
  await page.keyboard.press("e");
  await expect.poll(async () => (await snap(page)).level).toBe(1);
  const dungeon = await snap(page);
  expect(dungeon.tiles.length).toBeLessThan(dungeon.width * dungeon.height);
  expect(dungeon.tiles.length).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/dungeon.png" });
});
test("wall collision and turn-based monster combat", async ({ page }) => {
  await start(page);
  // Deterministic combat fixture: the renderer and keyboard still use real game logic.
  await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 100;
    for (let x = 9; x <= 11; x++)
      for (let y = 7; y <= 9; y++) {
        setItem(x, y, OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    setItem(9, 8, OWALL);
    setMonster(11, 8, createMonster(GNOME));
    showcell(10, 8);
    paint();
  });
  const before = await snap(page);
  await page.keyboard.press("ArrowLeft");
  expect((await snap(page)).x).toBe(10);
  const hp = await page.evaluate(() => monsterAt(11, 8).hitpoints);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("ArrowRight");
    if (
      !(await snap(page)).tiles.some(
        (t) => t.x === 11 && t.y === 8 && t.monster,
      )
    )
      break;
  }
  const after = await snap(page);
  expect(after.moves).toBeGreaterThan(before.moves);
  expect(after.log.join(" ")).toMatch(/hit|miss|kill|gnome/i);
  expect(
    await page.evaluate(() => monsterAt(11, 8)?.hitpoints ?? 0),
  ).toBeLessThanOrEqual(hp);
});
test("hidden traps, invisible demons, blindness, and unexplored tiles do not leak", async ({
  page,
}) => {
  await start(page);
  const results = await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    setItem(11, 8, OIVTRAPDOOR);
    setMonster(11, 8, createMonster(DEMONLORD));
    setKnow(11, 8, KNOWALL);
    setKnow(12, 8, KNOWNOT);
    paint();
    const hidden = ularn.snapshot();
    take(createObject(OLARNEYE));
    paint();
    const revealed = ularn.snapshot();
    player.BLINDCOUNT = 5;
    paint();
    const blind = ularn.snapshot();
    return {
      hidden: hidden.tiles.find((t) => t.x === 11 && t.y === 8),
      unknown: hidden.tiles.some((t) => t.x === 12 && t.y === 8),
      revealed: revealed.tiles.find((t) => t.x === 11 && t.y === 8),
      blind: blind.tiles.find((t) => t.x === 11 && t.y === 8),
    };
  });
  expect(results.hidden.id).toBe(0);
  expect(results.hidden.monster).toBeNull();
  expect(results.unknown).toBe(false);
  expect(results.revealed.monster).not.toBeNull();
  expect(results.blind.monster).toBeNull();
});
test("shop, spell casting, item use, and full depth generation", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    moveNear(ODNDSTORE, true);
    paint();
  });
  await page.keyboard.press("e");
  await expect(page.locator("#engine-modal")).toBeVisible();
  await expect(page.locator("#LARN")).toContainText(/Thrift Shoppe/i);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    player.SPELLS = player.SPELLMAX = 10;
    learnSpell("pro");
    paint();
  });
  await page.keyboard.press("c");
  await page.keyboard.type("pro");
  expect(await page.evaluate(() => player.SPELLSCAST)).toBe(1);
  expect((await snap(page)).mana).toBeLessThan(10);
  await page.evaluate(() => {
    player.HP = 1;
    take(createObject(OPOTION, 1));
    paint();
  });
  const potion = await page.evaluate(
    () => ularn.snapshot().inventory.find((i) => i.id === 42).key,
  );
  await page.keyboard.press("q");
  await page.keyboard.press(potion);
  expect((await snap(page)).inventory.some((i) => i.id === 42)).toBe(false);
  const levels = await page.evaluate(() => {
    const counts = [];
    for (let l = 1; l <= 20; l++) {
      newcavelevel(l);
      counts.push({
        l,
        items: LEVELS[l].items.length,
        monsters: LEVELS[l].monsters.length,
        width: MAXX,
      });
    }
    return counts;
  });
  expect(levels).toHaveLength(20);
  expect(levels.every((l) => l.items === l.width && l.monsters === l.width)).toBe(true);
});
test("death ends the run, clears autosave, and allows a fresh expedition", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => died(GNOME, true));
  await expect.poll(async () => (await snap(page)).over).toBe(true);
  await expect(page.locator("#new-after-death")).toBeVisible();
  expect(await page.evaluate(() => ularn.hasSave())).toBe(false);
  await page.keyboard.press("Enter");
  await expect(page.locator("#LARN")).toContainText(/score|visitor|winner/i);
  await page.locator("#new-after-death").click();
  await expect(page.locator("#welcome")).toBeVisible();
});
test("mobile controls, dialogs and layout fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/mobile-title.png" });
  await start(page);
  await page
    .getByRole("button", { name: "Wait one turn", exact: true })
    .click();
  expect((await snap(page)).moves).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#pause").click();
  await expect(page.locator("#pause-dialog")).toBeVisible();
  await page.locator("#resume-game").click();
  await page.screenshot({ path: "test-results/mobile-game.png" });
});
test("no external services required for gameplay or saves", async ({
  page,
}) => {
  const external = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== new URL(page.url()).origin)
      external.push(r.url());
  });
  await start(page);
  await page.keyboard.press(".");
  await page.locator("#save").click();
  expect(external).toEqual([]);
});
test("all eight classes receive their original attributes and equipment", async ({
  page,
}) => {
  test.setTimeout(120000); // Eight complete WebGL app initializations in software-rendered Chrome.
  const classes = [
    "Adventurer",
    "Wizard",
    "Rogue",
    "Elf",
    "Dwarf",
    "Ogre",
    "Klingon",
    "Rambo",
  ];
  for (const name of classes) {
    await page.goto("/");
    await page.getByRole("button", { name, exact: true }).click();
    await start(page);
    const s = await snap(page);
    expect(s.character).toBe(name);
    expect(s.hp).toBeGreaterThan(0);
    if (name === "Rambo")
      expect(s.inventory.some((i) => i.name.includes("lance of death"))).toBe(
        true,
      );
    if (name === "Wizard") expect(s.stats.INT).toBeGreaterThan(s.stats.STR);
  }
});
test("the cure can be returned home and the original victory sequence completes", async ({
  page,
}) => {
  await start(page);
  // Seed the quest item; exercise the real home entrance and ending callbacks.
  await page.evaluate(() => {
    localStorage.setObject(logname + "_ularn", { classic: "winner-sentinel" });
    take(createObject(OPOTION, 21));
    moveNear(OHOME, true);
    paint();
  });
  await page.keyboard.press("e");
  await expect(page.locator("#LARN")).toContainText("Congratulations");
  await expect
    .poll(() => page.evaluate(() => blocking_callback === win), {
      timeout: 15000,
    })
    .toBe(true);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await snap(page)).over, { timeout: 15000 })
    .toBe(true);
  expect(await page.evaluate(() => player.winner)).toBe(true);
  expect(
    await page.evaluate(() => localStorage.getObject(logname + "_ularn")),
  ).toEqual({ classic: "winner-sentinel" });
  expect(await page.evaluate(() => ularn.hasSave())).toBe(false);
});
test("corrupt saves fail visibly without preventing a new game", async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.setItem("ularn3d.expedition.v1", "invalid"),
  );
  await page.reload();
  await page.locator("#continue").click();
  await expect(page.locator("#start-error")).toContainText(
    "could not be restored",
  );
  await start(page);
  expect((await snap(page)).over).toBe(false);
});
