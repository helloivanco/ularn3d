import test from "node:test";
import assert from "node:assert/strict";
import { STAIR_COLORS, exitDirection, stairCompass } from "../src/map.js";

const floor = (x, y) => ({ x, y, id: 0, wall: false });
const up = (x, y, blocked = false) => ({ x, y, id: 5, stair: { direction: "up", blocked } });
const down = (x, y, blocked = false) => ({ x, y, id: 13, stair: { direction: "down", blocked } });
const degrees = (bearing) => Math.round(bearing.angle * 180 / Math.PI);
const at = (x, y, tiles) => ({ level: 3, x, y, width: 57, height: 20, tiles });

test("no arrow before a stair is charted", () => {
  // The snapshot holds only seen tiles, so an unseen stair is simply absent.
  assert.deepEqual(stairCompass(at(10, 10, [floor(10, 10), floor(11, 10)])), []);
});

test("a charted way up points from the player toward it, and turns as the player moves", () => {
  const stairs = up(20, 4);
  // South-west of the stairs: the arrow points north-east (screen y grows south).
  const [southWest] = stairCompass(at(14, 10, [stairs]));
  assert.equal(southWest.direction, "up");
  assert.equal(degrees(southWest), -45);
  // Now east of them: the same arrow points west.
  const [east] = stairCompass(at(26, 4, [stairs]));
  assert.equal(degrees(east), 180);
});

test("ways up and down get their own arrows, which point independently", () => {
  const bearings = stairCompass(at(10, 10, [up(10, 2), down(18, 10)]));
  assert.deepEqual(bearings.map((bearing) => [bearing.direction, degrees(bearing)]), [["up", -90], ["down", 0]]);
});

test("of several ways the same direction, the nearest charted one is shown", () => {
  const [bearing] = stairCompass(at(10, 10, [up(40, 10), { x: 12, y: 12, id: 93 }]));
  assert.deepEqual([bearing.x, bearing.y, degrees(bearing)], [12, 12, 45]);
});

test("dead ends and the stairs underfoot get no arrow", () => {
  assert.deepEqual(stairCompass(at(10, 10, [up(15, 10, true)])), []);
  assert.deepEqual(stairCompass(at(10, 10, [down(10, 10), up(4, 10)])).map((bearing) => bearing.direction), ["up"]);
});

test("the compass and the map glyphs share the engine's < and > targets", () => {
  assert.equal(exitDirection({ id: 93 }), "up"); // home exit on Depth 1
  assert.equal(exitDirection({ id: 56 }), "up"); // shaft up on Volcano 1
  assert.equal(exitDirection({ id: 54 }), "down"); // dungeon entrance in town
  assert.equal(exitDirection({ id: 55 }), null); // the volcano shaft is not where > leads
  assert.deepEqual(STAIR_COLORS, { up: "#6ecf7a", down: "#e07070" });
});
