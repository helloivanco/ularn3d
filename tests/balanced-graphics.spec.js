import { inflateSync } from "node:zlib";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { stoneTint, WARM_STONE_LEVEL } from "../src/materials.js";
import {
  wallLip,
  WALL_CUT,
  WALL_FULL,
  WALL_LIP,
  WALL_LIP_CUT,
} from "../src/wall-cut.js";
import { hero, itemModel, monsterModel } from "../src/models.js";
import { ITEM_SPRITE_TINT, itemSprite } from "../src/item-art.js";
import { monsterSprite } from "../src/monster-art.js";

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

const centerLuma = (path, fraction = 0.34, percentile = 0.9) => {
  const buf = readFileSync(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported png color ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = new Array(height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = Buffer.alloc(stride);
    const prev = y > 0 ? rows[y - 1] : null;
    for (let i = 0; i < stride; i++) {
      const value = raw[src++];
      const left = i >= channels ? row[i - channels] : 0;
      const up = prev ? prev[i] : 0;
      const ul = prev && i >= channels ? prev[i - channels] : 0;
      if (filter === 0) row[i] = value;
      else if (filter === 1) row[i] = (value + left) & 255;
      else if (filter === 2) row[i] = (value + up) & 255;
      else if (filter === 3) row[i] = (value + ((left + up) >> 1)) & 255;
      else if (filter === 4) row[i] = (value + paeth(left, up, ul)) & 255;
      else throw new Error(`png filter ${filter}`);
    }
    rows[y] = row;
  }
  const x0 = Math.floor(width * (0.5 - fraction / 2));
  const x1 = Math.floor(width * (0.5 + fraction / 2));
  const y0 = Math.floor(height * (0.5 - fraction / 2));
  const y1 = Math.floor(height * (0.5 + fraction / 2));
  const lumas = [];
  for (let y = y0; y < y1; y++) {
    const row = rows[y];
    for (let x = x0; x < x1; x++) {
      const i = x * channels;
      lumas.push(0.2126 * row[i] + 0.7152 * row[i + 1] + 0.0722 * row[i + 2]);
    }
  }
  lumas.sort((a, b) => a - b);
  return lumas[Math.floor(percentile * (lumas.length - 1))];
};

test("floor and wall tints differ, and deeper stone matches the volcano", () => {
  const shallow = stoneTint(1);
  const deep = stoneTint(WARM_STONE_LEVEL);
  const volcano = stoneTint(16);
  expect(shallow.floor).not.toBe(shallow.wall);
  expect(deep.floor).not.toBe(deep.wall);
  expect(deep).toEqual(volcano);
  expect(deep.floor).not.toBe(shallow.floor);
  expect(deep.wall).not.toBe(shallow.wall);
  expect(stoneTint(0).floor).toBe(0xffffff);
});

test("cutaway walls keep a shorter lip than full-height walls", () => {
  const full = wallLip(WALL_FULL, false);
  const cut = wallLip(WALL_CUT, false);
  expect(full.thickness).toBe(WALL_LIP);
  expect(full.overhang).toBe(1.015);
  expect(cut.thickness).toBe(WALL_LIP_CUT);
  expect(cut.thickness).toBeLessThan(full.thickness);
  expect(cut.overhang).toBeLessThan(full.overhang);
  expect(wallLip(WALL_CUT, true)).toEqual({
    thickness: WALL_LIP,
    overhang: 1.015,
    y: WALL_CUT + 0.025,
  });
});

test("stairs, doors, and the town exit use an unlit accent", () => {
  const up = itemModel({ id: 5, name: "stairs" });
  const down = itemModel({ id: 13, name: "stairs" });
  const exit = itemModel({ id: 93, name: "town" });
  const closed = itemModel({ id: 20, name: "door" });
  const open = itemModel({ id: 19, name: "door" });
  for (const accent of [
    up.getObjectByName("stair-accent"),
    down.getObjectByName("stair-accent"),
    exit.getObjectByName("town-exit-accent"),
    closed.getObjectByName("door-accent"),
    open.getObjectByName("door-accent"),
  ]) {
    expect(accent?.material.type).toBe("MeshBasicMaterial");
  }
  expect(exit.getObjectByName("stair-accent")).toBeUndefined();
});

const installDocument = () => {
  if (globalThis.document?.createElementNS) return;
  globalThis.document = {
    createElementNS() {
      return {
        addEventListener() {},
        removeEventListener() {},
        set src(_) {},
      };
    },
  };
};

test("hero has a flat disc and a thin outline; monsters have a disc only", () => {
  installDocument();
  const player = hero();
  const disc = player.getObjectByName("contact-disc");
  expect(disc?.material.type).toBe("MeshBasicMaterial");
  expect(disc.material.map).toBeNull();
  let outlines = 0;
  player.traverse((obj) => {
    if (obj.name === "hero-outline") outlines++;
  });
  expect(outlines).toBeGreaterThan(4);
  const sprite = monsterSprite({ id: 2, name: "gnome" });
  const fallback = monsterModel({ id: 99, name: "statue", color: "#888" });
  for (const monster of [sprite, fallback]) {
    expect(monster.getObjectByName("contact-disc")?.material.map).toBeNull();
    let monsterOutline = 0;
    monster.traverse((obj) => {
      if (obj.name === "hero-outline") monsterOutline++;
    });
    expect(monsterOutline).toBe(0);
  }
});

test("gold and items brighten the sprite they already use", () => {
  installDocument();
  const gold = itemSprite({ id: 18, name: "gold", arg: 40 });
  const gem = itemSprite({ id: 50, name: "diamond", arg: 0 });
  expect(gold.userData.artPath).toBe("/art/items/gold-pile.png");
  expect(gem.userData.artPath).toBe("/art/items/diamond.png");
  const goldColor = gold.userData.artwork.material.color;
  const gemColor = gem.userData.artwork.material.color;
  expect(gold.userData.artwork.material.type).toBe("MeshBasicMaterial");
  expect(gem.userData.artwork.material.type).toBe("MeshBasicMaterial");
  expect(goldColor.r).toBeCloseTo(ITEM_SPRITE_TINT.gold[0]);
  expect(gemColor.r).toBeCloseTo(ITEM_SPRITE_TINT.item[0]);
  expect(goldColor.r).toBeGreaterThan(gemColor.r);
  expect(gemColor.r).toBeGreaterThan(1);
});

test("balanced dungeon keeps fog off, shadows off, and mapped floors", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("ularn3d.quality", "balanced"),
  );
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  const stats = await page.evaluate(() => {
    const read = (level) => {
      newcavelevel(level);
      paint();
      const metrics = ularnGraphics.metrics();
      return {
        quality: metrics.quality,
        fogDensity: metrics.fogDensity,
        shadowMapEnabled: metrics.shadowMapEnabled,
        bloom: metrics.bloom,
        floorMapped: metrics.floorMapped,
        wallMapped: metrics.wallMapped,
        floorMaterial: metrics.floorMaterial,
        floorSpan: metrics.floorSpan,
        floorColor: metrics.floorColor,
        wallColor: metrics.wallColor,
        pixelRatio: metrics.pixelRatio,
        anisotropy: metrics.floorAnisotropy,
        auraMaterial: metrics.auraMaterial,
        auraVisible: metrics.auraVisible,
        auraCastShadow: metrics.auraCastShadow,
        pointLights: metrics.pointLights,
      };
    };
    return {
      shallow: read(1),
      deep: read(12),
      volcano: read(16),
      town: read(0),
      auraButton: !!document.querySelector("#aura-toggle"),
    };
  });
  for (const row of [stats.shallow, stats.deep, stats.volcano]) {
    expect(row.quality).toBe("balanced");
    expect(row.fogDensity).toBe(0);
    expect(row.shadowMapEnabled).toBe(false);
    expect(row.bloom).toBe(false);
    expect(row.auraMaterial).toBe("MeshBasicMaterial");
    expect(row.auraVisible).toBe(false);
    expect(row.auraCastShadow).toBe(false);
    expect(row.pointLights).toBe(0);
    expect(row.floorMapped).toBe(true);
    expect(row.wallMapped).toBe(true);
    expect(row.floorMaterial).toBe("MeshBasicMaterial");
    expect(row.floorSpan).toBeGreaterThanOrEqual(1);
    expect(row.floorColor).not.toBe(row.wallColor);
    expect(row.pixelRatio).toBeLessThanOrEqual(0.75);
    expect(row.anisotropy).toBe(2);
  }
  expect(stats.deep.floorColor).toBe(stats.volcano.floorColor);
  expect(stats.deep.wallColor).toBe(stats.volcano.wallColor);
  expect(stats.deep.floorColor).not.toBe(stats.shallow.floorColor);
  expect(stats.town.auraVisible).toBe(false);
  expect(stats.auraButton).toBe(false);
  const multiplayer = await page.evaluate(() => {
    addAdventurer("Bea");
    newcavelevel(1);
    paint();
    return {
      on: ularnGraphics.metrics().auraVisible,
      buttonOn: document.querySelector("#aura-toggle")?.textContent ?? "",
    };
  });
  expect(multiplayer.on).toBe(true);
  expect(multiplayer.buttonOn).toBe("AURA: ON");
  await page.locator("#aura-toggle").click();
  const turnedOff = await page.evaluate(() => ({
    off: ularnGraphics.metrics().auraVisible,
    buttonOff: document.querySelector("#aura-toggle")?.textContent ?? "",
  }));
  expect(turnedOff.off).toBe(false);
  expect(turnedOff.buttonOff).toBe("AURA: OFF");
  const left = await page.evaluate(() => {
    disbandParty();
    paint();
    return {
      solo: ularnGraphics.metrics().auraVisible,
      buttonGone: !document.querySelector("#aura-toggle"),
    };
  });
  expect(left.solo).toBe(false);
  expect(left.buttonGone).toBe(true);
  expect(stats.town.shadowMapEnabled).toBe(false);
  expect(stats.town.bloom).toBe(false);
  expect(stats.town.pointLights).toBe(0);
});

