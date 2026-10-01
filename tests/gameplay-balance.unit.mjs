import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const spells = readFileSync("public/engine/spells.js", "utf8");
const monster = readFileSync("public/engine/monster.js", "utf8");
const create = readFileSync("public/engine/create.js", "utf8");
const potion = readFileSync("public/engine/potion.js", "utf8");
const scroll = readFileSync("public/engine/scroll.js", "utf8");
const main = readFileSync("src/main.js", "utf8");
const itemArt = readFileSync("src/item-art.js", "utf8");

test("sonic spear has a slightly higher Ularn statue crumble chance", () => {
  assert.match(spells, /if \(ULARN\) doCrumble = getDifficulty\(\) <= 3 && rnd\(60\) < 36/);
});

test("giant centipede and ant strength drain is 20%", () => {
  assert.match(monster, /rnd\(100\) >= 20/);
  assert.match(monster, /stung you! You feel weaker/);
});

const readConst = (name) => {
  const match = create.match(new RegExp(`const ${name} = (\\d+)`));
  assert.ok(match, `${name} is missing`);
  return Number(match[1]);
};

/* rnd(n) is 1..n, so rnd(sides) < under succeeds (under - 1) times. */
const underPercent = (under, sides) => ((under - 1) / sides) * 100;

/* rnd(100) > (gate - (depth - 10)) succeeds once per point below 100. */
const depthPercent = (gate, depth) => {
  const threshold = gate - (depth - 10);
  let hits = 0;
  for (let roll = 1; roll <= 100; roll++) if (roll > threshold) hits++;
  return hits;
};

test("brass lamp is 6/120 (5%), not the previous threshold of 10", () => {
  assert.equal(readConst("ULARN_BRASS_LAMP_UNDER"), 7);
  assert.equal(underPercent(readConst("ULARN_BRASS_LAMP_UNDER"), 120), 5);
  assert.match(create, /OBRASSLAMP,\s+player\.LAMP,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_BRASS_LAMP_UNDER/);
});

test("rare artifacts keep threshold 8 except the six named 1.3.29 rates", () => {
  assert.equal(readConst("ULARN_ARTIFACT_SIDES"), 120);
  assert.equal(readConst("ULARN_ARTIFACT_UNDER"), 8);
  assert.equal(readConst("ULARN_SLASHING_UNDER"), 10);
  assert.equal(readConst("ULARN_ELVEN_CHAIN_UNDER"), 11);
  assert.equal(readConst("ULARN_ORB_UNDER"), 11);
  assert.equal(readConst("ULARN_SLAYER_GATE"), 90);
  assert.equal(readConst("ULARN_STAFF_GATE"), 87);
  assert.match(create, /OSWORDofSLASHING,\s+player\.SLASH,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_SLASHING_UNDER/);
  assert.match(create, /OELVENCHAIN,\s+player\.ELVEN,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ELVEN_CHAIN_UNDER/);
  assert.match(create, /OORB,\s+player\.ORB,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ORB_UNDER/);
  assert.match(create, /OSLAYER,\s+player\.SLAY,\s+!created && depth >= 10 && rnd\(100\) > \(ULARN_SLAYER_GATE - \(depth - 10\)\)/);
  assert.match(create, /OPSTAFF,\s+player\.STAFF,\s+!created && depth >= 8 && rnd\(100\) > \(ULARN_STAFF_GATE - \(depth - 10\)\)/);
  for (const line of [
    /OWWAND,\s+player\.WAND,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/,
    /OORBOFDRAGON,\s+player\.SLAYING,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/,
    /OSPIRITSCARAB,\s+player\.NEGATESPIRIT,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/,
    /OCUBEofUNDEAD,\s+player\.CUBEofUNDEAD,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/,
    /ONOTHEFT,\s+player\.NOTHEFT,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/,
    /OHAMMER,\s+player\.BESSMANN,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/,
    /OSPHTALISMAN,\s+player\.TALISMAN,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/,
    /OHANDofFEAR,\s+player\.HAND,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/,
    /OVORPAL,\s+player\.VORPAL,\s+!created && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/,
    /OLIFEPRESERVER,\s+player\.PRESERVER,\s+!created && depth >= 5 && rnd\(ULARN_ARTIFACT_SIDES\) < ULARN_ARTIFACT_UNDER/,
  ]) {
    assert.match(create, line);
  }
  assert.doesNotMatch(create, /rnd\(120\) < 1[123]/);
  assert.doesNotMatch(create, /82 - \(depth - 10\)/);
  assert.doesNotMatch(create, /OPSTAFF[\s\S]{0,160}ULARN_SLAYER_GATE/);
});

