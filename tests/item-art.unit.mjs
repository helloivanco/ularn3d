import test from "node:test";
import assert from "node:assert/strict";
import { stripPaleSpriteBackground } from "../src/item-art.js";

const rgba = (data, i, r, g, b, a) => {
  data[i * 4] = r;
  data[i * 4 + 1] = g;
  data[i * 4 + 2] = b;
  data[i * 4 + 3] = a;
};

test("pale edge cards become transparent while colored item pixels remain", () => {
  const image = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
  for (let i = 0; i < 16; i++) rgba(image.data, i, 222, 222, 222, 200);
  rgba(image.data, 5, 48, 96, 32, 255);
  rgba(image.data, 6, 48, 96, 32, 255);
  rgba(image.data, 9, 48, 96, 32, 255);
  rgba(image.data, 10, 48, 96, 32, 255);
  stripPaleSpriteBackground(image);
  assert.equal(image.data[3], 0);
  assert.equal(image.data[15], 0);
  assert.equal(image.data[5 * 4 + 3], 255);
  assert.equal(image.data[5 * 4], 48);
});

test("already transparent corners stay a no-op for clean artifact art", () => {
  const image = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
  rgba(image.data, 5, 200, 40, 40, 255);
  stripPaleSpriteBackground(image);
  assert.equal(image.data[3], 0);
  assert.equal(image.data[5 * 4 + 3], 255);
  assert.equal(image.data[5 * 4], 200);
});
