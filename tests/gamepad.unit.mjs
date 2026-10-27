import test from "node:test";
import assert from "node:assert/strict";
import { stickKey, dpadKey, pickSpatial } from "../src/gamepad.js";

test("the stick reads eight compass keys with north up", () => {
  const cases = [[0, -1, "k"], [1, -1, "u"], [1, 0, "l"], [1, 1, "n"], [0, 1, "j"], [-1, 1, "b"], [-1, 0, "h"], [-1, -1, "y"]];
  for (const [x, y, key] of cases) assert.equal(stickKey(x, y), key, `${x},${y}`);
  assert.equal(stickKey(0.92, -0.2), "l", "a slight tilt stays east");
  assert.equal(stickKey(0.3, 0.2), null, "inside the dead zone");
  assert.equal(stickKey(NaN, 0), null);
});

test("the d-pad combines two arrows into a diagonal", () => {
  assert.equal(dpadKey(true, false, false, false), "k");
  assert.equal(dpadKey(true, false, false, true), "u");
  assert.equal(dpadKey(false, true, true, false), "b");
  assert.equal(dpadKey(true, true, false, false), null, "opposites cancel");
  assert.equal(dpadKey(false, false, false, false), null);
});

const box = (left, top, width = 40, height = 30) => ({ left, top, right: left + width, bottom: top + height });

test("spatial focus picks the nearest control in the pressed direction", () => {
  // Two rows of four, like the calling picker.
  const grid = [box(0, 0), box(50, 0), box(100, 0), box(150, 0), box(0, 40), box(50, 40), box(100, 40), box(150, 40)];
  assert.equal(pickSpatial(grid[1], grid, "right"), 2);
  assert.equal(pickSpatial(grid[1], grid, "down"), 5);
  assert.equal(pickSpatial(grid[5], grid, "up"), 1);
  assert.equal(pickSpatial(grid[4], grid, "left"), -1);
  assert.equal(pickSpatial(grid[3], grid, "right"), -1);
});

test("off-axis distance counts double, so a row stays a row", () => {
  const from = box(0, 0), near = box(60, 50), level = box(140, 0);
  assert.equal(pickSpatial(from, [near, level], "right"), 1);
});