test("named rare-item rolls match the 1.3.29 discrete table", (t) => {
  const sides = readConst("ULARN_ARTIFACT_SIDES");
  const rows = [
    ["Brass Lamp", 7.5, -2.5, underPercent(readConst("ULARN_BRASS_LAMP_UNDER"), sides)],
    ["Sword of Slashing", 5.833333, 1.5, underPercent(readConst("ULARN_SLASHING_UNDER"), sides)],
    ["Elven Chain", 5.833333, 2.3, underPercent(readConst("ULARN_ELVEN_CHAIN_UNDER"), sides)],
    ["Orb of Enlightenment", 5.833333, 2.4, underPercent(readConst("ULARN_ORB_UNDER"), sides)],
  ];
  const slayerGate = readConst("ULARN_SLAYER_GATE");
  const staffGate = readConst("ULARN_STAFF_GATE");
  const depthName = (depth) => (depth <= 15 ? `D${depth}` : `V${depth - 15}`);
  for (let depth = 10; depth <= 20; depth++) {
    rows.push([
      `Slayer ${depthName(depth)}`,
      15 + (depth - 10),
      -5,
      depthPercent(slayerGate, depth),
    ]);
  }
  for (let depth = 8; depth <= 20; depth++) {
    rows.push([
      `Staff ${depthName(depth)}`,
      13 + (depth - 8),
      -2,
      depthPercent(staffGate, depth),
    ]);
  }

  assert.equal(rows[0][3], 5);
  assert.equal(rows[1][3], 7.5);
  assert.equal(rows[2][3], (10 / 120) * 100);
  assert.equal(rows[3][3], (10 / 120) * 100);
  /* Exact 7.333%, 8.133%, and 8.233% are not on a 1–120 roll. */
  assert.notEqual(rows[1][3], 7.333333);
  assert.ok(Math.abs(rows[1][3] - (rows[1][1] + rows[1][2])) < Math.abs((8 / 120) * 100 - (rows[1][1] + rows[1][2])));
  assert.ok(Math.abs(rows[2][3] - (rows[2][1] + rows[2][2])) < Math.abs((9 / 120) * 100 - (rows[2][1] + rows[2][2])));
  assert.ok(Math.abs(rows[3][3] - (rows[3][1] + rows[3][2])) < Math.abs((9 / 120) * 100 - (rows[3][1] + rows[3][2])));

  for (const [label, oldPct, delta, actual] of rows) {
    if (label.startsWith("Slayer") || label.startsWith("Staff")) {
      assert.equal(actual, oldPct + delta, label);
    }
    t.diagnostic(
      `${label.padEnd(22)} old ${oldPct.toFixed(3)}%  change ${delta.toFixed(3)}  new ${actual.toFixed(3)}%`,
    );
  }
});

