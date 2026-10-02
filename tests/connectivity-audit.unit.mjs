/**
 * Procedural floors: 1000 connected levels per cave depth and per volcano depth.
 * Run via: node --test tests/connectivity-audit.unit.mjs
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
    setKnow() {},
    getKnow() {
      return 0;
    },
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
      x: 5, y: 5, BLINDCOUNT: 0,
      LAMP: false, WAND: false, SLAYING: false, NEGATESPIRIT: false,
      CUBEofUNDEAD: false, NOTHEFT: false, SLASH: false, BESSMANN: false,
      TALISMAN: false, HAND: false, ORB: false, ELVEN: false, SLAY: false,
      VORPAL: false, STAFF: false, PRESERVER: false, PAD: false,
      ELEVUP: false, ELEVDOWN: false
    };
    `,
    context,
  );
  return context;
};

test("a rock-locked floor is unreachable from the carve", () => {
  const ctx = boot();
  const result = vm.runInContext(
    `
    forceMazeSource = "procedural";
    const built = generateFreshLevel(3);
    const before = walkableReport(3).unreachable;
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        setItem(x, y, OWALL);
        setMonster(x, y, null);
      }
    }
    setItem(1, 1, OEMPTY);
    const after = walkableReport(3).unreachable;
    forceMazeSource = null;
    ({ builtOk: built.ok, before, after });
    `,
    ctx,
  );
  assert.equal(result.builtOk, true);
  assert.equal(result.before, 0);
  assert.ok(result.after >= 1);
});

test("a sealed room with no doorway is joined to the dungeon", () => {
  const ctx = boot();
  const result = vm.runInContext(
    `
    forceMazeSource = "procedural";
    const built = generateFreshLevel(4);
    const tx = 8, ty = 6, w = 7, h = 6;
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        setItem(x, y, OWALL);
        setMonster(x, y, null);
        doorProvenance.delete(x + "," + y);
      }
    }
    let interior = 0;
    for (let y = ty + 1; y < ty + h - 1; y++) {
      for (let x = tx + 1; x < tx + w - 1; x++) {
        setItem(x, y, OEMPTY);
        interior++;
      }
    }
    const before = walkableReport(4).unreachable;
    const joined = repairPlayableRegions(4);
    const after = walkableReport(4);
    const net = networkFromStart(4);
    let interiorReach = 0;
    let repairDoors = 0;
    for (let y = ty + 1; y < ty + h - 1; y++) {
      for (let x = tx + 1; x < tx + w - 1; x++) {
        if (net.has(x + "," + y)) interiorReach++;
      }
    }
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        const it = itemAt(x, y);
        if (!it || !it.matches(OCLOSEDDOOR)) continue;
        if (doorProvenance.get(x + "," + y) === "repair" && repairDoorValid(x, y)) repairDoors++;
      }
    }
    const wallBlocked = playerCanStep(tx + 1, ty + 1, tx, ty + 1) === false;
    forceMazeSource = null;
    ({
      builtOk: built.ok,
      before,
      joined,
      afterUnreachable: after.unreachable,
      afterInvalid: after.invalidDoors,
      interior,
      interiorReach,
      repairDoors,
      wallBlocked,
    });
    `,
    ctx,
  );
  assert.equal(result.builtOk, true);
  assert.ok(result.before > 0);
  assert.equal(result.joined, true);
  assert.equal(result.afterUnreachable, 0);
  assert.equal(result.afterInvalid, 0);
  assert.equal(result.interiorReach, result.interior);
  assert.ok(result.repairDoors >= 1);
  assert.equal(result.wallBlocked, true);
});

test("1000 maps per cave and volcano depth and source are fully reachable", { timeout: 2_700_000 }, () => {
  const ctx = boot();
  const summary = vm.runInContext(
    `
    const jobs = [];
    for (let depth = 1; depth <= 20; depth++) {
      if (depth === 1) jobs.push({ depth, source: "procedural" });
      else if (depth === 15 || depth === 20) jobs.push({ depth, source: "canned" });
      else {
        jobs.push({ depth, source: "procedural" });
        jobs.push({ depth, source: "canned" });
      }
    }
    const perDepth = [];
    const failures = [];
    let levels = 0;
    let unreachableWalkable = 0;
    let unreachableStairs = 0;
    let unreachablePopulated = 0;
    let invalidDoors = 0;
    let stairBandBad = 0;
    let attemptsSum = 0;
    let attemptsMax = 0;
    let gaveUp = 0;
    for (const job of jobs) {
      const depth = job.depth;
      forceMazeSource = job.source;
      let n = 0;
      let unreach = 0;
      let stairsBad = 0;
      let popBad = 0;
      let doorsBad = 0;
      let attemptSum = 0;
      let attemptMax = 0;
      for (let i = 0; i < 1000; i++) {
        USED_MAZES = [];
        const built = generateFreshLevel(depth);
        const report = built.report || walkableReport(depth);
        n++;
        levels++;
        const attempts = built.attempts || 0;
        attemptSum += attempts;
        attemptsSum += attempts;
        if (attempts > attemptMax) attemptMax = attempts;
        if (attempts > attemptsMax) attemptsMax = attempts;
        if (!built.ok) {
          gaveUp++;
          failures.push({ depth, seed: built.seed, attempts, ...report, gaveUp: true });
        }
        unreach += report.unreachable || 0;
        unreachableWalkable += report.unreachable || 0;
        unreachableStairs += report.unreachableStairs || 0;
        unreachablePopulated += report.unreachablePopulated || 0;
        invalidDoors += report.invalidDoors || 0;
        if ((report.unreachableStairs || 0) > 0) stairsBad++;
        if ((report.unreachablePopulated || 0) > 0) popBad++;
        if ((report.invalidDoors || 0) > 0) doorsBad++;
        const down = countItem(OSTAIRSDOWN);
        const up = countItem(OSTAIRSUP);
        if (needsStairsDown(depth) !== (down > 0)) stairBandBad++;
        if (needsStairsUp(depth) !== (up > 0)) stairBandBad++;
        if (depth === 1 && !findItemXY(OHOMEENTRANCE)) stairBandBad++;
        if ((report.unreachable || 0) > 0 || (report.unreachableStairs || 0) > 0 || (report.unreachablePopulated || 0) > 0 || (report.invalidDoors || 0) > 0 || !built.ok) {
          if (failures.length < 20) {
            failures.push({
              depth,
              seed: built.seed,
              attempts,
              walkable: report.walkable,
              reachable: report.reachable,
              unreachable: report.unreachable,
              stairs: report.stairs,
              unreachableStairs: report.unreachableStairs,
              unreachablePopulated: report.unreachablePopulated,
              doors: report.doors,
              invalidDoors: report.invalidDoors,
            });
          }
        }
      }
      perDepth.push({
        depth,
        source: job.source,
        levels: n,
        attemptsSum: attemptSum,
        attemptsMax: attemptMax,
        unreachableWalkable: unreach,
        unreachableStairs: stairsBad,
        unreachablePopulated: popBad,
        invalidDoors: doorsBad,
      });
    }
    forceMazeSource = null;
    const totals = {
      levels,
      unreachableWalkable,
      unreachableStairs,
      unreachablePopulated,
      invalidDoors,
      stairBandBad,
      attemptsSum,
      attemptsMax,
      gaveUp,
      failures,
    };
    console.log("CONNECTIVITY_AUDIT " + JSON.stringify({ totals, perDepth }));
    totals;
    `,
    ctx,
  );
  assert.equal(summary.levels, 37000);
  assert.equal(summary.unreachableWalkable, 0);
  assert.equal(summary.unreachableStairs, 0);
  assert.equal(summary.unreachablePopulated, 0);
  assert.equal(summary.invalidDoors, 0);
  assert.equal(summary.stairBandBad, 0);
  assert.equal(summary.gaveUp, 0);
  assert.equal(summary.failures.length, 0);
});