test("the same corridor stays as bright zoomed out as zoomed in", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.addInitScript(() =>
    localStorage.setItem("ularn3d.quality", "balanced"),
  );
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  await page.evaluate(() => {
    newcavelevel(1);
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setMonster(x, y, null);
        const hall = x >= 8 && x <= 24 && y >= 9 && y <= 12;
        setItem(x, y, hall ? OEMPTY : OWALL);
        setKnow(x, y, KNOWALL);
      }
    setItem(10, 10, OSTAIRSDOWN);
    setItem(18, 11, OCLOSEDDOOR);
    setItem(20, 10, OHOMEENTRANCE);
    setItem(14, 11, createObject(OGOLDPILE, 80));
    setItem(15, 11, createObject(ODIAMOND, 0));
    setMonster(16, 10, createMonster(GNOME));
    player.x = 13;
    player.y = 10;
    paint();
  });
  const settle = async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
  };
  await page.locator("#camera-reset").click();
  for (let i = 0; i < 4; i++) await page.locator("#zoom-in").click();
  await settle();
  const world = page.locator("canvas[data-engine]");
  const zoomIn = testInfo.outputPath("balanced-zoom-in.png");
  await world.screenshot({ path: zoomIn });
  await page.locator("#camera-reset").click();
  for (let i = 0; i < 5; i++) await page.locator("#zoom-out").click();
  await settle();
  const zoomOut = testInfo.outputPath("balanced-zoom-out.png");
  await world.screenshot({ path: zoomOut });
  const media = process.env.BALANCED_GRAPHICS_MEDIA;
  if (media) {
    mkdirSync(media, { recursive: true });
    copyFileSync(zoomIn, join(media, "balanced-graphics-zoom-in.png"));
    copyFileSync(zoomOut, join(media, "balanced-graphics-zoom-out.png"));
  }
  const near = centerLuma(zoomIn);
  const far = centerLuma(zoomOut);
  console.log("corridor luma", { near, far, ratio: far / near });
  expect(far).toBeGreaterThan(80);
  expect(near).toBeGreaterThan(80);
  expect(Math.abs(far - near) / near).toBeLessThan(0.1);
  const locks = await page.evaluate(() => {
    const metrics = ularnGraphics.metrics();
    return {
      fogDensity: metrics.fogDensity,
      shadowMapEnabled: metrics.shadowMapEnabled,
      floorMapped: metrics.floorMapped,
    };
  });
  expect(locks.fogDensity).toBe(0);
  expect(locks.shadowMapEnabled).toBe(false);
  expect(locks.floorMapped).toBe(true);
});
