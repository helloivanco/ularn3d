import test from "node:test";
import assert from "node:assert/strict";
import { nextStep, goalStep, tileActions, foeStep, restStep, TILE } from "../src/next-step.js";

const floor = (x, y, extra = {}) => ({ x, y, id: 0, name: "the floor", wall: false, closed: false, monster: null, stair: null, ...extra });
const world = (level, tiles, extra = {}) => ({ level, x: 5, y: 5, maze: true, over: false, prompt: false, busy: false, deepest: level, hasCure: false, hasEye: false, tiles: [floor(5, 5), ...tiles], ...extra });
const button = (id, key, label, disabled = false) => ({ id, key, label, disabled });

test("nothing is suggested while a prompt, menu or ending owns the screen", () => {
  assert.equal(nextStep(null), null);
  for (const extra of [{ maze: false }, { over: true }, { prompt: true }, { busy: true }])
    assert.equal(nextStep(world(1, [], extra)), null, JSON.stringify(extra));
});

test("the tile underfoot comes first, with the engine's own key", () => {
  const state = world(0, [], { tiles: [floor(5, 5, { id: TILE.ENTRANCE, name: "the dungeon entrance", store: true })] });
  const step = nextStep(state, [button("BUTTON_ENTER_BUILDING", "E", "go inside"), button("BUTTON_INVENTORY_FULL", "I", "known items"), button("BUTTON_PACKWEIGHT", "g", "pack weight")]);
  assert.equal(step.kind, "tile");
  assert.deepEqual(step.actions, [{ key: "E", label: "Enter the caves", detail: "to Depth 1" }]);
});

test("stairs name the floor they lead to, and dead ends say so", () => {
  const down = world(3, [], { tiles: [floor(5, 5, { id: TILE.STAIRS_DOWN, name: "staircase down", stair: { direction: "down", blocked: false } })] });
  assert.deepEqual(tileActions(down, [button("BUTTON_DOWNSTAIRS", ">", "go down")]), [{ key: ">", label: "Go down", detail: "to Depth 4" }]);
  const volcano = world(16, [], { tiles: [floor(5, 5, { id: TILE.STAIRS_UP, stair: { direction: "up", blocked: true } })] });
  assert.deepEqual(tileActions(volcano, [button("BUTTON_UPSTAIRS", "<", "go up")]), [{ key: "<", label: "Go up", detail: "a dead end" }]);
});

test("generic and disabled buttons are skipped, and at most two actions show", () => {
  const state = world(2, [], { tiles: [floor(5, 5, { id: 21, name: "a magic potion" })] });
  const actions = tileActions(state, [button("BUTTON_DROP", "d", "drop"), button("BUTTON_TAKE", "t", "take", true), button("BUTTON_QUAFF", "q", "quaff"),
    button("BUTTON_FOUNTAIN_DRINK", "D", "drink"), button("BUTTON_FOUNTAIN_TIDY", "f", "wash")]);
  assert.deepEqual(actions, [{ key: "q", label: "Quaff", detail: "" }, { key: "D", label: "Drink", detail: "" }]);
  assert.deepEqual(tileActions(state, [button("BUTTON_TAKE", "t", "take")]), [{ key: "t", label: "Take", detail: "magic potion" }]);
});

test("a creature in reach is the next step; a harmless lemming is not", () => {
  const state = world(2, [floor(4, 5, { monster: { name: "kobold", harmless: false } })]);
  assert.deepEqual(foeStep(state), { key: "h", label: "Attack", detail: "kobold" });
  assert.equal(nextStep(state, [button("BUTTON_TAKE", "t", "take")]).kind, "foe");
  assert.equal(foeStep(world(2, [floor(6, 6, { monster: { name: "lemming", harmless: true } })])), null);
  assert.equal(foeStep(world(2, [floor(7, 5, { monster: { name: "kobold" } })])), null);
});

test("in town the caves come first; after Depth 15 the volcano does", () => {
  const entrance = floor(9, 9, { id: TILE.ENTRANCE }), shaft = floor(2, 2, { id: TILE.SHAFT_DOWN });
  assert.deepEqual(goalStep(world(0, [entrance, shaft])), { label: "Head into the caves", detail: "the dungeon entrance", target: entrance, key: ">" });
  const volcano = goalStep(world(0, [entrance, shaft], { deepest: 15 }));
  assert.equal(volcano.label, "Enter the volcano");
  assert.equal(volcano.target, shaft);
  assert.equal(volcano.key, null, "> walks to the caves, not the shaft");
});

test("in the caves known stairs come before exploring", () => {
  const stairs = floor(12, 3, { id: TILE.STAIRS_DOWN, stair: { direction: "down", blocked: false } });
  assert.deepEqual(goalStep(world(4, [stairs])), { label: "Walk to the stairs down", detail: "to Depth 5", target: stairs, key: ">" });
  assert.deepEqual(goalStep(world(4, [])), { label: "Explore", detail: "find the stairs down", target: null, key: "X" });
  const blocked = floor(12, 3, { stair: { direction: "down", blocked: true } });
  assert.equal(goalStep(world(4, [blocked])).label, "Explore");
});

