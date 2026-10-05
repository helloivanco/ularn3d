import test from "node:test";
import assert from "node:assert/strict";
import { createSpectatorView, tilesInFog, watcherCount } from "../src/online/spectator.js";
import { bootEngine } from "./lib/engine-session.mjs";

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
  assert.equal(view.watching(), 1);
  assert.equal(view.badge(), "Spectating Ada · 1 watching");
});

test("the watching count ignores players, the host, and people who have left", () => {
  assert.equal(watcherCount(players), 1);
  const empty = createSpectatorView([
    { name: "Ada", role: "host" },
    { name: "Bea", role: "player" },
    { name: "Cid", role: "spectator", connected: false },
    { name: "Dee", role: "spectator", banned: true },
  ]);
  assert.equal(empty.watching(), 0);
  assert.equal(empty.badge(), "Spectating Ada · 0 watching");
  empty.setRoster([
    { name: "Ada", role: "player" },
    { name: "Cid", role: "spectator" },
    { name: "Dee", role: "spectator", connected: true },
  ]);
  assert.equal(empty.badge(), "Spectating Ada · 2 watching");
});

test("the minimap keeps only the followed player's explored tiles", async () => {
  const api = bootEngine({ seed: 2, name: "Ada" });
  api.newcavelevel(1);
  api.addAdventurer("Bea");
  const ada = api.adventurerSeen("Ada");
  const bea = api.adventurerSeen("Bea");
  assert.ok(ada.length > 0);
  assert.equal(bea.length, 0);
  const tiles = ada.slice(0, 4).map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y, id: 1 };
  });
  const view = createSpectatorView([
    { name: "Ada", role: "player", dungeon: 1 },
    { name: "Bea", role: "player", dungeon: 1 },
  ]);
  assert.equal(tilesInFog(tiles, null).length, tiles.length);
  assert.equal(tilesInFog(tiles, view.fogOf({ Ada: ada, Bea: bea })).length, tiles.length);
  view.follow("Bea");
  assert.equal(tilesInFog(tiles, view.fogOf({ Ada: ada, Bea: bea })).length, 0);
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
