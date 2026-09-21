import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { box, orb, ring, hero } from "../src/models.js";

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

test("shared solids stay cheap enough for web GPU fill", () => {
  const group = new THREE.Group();
  box(group, 0xffffff, 0, 0, 0, 1, 1, 1);
  orb(group, 0xffffff, 0, 0, 0, 1);
  ring(group, 0xffffff);
  assert.equal(triangles(group.children[0]), 12);
  assert.equal(triangles(group.children[1]), 80);
  assert.equal(triangles(group.children[2]), 128);
});

test("the hero no longer pays rounded-box and dense-torus tax", () => {
  assert.ok(triangles(hero()) < 1200);
});
