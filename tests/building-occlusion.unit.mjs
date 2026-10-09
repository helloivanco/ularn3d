import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { World } from "../src/world.js";

function fixture(x = 0, z = 0) {
  const world = Object.create(World.prototype), mesh = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1.42, 1.36, .12), new THREE.MeshBasicMaterial());
  wall.position.set(0, .68, .54); mesh.add(wall);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.87, .3, 1.62), new THREE.MeshBasicMaterial());
  roof.position.y = 1.5; mesh.add(roof);
  const label = new THREE.Sprite(new THREE.SpriteMaterial());
  label.position.y = 2.7; label.scale.set(2.35, .46, 1); mesh.add(label);
  mesh.userData.buildingOccluders = [wall, roof];
  const camera = new THREE.PerspectiveCamera(45, 1.4, .1, 100);
  camera.position.set(x, 15, z + 10); camera.lookAt(x, 0, z); camera.updateMatrixWorld();
  Object.assign(world, { camera, player: new THREE.Group(), cutawayRay: new THREE.Raycaster(),
    cutawayHits: [], cutawayTarget: new THREE.Vector3(), cutawayDirection: new THREE.Vector3() });
  world.player.position.set(x, 0, z);
  return { world, mesh };
}

test("a nearby label and projected building bounds do not cut away a clear exterior", () => {
  const { world, mesh } = fixture(1, 0);
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const projected = new THREE.Box2();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const point = new THREE.Vector3(x, y, z).project(world.camera);
    projected.expandByPoint(new THREE.Vector2(point.x, point.y));
  }
  const hero = new THREE.Vector3(1, .6, 0).project(world.camera);
  assert.equal(projected.containsPoint(new THREE.Vector2(hero.x, hero.y)), true, "the old projected rectangle falsely overlaps");
  assert.equal(world.buildingObscuresHero(mesh), false);
});

test("real obstructions remain detected after fading and restore when the hero clears them", () => {
  const { world, mesh } = fixture();
  assert.equal(world.buildingObscuresHero(mesh), true);
  mesh.userData.obscuresHero = true;
  for (const part of mesh.userData.buildingOccluders) { part.visible = false; part.material.opacity = 0; }
  assert.equal(world.buildingObscuresHero(mesh), true, "invisible geometry still controls the fade");
  world.player.position.x = 1;
  world.camera.position.x = 1; world.camera.lookAt(1, 0, 0); world.camera.updateMatrixWorld();
  assert.equal(world.buildingObscuresHero(mesh), false);
});

test("geometry behind the hero never counts as an obstruction", () => {
  const { world, mesh } = fixture(0, 2);
  assert.equal(world.buildingObscuresHero(mesh), false);
});
