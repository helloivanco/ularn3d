/**
 * Solo opening against the original engine rules.
 * A capital or shifted run spends one turn per open step. Floor 1 stocking,
 * a real fight, a door, stairs, a spell, a fountain, and a trap stay on
 * those rules. The one-swing lemming kill stays in the 3D bridge.
 *
 * Run via: node --test tests/original-larn-gameplay.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bootEngine } from "./lib/engine-session.mjs";

const WIDTH = 57;
const HEIGHT = 20;
const LEMMING = 1;
const GNOME = 2;
const KOBOLD = 5;
const EYE = 12;
const EMPTY = 0;
const PIT = 4;
const STAIRS_UP = 5;
const FOUNTAIN = 7;
const STAIRS_DOWN = 13;
const DEAD_FOUNTAIN = 17;
const OPEN_DOOR = 19;
const CLOSED_DOOR = 20;
const WALL = 21;
const DAGGER = 31;
const ENTRANCE = 54;
const ARROW_TRAP = 66;

const floorMonsters = (api, depth = api.level) => {
  const floor = api.LEVELS[depth];
  const found = [];
  if (!floor?.monsters) return found;
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < HEIGHT; y++) {
      const monster = floor.monsters[x][y];
      if (!monster) continue;
      found.push({ x, y, arg: monster.arg, level: monster.level });
    }
  }
  return found;
};

const place = (api, x, y, id, arg = 0) => {
  const item = api.createObject(id || 1, arg);
  if (id === EMPTY) {
    item.id = EMPTY;
    item.arg = 0;
  }
  return api.setItem(x, y, item);
};

const carve = (api, x, y) => {
  place(api, x, y, EMPTY);
  api.setMonster(x, y, null);
};

const captureLog = (api) => {
  const lines = [];
  const original = api.updateLog;
  api.updateLog = (...args) => {
    lines.push(args.join(" "));
    return original(...args);
  };
  return lines;
};

const findId = (api, id, depth = api.level) => {
  const floor = api.LEVELS[depth];
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < HEIGHT; y++) {
      if (floor.items[x][y]?.id === id) return { x, y };
    }
  }
  return null;
};

test("capital and shifted runs spend a turn per open step", () => {
  const api = bootEngine({ seed: 4 });
  const y = 10;
  for (let x = 5; x <= 16; x++) carve(api, x, y);
  place(api, 16, y, WALL);
  api.player.x = 5;
  api.player.y = y;
  api.player.HASTESELF = 0;
  api.player.TIMESTOP = 0;
  api.player.CONFUSE = 0;
  api.hitflag = 0;

  assert.equal(api.shouldRun({ shift: false }, "L"), true);
  assert.equal(api.shouldRun({ shift: false }, "l"), false);
  assert.equal(api.shouldRun({ shift: true }, "l"), true);
  assert.equal(api.shouldRun(null, "h"), false);

  const start = api.gtime;
  // The 3D client always passes an event. Capital L still runs.
  api.mainloop({ shift: false, preventDefault() {} }, "L");
  assert.equal(api.player.x, 15);
  assert.equal(api.gtime - start, 10);

  const stepped = api.gtime;
  api.mainloop({ shift: false, preventDefault() {} }, "h");
  assert.equal(api.player.x, 14);
  assert.equal(api.gtime - stepped, 1);

  api.player.x = 5;
  const shifted = api.gtime;
  api.mainloop({ shift: true, preventDefault() {} }, "l");
  assert.equal(api.player.x, 15);
  assert.equal(api.gtime - shifted, 10);
});

test("a solo adventurer plays town, floor 1, a fight, a door, stairs, a spell, a fountain, and a trap", () => {
  const api = bootEngine({ seed: 11, character: "Adventurer" });
  const lines = captureLog(api);
  assert.equal(api.level, 0);
  assert.equal(api.PARTY_ON, false);
  assert.equal(api.partySize(), 1);
  assert.equal(api.auraTurnMode(), "level");
  assert.equal(api.cooperationAuraOn(), false);
  assert.equal(api.player.HP, 10);
  assert.equal(api.player.SPELLS, 1);
  assert.ok(api.player.knownSpells.includes("mle"));
  assert.ok(api.player.knownSpells.includes("pro"));
  assert.ok(api.player.inventory.some((item) => item && item.id === DAGGER));
  assert.equal(api.player.WIELD && api.player.WIELD.id, DAGGER);
  assert.equal(api.monsterlist[GNOME].armorclass, 10);
  assert.equal(api.monsterlist[GNOME].hitpoints, 2);
  assert.equal(api.monsterlist[GNOME].damage, 1);
  assert.equal(api.monsterlist[EYE].level, 3);
  assert.equal(api.monsterlist[EYE].armorclass, 8);
  assert.equal(api.monsterlist[EYE].damage, 2);

  const entrance = findId(api, ENTRANCE, 0);
  assert.ok(entrance);
  api.player.x = entrance.x;
  api.player.y = entrance.y;
  api.mainloop(null, "e");
  assert.equal(api.level, 1);
  const stocked = floorMonsters(api, 1);
  assert.ok(stocked.length > 0);
  assert.equal(stocked.filter((monster) => monster.arg === EYE).length, 0);
  // The rare loot goblin is not a makemonst roll. Everyone else is lemming through kobold.
  const LOOT_GOBLIN = 66;
  const ordinary = stocked.filter((monster) => monster.arg !== LOOT_GOBLIN);
  assert.ok(ordinary.every((monster) => monster.arg >= LEMMING && monster.arg <= KOBOLD));
  assert.ok(stocked.filter((monster) => monster.arg === LEMMING).length <= 1);

  carve(api, api.player.x + 1, api.player.y);
  const moved = api.gtime;
  api.mainloop(null, "l");
  assert.equal(api.gtime - moved, 1);

  api.player.HP = 80;
  carve(api, api.player.x + 1, api.player.y);
  const gnomeMax = api.monsterlist[GNOME].hitpoints;
  api.monsterlist[GNOME].hitpoints = 40;
  const gnome = api.setMonster(api.player.x + 1, api.player.y, GNOME);
  gnome.hitpoints = 40;
  const realRnd = api.rnd;
  api.rnd = () => 1;
  api.mainloop(null, "l");
  const fought = floorMonsters(api, 1).find((monster) => monster.arg === GNOME);
  assert.ok(fought, "a gnome is not removed by the lemming one-swing kill");
  const foughtMob = api.monsterAt(fought.x, fought.y);
  assert.ok(foughtMob.hitpoints < 40);
  assert.ok(foughtMob.hitpoints > 0);
  api.monsterlist[GNOME].hitpoints = gnomeMax;
  api.rnd = realRnd;

  const doorX = api.player.x + 1;
  const doorY = api.player.y;
  carve(api, doorX, doorY);
  place(api, doorX, doorY, CLOSED_DOOR, 0);
  api.rnd = () => 9;
  api.mainloop(null, "o");
  api.mainloop(null, "l");
  assert.equal(api.itemAt(doorX, doorY).id, OPEN_DOOR);
  api.rnd = realRnd;

  place(api, api.player.x, api.player.y, STAIRS_UP);
  api.mainloop(null, "<");
  assert.equal(api.level, 1);
  assert.match(lines.join("\n"), /dead end/i);

  place(api, api.player.x, api.player.y, STAIRS_DOWN);
  api.mainloop(null, ">");
  assert.equal(api.level, 2);
  place(api, api.player.x, api.player.y, STAIRS_UP);
  api.mainloop(null, "<");
  assert.equal(api.level, 1);

  api.mainloop(null, "i");
  assert.equal(typeof api.blocking_callback, "function");
  api.mainloop(null, "escape");
  assert.equal(api.blocking_callback, null);

  api.rnd = () => 1;
  api.mainloop(null, "c");
  api.mainloop(null, "p");
  api.mainloop(null, "r");
  api.mainloop(null, "o");
  assert.equal(api.player.SPELLS, 0);
  assert.ok(api.player.PROTECTIONTIME > 0);

  place(api, api.player.x, api.player.y, FOUNTAIN);
  const rolls = [100, 40, 1];
  api.rnd = () => rolls.shift();
  api.mainloop(null, "D");
  assert.equal(api.itemAt(api.player.x, api.player.y).id, DEAD_FOUNTAIN);
  assert.match(lines.join("\n"), /no water remains/i);
  api.rnd = realRnd;

  const hp = api.player.HP;
  carve(api, api.player.x + 1, api.player.y);
  place(api, api.player.x + 1, api.player.y, ARROW_TRAP);
  api.mainloop(null, "l");
  assert.ok(api.player.HP < hp);
  assert.match(lines.join("\n"), /arrow/i);
  assert.equal(api.GAMEOVER, false);

  const saved = JSON.parse(JSON.stringify(new api.GameState(true)));
  const mark = { x: api.player.x, y: api.player.y, level: api.level, hp: api.player.HP };
  api.player.x = 2;
  api.player.HP = 1;
  api.loadState(saved);
  assert.equal(api.player.x, mark.x);
  assert.equal(api.player.y, mark.y);
  assert.equal(api.level, mark.level);
  assert.equal(api.player.HP, mark.hp);
  assert.equal(api.partySize(), 1);
  assert.equal(api.auraTurnMode(), "level");
});

test("a pit can drop a floor and death ends the expedition", () => {
  const api = bootEngine({ seed: 6 });
  const lines = captureLog(api);
  api.newcavelevel(1);
  api.player.x = 8;
  api.player.y = 8;
  api.player.HP = 40;
  carve(api, 9, 8);
  place(api, 9, 8, PIT);
  const rolls = [1, 1, 1];
  api.rnd = () => rolls.shift() ?? 1;
  api.mainloop(null, "l");
  assert.equal(api.level, 2);
  assert.match(lines.join("\n"), /pit/i);
  assert.equal(api.GAMEOVER, false);

  api.lastnum = 259;
  api.player.HP = 4;
  api.player.losehp(20);
  assert.equal(api.GAMEOVER, true);
  assert.ok(api.player.HP <= 0);
});