test("rooms and switched-off travel keys keep the route but drop the key", () => {
  const stairs = floor(12, 3, { stair: { direction: "down", blocked: false } });
  assert.equal(goalStep(world(4, [stairs]), { room: true }).key, null);
  assert.equal(goalStep(world(4, [stairs]), { travelKeys: false }).key, null);
  assert.equal(goalStep(world(4, [stairs]), { travelKeys: false }).target, stairs);
  assert.equal(goalStep(world(4, []), { room: true }).key, null);
  assert.equal(goalStep(world(4, []), { explore: false }).key, null);
});

test("Depth 15 points at the Eye, and the volcano floor at the cure", () => {
  assert.equal(goalStep(world(15, [])).label, "Find the Eye of Larn");
  assert.deepEqual(goalStep(world(15, [], { hasEye: true })), { label: "The caves end here", detail: "the volcano is reached from town", target: null, key: null });
  assert.equal(goalStep(world(20, [])).label, "Find the cure");
});

test("with the cure, every floor points home", () => {
  const exit = floor(1, 19, { id: TILE.HOME_EXIT }), up = floor(3, 3, { stair: { direction: "up", blocked: false } });
  const home = floor(8, 8, { id: TILE.HOME }), shaftUp = floor(4, 4, { id: TILE.SHAFT_UP });
  assert.deepEqual(goalStep(world(1, [exit, up], { hasCure: true })), { label: "Carry the cure home", detail: "up to town", target: exit, key: "<" });
  assert.deepEqual(goalStep(world(7, [up], { hasCure: true })), { label: "Carry the cure home", detail: "up to Depth 6", target: up, key: "<" });
  assert.deepEqual(goalStep(world(16, [up, shaftUp], { hasCure: true })), { label: "Carry the cure home", detail: "up to town", target: shaftUp, key: null });
  assert.equal(goalStep(world(18, [], { hasCure: true })).label, "Find the way up");
  assert.deepEqual(goalStep(world(0, [home], { hasCure: true })), { label: "Bring the cure home", detail: "your daughter is waiting", target: home, key: null });
});

test("a floor shut behind a closed door points at the door, since exploring never opens one", () => {
  // A walled room: the hero at (5,5), floor to (7,5), a closed door at (8,5).
  const wall = (x, y) => floor(x, y, { wall: true, name: "a wall" });
  const room = [floor(6, 5), floor(7, 5), floor(8, 5, { closed: true, name: "a closed door" })];
  for (let x = 4; x <= 9; x++) room.push(wall(x, 4), wall(x, 6));
  room.push(wall(4, 5), wall(9, 5));
  const shut = world(3, room);
  assert.deepEqual(goalStep(shut), { label: "Walk to the door", detail: "the only way on", target: room[1], key: null });
  assert.equal(goalStep(world(15, room)).label, "Walk to the door", "the Eye hunt is shut in too");
  // Unknown ground in reach (no wall at 6,6) keeps exploring.
  const leaky = world(3, room.filter((tile) => !(tile.x === 6 && tile.y === 6)));
  assert.equal(goalStep(leaky).label, "Explore");
  // Beside the door already, the engine's own Open button covers it.
  assert.equal(goalStep(world(3, room, { x: 7 })).label, "Explore");
});

test("Open names the one shut door beside you; a chest or a second door keeps the classic prompt", () => {
  const door = floor(5, 4, { closed: true, name: "a closed door" });
  const open = [button("BUTTON_OPEN", "o", "open")];
  assert.deepEqual(tileActions(world(2, [door]), open), [{ key: "o", label: "Open the door", detail: "to the north", target: door }]);
  const chest = floor(6, 5, { name: "a chest" });
  assert.deepEqual(tileActions(world(2, [door, chest]), open), [{ key: "o", label: "Open", detail: "beside you" }]);
  const second = floor(4, 5, { closed: true, name: "a closed door" });
  assert.equal(tileActions(world(2, [door, second]), open)[0].label, "Open");
});

test("badly hurt with nothing hostile in sight, Rest comes first", () => {
  const rest = { key: "M", label: "Rest", detail: "until you recover" };
  assert.deepEqual(restStep(world(3, [], { hp: 7, hpMax: 20 })), rest);
  assert.equal(restStep(world(3, [], { hp: 11, hpMax: 20 })), null, "above half health");
  assert.equal(restStep(world(3, [floor(9, 9, { monster: { name: "hobgoblin" } })], { hp: 4, hpMax: 20 })), null, "a creature in sight");
  assert.equal(restStep(world(3, [floor(9, 9, { monster: { name: "lemming", harmless: true } })], { hp: 4, hpMax: 20 })).label, "Rest");
  assert.equal(restStep(world(3, [], { hp: 4, hpMax: 20 }), { room: true }), null, "rooms share every turn");
  const step = nextStep(world(4, [], { hp: 5, hpMax: 20 }));
  assert.deepEqual(step.actions.map((action) => action.label), ["Rest", "Explore"]);
  const stairs = world(4, [], { hp: 5, hpMax: 20, tiles: [floor(5, 5, { id: TILE.STAIRS_DOWN, stair: { direction: "down", blocked: false } })] });
  assert.deepEqual(nextStep(stairs, [button("BUTTON_DOWNSTAIRS", ">", "go down")]).actions.map((action) => action.label), ["Rest", "Go down"]);
});
