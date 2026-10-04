import test from "node:test";
import assert from "node:assert/strict";
import { createSpectatorView } from "../src/online/spectator.js";

const players = [
  { name: "Ada", role: "player", dungeon: 2 },
  { name: "Bea", role: "player", dungeon: 4 },
  { name: "Cid", role: "spectator", dungeon: 2 },
];

test("spectators cannot act and Tab follows the next player", () => {
  const view = createSpectatorView(players);
  assert.equal(view.acceptInput(), false);
  assert.equal(view.followed().name, "Ada");
  assert.equal(view.next().name, "Bea");
  assert.equal(view.follow("Ada").name, "Ada");
  assert.equal(view.badge(3), "Spectating Ada · 3 watching");
});

test("free camera stays on the followed player's level and fog", () => {
  const view = createSpectatorView(players);
  view.setFreeCamera(true);
  assert.equal(view.freeCamera(), true);
  assert.equal(view.level(), 2);
  view.next();
  assert.equal(view.freeCamera(), false);
  assert.equal(view.level(), 4);
  const fog = view.fogOf({ Ada: "ada-map", Bea: "bea-map" });
  assert.equal(fog, "bea-map");
});
