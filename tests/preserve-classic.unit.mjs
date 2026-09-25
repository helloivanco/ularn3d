/**
 * Hard walls: do not regress classic loot density, goblin, or treasure rooms.
 * Run via: node --test tests/preserve-classic.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("classic floor loot loops unchanged (do not increase density)", () => {
  const create = readFileSync("public/engine/create.js", "utf8");
  assert.match(create, /rnd\(4\) \+ 3/);
  assert.match(create, /rnd\(5\) \+ 3/);
  assert.match(create, /rnd\(12\) \+ 11/);
  assert.doesNotMatch(create, /function placeRareTreasureRoom/);
  assert.doesNotMatch(create, /function buildRoomCorridorMaze/);
});

test("loot goblin and treasure-room rarity remain as shipped", () => {
  const create = readFileSync("public/engine/create.js", "utf8");
  const monster = readFileSync("public/engine/monsterdata.js", "utf8");
  assert.match(monster, /LOOTGOBLIN\s*=\s*66/);
  assert.match(create, /fillmonst\(LOOTGOBLIN/);
  assert.match(create, /function treasureroom\(/);
  /* Classic treasure-room call site — do not invent denser rarity. */
  assert.match(create, /treasureroom\(k\)/);
});
