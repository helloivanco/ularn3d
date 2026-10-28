import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CAVE_LIGHT, LIGHT_SIZE } from "../src/cave-light.js";

test("point lights fall off from a light a tile across, not a point", () => {
  const chunk = THREE.ShaderChunk.lights_pars_begin;
  assert.doesNotMatch(chunk, /max\( pow\( lightDistance, decayExponent \), 0\.01 \)/,
    "three's point falloff is still in place; the light-size patch no longer matches this three version");
  assert.match(chunk, /1\.0 \/ \( pow\( lightDistance, decayExponent \) \+ 1\.0000 \)/);
  assert.equal(LIGHT_SIZE, 1);
});

test("a creature beside a torch takes at most a few times the light of the floor a tile away", () => {
  // A torch hangs 0.88 up and inside the walkable tile beside its wall.
  const falloff = (distance) => 1 / (distance ** 2 + LIGHT_SIZE ** 2);
  const besideTorch = CAVE_LIGHT.torch.intensity * falloff(0);
  const floorTileAway = CAVE_LIGHT.torch.intensity * falloff(Math.hypot(1, 0.88));
  assert.ok(besideTorch / floorTileAway < 3, `${besideTorch} vs ${floorTileAway}`);
  // Point-sized, the same torch gave a creature 700 times the light it gave the floor under it.
  assert.ok(falloff(3) * 9 > 0.89, "a few tiles out the light still falls off like a point");
});
