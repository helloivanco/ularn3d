import test from "node:test";
import assert from "node:assert/strict";
import { bleedTransparentEdges, stripPaleSpriteBackground } from "../src/item-art.js";

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

test("transparent pixels borrow neighboring item color but stay transparent", () => {
  const image = { data: new Uint8ClampedArray(5 * 5 * 4), width: 5, height: 5 };
  rgba(image.data, 12, 200, 120, 40, 255);
  bleedTransparentEdges(image);
  for (let i = 0; i < 25; i++) {
    assert.equal(image.data[i * 4 + 3], i === 12 ? 255 : 0, `alpha ${i}`);
    assert.deepEqual([...image.data.slice(i * 4, i * 4 + 3)], [200, 120, 40], `color ${i}`);
  }
});

test("the fill cannot leak diagonally or into tinted pale art", () => {
  const image = { data: new Uint8ClampedArray(3 * 3 * 4), width: 3, height: 3 };
  for (let i = 0; i < 9; i++) rgba(image.data, i, 230, 230, 230, 255);
  for (const i of [1, 3, 5, 7]) rgba(image.data, i, 30, 30, 30, 255);
  rgba(image.data, 4, 255, 255, 255, 255);
  stripPaleSpriteBackground(image);
  assert.equal(image.data[0 * 4 + 3], 0, "corner card removed");
  assert.equal(image.data[4 * 4 + 3], 255, "white facet behind a diagonal outline stays");
  const lavender = { data: new Uint8ClampedArray(2 * 2 * 4), width: 2, height: 2 };
  for (let i = 0; i < 4; i++) rgba(lavender.data, i, 240, 231, 249, 255);
  stripPaleSpriteBackground(lavender);
  assert.equal(lavender.data[3], 255, "a pale lavender bottle is not card");
});

test("enclosed checker holes clear while highlights inside metal stay", () => {
  const make = (inside, frame) => {
    const size = 40, image = { data: new Uint8ClampedArray(size * size * 4), width: size, height: size };
    for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) {
      const edge = x < 9 || y < 9 || x > 30 || y > 30;
      rgba(image.data, y * size + x, ...(edge ? frame : inside(x, y)), 255);
    }
    return image;
  };
  const checker = make((x, y) => ((x >> 1) + (y >> 1)) % 2 ? [255, 255, 255] : [222, 222, 222], [40, 34, 30]);
  stripPaleSpriteBackground(checker);
  assert.equal(checker.data[(20 * 40 + 20) * 4 + 3], 0, "ring hole cleared");
  assert.equal(checker.data[(6 * 40 + 6) * 4 + 3], 255, "ring kept");
  const polished = make((x) => { const v = 210 + x; return [v, v, v]; }, [150, 152, 158]);
  stripPaleSpriteBackground(polished);
  assert.equal(polished.data[(20 * 40 + 20) * 4 + 3], 255, "steel highlight kept");
});
