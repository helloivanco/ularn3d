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

test("brass lamp stays at the current threshold, not classic rnd(120) < 8", () => {
  assert.match(create, /const ULARN_BRASS_LAMP_UNDER = 10/);
  assert.match(create, /OBRASSLAMP[\s\S]*ULARN_BRASS_LAMP_UNDER/);
});

test("rare artifacts use original Ularn rnd(120) < 8 and Slayer depth gate 85", () => {
  assert.match(create, /const ULARN_ARTIFACT_UNDER = 8/);
  assert.match(create, /OSWORDofSLASHING[\s\S]*ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OHAMMER[\s\S]*ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OVORPAL[\s\S]*ULARN_ARTIFACT_UNDER/);
  assert.match(create, /OSLAYER[\s\S]*ULARN_SLAYER_GATE - \(depth - 10\)/);
  assert.doesNotMatch(create, /rnd\(120\) < 1[123]/);
  assert.doesNotMatch(create, /82 - \(depth - 10\)/);
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
