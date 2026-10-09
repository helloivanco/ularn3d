import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { World } from "../src/world.js";
import { hero } from "../src/models.js";
import { stepPose } from "../src/hero-motion.js";

const classes = ["Adventurer", "Wizard", "Rogue", "Elf", "Dwarf", "Ogre", "Klingon", "Rambo"];

function fixture(character, cells) {
  const world = Object.create(World.prototype);
  Object.assign(world, {
    player: hero(character),
    heroBounds: new THREE.Box3(),
    boundsCorner: new THREE.Vector3(),
    solidTiles: new Set(cells.map(([x, z]) => `${x},${z}`)),
    stepHome: { x: 0, z: 0 },
  });
  world.bindHero();
  world.applyStepPose(stepPose(1, false));
  return world;
}

test("stationary heroes stay planted at every facing beside corridor corners", () => {
  const layouts = [
    [[-1, -1], [0, -1], [0, 1]],
    [[1, 1], [0, 1], [0, -1]],
    [[-1, -1], [-1, 0], [1, 0]],
    [[1, 1], [1, 0], [-1, 0]],
  ];
  for (const character of classes) {
    for (const cells of layouts) {
      const world = fixture(character, cells);
      for (let facing = 0; facing < 16; facing++) {
        world.player.position.set(0, 0, 0);
        world.player.rotation.y = facing * Math.PI / 8;
        for (let frame = 0; frame < 12; frame++) {
          world.keepBodyOutOfRock();
          assert.ok(world.player.position.length() < 1e-8,
            `${character}, facing ${facing}, frame ${frame}: ${world.player.position.toArray()}`);
          assert.equal(world.bodyHitsRock(), false);
        }
      }
    }
  }
});

test("actual body overlap still clears walls and settles without moving gameplay coordinates", () => {
  for (const character of classes) {
    const world = fixture(character, [[1, 0]]);
    world.player.position.x = .35;
    assert.equal(world.bodyHitsRock(), true, character);
    world.keepBodyOutOfRock();
    assert.equal(world.bodyHitsRock(), false, character);
    assert.ok(world.player.position.x < .35 && world.player.position.x >= 0, character);
    const settled = world.player.position.clone();
    for (let frame = 0; frame < 12; frame++) world.keepBodyOutOfRock();
    assert.ok(world.player.position.distanceTo(settled) < 1e-8, character);
    assert.deepEqual(world.stepHome, { x: 0, z: 0 });
  }
});
