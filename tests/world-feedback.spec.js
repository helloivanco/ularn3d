import { test, expect } from "@playwright/test";

const faults = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  faults.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

async function room(page) {
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
    for (let x = 5; x < 17; x++) for (let y = 4; y < 13; y++) {
      setItem(x, y, OEMPTY);
      setKnow(x, y, KNOWALL);
    }
    paint();
  });
}

test("overhead view, species art and facing survive monster movement", async ({ page }) => {
  await room(page);
  await page.evaluate(() => {
    setMonster(12, 8, createMonster(GNOME));
    setMonster(14, 8, createMonster(JACKAL));
    setMonster(11, 9, createMonster(LEMMING));
    setItem(7, 6, OSTAIRSUP);
    setItem(8, 6, OSTAIRSDOWN);
    setItem(7, 10, OFOUNTAIN);
    setItem(8, 10, ODEADFOUNTAIN);
    paint();
  });
  await expect.poll(() => page.evaluate(() => ularnGraphics.creatures().length)).toBe(3);
  const before = await page.evaluate(() => ({ creatures: ularnGraphics.creatures(), metrics: ularnGraphics.metrics() }));
  expect(before.metrics.cameraElevation).toBeGreaterThan(55);
  expect(before.creatures.find((m) => m.species === 2).art).toBe("/engine/img/m2.png");
  expect(before.creatures.find((m) => m.species === 4).art).toBe("/engine/img/m4.png");
  expect(before.creatures.find((m) => m.species === 1).art).toBe("/art/monsters/lemming.png");
  const lemming = before.creatures.find((m) => m.species === 1);
  const facing = await page.evaluate(() => {
    mmove(11, 9, 10, 9); paint();
    const left = ularnGraphics.creatures().find((m) => m.species === 1);
    mmove(10, 9, 11, 9); paint();
    return { left, right: ularnGraphics.creatures().find((m) => m.species === 1) };
  });
  expect(facing.left.uid).toBe(lemming.uid);
  expect(facing.right.uid).toBe(lemming.uid);
  expect(facing.left.mirrored).not.toBe(facing.right.mirrored);
  const gnome = before.creatures.find((m) => m.species === 2);
  await page.evaluate(() => { mmove(12, 8, 11, 8); paint(); });
  await expect.poll(() => page.evaluate(() => ularnGraphics.creatures().find((m) => m.species === 2).facing.x)).toBe(-1);
  const after = await page.evaluate(() => ularnGraphics.creatures().find((m) => m.species === 2));
  expect(after.uid).toBe(gnome.uid);
  expect(after.tile).toEqual({ x: 11, y: 8 });
  await page.waitForTimeout(450);
  const landmarks = await page.evaluate(() => ularnGraphics.landmarks());
  expect(landmarks.find((t) => t.tile.x === 7 && t.tile.y === 6).stairDirection).toBe("up");
  expect(landmarks.find((t) => t.tile.x === 8 && t.tile.y === 6).stairDirection).toBe("down");
  expect(landmarks.find((t) => t.tile.x === 7 && t.tile.y === 10).waterVisible).toBe(true);
  expect(landmarks.find((t) => t.tile.x === 8 && t.tile.y === 10).waterVisible).toBe(false);
  await page.screenshot({ path: "test-results/world-feedback.png" });
  await page.evaluate(() => { setItem(7, 10, ODEADFOUNTAIN); paint(); });
  await expect.poll(() => page.evaluate(() => ularnGraphics.landmarks().find((t) => t.tile.x === 7 && t.tile.y === 10).waterVisible), { timeout: 6000 }).toBe(false);
  await page.screenshot({ path: "test-results/fountain-drained.png" });
});

