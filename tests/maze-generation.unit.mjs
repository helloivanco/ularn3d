/**
 * Headless checks: classic eat()-era mazes, no orphan doors, sparse canned loot.
 * Run via: node --test tests/maze-generation.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);

test("canned mazes are the fitted Ularn Umaps, not a generated door library", () => {
  const mazesSrc = readFileSync("public/engine/mazes.js", "utf8");
  const sandbox = {};
  vm.runInNewContext(
    mazesSrc + "\nthis.U=ULARN_MAZES;this.C=COMMON_MAZES;this.T=TREASURE_MAZES;this.L=LARN_MAZES;",
    sandbox,
  );
  const W = 57;
  const H = 20;
  assert.equal(sandbox.U.length, 0);
  assert.equal(sandbox.T.length, 0);
  assert.equal(sandbox.C.length, 21);
  for (const m of sandbox.C) {
    assert.equal(m.length, W * H);
    assert.equal(m.includes("$"), false);
    for (const ch of m) assert.ok("# D.-~!".includes(ch), `glyph ${ch}`);
  }
  assert.ok(sandbox.C[0].includes("~"));
  assert.ok(sandbox.C[0].includes("!"));
  assert.ok(sandbox.C[0].includes("D"));
});

test("create.js keeps eat() and does not sculpt or invent corridor doors", () => {
  const create = readFileSync("public/engine/create.js", "utf8");
  assert.match(create, /function eat\(/);
  assert.match(create, /eat\(1, 1\)/);
  assert.match(create, /function enforceDoorProvenance/);
  assert.match(create, /function levelTraversalOk/);
  assert.match(create, /rnd\(4\) \+ 3/);
  assert.match(create, /rnd\(5\) \+ 3/);
  assert.match(create, /rnd\(12\) \+ 11/);
  assert.doesNotMatch(create, /function buildRoomCorridorMaze/);
  assert.doesNotMatch(create, /function placeRareTreasureRoom/);
  assert.doesNotMatch(create, /function sculptLabyrinthDensity/);
  assert.doesNotMatch(create, /function sanitizeMazeDoors/);
  assert.doesNotMatch(create, /function sealDoorThroats/);
  assert.doesNotMatch(create, /function ensureMazeConnectivity/);
});
