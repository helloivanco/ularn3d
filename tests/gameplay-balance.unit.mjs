import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