test("notable artifacts use unique camera-facing art that mirrors with orbit", async ({ page }) => {
  await room(page);
  const expected = await page.evaluate(() => {
    const placements = [
      [6, 6, OORB],
      [7, 6, OSWORDofSLASHING],
      [8, 6, OHAMMER],
      [9, 6, OAMULET],
      [10, 6, OORBOFDRAGON],
      [11, 6, OSPIRITSCARAB],
      [12, 6, OCUBEofUNDEAD],
      [13, 6, ONOTHEFT],
      [6, 8, OBRASSLAMP],
      [7, 8, OHANDofFEAR],
      [8, 8, OSPHTALISMAN],
      [9, 8, OWWAND],
      [10, 8, OPSTAFF],
      [11, 8, OSLAYER],
      [12, 8, OELVENCHAIN],
    ];
    for (const [x, y, item] of placements) setItem(x, y, item);
    paint();
    return placements.map(([x, y, item]) => ({ x, y, id: item.id }));
  });
  await expect.poll(() => page.evaluate(() => ularnGraphics.props().length)).toBe(15);
  const props = await page.evaluate(() => ularnGraphics.props());
  const byId = Object.fromEntries(props.map((p) => [p.id, p]));
  const paths = {
    3: "/art/items/orb-of-enlightenment.png",
    26: "/art/items/sword-of-slashing.png",
    27: "/art/items/bessmans-flailing-hammer.png",
    45: "/art/items/amulet-of-invisibility.png",
    46: "/art/items/orb-of-dragon-slaying.png",
    47: "/art/items/scarab-of-negate-spirit.png",
    48: "/art/items/cube-of-undead-control.png",
    49: "/art/items/device-of-theft-prevention.png",
    85: "/art/items/brass-lamp.png",
    86: "/art/items/hand-of-fear.png",
    87: "/art/items/talisman-of-the-sphere.png",
    88: "/art/items/wand-of-wonder.png",
    89: "/art/items/staff-of-power.png",
    91: "/art/items/slayer.png",
    92: "/art/items/elven-chain.png",
  };
  for (const { id } of expected) {
    expect(byId[id].art).toBe(paths[id]);
  }
  const metrics = await page.evaluate(() => ularnGraphics.metrics());
  expect(metrics.itemTextures).toBe(15);
  const before = await page.evaluate(() => ularnGraphics.props().find((p) => p.id === 26).mirrored);
  await page.locator("#rotate-left").click();
  await page.locator("#rotate-left").click();
  await page.locator("#rotate-left").click();
  await page.locator("#rotate-left").click();
  await expect.poll(() => page.evaluate(() => ularnGraphics.props().find((p) => p.id === 26).mirrored)).not.toBe(before);
  await page.screenshot({ path: "test-results/item-art.png" });
});

test("idle and hidden rendering stops and gameplay wakes it without accumulating resources", async ({ page }) => {
  await room(page);
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().idle), { timeout: 8000 }).toBe(true);
  const idle = await page.evaluate(() => ularnGraphics.metrics());
  await page.waitForTimeout(400);
  expect((await page.evaluate(() => ularnGraphics.metrics())).renderedFrames).toBe(idle.renderedFrames);
  await page.keyboard.press(".");
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().renderedFrames)).toBeGreaterThan(idle.renderedFrames);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = await page.evaluate(() => ularnGraphics.metrics().renderedFrames);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => ularnGraphics.metrics().renderedFrames)).toBe(hidden);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().renderedFrames)).toBeGreaterThan(hidden);
  await page.evaluate(() => { setMonster(13, 8, createMonster(GNOME)); paint(); });
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().monsterTextures)).toBeGreaterThan(0);
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => ularnGraphics.metrics());
  await page.evaluate(() => {
    for (let i = 0; i < 80; i++) {
      const left = i % 2 === 0;
      mmove(left ? 13 : 12, 8, left ? 12 : 13, 8);
      paint();
    }
  });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ularnGraphics.metrics());
  expect(after.monsterActors).toBe(1);
  expect(after.monsterTextures).toBe(before.monsterTextures);
  expect(after.geometries).toBeLessThanOrEqual(before.geometries + 1);
  expect(after.textures).toBeLessThanOrEqual(before.textures);
});

