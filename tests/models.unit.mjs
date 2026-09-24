import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { box, orb, ring, hero, itemModel } from "../src/models.js";

const triangles = (root) => {
  let count = 0;
  root.traverse((object) => {
    const geometry = object.geometry;
    if (!geometry) return;
    count += geometry.index
      ? geometry.index.count / 3
      : geometry.attributes.position.count / 3;
  });
  return count;
};

const meshCount = (root) => {
  let count = 0;
  root.traverse((object) => {
    if (object.isMesh) count += 1;
  });
  return count;
};

test("shared solids stay cheap enough for web GPU fill", () => {
  const group = new THREE.Group();
  box(group, 0xffffff, 0, 0, 0, 1, 1, 1);
  orb(group, 0xffffff, 0, 0, 0, 1);
  ring(group, 0xffffff);
  assert.equal(triangles(group.children[0]), 12);
  assert.equal(triangles(group.children[1]), 20);
  assert.equal(triangles(group.children[2]), 72);
});

test("the hero no longer pays rounded-box and dense-torus tax", () => {
  assert.ok(triangles(hero()) < 900);
});

test("pits dart traps and express elevators use distinct graphics", () => {
  const pit = itemModel({ id: 4, name: "a pit" });
  const dart = itemModel({ id: 74, name: "a dart trap" });
  const up = itemModel({ id: 6, name: "an express elevator going up" });
  const down = itemModel({ id: 14, name: "an express elevator going down" });
  const arrow = itemModel({ id: 66, name: "an arrow trap" });

  assert.equal(pit.userData.trapKind, "pit");
  assert.equal(dart.userData.trapKind, "dart");
  assert.equal(up.userData.trapKind, "elevator-up");
  assert.equal(down.userData.trapKind, "elevator-down");
  assert.equal(arrow.userData.trapKind, "trap");

  assert.ok(pit.getObjectByName("pit-rim"));
  assert.equal(dart.children.filter((c) => c.name === "dart-spike").length, 6);
  assert.ok(up.getObjectByName("elevator-up-arrow"));
  assert.ok(down.getObjectByName("elevator-down-arrow"));
  assert.equal(up.userData.elevatorDirection, "up");
  assert.equal(down.userData.elevatorDirection, "down");

  const counts = [pit, dart, up, down, arrow].map(meshCount);
  assert.ok(new Set(counts).size >= 4, `expected distinct mesh topologies, got ${counts}`);
  assert.notEqual(meshCount(pit), meshCount(dart));
  assert.notEqual(meshCount(pit), meshCount(up));
  assert.notEqual(meshCount(dart), meshCount(up));
  assert.notEqual(meshCount(up), meshCount(down), "elevator directions need unique topology");
});

test("wielded weapons rebuild into distinct larger attack grips", async () => {
  const { fillWieldedWeapon } = await import("../src/models.js");
  const grip = new THREE.Group();
  fillWieldedWeapon(grip, { id: 31, type: "dagger" });
  const daggerMeshes = meshCount(grip);
  const daggerBox = new THREE.Box3().setFromObject(grip);
  const daggerSize = daggerBox.getSize(new THREE.Vector3());
  fillWieldedWeapon(grip, { id: 57, type: "axe" });
  const axeMeshes = meshCount(grip);
  fillWieldedWeapon(grip, { id: 27, type: "hammer" });
  const hammerMeshes = meshCount(grip);
  fillWieldedWeapon(grip, { id: null, type: "unarmed" });
  assert.equal(meshCount(grip), 0);
  assert.notEqual(daggerMeshes, axeMeshes);
  assert.notEqual(axeMeshes, hammerMeshes);
  assert.ok(daggerSize.y > 0.6, `swing dagger should be larger than a ground icon, got ${daggerSize.y}`);
});

test("town portal has its own landmark mesh", () => {
  const portal = itemModel({ id: 102, name: "a town portal" });
  assert.equal(portal.userData.portal, true);
  assert.ok(meshCount(portal) >= 3);
});
