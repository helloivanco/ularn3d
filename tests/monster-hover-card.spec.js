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

test("all 66 creature cards have distinct transparent portraits of their species", async ({ page }) => {
  const portraits = await page.evaluate(async () => {
    const { CREATURES } = await import("/src/creatures.js");
    const { monsterCardInfo } = await import("/src/monster-descriptions.js");
    return Promise.all(CREATURES.map(async entry => {
      const info = monsterCardInfo({ id: entry.id, name: entry.model, known: true });
      const response = await fetch(info.art), blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())))
        .map(value => value.toString(16).padStart(2, "0")).join("");
      const result = { id: entry.id, art: info.art, status: response.status,
        width: bitmap.width, height: bitmap.height, cornerAlpha: context.getImageData(0, 0, 1, 1).data[3], hash };
      bitmap.close(); return result;
    }));
  });
  expect(portraits).toHaveLength(66);
  expect(new Set(portraits.map(portrait => portrait.hash)).size).toBe(66);
  for (const portrait of portraits) {
    expect(portrait).toMatchObject({ art: `/art/creatures/${portrait.id}.webp`, status: 200, width: 192, height: 252, cornerAlpha: 0 });
  }
});

test("monster hover card respects visibility and leaves items on the label", async ({
  page,
}) => {
  test.setTimeout(90000);

  const coverage = await page.evaluate(async () => {
    const { MONSTER_DESCRIPTIONS } = await import("/src/monster-descriptions.js");
    const missing = [];
    for (let id = 1; id < monsterlist.length; id++) {
      const text = MONSTER_DESCRIPTIONS[id];
      if (typeof text !== "string" || text.trim().length < 20) missing.push(id);
    }
    return { missing, count: monsterlist.length - 1 };
  });
  expect(coverage.missing).toEqual([]);
  expect(coverage.count).toBe(66);

  await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 500;
    player.SEEINVISIBLE = 0;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setMonster(x, y, null);
        setItem(x, y, OWALL);
        setKnow(x, y, KNOWNOT);
      }
    for (let x = 5; x < 16; x++)
      for (let y = 4; y < 13; y++) {
        setItem(x, y, OEMPTY);
        setKnow(x, y, KNOWALL);
      }
    setMonster(12, 6, createMonster(GNOME));
    setMonster(10, 6, createMonster(KOBOLD));
    setMonster(14, 10, createMonster(INVISIBLESTALKER));
    setMonster(6, 6, createMonster(MIMIC));
    setItem(8, 10, createGold(40));
    setMazeMode(true);
    paint();
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const tiles = ularn.snapshot().tiles;
        const at = (x, y) => tiles.find((tile) => tile.x === x && tile.y === y);
        return {
          gnome: at(12, 6)?.monster?.name ?? null,
          known: at(12, 6)?.monster?.known ?? null,
          stalker: at(14, 10)?.monster ? "visible" : null,
          floor: at(14, 10)?.name ?? null,
          mimic: at(6, 6)?.monster?.name ?? null,
          mimicKnown: at(6, 6)?.monster?.known ?? null,
          gold: at(8, 10)?.name ?? null,
        };
      }),
    )
    .toMatchObject({
      gnome: "gnome",
      known: true,
      stalker: null,
      floor: "The floor",
      mimicKnown: false,
      gold: "some gold",
    });

  await page.locator("#camera-reset").click();
  const moveTo = async (x, y) => {
    const point = await page.evaluate(({ x, y }) => ularnGraphics.projectTile(x, y, 0.35), { x, y });
    await page.mouse.move(point.x, point.y);
  };

  await test.step("visible monster shows the card", async () => {
    const expected = await page.evaluate(async () => {
      const { MONSTER_DESCRIPTIONS } = await import("/src/monster-descriptions.js");
      const monster = ularn.snapshot().tiles.find((tile) => tile.x === 12 && tile.y === 6).monster;
      return {
        name: monster.name,
        description: MONSTER_DESCRIPTIONS[monster.id],
        art: `/art/creatures/${monster.id}.webp`,
        hp: monster.hp,
      };
    });
    await moveTo(12, 6);
    const card = page.locator("#monster-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".monster-card-name")).toHaveText(expected.name);
    await expect(card.locator(".monster-card-desc")).toHaveText(expected.description);
    await expect(card.locator(".monster-card-art")).toHaveAttribute("src", expected.art);
    await expect.poll(() => card.locator(".monster-card-art").evaluate(image => image.complete && image.naturalWidth === 192)).toBe(true);
    await expect(card.locator(".monster-card-art")).toHaveCSS("image-rendering", "auto");
    await expect(card).not.toContainText(String(expected.hp));
    await expect(card).not.toContainText(/\bHP\b/);
    await expect(page.locator("#tile-label")).toBeHidden();
    await expect(card).toHaveCSS("pointer-events", "none");
    const box = await card.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  });

  await test.step("the kobold card matches the 3D creature in the example", async () => {
    const kobold = await page.evaluate(() => ularnGraphics.creatures().find(monster => monster.tile.x === 10 && monster.tile.y === 6));
    expect(kobold).toMatchObject({ species: 5, model: "kobold", presentation: "model" });
    await moveTo(10, 6);
    const card = page.locator("#monster-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".monster-card-name")).toHaveText("kobold");
    await expect(card.locator(".monster-card-art")).toHaveAttribute("src", "/art/creatures/5.webp");
    await expect.poll(() => card.locator(".monster-card-art").evaluate(image => image.complete && image.naturalWidth === 192)).toBe(true);
  });

  await test.step("hidden monster gets no card", async () => {
    await moveTo(14, 10);
    await expect(page.locator("#monster-card")).toBeHidden();
    await expect(page.locator("#tile-label")).toHaveText("The floor");
    await expect(page.locator("#tile-label")).not.toContainText(/stalker/i);
  });

  await test.step("unidentified mimic keeps the plain name", async () => {
    const disguise = await page.evaluate(() => {
      const monster = ularn.snapshot().tiles.find((tile) => tile.x === 6 && tile.y === 6).monster;
      return monster.name;
    });
    expect(disguise.toLowerCase()).not.toBe("mimic");
    await moveTo(6, 6);
    await expect(page.locator("#monster-card")).toBeHidden();
    await expect(page.locator("#tile-label")).toHaveText(disguise);
    await expect(page.locator("#tile-label")).not.toContainText(/wearing some other shape/i);
  });

  await test.step("an item keeps its plain label", async () => {
    await moveTo(8, 10);
    await expect(page.locator("#monster-card")).toBeHidden();
    await expect(page.locator("#tile-label")).toHaveText("some gold");
    await expect(page.locator("#tile-label .tile-label-title")).toHaveCount(0);
  });
});
