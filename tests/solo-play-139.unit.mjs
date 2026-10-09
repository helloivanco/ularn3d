/**
 * Solo play versus Ularn 1.3.39.
 * Floor 1 does not stock a floating eye, and a solo turn uses the classic
 * movement window rather than the 20×10 multiplayer aura.
 * Run via: node --test tests/solo-play-139.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bootEngine } from "./lib/engine-session.mjs";

const WIDTH = 57;
const HEIGHT = 20;
const LEMMING = 1;
const KOBOLD = 5;
const EYE = 12;

const floorMonsters = (api, depth = api.level) => {
  const floor = api.LEVELS[depth];
  const found = [];
  if (!floor?.monsters) return found;
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < HEIGHT; y++) {
      const monster = floor.monsters[x][y];
      if (!monster) continue;
      found.push({
        x,
        y,
        arg: monster.arg,
        level: monster.level,
        desc: monster.desc,
      });
    }
  }
  return found;
};

const clearMonsters = (api, depth) => {
  const floor = api.LEVELS[depth];
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < HEIGHT; y++) floor.monsters[x][y] = null;
  }
};

test("a floor-1 floating eye is not stocked and nothing there outranks a kobold", () => {
  const seeds = [];
  for (let i = 0; i < 12; i++) seeds.push(i * 17 + 3);
  for (const seed of seeds) {
    const api = bootEngine({ seed });
    const built = api.generateFreshLevel(1);
    assert.equal(built.ok, true, `seed ${seed} did not build floor 1`);
    assert.equal(api.level, 1);
    const monsters = floorMonsters(api, 1);
    assert.ok(monsters.length > 0, `seed ${seed} stocked an empty floor`);
    const eyes = monsters.filter((monster) => monster.arg === EYE);
    assert.deepEqual(eyes, [], `seed ${seed} placed a floating eye on floor 1`);
    for (const monster of monsters) {
      assert.ok(
        monster.arg >= LEMMING && monster.arg <= KOBOLD,
        `seed ${seed} placed ${monster.desc} (${monster.arg}) on floor 1`,
      );
      assert.ok(monster.level <= 1, `seed ${seed} placed a level ${monster.level} ${monster.desc}`);
    }
    const lemmings = monsters.filter((monster) => monster.arg === LEMMING);
    assert.ok(lemmings.length <= 1, `seed ${seed} left ${lemmings.length} lemmings`);
    const eye = api.monsterlist[EYE];
    assert.equal(eye.desc, "floating eye");
    assert.equal(eye.level, 3);
    assert.equal(eye.armorclass, 8);
    assert.equal(eye.damage, 2);
    assert.equal(eye.attack, 0);
    assert.equal(eye.hitpoints, 7);
    assert.equal(eye.experience, 2);
  }
});

test("stocking occupies extra lemmings, then thins the floor back to one", () => {
  const api = bootEngine({ seed: 1 });
  api.generateFreshLevel(1);
  api.player.x = 20;
  api.player.y = 8;
  clearMonsters(api, 1);
  api.beginDeferredLemmingCap();
  assert.equal(api.setMonster(20, 8, LEMMING)?.arg, LEMMING);
  assert.equal(api.setMonster(30, 8, LEMMING)?.arg, LEMMING);
  assert.equal(api.setMonster(40, 8, 2)?.arg, 2);
  assert.equal(api.monsterAt(30, 8).arg, LEMMING);
  api.endDeferredLemmingCap();
  const monsters = floorMonsters(api, 1);
  const lemmings = monsters.filter((monster) => monster.arg === LEMMING);
  assert.equal(lemmings.length, 1);
  assert.deepEqual(lemmings[0], { x: 20, y: 8, arg: LEMMING, level: 1, desc: "lemming" });
  assert.equal(api.monsterAt(40, 8).arg, 2);
  assert.equal(api.monsterAt(30, 8), null);
  assert.equal(api.setMonster(30, 8, LEMMING), null);
});

test("solo monster turns use the 1.3.39 window and not the multiplayer aura", () => {
  const api = bootEngine({ seed: 2 });
  api.generateFreshLevel(1);
  api.player.x = 10;
  api.player.y = 8;
  api.player.TIMESTOP = 0;
  api.player.HOLDMONST = 0;
  api.player.AGGRAVATE = 0;
  api.player.STEALTH = 0;
  api.level = 1;
  clearMonsters(api, 1);
  api.setMonster(10, 8, 2);
  api.setMonster(18, 8, 2);
  api.setMonster(50, 8, 2);
  api.lasthx = 0;
  api.lasthy = 0;
  const calls = [];
  api.movemt = (x, y) => {
    calls.push(`${x},${y}`);
    const monster = api.monsterAt(x, y);
    if (monster) monster.moved = true;
  };

  api.movemonst();
  let acted = new Set(calls);
  assert.equal(acted.has("10,8"), true);
  assert.equal(acted.has("18,8"), false);
  assert.equal(acted.has("50,8"), false);

  calls.length = 0;
  for (const monster of floorMonsters(api, 1)) api.monsterAt(monster.x, monster.y).moved = false;
  api.lasthx = 50;
  api.lasthy = 8;
  api.movemonst();
  acted = new Set(calls);
  assert.equal(acted.has("50,8"), true);
  assert.equal(acted.has("18,8"), false);
  assert.equal(acted.has("10,8"), true);

  api.PARTY_ON = true;
  api.ADVENTURERS = [{ slot: 0 }, { slot: 1 }];
  api.COOP_AURA_ON = true;
  assert.equal(api.partySize(), 2);
  assert.equal(api.auraTurnMode(), "aura");
  calls.length = 0;
  for (const monster of floorMonsters(api, 1)) api.monsterAt(monster.x, monster.y).moved = false;
  api.lasthx = 0;
  api.lasthy = 0;
  api.movemonst();
  acted = new Set(calls);
  assert.equal(acted.has("18,8"), true);
  assert.equal(acted.has("10,8"), true);
  assert.equal(acted.has("50,8"), false);

  api.PARTY_ON = false;
  api.ADVENTURERS = [];
  assert.equal(api.auraTurnMode(), "level");
});
