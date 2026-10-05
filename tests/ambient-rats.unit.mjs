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

const worldPoints = (mesh, name) => {
  const points = [];
  const vertex = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  mesh.traverse((object) => {
    if (!object.isMesh || object.name !== name) return;
    const position = object.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i);
      points.push(object.localToWorld(vertex.clone()));
    }
  });
  return points;
};

const widthBetween = (points, z0, z1) => {
  const slice = points.filter((point) => point.z >= z0 && point.z <= z1);
  const xs = slice.map((point) => point.x);
  return Math.max(...xs) - Math.min(...xs);
};

test("ambient rats have a tapered body, pointed snout, ears, and a curved tail", () => {
  const scene = new THREE.Scene();
  const rats = new AmbientRats(scene);
  const mesh = rats.slots[0].mesh;
  const names = new Set();
  mesh.traverse((object) => {
    if (!object.isMesh) return;
    names.add(object.name);
    assert.equal(object.material.type, "MeshBasicMaterial");
    assert.equal(object.castShadow, false);
    assert.equal(object.receiveShadow, false);
  });
  for (const name of ["rat-body", "rat-head", "rat-ear", "rat-tail"]) {
    assert.equal(names.has(name), true, name);
  }

  const body = worldPoints(mesh, "rat-body");
  const bodyZ = body.map((point) => point.z);
  const zMin = Math.min(...bodyZ);
  const zMax = Math.max(...bodyZ);
  const span = zMax - zMin;
  const haunchW = widthBetween(body, zMin, zMin + span * 0.45);
  const shoulderW = widthBetween(body, zMax - span * 0.25, zMax);
  assert.ok(haunchW > shoulderW * 1.4, `haunches ${haunchW} shoulders ${shoulderW}`);

  const head = worldPoints(mesh, "rat-head");
  const tip = head.reduce((best, point) => (point.z > best.z ? point : best));
  assert.ok(tip.z > zMax);
  assert.ok(Math.abs(tip.x) < 0.012);
  const behindTip = head.filter((point) => point.z < tip.z - 0.04);
  const tipWidth = Math.max(...behindTip.map((point) => point.x)) - Math.min(...behindTip.map((point) => point.x));
  assert.ok(tipWidth > 0.04);

  const ears = worldPoints(mesh, "rat-ear");
  assert.ok(ears.some((point) => point.x < -0.03));
  assert.ok(ears.some((point) => point.x > 0.03));
  const earZ = ears.map((point) => point.z);
  assert.ok(Math.min(...earZ) > (zMin + zMax) / 2);

  const tail = worldPoints(mesh, "rat-tail");
  const tailTip = tail.reduce((best, point) => (point.z < best.z ? point : best));
  assert.ok(tailTip.z < zMin);
  const base = tail.reduce((best, point) => (point.z > best.z ? point : best));
  assert.ok(base.z > zMin - 0.02);
  assert.ok(Math.abs(base.x) < 0.06);
  const bow = Math.max(...tail.map((point) => Math.abs(point.x - base.x)));
  assert.ok(bow > 0.08, `tail bow ${bow}`);
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
