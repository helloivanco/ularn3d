import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { itemArtPath, itemArtCatalog } from "../src/item-art.js";

test("undiscovered scrolls share one graphic; discovered keep unique art", () => {
  const unknown = itemArtPath(41, 0, false);
  assert.equal(unknown, "/art/items/scroll-unknown.png");
  assert.equal(itemArtPath(41, 8, false), unknown);
  assert.equal(itemArtPath(41, 24, false), unknown);
  assert.equal(itemArtPath(41, 0, true), "/art/items/scroll-enchant-armor.png");
  assert.equal(itemArtPath(41, 24, true), "/art/items/scroll-teleport-to-town.png");
  assert.notEqual(itemArtPath(41, 0, true), itemArtPath(41, 1, true));
});

test("scroll art assets exist on disk including town portal and unknown", () => {
  const catalog = itemArtCatalog();
  assert.equal(catalog.scrolls, 25);
  assert.equal(catalog.unknownScroll, "/art/items/scroll-unknown.png");
  for (const path of [
    "public/art/items/scroll-unknown.png",
    "public/art/items/scroll-teleport-to-town.png",
  ]) {
    const bytes = readFileSync(path);
    assert.ok(bytes.length > 100);
    assert.equal(bytes[0], 0x89);
    assert.equal(bytes[1], 0x50); // PNG
  }
});

test("engine defines teleport-to-town scroll and infinite DnD stock", () => {
  const data = readFileSync("public/engine/data.js", "utf8");
  const store = readFileSync("public/engine/storedata.js", "utf8");
  const scroll = readFileSync("public/engine/scroll.js", "utf8");
  assert.match(data, /teleport to town/);
  assert.match(store, /OSCROLL\.id,\s*24,\s*1,\s*true/);
  assert.match(store, /\[2500,\s*OSCROLL\.id,\s*24/);
  assert.match(scroll, /case 24/);
  assert.match(scroll, /placeTownPortalPair/);
  assert.match(scroll, /activateTownPortal/);
});

test("undiscovered scrolls sell for 100 gold in the DnD store", () => {
  const store = readFileSync("public/engine/store.js", "utf8");
  assert.match(store, /function dndItemPrice/);
  assert.match(store, /return 100/);
  assert.match(store, /isKnownScroll\(item\)\) return 100/);
});
