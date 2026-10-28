import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { worldMasonry, tileScatter } from "../src/materials.js";

const compiled = (material) => {
  const shader = { vertexShader: "void main() {\n#include <uv_vertex>\n}", fragmentShader: "" };
  material.onBeforeCompile(shader);
  return shader.vertexShader;
};

test("walls are laid in world space with a course joint on the floor line", () => {
  const base = new THREE.MeshBasicMaterial({ color: 0x73847d });
  const laid = worldMasonry(base, -0.015);
  assert.notEqual(laid, base);
  assert.equal(worldMasonry(base, -0.015), laid, "one laid material per base and floor line");
  assert.equal(laid.userData.worldMasonry, true);
  assert.equal(laid.customProgramCacheKey(), "world-masonry:-0.015");
  const vertex = compiled(laid);
  // Instanced blocks read their world position, so courses run on from block to block.
  assert.match(vertex, /modelMatrix \* instanceMatrix \* vec4\( position, 1\.0 \)/);
  // Tops pave by world x and z; sides run along the face, with height above the floor.
  assert.match(vertex, /masonryAt\.xz/);
  assert.match(vertex, /masonryAt\.y - -0\.0150/);
  for (const map of ["vMapUv", "vNormalMapUv", "vRoughnessMapUv"]) assert.match(vertex, new RegExp(`${map} = `));
});

test("floors keep turning per tile while walls are laid", () => {
  const base = new THREE.MeshBasicMaterial();
  assert.notEqual(compiled(tileScatter(base)), compiled(worldMasonry(base)));
  assert.equal(tileScatter(base).userData.worldMasonry, undefined);
});
