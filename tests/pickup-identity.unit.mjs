/**
 * Pickup must not identify an item. Identity survives inventory, save/load,
 * and a multiplayer state diff. Drinking, reading, and an identify scroll
 * still reveal potions and scrolls.
 *
 * Run: node --test tests/pickup-identity.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bootEngine } from "./lib/engine-session.mjs";

const POTION = 42;
const SCROLL = 41;
const RING = 33;
const WAND = 88;
const STAFF = 89;
const SWORD = 58;
const FLOOR = 0;

const kinds = [
  { name: "potion", id: POTION, arg: 1, secret: "healing", consumable: true },
  { name: "scroll", id: SCROLL, arg: 0, secret: "enchant armor", consumable: true },
  { name: "ring", id: RING, arg: 0, secret: "regeneration", consumable: false },
  { name: "wand", id: WAND, arg: 0, secret: "wonder", consumable: false },
  { name: "staff", id: STAFF, arg: 0, secret: "power", consumable: false },
];

const prepare = (api) => {
  api.newcavelevel(1);
  api.setMazeMode(true);
  api.player.x = 8;
  api.player.y = 8;
  api.setItem(8, 8, FLOOR);
};

const make = (api, kind) => api.createObject(kind.id, kind.arg);

const isKnown = (api, item) => {
  if (item.id === POTION) return api.isKnownPotion(item);
  if (item.id === SCROLL) return api.isKnownScroll(item);
  return false;
};

const pickup = (api, item) => {
  api.setItem(api.player.x, api.player.y, item);
  const floor = api.itemAt(api.player.x, api.player.y);
  const floorName = String(floor);
  const floorKnown = isKnown(api, floor);
  api.lookforobject(false, true);
  const carried = api.player.inventory.find((slot) => slot && slot.id === item.id && slot.arg === item.arg);
  return { floorName, floorKnown, carried };
};

const roundTrip = (api) => {
  const raw = JSON.parse(JSON.stringify(new api.GameState(true)));
  api.loadState(raw);
};

for (const kind of kinds) {
  test(`${kind.name} stays unidentified from the floor through pickup, save, and sync`, () => {
    const api = bootEngine({ seed: 2, name: "Ada" });
    prepare(api);
    const item = make(api, kind);
    const { floorName, floorKnown, carried } = pickup(api, item);
    assert.equal(floorKnown, false, "floor");
    if (kind.consumable) assert.equal(floorName.includes(kind.secret), false);
    assert.ok(carried, "inventory");
    assert.equal(isKnown(api, carried), false);
    assert.equal(String(carried), floorName);

    roundTrip(api);
    const loaded = api.player.inventory.find((slot) => slot && slot.id === item.id && slot.arg === item.arg);
    assert.ok(loaded, "saved inventory");
    assert.equal(isKnown(api, loaded), false);
    assert.equal(String(loaded), floorName);

    const sync = bootEngine({ seed: 2, name: "Ada" });
    prepare(sync);
    const before = sync.captureGameState();
    const syncedItem = make(sync, kind);
    pickup(sync, syncedItem);
    const after = sync.captureGameState();
    const applied = sync.applyDiff(before, sync.diffState(before, after));
    const knownList = kind.id === POTION ? applied.player.knownPotions : applied.player.knownScrolls;
    if (kind.consumable) assert.equal(!!knownList?.[kind.arg], false);
    const packed = applied.player.inventory.find((slot) => slot && slot.id === syncedItem.id && slot.arg === kind.arg);
    assert.ok(packed, "synced inventory");
    assert.equal(packed.arg, kind.arg);
  });

  test(`a known ${kind.name} stays known, and an identify scroll still reveals a hidden one`, () => {
    const api = bootEngine({ seed: 2, name: "Ada" });
    prepare(api);
    if (kind.consumable) {
      const known = make(api, kind);
      if (kind.id === POTION) api.learnPotion(known);
      else api.learnScroll(known);
      const named = String(known);
      assert.equal(named.includes(kind.secret), true);
      const { carried } = pickup(api, known);
      assert.equal(isKnown(api, carried), true);
      assert.equal(String(carried), named);
    } else {
      const item = make(api, kind);
      const named = String(item);
      const { floorName, carried } = pickup(api, item);
      assert.equal(floorName, named);
      assert.equal(String(carried), named);
    }

    const freshEngine = bootEngine({ seed: 2, name: "Ada" });
    prepare(freshEngine);
    const hidden = make(freshEngine, kind);
    const { carried: fresh } = pickup(freshEngine, hidden);
    const before = String(fresh);
    freshEngine.read_scroll(freshEngine.createObject(SCROLL, 19));
    if (kind.consumable) {
      assert.equal(isKnown(freshEngine, fresh), true);
      assert.equal(String(fresh).includes(kind.secret), true);
    } else {
      assert.equal(isKnown(freshEngine, fresh), false);
      assert.equal(String(fresh), before);
    }
  });
}

test("quaffing a potion and reading a scroll still identify them", () => {
  const api = bootEngine({ seed: 2, name: "Ada" });
  prepare(api);
  const potion = api.createObject(POTION, 1);
  const { carried } = pickup(api, potion);
  assert.equal(api.isKnownPotion(carried), false);
  api.quaffpotion(carried, true);
  assert.equal(api.isKnownPotion(carried), true);
  assert.equal(String(carried).includes("healing"), true);

  const scroll = api.createObject(SCROLL, 1);
  api.setItem(api.player.x, api.player.y, scroll);
  api.lookforobject(false, true);
  const paper = api.player.inventory.find((slot) => slot && slot.id === SCROLL && slot.arg === 1);
  assert.equal(api.isKnownScroll(paper), false);
  api.read_scroll(paper);
  assert.equal(api.isKnownScroll(paper), true);
});

test("a weapon bonus that is already on the item is unchanged by pickup", () => {
  const api = bootEngine({ seed: 2, name: "Ada" });
  prepare(api);
  const sword = api.createObject(SWORD, 3);
  const { floorName, carried } = pickup(api, sword);
  assert.equal(floorName.includes("+3"), true);
  assert.equal(String(carried), floorName);
  roundTrip(api);
  const loaded = api.player.inventory.find((slot) => slot && slot.id === SWORD);
  assert.equal(String(loaded), floorName);
});

test("taking an item does not learn it; the shop's own call still does", () => {
  const api = bootEngine({ seed: 2, name: "Ada" });
  prepare(api);
  api.setMazeMode(false);
  const bought = api.createObject(SCROLL, 0);
  assert.equal(api.take(bought), true);
  assert.equal(api.isKnownScroll(bought), false);
  api.learnScroll(bought);
  assert.equal(api.isKnownScroll(bought), true);
  assert.equal(String(bought).includes("enchant armor"), true);
});
