/**
 * Door throat sealing + diagonal corner-cut rules.
 * Run via: node --test tests/door-throat.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  doorCorridorAxisFromOpen,
  doorLateralOffsets,
  diagonalSqueezesPastClosedDoor,
  doorHasDiagonalBypass,
} from "../src/door-throat.js";

test("E–W corridor door laterals are north+south stone", () => {
  assert.equal(
    doorCorridorAxisFromOpen({ n: false, s: false, e: true, w: true }),
    "ew",
  );
  assert.deepEqual(doorLateralOffsets("ew"), [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
  ]);
});

test("N–S corridor door laterals are east+west stone", () => {
  assert.equal(
    doorCorridorAxisFromOpen({ n: true, s: true, e: false, w: false }),
    "ns",
  );
  assert.deepEqual(doorLateralOffsets("ns"), [
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
  ]);
});

test("diagonal squeeze past closed door is detected", () => {
  /* Door at (5,5); move from (4,5) NE to (5,4) — orthogonal neighbor is door. */
  const isDoor = (x, y) => x === 5 && y === 5;
  assert.equal(diagonalSqueezesPastClosedDoor(4, 5, 5, 4, isDoor), true);
  assert.equal(diagonalSqueezesPastClosedDoor(4, 5, 3, 5, isDoor), false); /* cardinal */
  assert.equal(diagonalSqueezesPastClosedDoor(4, 4, 3, 3, isDoor), false); /* away */
});

test("open laterals allow diagonal bypass; sealed laterals do not", () => {
  const openThroat = (x, y) => {
    /* EW door at 5,5 with open N/S — classic float */
    if (x === 5 && y === 5) return false;
    return true;
  };
  assert.equal(doorHasDiagonalBypass(5, 5, "ew", openThroat), true);

  const sealed = (x, y) => {
    if (x === 5 && y === 5) return false; /* door */
    if (x === 5 && (y === 4 || y === 6)) return false; /* lateral stone */
    if (y === 5 && (x === 4 || x === 6)) return true; /* passage */
    /* corridor band */
    if (y === 5) return true;
    return false;
  };
  assert.equal(doorHasDiagonalBypass(5, 5, "ew", sealed), false);
});

test("create.js seals door throats and keeps classic eat() generator", () => {
  const create = readFileSync("public/engine/create.js", "utf8");
  assert.match(create, /function sealDoorThroats/);
  assert.match(create, /function sculptLabyrinthDensity/);
  assert.match(create, /function eat\(/);
  assert.match(create, /eat\(1, 1\)/);
  assert.doesNotMatch(create, /function buildRoomCorridorMaze/);
  /* Treasure-room doors avoid wall corners. */
  assert.match(create, /tx \+ 1 \+ rund\(Math\.max\(1, xsize - 2\)\)/);
});

test("engine diagonal door block stays synced with door-throat.js", () => {
  const global = readFileSync("public/engine/global.js", "utf8");
  assert.match(global, /function closedDoorBlocksDiagonal/);
  assert.match(global, /Keep in sync with src\/door-throat\.js/);
  const display = readFileSync("public/engine/display.js", "utf8");
  assert.match(display, /closedDoorBlocksDiagonal\(player\.x, player\.y, k, m\)/);
  const buttons = readFileSync("public/engine/buttons.js", "utf8");
  assert.match(buttons, /closedDoorBlocksDiagonal\(player\.x, player\.y, x, y\)/);
});
