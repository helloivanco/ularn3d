import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  AmbientRats,
  AMBIENT_RAT_POOL,
  AMBIENT_RAT_KIND,
} from "../src/ambient-rats.js";
import { WALL_FULL } from "../src/wall-cut.js";

const wallRing = () => {
  const cells = [];
  for (let x = 4; x <= 12; x++) {
    cells.push({ x, y: 4 });
    cells.push({ x, y: 12 });
  }
  for (let y = 5; y <= 11; y++) {
    cells.push({ x: 4, y });
    cells.push({ x: 12, y });
  }
  return cells;
};

test("ambient rats use a hard-capped non-interactive pool", () => {
  const scene = new THREE.Scene();
  const rats = new AmbientRats(scene);
  assert.equal(rats.slots.length, AMBIENT_RAT_POOL);
  assert.ok(AMBIENT_RAT_POOL <= 6);
  assert.ok(AMBIENT_RAT_POOL >= 3);

  const heights = wallRing().map(() => WALL_FULL);
  rats.setLayout(wallRing(), 1, heights);
  const snap = rats.snapshot();
  assert.equal(snap.pool, AMBIENT_RAT_POOL);
  assert.equal(snap.interactive, false);
  assert.equal(snap.decorative, true);
  assert.equal(snap.kind, AMBIENT_RAT_KIND);
  assert.ok(snap.count <= AMBIENT_RAT_POOL);
  assert.ok(snap.count >= 1);
  assert.equal(snap.rats.length, snap.count);
  for (const rat of snap.rats) {
    assert.equal(rat.interactive, false);
    assert.equal(rat.decorative, true);
    assert.equal(rat.kind, AMBIENT_RAT_KIND);
    assert.ok(rat.position.y > 1);
  }

  // Growing the wall set must not grow the pool.
  const many = [];
  for (let x = 0; x < 40; x++) for (let y = 0; y < 20; y++) many.push({ x, y });
  rats.setLayout(many, 2, many.map(() => WALL_FULL));
  assert.equal(rats.slots.length, AMBIENT_RAT_POOL);
  assert.ok(rats.snapshot().count <= AMBIENT_RAT_POOL);

  for (const slot of rats.slots) {
    assert.equal(slot.mesh.userData.interactive, false);
    assert.equal(slot.mesh.userData.decorative, true);
    assert.equal(typeof slot.mesh.raycast, "function");
    // Empty raycast — never a pick target even if accidentally included.
    const hits = [];
    slot.mesh.raycast({ ray: new THREE.Ray() }, hits);
    assert.equal(hits.length, 0);
  }

  rats.dispose();
  assert.equal(scene.children.includes(rats.group), false);
});

test("ambient rats are a small unlit side-view sprite", () => {
  const scene = new THREE.Scene();
  const rats = new AmbientRats(scene);
  const mesh = rats.slots[0].mesh;
  const sprite = mesh.getObjectByName("rat-sprite");
  assert.ok(sprite);
  assert.equal(sprite.material.type, "MeshBasicMaterial");
  assert.equal(sprite.material.toneMapped, false);
  assert.ok(sprite.material.alphaTest > 0);
  assert.equal(sprite.castShadow, false);
  assert.equal(sprite.receiveShadow, false);
  assert.equal(sprite.rotation.x, 0);
  assert.ok(Math.abs(sprite.scale.x) > Math.abs(sprite.scale.y));
  assert.ok(Math.abs(sprite.scale.x) < 1);

  const image = sprite.material.map.image;
  const { data, width, height } = image;
  assert.ok(width > height);
  let pink = 0;
  let brown = 0;
  let eye = 0;
  let clear = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 10) {
      clear += 1;
      continue;
    }
    if (r > 200 && r > g + 15 && b > 120) pink += 1;
    else if (r > 70 && r < 190 && g > 40 && g < r - 10 && b < 140) brown += 1;
    if (r < 30 && g < 30 && b < 30) eye += 1;
  }
  assert.ok(clear > 20);
  assert.ok(pink > 8, `pink ${pink}`);
  assert.ok(brown > 20, `brown ${brown}`);
  assert.ok(eye > 0, `eye ${eye}`);
  rats.dispose();
});

test("town floors skip ambient rats", () => {
  const scene = new THREE.Scene();
  const rats = new AmbientRats(scene);
  rats.setLayout(wallRing(), 0, wallRing().map(() => WALL_FULL));
  assert.equal(rats.enabled, false);
  assert.equal(rats.snapshot().count, 0);
  rats.dispose();
});

test("rats scurry along wall tops without allocating new slots", () => {
  const scene = new THREE.Scene();
  const rats = new AmbientRats(scene);
  const cells = wallRing();
  const heights = cells.map(() => WALL_FULL);
  rats.setLayout(cells, 3, heights);
  const before = rats.slots.length;
  const cam = new THREE.Vector3(8, 8, 8);
  let moved = false;
  for (let i = 0; i < 80; i++) {
    if (rats.update(0.25, cam)) moved = true;
  }
  assert.equal(rats.slots.length, before);
  assert.ok(rats.snapshot().count <= AMBIENT_RAT_POOL);
  // After enough thinks, at least one scurry should have run near camera.
  assert.equal(moved, true);
  for (const rat of rats.snapshot().rats) {
    if (!rat.visible) continue;
    assert.ok(Math.abs(rat.position.y - (WALL_FULL + 0.055)) < 0.05 || rat.scurrying);
  }
  rats.dispose();
});
