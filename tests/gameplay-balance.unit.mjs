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

test("canned mazes are 57x20 maze-like with classic 1% treasure maps", () => {
  const mazesSrc = readFileSync("public/engine/mazes.js", "utf8");
  assert.match(mazesSrc, /const TREASURE_MAZES/);
  assert.match(create, /rnd\(100\) === 1/);
  assert.match(create, /function eat\(/);
  assert.match(create, /eat\(1, 1\)/);
  assert.match(create, /function ensureLevelStairs/);
  assert.match(create, /function createDepthLoot/);
  assert.doesNotMatch(create, /function buildRoomCorridorMaze/);
  assert.doesNotMatch(create, /function placeRareTreasureRoom/);
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

  const W = 57;
  const H = 20;
  const orphanDoors = (m) => {
    let bad = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (m[y * W + x] !== "D") continue;
        const floor = (xx, yy) => {
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) return false;
          const c = m[yy * W + xx];
          return c !== "#" && c !== "D";
        };
        if (!(floor(x - 1, y) && floor(x + 1, y)) && !(floor(x, y - 1) && floor(x, y + 1)))
          bad++;
      }
    }
    return bad;
  };
  for (const m of [...sandbox.COMMON, ...sandbox.ULARN.slice(0, 20), ...sandbox.TREASURE]) {
    assert.equal(orphanDoors(m), 0, "doors must connect floor tiles");
    const walls = (m.match(/#/g) || []).length;
    const open = m.length - walls;
    assert.ok(open >= 300 && open <= 700, `open cells out of range: ${open}`);
    const dash = m.split("-").length - 1;
    assert.ok(dash <= 8, `too many canned loot markers: ${dash}`);
  }
  /* Treasure floors: more gold markers than item markers. */
  for (const m of sandbox.TREASURE) {
    const gold = m.split("$").length - 1;
    const loot = m.split("-").length - 1;
    assert.ok(gold > loot, `treasure map should favor gold (${gold} vs ${loot})`);
  }
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
