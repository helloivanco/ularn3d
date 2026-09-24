/**
 * Headless checks: maze-like floors, classic loot counts, no orphan doors.
 * Run via: node --experimental-vm-modules tests/maze-generation.unit.mjs
 * (also loaded by node:test through the file itself)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

test("regenerated mazes have no orphan doors and sparse canned loot", () => {
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

test("create.js uses room-corridor mazes and classic makeobject loot loops", () => {
  const create = readFileSync("public/engine/create.js", "utf8");
  assert.match(create, /function buildRoomCorridorMaze/);
  assert.match(create, /placeRareTreasureRoom/);
  assert.match(create, /rnd\(1000\) === 1/);
  assert.match(create, /rnd\(4\) \+ 3/);
  assert.match(create, /rnd\(5\) \+ 3/);
  assert.match(create, /rnd\(12\) \+ 11/);
  /* No full-width trench carve. */
  assert.doesNotMatch(create, /full-width east-west run/);
});
