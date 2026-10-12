/**
 * Locks the four 1.3.39 regressions: camera center, floor species,
 * full map size, and balanced lighting (no fog, no bloom, no shadows).
 * Run via: node --test tests/restore-139.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { World } from "../src/world.js";
import { compactMapCell, compactMapExtent } from "../src/map.js";
import { bootEngine } from "./lib/engine-session.mjs";

const WIDTH = 57;
const HEIGHT = 20;
const LEMMING = 1;
const EYE = 12;
const LOOT_GOBLIN = 66;
const FLOOR_CAP = [5, 11, 17];

const floorMonsters = (api, depth) => {
  const floor = api.LEVELS[depth];
  const found = [];
  for (let x = 0; x < WIDTH; x++) {
    for (let y = 0; y < HEIGHT; y++) {
      const monster = floor.monsters[x][y];
      if (monster) found.push(monster);
    }
  }
  return found;
};

test("the camera keeps the hero in the middle of the window", () => {
  const calls = [];
  const world = Object.create(World.prototype);
  world.camera = {
    setViewOffset() {
      calls.push("offset");
    },
    clearViewOffset() {
      calls.push("clear");
    },
  };
  world.invalidate = () => calls.push("invalidate");
  world.setViewportRect({ left: 400, right: 1400, top: 80, bottom: 820 });
  assert.deepEqual(calls, ["clear", "invalidate"]);
  assert.equal(world.viewportRect.left, 400);
});

test("floor stocking stays inside the 1.3.39 monstlevel table", () => {
  const bridge = readFileSync(new URL("../src/bridge.js", import.meta.url), "utf8");
  assert.equal(bridge.includes("spawnCaveRat3D"), false);
  assert.equal(bridge.includes("newcavelevel ="), false);

  const rolls = bootEngine({ seed: 4 });
  rolls.level = 1;
  for (let i = 0; i < 300; i++) {
    const species = rolls.makemonst(1);
    assert.ok(species >= LEMMING && species <= 5, `floor 1 rolled ${species}`);
  }
  rolls.level = 3;
  const floor3 = new Set();
  for (let i = 0; i < 400; i++) floor3.add(rolls.makemonst(3));
  assert.equal([...floor3].some((species) => species > 17 && species !== LEMMING), false);
  assert.equal(floor3.has(EYE), true);

  for (let n = 0; n < 10; n++) {
    const api = bootEngine({ seed: n * 19 + 2 });
    for (const depth of [1, 2, 3]) {
      assert.equal(api.generateFreshLevel(depth).ok, true, `seed ${n} floor ${depth}`);
      const monsters = floorMonsters(api, depth);
      assert.ok(monsters.length > 0, `seed ${n} floor ${depth} was empty`);
      const lemmings = monsters.filter((monster) => monster.arg === LEMMING);
      assert.ok(lemmings.length <= 1, `seed ${n} floor ${depth} kept ${lemmings.length} lemmings`);
      for (const monster of monsters) {
        const classic = monster.arg === LOOT_GOBLIN || (monster.arg >= 1 && monster.arg <= FLOOR_CAP[depth - 1]);
        assert.equal(classic, true, `seed ${n} floor ${depth} placed ${monster.desc} (${monster.arg})`);
      }
      if (depth < 3) {
        assert.equal(monsters.some((monster) => monster.arg === EYE), false);
      }
    }
  }

  const lem = bootEngine({ seed: 1 }).monsterlist[LEMMING];
  assert.equal(lem.desc, "lemming");
  assert.equal(lem.armorclass, 18);
  assert.equal(lem.hitpoints, 0);
  const eye = bootEngine({ seed: 1 }).monsterlist[EYE];
  assert.equal(eye.desc, "floating eye");
  assert.equal(eye.level, 3);
});

test("the on-screen map keeps the 1.3.39 floor size", () => {
  assert.deepEqual(compactMapExtent({ level: 1, width: WIDTH, height: HEIGHT }), {
    x: 0,
    y: 0,
    cols: WIDTH,
    rows: HEIGHT,
  });
  const desktop = compactMapCell(WIDTH, HEIGHT, 1440, 1000);
  assert.equal(desktop.cell, 12);
  assert.equal(desktop.cssWidth, 684);
  assert.equal(desktop.cssHeight, 240);
  assert.deepEqual(
    compactMapExtent({ level: 0, width: WIDTH, height: HEIGHT }, { x0: 19, y0: 1, x1: 36, y1: 18 }),
    { x: 18, y: 0, cols: 20, rows: 20 },
  );
});

test("balanced and auto keep fog, bloom, and shadows off", () => {
  const world = Object.create(World.prototype);
  world.quality = "balanced";
  world.effectiveTier = 1;
  world.state = { level: 1 };
  world.ambient = { intensity: 0 };
  world.sun = {
    intensity: 4,
    visible: true,
    castShadow: true,
    shadow: { mapSize: { set() {} }, map: null },
  };
  world.fill = { intensity: 1, visible: true, color: { set() {} } };
  world.scene = { fog: { density: 0.02 }, environment: { texture: {} }, environmentIntensity: 1 };
  world.playerLight = { visible: true, intensity: 3 };
  world.torchLights = [];
  world.renderer = {
    setPixelRatio() {},
    shadowMap: { enabled: true, type: 0 },
    toneMapping: 1,
    toneMappingExposure: 1,
  };
  world.walls = { castShadow: true, receiveShadow: true };
  world.caps = { castShadow: true, receiveShadow: true };
  world.floor = { receiveShadow: true };
  world.grassFloor = { receiveShadow: true };
  world.player = null;
  world.monsters = new Map();
  world.cooperationAura = null;
  world.bloom = { enabled: true };
  world.composer = { setPixelRatio() {} };
  world.environment = null;
  let builtComposer = false;
  world.ensureComposer = () => {
    builtComposer = true;
  };
  world.disposeComposer = () => {
    world.composer = null;
    world.bloom = null;
  };
  world.applyFloorMaterials = () => {};
  world.markShadowUpdate = () => {
    throw new Error("balanced updated a shadow map");
  };

  assert.equal(world.cinematicRendering(), false);
  assert.equal(world.qualityPixelRatio(), 0.75);
  world.quality = "auto";
  world.effectiveTier = 2;
  assert.equal(world.cinematicRendering(), false);
  assert.equal(world.qualityPixelRatio(), 0.75);
  world.quality = "balanced";

  world.applyGpuQuality();
  assert.equal(builtComposer, false);
  assert.equal(world.scene.fog.density, 0);
  assert.equal(world.sun.visible, false);
  assert.equal(world.sun.intensity, 0);
  assert.equal(world.fill.visible, false);
  assert.equal(world.renderer.shadowMap.enabled, false);
  assert.equal(world.sun.castShadow, false);
  assert.equal(world.bloom, null);
  assert.equal(world.composer, null);
  assert.equal(world.playerLight.visible, false);
});
