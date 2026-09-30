/**
 * Teleport landings: town grid, cave/volcano floor, and a forced bad roll.
 * Run via: node --test tests/teleport-landing.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(path, "utf8");

const boot = () => {
  function Storage() {}
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Math,
    Date,
    JSON,
    Map,
    Set,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    Storage,
    ULARN: true,
    DEBUG_NO_MONSTERS: false,
    diroffx: [0, 0, 1, 0, -1, 1, -1, 1, -1],
    diroffy: [0, 1, 0, -1, 0, -1, -1, 1, 1],
    KNOWALL: 3,
    KNOWHERE: 1,
    KNOWNOT: 0,
    GOTW: false,
    changedDepth: 0,
    screen: null,
    setKnow() {},
    getKnow() {
      return 0;
    },
    showcell() {},
    updateLog() {},
    appendLog() {},
    isGenocided() {
      return false;
    },
    genocide: [],
    wizard: 0,
    HARDGAME: 0,
    GAMEOVER: false,
    game_started: true,
    mazeMode: false,
    napping: false,
    gtime: 0,
    level: 0,
    getPref() {
      return false;
    },
    colorText(text) {
      return text;
    },
    amiga_mode: false,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  for (const file of [
    "public/engine/common/util.js",
    "public/engine/data.js",
    "public/engine/object.js",
    "public/engine/monster.js",
    "public/engine/monsterdata.js",
    "public/engine/level.js",
    "public/engine/mazes.js",
    "public/engine/spellsinfo.js",
    "public/engine/storedata.js",
    "public/engine/config.js",
    "public/engine/state.js",
    "public/engine/global.js",
    "public/engine/create.js",
  ]) {
    vm.runInContext(read(file), context, { filename: file });
  }
  vm.runInContext(
    `
    ULARN = true;
    setGameConfig();
    player = {
      x: 5, y: 5, BLINDCOUNT: 0, TELEFLAG: 1, WTW: 0, LEVEL: 10,
      LAMP: false, WAND: false, SLAYING: false, NEGATESPIRIT: false,
      CUBEofUNDEAD: false, NOTHEFT: false, SLASH: false, BESSMANN: false,
      TALISMAN: false, HAND: false, ORB: false, ELVEN: false, SLAY: false,
      VORPAL: false, STAFF: false, PRESERVER: false, PAD: false,
      ELEVUP: false, ELEVDOWN: false
    };
    globalThis.OWALL = OWALL;
    globalThis.OEMPTY = OEMPTY;
    globalThis.OCLOSEDDOOR = OCLOSEDDOOR;
    globalThis.OSTAIRSDOWN = OSTAIRSDOWN;
    globalThis.OSTAIRSUP = OSTAIRSUP;
    globalThis.OHOMEENTRANCE = OHOMEENTRANCE;
    globalThis.OVOLUP = OVOLUP;
    globalThis.OVOLDOWN = OVOLDOWN;
    globalThis.OLARNEYE = OLARNEYE;
    globalThis.MAXX = MAXX;
    globalThis.MAXY = MAXY;
    globalThis.MAXLEVEL = MAXLEVEL;
    `,
    context,
  );
  return context;
};

const passCell = (ctx, x, y, town) => {
  if (!ctx.inBounds(x, y)) return false;
  if (town && !ctx.inTown(x, y)) return false;
  const item = ctx.itemAt(x, y);
  return !!(item && !item.matches(ctx.OWALL));
};

const componentKeys = (ctx, sx, sy, town) => {
  const seen = new Set();
  if (!passCell(ctx, sx, sy, town)) return seen;
  const q = [[sx, sy]];
  seen.add(`${sx},${sy}`);
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !passCell(ctx, nx, ny, town)) continue;
      seen.add(key);
      q.push([nx, ny]);
    }
  }
  return seen;
};

const anchorCells = (ctx) => {
  const found = [];
  for (let y = 0; y < ctx.MAXY; y++) {
    for (let x = 0; x < ctx.MAXX; x++) {
      const item = ctx.itemAt(x, y);
      if (!item) continue;
      if (
        item.matches(ctx.OSTAIRSDOWN) ||
        item.matches(ctx.OSTAIRSUP) ||
        item.matches(ctx.OHOMEENTRANCE) ||
        item.matches(ctx.OVOLUP) ||
        item.matches(ctx.OVOLDOWN) ||
        item.matches(ctx.OLARNEYE)
      ) found.push([x, y]);
    }
  }
  return found;
};

const playableKeys = (ctx) => {
  const town = ctx.level === 0;
  if (town) {
    let best = new Set();
    const claimed = new Set();
    const b = ctx.townBounds();
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const key = `${x},${y}`;
        if (claimed.has(key) || !passCell(ctx, x, y, true)) continue;
        const comp = componentKeys(ctx, x, y, true);
        for (const cell of comp) claimed.add(cell);
        if (comp.size > best.size) best = comp;
      }
    }
    return best;
  }
  let best = new Set();
  const claimed = new Set();
  for (const [x, y] of anchorCells(ctx)) {
    const key = `${x},${y}`;
    if (claimed.has(key)) continue;
    const comp = componentKeys(ctx, x, y, false);
    for (const cell of comp) claimed.add(cell);
    if (comp.size > best.size) best = comp;
  }
  if (best.size) return best;
  const allClaimed = new Set();
  for (let y = 0; y < ctx.MAXY; y++) {
    for (let x = 0; x < ctx.MAXX; x++) {
      const key = `${x},${y}`;
      if (allClaimed.has(key) || !passCell(ctx, x, y, false)) continue;
      const comp = componentKeys(ctx, x, y, false);
      for (const cell of comp) allClaimed.add(cell);
      if (comp.size > best.size) best = comp;
    }
  }
  return best;
};

const assertLegalLanding = (ctx, label) => {
  const x = ctx.player.x;
  const y = ctx.player.y;
  const town = ctx.level === 0;
  assert.equal(ctx.inBounds(x, y), true, `${label} out of bounds ${x},${y}`);
  if (town) assert.equal(ctx.inTown(x, y), true, `${label} left town ${x},${y}`);
  const item = ctx.itemAt(x, y);
  assert.ok(item, `${label} missing tile`);
  assert.equal(item.matches(ctx.OWALL), false, `${label} rock ${x},${y}`);
  assert.equal(item.matches(ctx.OCLOSEDDOOR), false, `${label} closed door ${x},${y}`);
  if (town) assert.equal(!!item.isStore(), false, `${label} building ${x},${y}`);
  assert.equal(ctx.monsterAt(x, y) == null, true, `${label} monster ${x},${y}`);
  let open = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (!passCell(ctx, nx, ny, town)) continue;
    const neighbor = ctx.itemAt(nx, ny);
    if (!neighbor || neighbor.matches(ctx.OCLOSEDDOOR)) continue;
    open++;
  }
  assert.ok(open >= 1, `${label} no open neighbor ${x},${y}`);
  const net = playableKeys(ctx);
  assert.ok(net.size >= 2, `${label} playable network`);
  assert.equal(net.has(`${x},${y}`), true, `${label} disconnected ${x},${y}`);
  assert.equal(ctx.teleportDestinationOk(x, y), true, `${label} engine rejected its own landing`);
};

const paintWalls = (ctx) => {
  for (let y = 0; y < ctx.MAXY; y++) {
    for (let x = 0; x < ctx.MAXX; x++) {
      ctx.setItem(x, y, ctx.OWALL);
      ctx.setMonster(x, y, null);
    }
  }
};

const paintFloor = (ctx, x0, y0, x1, y1) => {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      ctx.setItem(x, y, ctx.OEMPTY);
      ctx.setMonster(x, y, null);
    }
  }
};

test("town teleport stays on town floor", { timeout: 120000 }, () => {
  const ctx = boot();
  const built = ctx.generateFreshLevel(0);
  assert.equal(built.ok, true);
  assert.equal(ctx.level, 0);
  ctx.setLevelRng(null);
  for (let i = 0; i < 24; i++) {
    assert.equal(ctx.placeTeleportLanding(), true, `town place ${i}`);
    assertLegalLanding(ctx, `town place ${i}`);
  }
  for (let i = 0; i < 12; i++) {
    ctx.oteleport(0, null);
    assert.equal(ctx.level, 0, `town scroll left level ${i}`);
    assertLegalLanding(ctx, `town scroll ${i}`);
  }
  assert.equal(ctx.teleportDestinationOk(-1, 1), false);
  assert.equal(ctx.teleportDestinationOk(ctx.MAXX, 1), false);
  assert.equal(ctx.teleportDestinationOk(0, 0), false);
  assert.equal(ctx.teleportDestinationOk(1, 1), false);
});

test("dungeon and volcano teleport stay on the connected floor", { timeout: 180000 }, () => {
  const ctx = boot();
  for (const depth of [1, 8, 15, 16, 20]) {
    const built = ctx.generateFreshLevel(depth);
    assert.equal(built.ok, true, `depth ${depth} failed to generate`);
    assert.equal(ctx.level, depth);
    ctx.setLevelRng(null);
    ctx.player.TELEFLAG = 1;
    ctx.player.WTW = 0;
    for (let i = 0; i < 8; i++) {
      assert.equal(ctx.placeTeleportLanding(), true, `depth ${depth} place ${i}`);
      assert.equal(ctx.level, depth);
      assertLegalLanding(ctx, `depth ${depth} place ${i}`);
    }
  }
  ctx.generateFreshLevel(8);
  ctx.setLevelRng(null);
  ctx.player.TELEFLAG = 1;
  for (let i = 0; i < 3; i++) {
    ctx.oteleport(0, null);
    assert.ok(ctx.level >= 1 && ctx.level < ctx.MAXLEVEL, `dungeon teleport level ${ctx.level}`);
    assertLegalLanding(ctx, `dungeon scroll ${i}`);
  }
  ctx.generateFreshLevel(16);
  ctx.setLevelRng(null);
  ctx.player.TELEFLAG = 1;
  for (let i = 0; i < 3; i++) {
    ctx.oteleport(0, null);
    assert.ok(ctx.level >= ctx.MAXLEVEL, `volcano teleport level ${ctx.level}`);
    assertLegalLanding(ctx, `volcano scroll ${i}`);
  }
  ctx.generateFreshLevel(8);
  ctx.setLevelRng(null);
  ctx.player.x = 10;
  ctx.player.y = 8;
  ctx.oelevator(1);
  assert.ok(ctx.level >= 0 && ctx.level < 8, `elevator level ${ctx.level}`);
  assertLegalLanding(ctx, "elevator");
});

test("a forced bad roll does not stick the player in rock or outside the map", { timeout: 60000 }, () => {
  const ctx = boot();
  ctx.initNewLevel(5);
  paintWalls(ctx);
  paintFloor(ctx, 8, 8, 12, 12);
  ctx.setItem(10, 10, ctx.OSTAIRSDOWN);
  ctx.setItem(2, 2, ctx.OEMPTY);
  paintFloor(ctx, 2, 6, 3, 6);
  ctx.setItem(4, 4, ctx.OEMPTY);
  ctx.setItem(5, 4, ctx.OCLOSEDDOOR);
  ctx.player.x = -4;
  ctx.player.y = 99;
  ctx.player.TELEFLAG = 1;
  ctx.player.WTW = 0;
  let n = 0;
  ctx.setLevelRng(() => {
    n += 1;
    return n % 2 === 1 ? 1 / 55 : 1 / 18;
  });
  assert.equal(ctx.teleportDestinationOk(2, 2), false);
  assert.equal(ctx.teleportDestinationOk(2, 6), false);
  assert.equal(ctx.teleportDestinationOk(4, 4), false);
  assert.equal(ctx.teleportDestinationOk(5, 4), false);
  assert.equal(ctx.teleportDestinationOk(-1, 8), false);
  assert.equal(ctx.teleportDestinationOk(ctx.MAXX, 8), false);
  assert.equal(ctx.placeTeleportLanding(), true);
  assert.equal(ctx.level, 5);
  assertLegalLanding(ctx, "bad dungeon roll");
  assert.ok(!(ctx.player.x === 2 && ctx.player.y === 2));
  assert.ok(!(ctx.player.x === 2 && ctx.player.y === 6));
  assert.ok(!(ctx.player.x === 3 && ctx.player.y === 6));
  assert.ok(!(ctx.player.x === 4 && ctx.player.y === 4));

  n = 0;
  ctx.setLevelRng(() => {
    n += 1;
    if (n === 1) return 0.4;
    return n % 2 === 0 ? 1 / 55 : 1 / 18;
  });
  ctx.player.x = 10;
  ctx.player.y = 10;
  ctx.oteleport(0, null);
  assert.equal(ctx.level, 5);
  assertLegalLanding(ctx, "bad scroll roll");
  assert.ok(!(ctx.player.x === 2 && ctx.player.y === 2));

  ctx.initNewLevel(0);
  paintWalls(ctx);
  const b = ctx.townBounds();
  paintFloor(ctx, 24, 6, 28, 10);
  ctx.setItem(b.x0, b.y0, ctx.OWALL);
  ctx.setItem(22, 3, ctx.OEMPTY);
  paintFloor(ctx, 20, 16, 21, 16);
  ctx.player.x = -1;
  ctx.player.y = -1;
  ctx.setLevelRng(() => 0);
  assert.equal(ctx.teleportDestinationOk(b.x0, b.y0), false);
  assert.equal(ctx.teleportDestinationOk(1, 1), false);
  assert.equal(ctx.teleportDestinationOk(22, 3), false);
  assert.equal(ctx.teleportDestinationOk(20, 16), false);
  assert.equal(ctx.placeTeleportLanding(), true);
  assert.equal(ctx.level, 0);
  assertLegalLanding(ctx, "bad town roll");
  assert.ok(ctx.player.x >= 24 && ctx.player.x <= 28);
  assert.ok(ctx.player.y >= 6 && ctx.player.y <= 10);

  ctx.setLevelRng(() => 0);
  ctx.player.x = 26;
  ctx.player.y = 8;
  ctx.oteleport(0, null);
  assert.equal(ctx.level, 0);
  assertLegalLanding(ctx, "bad town scroll");
  assert.ok(ctx.inTown(ctx.player.x, ctx.player.y));

  ctx.initNewLevel(5);
  paintWalls(ctx);
  ctx.setItem(2, 2, ctx.OEMPTY);
  ctx.player.x = 9;
  ctx.player.y = 9;
  ctx.player.TELEFLAG = 1;
  n = 0;
  ctx.setLevelRng(() => {
    n += 1;
    if (n === 1) return 0.4;
    return n % 2 === 0 ? 1 / 55 : 1 / 18;
  });
  ctx.oteleport(0, null);
  assert.equal(ctx.level, 5);
  assert.equal(ctx.player.x, 9, "bad roll with nowhere to stand must not move");
  assert.equal(ctx.player.y, 9, "bad roll with nowhere to stand must not move");
  assert.equal(ctx.inBounds(ctx.player.x, ctx.player.y), true);
  assert.ok(!(ctx.player.x === 2 && ctx.player.y === 2));
});
