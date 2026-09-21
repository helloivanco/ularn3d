import test from "node:test";
import assert from "node:assert/strict";
import { WALL_CUT, WALL_FULL, wallHeight } from "../src/wall-cut.js";

const towardSouth = { x: 0, z: 1 };
const towardGame = (() => {
  const x = 2.8,
    z = 8.5,
    len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
})();

test("town plaza walls stay full height even on the camera side", () => {
  assert.equal(wallHeight(0, 1, towardSouth.x, towardSouth.z, true), WALL_FULL);
  assert.equal(wallHeight(-2, 1, towardGame.x, towardGame.z, true), WALL_FULL);
});

test("dungeon cutaway only lowers the wall between camera and hero", () => {
  assert.equal(wallHeight(0, 1, towardSouth.x, towardSouth.z, false), WALL_CUT);
  assert.equal(wallHeight(0, -1, towardSouth.x, towardSouth.z, false), WALL_FULL);
  assert.equal(wallHeight(-1, 0, towardSouth.x, towardSouth.z, false), WALL_FULL);
  assert.equal(wallHeight(1, 0, towardSouth.x, towardSouth.z, false), WALL_FULL);
});

test("walking beside a long camera-facing wall does not bite a 2.8-tile hole", () => {
  const heights = [];
  for (let dx = -4; dx <= 4; dx++)
    heights.push(wallHeight(dx, 1, towardGame.x, towardGame.z, false));
  const cut = heights.filter((h) => h === WALL_CUT).length;
  const full = heights.filter((h) => h === WALL_FULL).length;
  assert.ok(cut <= 2, `expected at most two lowered tiles, got ${cut}`);
  assert.equal(full, heights.length - cut);
  assert.equal(wallHeight(-2, 1, towardGame.x, towardGame.z, false), WALL_FULL);
});
