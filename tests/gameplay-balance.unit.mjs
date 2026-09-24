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

test("brass lamp spawn chance is slightly higher than classic", () => {
  assert.match(create, /OBRASSLAMP[\s\S]*rnd\(120\) < 10/);
});

test("special weapons have independent slight find-rate boosts", () => {
  assert.match(create, /OSWORDofSLASHING[\s\S]*rnd\(120\) < 11/);
  assert.match(create, /OHAMMER[\s\S]*rnd\(120\) < 13/);
  assert.match(create, /OVORPAL[\s\S]*rnd\(120\) < 10/);
  assert.match(create, /OSLAYER[\s\S]*rnd\(100\) > \(82 -/);
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

test("canned mazes are 57x20 with 100+ Ularn maps and treasure maps", () => {
  const mazesSrc = readFileSync("public/engine/mazes.js", "utf8");
  assert.match(mazesSrc, /const TREASURE_MAZES/);
  assert.match(create, /rnd\(100\) === 1/);
  assert.match(create, /scatterTreasureMapExtras/);
  const vm = require("node:vm");
  const sandbox = {};
  vm.runInNewContext(
    mazesSrc +
      "\nthis.ULARN=ULARN_MAZES;this.TREASURE=TREASURE_MAZES;this.COMMON=COMMON_MAZES;",
    sandbox,
  );
  assert.ok(sandbox.ULARN.length >= 100, `expected 100+ ularn maps, got ${sandbox.ULARN.length}`);
  assert.ok(sandbox.TREASURE.length >= 1);
  assert.ok(sandbox.ULARN.every((m) => m.length === 57 * 20));
  assert.ok(sandbox.TREASURE.every((m) => m.length === 57 * 20));
  assert.ok(sandbox.COMMON.every((m) => m.length === 57 * 20));
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
