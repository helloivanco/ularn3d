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

test("teleport-to-town scroll leaves a portal activated with e", async ({ page }) => {
  test.setTimeout(90000);
  const result = await page.evaluate(() => {
    initpricelist();
    player.setGold(10000);
    player.knownScrolls = [];
    // Shop stock is always catalog-priced (2500), even before the player learns it.
    const townIdx = dnd_item.findIndex((d) => d.itemId === OSCROLL.id && d.arg === 24);
    const shopPrice = dndItemPrice(townIdx);
    const beforeKnown = player.knownScrolls[24];
    // Simulate browsing: price must not depend on discovery.
    const browsed = createObject(OSCROLL, 24).toString(true);
    const beforeQty = dnd_item[townIdx].qty;
    // Simulate a buy without going through UI — infinite stock must not deplete.
    if (!dnd_item[townIdx].infinite) dnd_item[townIdx].qty--;
    const afterQty = dnd_item[townIdx].qty;

    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 500;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setMonster(x, y, null);
        setItem(x, y, OWALL);
        setKnow(x, y, KNOWNOT);
      }
    for (let x = 5; x < 18; x++)
      for (let y = 4; y < 13; y++) {
        setItem(x, y, OEMPTY);
        setKnow(x, y, KNOWALL);
      }
    player.x = 10;
    player.y = 8;
    setItem(10, 8, OEMPTY);
    read_scroll(createObject(OSCROLL, 24));
    const afterRead = {
      level,
      portalLink: townPortalLink && { ...townPortalLink },
      dungeonPortal: LEVELS[1]?.items[10][8]?.id,
      townPortalId: townPortalLink
        ? LEVELS[0]?.items[townPortalLink.townX][townPortalLink.townY]?.id
        : null,
      townIsStore: townPortalLink
        ? itemAt(townPortalLink.townX, townPortalLink.townY).isStore()
        : null,
    };
    // Stand on town portal and press e to return.
    if (townPortalLink) {
      player.x = townPortalLink.townX;
      player.y = townPortalLink.townY;
      activateTownPortal();
    }
    const afterReturn = {
      level,
      x: player.x,
      y: player.y,
    };
    return {
      townIdx,
      shopPrice,
      beforeKnown: !!beforeKnown,
      browsed,
      beforeQty,
      afterQty,
      infinite: !!dnd_item[townIdx].infinite,
      afterRead,
      afterReturn,
    };
  });

  expect(result.townIdx).toBeGreaterThanOrEqual(0);
  expect(result.shopPrice).toBe(2500);
  expect(result.beforeKnown).toBe(false);
  expect(result.browsed).toContain("teleport to town");
  expect(result.infinite).toBe(true);
  expect(result.afterQty).toBe(result.beforeQty);
  expect(result.afterRead.level).toBe(0);
  expect(result.afterRead.dungeonPortal).toBe(102);
  expect(result.afterRead.townPortalId).toBe(102);
  expect(result.afterRead.townIsStore).toBeFalsy();
  expect(result.afterReturn).toEqual({ level: 1, x: 10, y: 8 });
});

test("undiscovered floor scrolls share art; shop lists identified stock", async ({ page }) => {
  const art = await page.evaluate(async () => {
    const { itemArtPath } = await import("/src/item-art.js");
    player.knownScrolls = [];
    const a = itemArtPath(41, 0, false);
    const b = itemArtPath(41, 19, false);
    const c = itemArtPath(41, 0, true);
    initpricelist();
    const idx = dnd_item.findIndex((d) => d.itemId === OSCROLL.id && d.arg === 0);
    const price = dndItemPrice(idx);
    const shopName = createObject(OSCROLL, 0).toString(true);
    const floorName = createObject(OSCROLL, 0).toString(false);
    return { a, b, c, price, shopName, floorName, knownAfterBrowse: !!player.knownScrolls[0] };
  });
  expect(art.a).toBe("/art/items/scroll-unknown.png");
  expect(art.b).toBe(art.a);
  expect(art.c).toBe("/art/items/scroll-enchant-armor.png");
  expect(art.price).toBe(1000);
  expect(art.shopName).toContain("enchant armor");
  expect(art.floorName).not.toContain("enchant armor");
  expect(art.knownAfterBrowse).toBe(false);
});

test("wielded weapon mesh follows the carried weapon into the attack grip", async ({ page }) => {
  const result = await page.evaluate(() => {
    const dagger = createObject(ODAGGER);
    take(dagger);
    player.WIELD = dagger;
    paint();
    const afterDagger = ularnGraphics.heroWeapon();
    const axe = createObject(OBATTLEAXE);
    take(axe);
    player.WIELD = axe;
    paint();
    const afterAxe = ularnGraphics.heroWeapon();
    return { afterDagger, afterAxe, snapshot: ularn.snapshot().weapon };
  });
  expect(result.afterDagger.id).toBe(31);
  expect(result.afterAxe.id).toBe(57);
  expect(result.afterAxe.meshes).toBeGreaterThan(0);
  expect(result.afterAxe.hasArt).toBe(false);
  expect(result.snapshot.type).toBe("axe");
});
