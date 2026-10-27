import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { readGlb, writeGlb, trim, CLIPS } from "../scripts/build-models.mjs";
import { HERO_BODIES, CREATURE_BODIES } from "../src/hero-skin.js";
import { dressingPlan, townPlan, PROPS } from "../src/set-dressing.js";
import { CREATURES } from "../src/creatures.js";

const MODELS = new URL("../public/models/", import.meta.url);
const glb = (path) => readGlb(readFileSync(new URL(path, MODELS)));

test("shipped clips are exactly the ones the rigs play, and bodies carry none", () => {
  const clips = glb("rig-clips.glb").json;
  assert.deepEqual(clips.animations.map((clip) => clip.name).sort(), [...CLIPS].sort());
  assert.equal(clips.meshes, undefined);
  for (const file of readdirSync(new URL("characters/", MODELS))) {
    const { json } = glb(`characters/${file}`);
    assert.equal(json.animations, undefined, file);
    assert.equal(json.skins.length, 1, file);
    const held = json.nodes.filter((node) => node.mesh != null && /sword|axe|shield|crossbow|knife|staff|wand|spellbook|mug/i.test(node.name));
    assert.deepEqual(held, [], `${file} keeps pack weapons`);
    // Every body shares the rig the clips animate.
    assert.ok(json.nodes.some((node) => node.name === "handslot.r"), file);
    assert.ok(statSync(new URL(`characters/${file}`, MODELS)).size < 400 * 1024, `${file} is too large`);
  }
});

test("trimming keeps a valid GLB whose buffer views fit its binary chunk", () => {
  const source = glb("characters/knight.glb");
  const { json, bin } = trim(source, { keepMesh: (name) => !/Cape/.test(name) });
  const round = readGlb(writeGlb(json, bin));
  assert.equal(round.bin.length, json.buffers[0].byteLength + ((4 - (json.buffers[0].byteLength % 4)) % 4));
  for (const view of round.json.bufferViews) assert.ok(view.byteOffset + view.byteLength <= json.buffers[0].byteLength);
  for (const accessor of round.json.accessors) assert.ok(accessor.bufferView < round.json.bufferViews.length);
  assert.ok(!round.json.nodes.some((node) => node.mesh != null && /Cape/.test(node.name)));
  assert.ok(bin.length < source.bin.length);
});

test("every class and every rigged species names a body that ships", () => {
  const bodies = new Set(readdirSync(new URL("characters/", MODELS)).map((file) => file.replace(".glb", "")));
  for (const [name, fit] of Object.entries({ ...HERO_BODIES, ...CREATURE_BODIES })) assert.ok(bodies.has(fit.file), name);
  const species = new Set(CREATURES.map((creature) => creature.model));
  for (const model of Object.keys(CREATURE_BODIES)) assert.ok(species.has(model), model);
});

const room = () => {
  // A 7×5 room with walls all round, a dead end off its east side, and a potion.
  const tiles = [];
  for (let x = 0; x <= 8; x++) for (let y = 0; y <= 6; y++) {
    const inside = x >= 1 && x <= 6 && y >= 1 && y <= 5;
    const deadEnd = x === 7 && y === 3;
    tiles.push({ x, y, wall: !inside && !deadEnd, id: x === 3 && y === 3 ? 21 : 0 });
  }
  return tiles;
};

test("set dressing is deterministic, stays off items, torch tiles and the town", () => {
  const tiles = room();
  const first = dressingPlan(tiles, 3), again = dressingPlan(tiles, 3);
  assert.deepEqual(first, again);
  assert.deepEqual(dressingPlan(tiles, 0), { props: [], torches: [], shade: [] });
  const item = tiles.find((tile) => tile.id !== 0);
  for (const prop of first.props) {
    assert.ok(PROPS[prop.kind], prop.kind);
    assert.ok(!(Math.round(prop.x) === item.x && Math.round(prop.z) === item.y), "prop on an item tile");
    // Furniture hugs a wall instead of sitting mid-floor.
    const fx = prop.x - Math.round(prop.x), fz = prop.z - Math.round(prop.z);
    assert.ok(Math.max(Math.abs(fx), Math.abs(fz)) >= 0.2, `${prop.kind} is not against a wall`);
  }
  const lit = new Set(first.torches.map((torch) => `${Math.round(torch.x + Math.sin(torch.angle) * 0.5)},${Math.round(torch.z + Math.cos(torch.angle) * 0.5)}`));
  for (const prop of first.props) assert.ok(!lit.has(`${Math.round(prop.x)},${Math.round(prop.z)}`), "prop under a torch");
  for (const torch of first.torches) assert.equal(tiles.filter((tile) => tile.wall)[torch.wall].wall, true);
  // Every floor edge against a wall gets a shade strip.
  assert.ok(first.shade.length >= 2 * 6 + 2 * 5);
});

test("no dressing prop could be mistaken for loot", () => {
  for (const kind of Object.keys(PROPS)) assert.doesNotMatch(kind, /bottle|coin|trunk|box_small|key/);
});

test("the town dresses its lawns but never a path, a shop's doorstep or another lamp's reach", () => {
  // A 20×12 lawn with two shops joined by an L-shaped path.
  const tiles = [], paths = new Set();
  for (let x = 0; x < 20; x++) for (let y = 0; y < 12; y++) tiles.push({ x, y, wall: false, id: 0 });
  const shops = [{ x: 4, y: 3, id: 12 }, { x: 15, y: 8, id: 77 }];
  for (const shop of shops) Object.assign(tiles.find((t) => t.x === shop.x && t.y === shop.y), { id: shop.id, store: true });
  for (let x = 4; x <= 15; x++) paths.add(`${x},6`);
  for (let y = 3; y <= 6; y++) paths.add(`4,${y}`);
  for (let y = 6; y <= 8; y++) paths.add(`15,${y}`);
  const plan = townPlan(tiles, paths);
  assert.deepEqual(plan, townPlan(tiles, paths));
  assert.ok(plan.decor.length > 20 && plan.posts.length > 0);
  for (const piece of plan.decor) {
    const x = Math.round(piece.x), y = Math.round(piece.z);
    assert.ok(!paths.has(`${x},${y}`), `${piece.kind} on a path`);
    for (const shop of shops) assert.ok(Math.max(Math.abs(shop.x - x), Math.abs(shop.y - y)) > 1, `${piece.kind} at a shop`);
  }
  for (const [i, a] of plan.posts.entries()) for (const b of plan.posts.slice(i + 1))
    assert.ok(Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty) >= 6, "lamp posts too close");
  for (const prop of plan.props) assert.ok(PROPS[prop.kind], prop.kind);
});
