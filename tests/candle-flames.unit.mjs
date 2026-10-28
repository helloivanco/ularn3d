import test from "node:test";
import assert from "node:assert/strict";
import { candleSpots } from "../src/candle-flames.js";
import { PROPS } from "../src/set-dressing.js";

const scale = PROPS.candle_triple.scale;

test("each triple candle burns three wicks and gets one light above them", () => {
  const { flames, lights } = candleSpots([{ kind: "candle_triple", x: 4, z: 7, angle: 0 }, { kind: "keg", x: 9, z: 9, angle: 0 }], scale, -0.1);
  assert.equal(flames.length, 3);
  assert.equal(lights.length, 1);
  // The tall candle's wick is the highest flame, about 0.39 tiles above the floor.
  const top = Math.max(...flames.map(([, y]) => y));
  assert.ok(Math.abs(top - (-0.1 + 0.873 * scale)) < 0.01, `top flame at ${top}`);
  for (const [x, y, z] of flames) {
    assert.ok(Math.hypot(x - 4, z - 7) < 0.2, "flames stay on the candle");
    assert.ok(lights[0][1] > y, "the light hangs above every flame");
  }
});

test("flames turn with the candle", () => {
  const still = candleSpots([{ kind: "candle_triple", x: 0, z: 0, angle: 0 }], scale).flames;
  const turned = candleSpots([{ kind: "candle_triple", x: 0, z: 0, angle: Math.PI }], scale).flames;
  still.forEach(([x, y, z], i) => {
    assert.ok(Math.abs(turned[i][0] + x) < 1e-9 && Math.abs(turned[i][2] + z) < 1e-9, "a half turn mirrors the wicks");
    assert.equal(turned[i][1], y);
  });
});