test("loot goblin flees, despawns, and drops equal-chance loot", () => {
  const movem = readFileSync("public/engine/movem.js", "utf8");
  const monsterdata = readFileSync("public/engine/monsterdata.js", "utf8");
  const global = readFileSync("public/engine/global.js", "utf8");
  assert.match(monsterdata, /loot goblin/);
  assert.match(monsterdata, /LOOTGOBLIN = 66/);
  assert.match(movem, /flee_move/);
  assert.match(movem, /lootGoblinTurns >= 200/);
  assert.match(global, /function createEqualChanceItem/);
  assert.match(create, /fillmonst\(LOOTGOBLIN/);
});

test("canned mazes are fitted original Ularn maps on the 57x20 grid", () => {
  const mazesSrc = readFileSync("public/engine/mazes.js", "utf8");
  assert.match(mazesSrc, /const TREASURE_MAZES = \[\]/);
  assert.match(mazesSrc, /const ULARN_MAZES = \[\]/);
  assert.match(create, /function eat\(/);
  assert.match(create, /eat\(1, 1\)/);
  assert.match(create, /function ensureLevelStairs/);
  assert.match(create, /function createDepthLoot/);
  assert.match(create, /noteDoor\(x, y, "canned"\)/);
  assert.doesNotMatch(create, /function buildRoomCorridorMaze/);
  assert.doesNotMatch(create, /function placeRareTreasureRoom/);
  assert.doesNotMatch(create, /function sculptLabyrinthDensity/);
  const vm = require("node:vm");
  const sandbox = {};
  vm.runInNewContext(
    mazesSrc +
      "\nthis.ULARN=ULARN_MAZES;this.TREASURE=TREASURE_MAZES;this.COMMON=COMMON_MAZES;",
    sandbox,
  );
  assert.equal(sandbox.ULARN.length, 0);
  assert.equal(sandbox.TREASURE.length, 0);
  assert.equal(sandbox.COMMON.length, 21);
  assert.ok(sandbox.COMMON.every((m) => m.length === 57 * 20));
});

test("adventurer name is remembered across sessions", () => {
  assert.match(main, /ularn3d\.heroName/);
  assert.match(main, /readRememberedHeroName/);
  assert.match(main, /rememberHeroName/);
});

test("makeobject keeps classic potion/scroll/gold counts", () => {
  assert.match(create, /for \(i = 0; i < rnd\(4\) \+ 3; i\+\+\)/);
  assert.match(create, /for \(i = 0; i < rnd\(5\) \+ 3; i\+\+\)/);
  assert.match(create, /for \(i = 0; i < rnd\(12\) \+ 11; i\+\+\)/);
});

test("town portal from town consumes the portal pair", () => {
  assert.match(scroll, /Town → dungeon consumes the portal pair/);
  assert.match(scroll, /clearTownPortals\(\)/);
  assert.match(scroll, /function placeTownPortalPair/);
  /* New portal replaces any existing one. */
  assert.match(scroll, /placeTownPortalPair[\s\S]*clearTownPortals/);
});

test("town buildings require one empty square of clearance", () => {
  assert.match(create, /function fillTownBuilding/);
  assert.match(create, /function townBuildingClearanceOk/);
  assert.match(create, /fillTownBuilding\(OENTRANCE/);
  assert.match(create, /fillTownBuilding\(OHOME/);
});

test("self-cast spell buffs refresh instead of stacking", () => {
  assert.match(spells, /function refreshSelfSpell/);
  assert.match(spells, /refreshSelfSpell\(\(\) => player\.PROTECTIONTIME/);
  assert.match(spells, /refreshSelfSpell\(\(\) => player\.HASTESELF/);
  assert.match(spells, /player\.GLOBE = 200/);
  assert.doesNotMatch(spells, /player\.GLOBE \+= 200/);
});

test("potion and scroll duration effects still accumulate", () => {
  assert.match(potion, /player\.HERO \+= 250/);
  assert.match(potion, /player\.updateGiantStr\(700\)/);
  assert.match(potion, /player\.updateFireResistance\(1000\)/);
  assert.match(scroll, /player\.AWARENESS \+= 1800/);
  assert.match(scroll, /player\.updateSpiritPro\(300 \+ rnd\(200\)\)/);
  assert.match(scroll, /player\.updateHoldMonst\(30\)/);
});

test("undiscovered potions share one art path", () => {
  assert.match(itemArt, /UNKNOWN_POTION_ART = "\/art\/items\/potion-unknown\.png"/);
  assert.match(itemArt, /if \(!known\) return UNKNOWN_POTION_ART/);
});

test("minimap stairs are color coded green up and red down", () => {
  assert.match(main, /STAIR_UP_IDS/);
  assert.match(main, /STAIR_DOWN_IDS/);
  assert.match(main, /#e07070/);
  assert.match(main, /#6ecf7a/);
  assert.match(main, /function mapGlyphColor/);
});
