/**
 * Ularn level rules: stairs by depth, canned doors, treasure-room doors, artifact thresholds.
 * Run via: node --test tests/ularn-level-rules.unit.mjs
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

test("artifact thresholds are the Ularn constants, brass lamp unchanged", () => {
  const create = read("public/engine/create.js");
  assert.match(create, /const ULARN_ARTIFACT_SIDES = 120/);
  assert.match(create, /const ULARN_ARTIFACT_UNDER = 8/);
  assert.match(create, /const ULARN_BRASS_LAMP_UNDER = 10/);
  assert.match(create, /const ULARN_SLAYER_GATE = 85/);
  assert.match(create, /OBRASSLAMP,\s+player\.LAMP,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_BRASS_LAMP_UNDER/);
  assert.match(create, /OWWAND,\s+player\.WAND,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OORBOFDRAGON,\s+player\.SLAYING,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OSPIRITSCARAB,\s+player\.NEGATESPIRIT,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OCUBEofUNDEAD,\s+player\.CUBEofUNDEAD,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /ONOTHEFT,\s+player\.NOTHEFT,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OSWORDofSLASHING,\s+player\.SLASH,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OHAMMER,\s+player\.BESSMANN,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OSPHTALISMAN,\s+player\.TALISMAN,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OHANDofFEAR,\s+player\.HAND,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OORB,\s+player\.ORB,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OELVENCHAIN,\s+player\.ELVEN,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OSLAYER,\s+player\.SLAY,\s+!created && depth >= 10 && rnd\(100\) > \(ULARN_SLAYER_GATE - \(depth - 10\)\)/);
  assert.match(create, /OVORPAL,\s+player\.VORPAL,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OPSTAFF,\s+player\.STAFF,\s+!created && depth >= 8 && rnd\(100\) > \(ULARN_SLAYER_GATE - \(depth - 10\)\)/);
  assert.match(create, /OLIFEPRESERVER,\s+player\.PRESERVER,\s+!created && depth >= 5 && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/);
  assert.doesNotMatch(create, /rnd\(120\) < 1[123]/);
  assert.doesNotMatch(create, /82 - \(depth - 10\)/);
});

test("120 generated levels keep stair bands, canned doors, and treasure-room doors", () => {
  const ctx = boot();
  const summary = vm.runInContext(
    `
    const W = MAXX;
    let built = 0, failed = 0, procDoors = 0, cannedMismatch = 0, stairBad = 0, treasureBad = 0;
    const failDepths = [];
    const doorCells = () => {
      const cells = [];
      for (let y = 0; y < MAXY; y++) {
        for (let x = 0; x < MAXX; x++) {
          const it = itemAt(x, y);
          if (it && (it.matches(OCLOSEDDOOR) || it.matches(OOPENDOOR))) cells.push(x + "," + y);
        }
      }
      cells.sort();
      return cells;
    };
    for (let pass = 0; pass < 6; pass++) {
      USED_MAZES = [];
      for (let depth = 1; depth <= 20; depth++) {
        let ok = false;
        for (let attempt = 0; attempt < 32 && !ok; attempt++) {
          initNewLevel(depth);
          resetLevelDoorBook();
          makemaze(depth);
          enforceDoorProvenance();
          makeobject(depth);
          ensureSpecialLevelArtifacts(depth);
          ensureLevelStairs(depth);
          enforceDoorProvenance();
          ok = levelTraversalOk(depth);
        }
        built++;
        if (!ok) {
          failed++;
          failDepths.push(depth);
          continue;
        }
        const doors = doorCells();
        if (levelFromCanned) {
          const maze = MAZES[USED_MAZES[USED_MAZES.length - 1]];
          const expect = [];
          for (let i = 0; i < maze.length; i++) {
            if (maze[i] === "D") expect.push((i % W) + "," + ((i / W) | 0));
          }
          expect.sort();
          if (expect.join("|") !== doors.join("|")) cannedMismatch++;
        } else {
          for (const key of doors) {
            if (doorProvenance.get(key) !== "treasure-room") procDoors++;
          }
          if (!doorsFollowProvenance()) treasureBad++;
        }
        const down = countItem(OSTAIRSDOWN);
        const up = countItem(OSTAIRSUP);
        if (needsStairsDown(depth) !== (down > 0)) stairBad++;
        if (needsStairsUp(depth) !== (up > 0)) stairBad++;
        if (depth === 1 && !findItemXY(OHOMEENTRANCE)) stairBad++;
        if (depth === 15 && (down > 0 || up < 1 || countItem(OLARNEYE) < 1)) stairBad++;
        if (depth === 16 && countItem(OVOLUP) < 1) stairBad++;
        if (depth >= 18 && down > 0) stairBad++;
        if (depth === 20 && (countItem(OPOTION, 21) < 1 || countItem(OPIT) < 1 || countItem(OIVTRAPDOOR) < 1)) stairBad++;
      }
    }
    ({ built, failed, failDepths, procDoors, cannedMismatch, stairBad, treasureBad });
    `,
    ctx,
  );
  assert.equal(summary.built, 120);
  assert.equal(summary.failed, 0);
  assert.equal(Number(summary.failDepths.length), 0);
  assert.equal(summary.procDoors, 0);
  assert.equal(summary.cannedMismatch, 0);
  assert.equal(summary.stairBad, 0);
  assert.equal(summary.treasureBad, 0);
});
