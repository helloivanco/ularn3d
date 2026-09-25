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

test("canned mazes have no orphan doors and sparse canned loot", () => {
  const mazesSrc = readFileSync("public/engine/mazes.js", "utf8");
  const sandbox = {};
  vm.runInNewContext(
    mazesSrc + "\nthis.U=ULARN_MAZES;this.C=COMMON_MAZES;this.T=TREASURE_MAZES;",
    sandbox,
  );
  const W = 57;
  const H = 20;
  const check = (m, treasure) => {
    assert.equal(m.length, W * H);
    let orphans = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (m[y * W + x] !== "D") continue;
        const floor = (xx, yy) => {
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) return false;
          const c = m[yy * W + xx];
          return c !== "#" && c !== "D";
        };
        if (!(floor(x - 1, y) && floor(x + 1, y)) && !(floor(x, y - 1) && floor(x, y + 1)))
          orphans++;
      }
    }
    assert.equal(orphans, 0);
    const open = (m.match(/[^#]/g) || []).length;
    assert.ok(open >= 300 && open <= 700, `open=${open}`);
    const dash = m.split("-").length - 1;
    assert.ok(dash <= 8, `dash=${dash}`);
    if (treasure) {
      const gold = m.split("$").length - 1;
      assert.ok(gold > dash, `gold ${gold} vs loot ${dash}`);
    }
  };
  sandbox.C.forEach((m) => check(m, false));
  sandbox.U.forEach((m) => check(m, false));
  sandbox.T.forEach((m) => check(m, true));
});

test("create.js restores classic eat() maze and hard stair/door invariants", () => {
  const create = readFileSync("public/engine/create.js", "utf8");
  /* Classic Ularn caverns — not the short-lived room-corridor rewrite. */
  assert.match(create, /function eat\(/);
  assert.match(create, /eat\(1, 1\)/);
  assert.match(create, /Classic connectivity spine/);
  assert.match(create, /function ensureMazeConnectivity/);
  assert.match(create, /function ensureLevelStairs/);
  assert.match(create, /function sanitizeMazeDoors/);
  assert.match(create, /function sealDoorThroats/);
  assert.match(create, /function sculptLabyrinthDensity/);
  assert.match(create, /function levelTraversalOk/);
  assert.match(create, /rnd\(4\) \+ 3/);
  assert.match(create, /rnd\(5\) \+ 3/);
  assert.match(create, /rnd\(12\) \+ 11/);
  assert.doesNotMatch(create, /function buildRoomCorridorMaze/);
  assert.doesNotMatch(create, /function placeRareTreasureRoom/);
});