test("accepted casts display bounded effects; cancelled and unknown spells do not", async ({ page }) => {
  await room(page);
  await page.evaluate(() => {
    player.SPELLS = player.SPELLMAX = 100;
    player.INTELLIGENCE = 100;
    player.LEVEL = 30;
    learnSpell("pro");
    paint();
  });
  await page.keyboard.press("c");
  await page.keyboard.press("Escape");
  expect((await page.evaluate(() => ularnGraphics.metrics())).activeEffects).toBe(0);
  await page.keyboard.press("c");
  await page.keyboard.type("pro");
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().lastSpell)).toBe("pro");
  await page.evaluate(() => {
    for (const code of ["pro", "dex", "str", "chm", "inb", "can", "has", "pro", "dex"]) {
      learnSpell(code);
      cast(code);
    }
    paint();
  });
  const active = await page.evaluate(() => ularnGraphics.metrics());
  expect(active.activeEffects).toBeLessThanOrEqual(active.effectCapacity);
  expect(active.effectPoints).toBeLessThanOrEqual(active.effectCapacity * 96);
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().activeEffects), { timeout: 8000 }).toBe(0);
  await page.evaluate(() => { learnSpell("mle"); cast("mle"); });
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().lastSpell)).toBe("mle");
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().effectPoints)).toBeGreaterThan(0);

  // Fast reflections can deliver multiple segments between rendered frames.
  // The orb must start on the current edge, not cut diagonally across the corner.
  const THREE = await import("three");
  const { CombatEffects } = await import("../src/combat-effects.js");
  const effects = new CombatEffects(new THREE.Scene());
  const event = { kind: "spell", castId: 1, level: 1, from: { x: 0, y: 0 },
    spell: { id: 3, code: "lit", name: "lightning" } };
  effects.event({ ...event, phase: "cast", path: [{ x: 0, y: 0 }] }, false);
  effects.event({ ...event, phase: "projectile", path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, false);
  effects.event({ ...event, phase: "projectile", path: [{ x: 1, y: 0 }, { x: 1, y: 1 }] }, false);
  const slot = effects.slots.find((effect) => effect.active);
  expect(slot.segmentStart.toArray()).toEqual([1, 0.48, 0]);
  expect(slot.segmentEnd.toArray()).toEqual([1, 0.48, 1]);
  effects.dispose();
});

test("context recovery releases off-scene sprite resources and full disposal clears the cache", async ({ page }) => {
  test.setTimeout(90000);
  await room(page);
  const state = await page.evaluate(() => {
    setMonster(12, 8, createMonster(GNOME));
    paint();
    return ularn.snapshot();
  });
  // An isolated renderer lets the test exercise full World.dispose without
  // leaving the application's normal keyboard/update listeners using it.
  await page.route("**/graphics-fixture", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><body style="margin:0"><div id="fixture"></div></body></html>',
  }));
  await page.goto("/graphics-fixture");
  await page.evaluate(async (snapshot) => {
    const { World } = await import("/src/world.js");
    window.fixtureState = snapshot;
    window.fixtureWorld = new World(document.querySelector("#fixture"), () => {}, () => {});
    fixtureWorld.update(snapshot);
    window.spriteDisposals = 0;
    window.cachedTexture = fixtureWorld.monsters.values().next().value.mesh.userData.artwork.material.map;
    cachedTexture.addEventListener("dispose", () => spriteDisposals++);
  }, state);
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().renderedFrames)).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => !!cachedTexture.image?.complete)).toBe(true);
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.evaluate(() => {
      fixtureWorld.update({ ...fixtureState,
        tiles: fixtureState.tiles.map((tile) => ({ ...tile, monster: null })),
      });
      window.contextExtension = document.querySelector("canvas").getContext("webgl2").getExtension("WEBGL_lose_context");
      contextExtension.loseContext();
    });
    await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().contextLost)).toBe(true);
    expect(await page.evaluate(() => spriteDisposals)).toBe(cycle + 1);
    await page.evaluate(() => contextExtension.restoreContext());
    await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().contextLost), { timeout: 15000 }).toBe(false);
    const before = await page.evaluate(() => {
      fixtureWorld.update(fixtureState);
      return ularnGraphics.metrics().renderedFrames;
    });
    await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().renderedFrames)).toBeGreaterThan(before);
    expect(await page.evaluate(() => {
      return fixtureWorld.monsters.values().next().value.mesh.userData.artwork.material.map === cachedTexture;
    })).toBe(true);
  }
  expect(await page.evaluate(() => {
    fixtureWorld.dispose();
    const { monsterTextures, monsterMaterials } = ularnGraphics.metrics();
    return { monsterTextures, monsterMaterials, canvases: document.querySelectorAll("canvas").length };
  })).toEqual({ monsterTextures: 0, monsterMaterials: 0, canvases: 0 });
});
