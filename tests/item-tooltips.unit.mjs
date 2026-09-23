import test from "node:test";
import assert from "node:assert/strict";
import {
  SPECIAL_ITEM_TOOLTIPS,
  groundHoverInfo,
} from "../src/item-tooltips.js";

test("special artifacts expose the canonical ground info blurbs", () => {
  const expected = [
    22, 26, 27, 3, 46, 47, 45, 48, 49, 86, 87, 88, 89, 91, 92, 85,
  ];
  assert.deepEqual(Object.keys(SPECIAL_ITEM_TOOLTIPS).map(Number).sort((a, b) => a - b),
    [...expected].sort((a, b) => a - b));
  const eye = groundHoverInfo({ id: 22, name: "Eye of Larn" });
  assert.equal(eye.kind, "special");
  assert.equal(eye.title, "Eye of Larn");
  assert.match(eye.body, /God of Hellfire/);
  assert.match(eye.body, /Type I Demon Lord/);
  const lamp = groundHoverInfo({ id: 85, name: "a brass lamp" });
  assert.equal(lamp.title, "Brass Lamp");
  assert.match(lamp.body, /genie will grant you a spell/);
});

test("scrolls potions armor and normal weapons stay quiet on the floor", () => {
  for (const id of [41, 42, 23, 25, 68, 31, 58, 65, 90, 40]) {
    assert.equal(
      groundHoverInfo({ id, name: "something" }),
      null,
      `id ${id} should stay quiet`,
    );
  }
});

test("special weapons and elven chain still open the info box", () => {
  for (const id of [26, 27, 89, 91, 92]) {
    assert.equal(groundHoverInfo({ id, name: "x" }).kind, "special");
  }
});

test("monsters and landmarks keep a short name label", () => {
  assert.deepEqual(groundHoverInfo({ id: 42, name: "potion", monster: { name: "a gnome" } }), {
    kind: "name",
    text: "a gnome",
  });
  assert.deepEqual(groundHoverInfo({ id: 10, name: "your home" }), {
    kind: "name",
    text: "your home",
  });
  assert.equal(groundHoverInfo(null), null);
});
