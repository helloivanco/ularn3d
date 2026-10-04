/**
 * Cooperation aura bounds and the monster-turn gate.
 * Run via: node --test tests/cooperation-aura.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as THREE from "three";
import {
  AURA_HEIGHT,
  AURA_WIDTH,
  auraBoundingBox,
  auraCenter,
  monsterInAdventurerAura,
  monstersActingFor,
  tileInAura,
} from "../src/cooperation-aura.js";
import {
  cooperationAuraShown,
  createCooperationAura,
  placeCooperationAura,
} from "../src/cooperation-aura-mesh.js";

const MAXX = 57;
const MAXY = 20;

test("engine aura.js matches src/cooperation-aura.js aside from exports", () => {
  const esm = readFileSync("src/cooperation-aura.js", "utf8");
  const classic = readFileSync("public/engine/aura.js", "utf8");
  assert.equal(classic, esm.replace(/^export /gm, ""));
  assert.match(readFileSync("public/engine/movem.js", "utf8"), /monstersActingFor\(adventurers, candidates\)/);
  assert.match(readFileSync("scripts/build-engine.mjs", "utf8"), /"aura"/);
});

test("cooperation aura bounding box is 20 by 10 centered on the adventurer", () => {
  assert.equal(AURA_WIDTH, 20);
  assert.equal(AURA_HEIGHT, 10);
  const box = auraBoundingBox(10, 8);
  assert.deepEqual(box, { x0: 1, y0: 4, x1: 20, y1: 13 });
  assert.equal(box.x1 - box.x0 + 1, 20);
  assert.equal(box.y1 - box.y0 + 1, 10);
  const center = auraCenter(10, 8);
  assert.equal(center.x, 10.5);
  assert.equal(center.y, 8.5);
  assert.equal(auraCenter(0, 0).x, 0.5);
  assert.equal(auraCenter(0, 0).y, 0.5);
});

test("ellipse tile test keeps the center row at 20 and the center column at 10", () => {
  const originX = 10;
  const originY = 8;
  const box = auraBoundingBox(originX, originY);
  let row = 0;
  for (let x = box.x0; x <= box.x1; x++) {
    assert.equal(tileInAura(originX, originY, x, originY), true, `row x ${x}`);
    row++;
  }
  assert.equal(row, 20);
  assert.equal(tileInAura(originX, originY, box.x0 - 1, originY), false);
  assert.equal(tileInAura(originX, originY, box.x1 + 1, originY), false);
  let column = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    assert.equal(tileInAura(originX, originY, originX, y), true, `column y ${y}`);
    column++;
  }
  assert.equal(column, 10);
  assert.equal(tileInAura(originX, originY, originX, box.y0 - 1), false);
  assert.equal(tileInAura(originX, originY, originX, box.y1 + 1), false);
  assert.equal(tileInAura(originX, originY, box.x0, box.y0), false);
  assert.equal(tileInAura(originX, originY, box.x1, box.y1), false);
});

test("player A's turn moves a monster inside A's aura and does not move a monster only inside B's aura", () => {
  const playerA = { x: 10, y: 8, dungeon: 1 };
  const playerB = { x: 40, y: 8, dungeon: 1 };
  const insideA = { id: "in-a", x: 10, y: 8, dungeon: 1 };
  const onlyB = { id: "in-b", x: 40, y: 8, dungeon: 1 };
  const corner = { id: "corner", x: 1, y: 4, dungeon: 1 };
  const otherLevel = { id: "other-level", x: 10, y: 8, dungeon: 2 };
  const moved = monstersActingFor([playerA], [insideA, onlyB, corner, otherLevel]);
  assert.deepEqual(
    moved.map((monster) => monster.id),
    ["in-a"],
  );
  assert.equal(monsterInAdventurerAura(playerB, onlyB), true);
  assert.equal(monsterInAdventurerAura(playerA, onlyB), false);
  const overlap = { id: "shared", x: 12, y: 8, dungeon: 1 };
  const once = monstersActingFor(
    [playerA, { x: 14, y: 8, dungeon: 1 }],
    [overlap, overlap],
  );
  assert.deepEqual(
    once.map((monster) => monster.id),
    ["shared"],
  );
});

test("a monster on another dungeon level never acts", () => {
  const playerA = { x: 10, y: 8, dungeon: 1 };
  const otherLevel = { id: "other-level", x: 10, y: 8, dungeon: 2 };
  assert.equal(monsterInAdventurerAura(playerA, otherLevel), false);
  assert.deepEqual(monstersActingFor([playerA], [otherLevel]), []);
  const engine = bootMonsterTurns();
  engine.level = 1;
  engine.player.x = 40;
  engine.player.y = 8;
  const upstairs = engine.makeMonster("other-level");
  engine.LEVELS[2].monsters[10][8] = upstairs;
  engine.cooperationActingAdventurers = () => [{ x: 10, y: 8, dungeon: 1 }];
  engine.movemonst();
  assert.deepEqual(engine.calls, []);
  assert.equal(upstairs.moved, false);
});

test("movemonst follows the acting adventurer list, not the other player's aura", () => {
  const engine = bootMonsterTurns();
  engine.level = 1;
  engine.player.x = 40;
  engine.player.y = 8;
  const insideA = engine.makeMonster("in-a");
  const onlyB = engine.makeMonster("in-b");
  engine.LEVELS[1].monsters[10][8] = insideA;
  engine.LEVELS[1].monsters[40][8] = onlyB;
  const upstairs = engine.makeMonster("other-level");
  engine.LEVELS[2].monsters[10][8] = upstairs;
  engine.cooperationActingAdventurers = () => [{ x: 10, y: 8, dungeon: 1 }];
  engine.movemonst();
  assert.deepEqual(
    engine.calls.map((call) => call.id),
    ["in-a"],
  );
  assert.equal(onlyB.moved, false);
  assert.equal(upstairs.moved, false);
  assert.equal(engine.noticeCalls, 0);

  engine.calls.length = 0;
  insideA.moved = false;
  engine.cooperationActingAdventurers = () => [{ x: 40, y: 8, dungeon: 1 }];
  engine.player.x = 40;
  engine.player.y = 8;
  engine.movemonst();
  assert.deepEqual(
    engine.calls.map((call) => call.id),
    ["in-b"],
  );
  assert.equal(insideA.moved, false);

  engine.calls.length = 0;
  engine.LEVELS[1].monsters[10][8] = null;
  engine.LEVELS[1].monsters[40][8] = null;
  const shared = engine.makeMonster("shared");
  engine.LEVELS[1].monsters[12][8] = shared;
  engine.cooperationActingAdventurers = () => [
    { x: 10, y: 8, dungeon: 1 },
    { x: 14, y: 8, dungeon: 1 },
  ];
  engine.movemonst();
  assert.deepEqual(
    engine.calls.map((call) => call.id),
    ["shared"],
  );
});

test("single player aura is the local hero when no acting list is installed", () => {
  const engine = bootMonsterTurns();
  engine.level = 3;
  engine.player.x = 10;
  engine.player.y = 8;
  engine.cooperationActingAdventurers = undefined;
  const here = engine.makeMonster("here");
  const away = engine.makeMonster("away");
  engine.LEVELS[3].monsters[10][8] = here;
  engine.LEVELS[3].monsters[40][8] = away;
  engine.movemonst();
  assert.deepEqual(
    engine.calls.map((call) => call.id),
    ["here"],
  );
  assert.equal(engine.noticeCalls, 1);
});

test("cooperation aura mesh is an unlit MeshBasic ellipse with no light and no shadow", () => {
  const aura = createCooperationAura();
  placeCooperationAura(aura, 10, 8);
  assert.equal(aura.name, "cooperation-aura");
  assert.equal(aura.visible, false);
  assert.equal(aura.position.x, 10.5);
  assert.equal(aura.position.y, 0.015);
  assert.equal(aura.position.z, 8.5);
  const fill = aura.getObjectByName("cooperation-aura-fill");
  const rim = aura.getObjectByName("cooperation-aura-rim");
  assert.equal(fill.material.type, "MeshBasicMaterial");
  assert.equal(rim.material.type, "MeshBasicMaterial");
  assert.equal(fill.material.fog, false);
  assert.equal(rim.material.fog, false);
  assert.equal(fill.material.toneMapped, false);
  assert.equal(fill.castShadow, false);
  assert.equal(fill.receiveShadow, false);
  assert.equal(rim.castShadow, false);
  assert.equal(rim.receiveShadow, false);
  assert.equal(fill.scale.x, AURA_WIDTH / 2);
  assert.equal(fill.scale.y, AURA_HEIGHT / 2);
  aura.updateMatrixWorld(true);
  const east = fill.localToWorld(new THREE.Vector3(1, 0, 0));
  const north = fill.localToWorld(new THREE.Vector3(0, 1, 0));
  assert.ok(Math.abs(east.x - (aura.position.x + AURA_WIDTH / 2)) < 1e-6);
  assert.ok(Math.abs(east.z - aura.position.z) < 1e-6);
  assert.ok(Math.abs(north.x - aura.position.x) < 1e-6);
  assert.ok(Math.abs(Math.abs(north.z - aura.position.z) - AURA_HEIGHT / 2) < 1e-6);
  assert.equal(aura.children.some((child) => child.isLight), false);
  assert.equal(cooperationAuraShown(0), false);
  assert.equal(cooperationAuraShown(1), true);
  assert.equal(cooperationAuraShown(16), true);
  fill.geometry.dispose();
  rim.geometry.dispose();
  fill.material.dispose();
  rim.material.dispose();
});

const bootMonsterTurns = () => {
  const context = {
    console,
    Math,
    Set,
    MAXX,
    MAXY,
    ULARN: true,
    MIMIC: -1,
    level: 1,
    lasthx: -1,
    lasthy: -1,
    player: {
      x: 10,
      y: 8,
      TIMESTOP: 0,
      HOLDMONST: 0,
      AGGRAVATE: 0,
      STEALTH: 0,
    },
    calls: [],
    noticeCalls: 0,
    LEVELS: {},
    initGrid(width, height) {
      const grid = [];
      for (let x = 0; x < width; x++) grid[x] = new Array(height).fill(0);
      return grid;
    },
    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < MAXX && y < MAXY;
    },
  };
  for (let dungeon = 0; dungeon <= 16; dungeon++) {
    context.LEVELS[dungeon] = { monsters: context.initGrid(MAXX, MAXY).map((column) => column.map(() => null)) };
  }
  context.monsterAt = (x, y) => {
    if (!context.inBounds(x, y)) return null;
    return context.LEVELS[context.level].monsters[x][y];
  };
  context.makeMonster = (id) => ({
    id,
    moved: false,
    awake: true,
    arg: 1,
    mimiccounter: 0,
  });
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync("public/engine/aura.js", "utf8"), context);
  vm.runInContext(readFileSync("public/engine/movem.js", "utf8"), context);
  context.movemt = (x, y) => {
    const monster = context.monsterAt(x, y);
    context.calls.push({ x, y, level: context.level, id: monster && monster.id });
    if (monster) monster.moved = true;
    context.movedx = x;
    context.movedy = y;
  };
  context.noticeplayer = () => {
    context.noticeCalls++;
  };
  return context;
};
