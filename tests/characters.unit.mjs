import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as THREE from "three";
import { hero } from "../src/models.js";
import { CREATURES, creature, animateCreature } from "../src/creatures.js";

const sizeOf = root => new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
const triangles = root => {
  let total = 0;
  root.traverse(part => { if (part.isMesh) total += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3; });
  return total;
};

test("every native enemy, including the loot goblin, has an exact-ID model", () => {
  const context = vm.createContext({ OEMPTY: {}, Monster: class { constructor(_glyph, name) { this.name = name; } } });
  vm.runInContext(`${readFileSync("public/engine/monsterdata.js", "utf8")}\nglobalThis.nativeCount = ULARN_monsterlist.length - 1;`, context);
  assert.equal(CREATURES.length, context.nativeCount);
  assert.equal(new Set(CREATURES.map(entry => entry.model)).size, context.nativeCount);
  for (let id = 1; id <= context.nativeCount; id++) {
    const model = creature({ id });
    assert.equal(model.userData.species, id);
    assert.equal(model.userData.presentation, "model");
    assert.ok(model.getObjectByName("contact-disc"));
    assert.ok(model.getObjectByName("creature-body"));
  }
  assert.equal(creature({ id: 66 }).userData.model, "loot-goblin");
  assert.equal(creature({ id: 0 }), null);
});

test("player bodies fit a corridor and the hood no longer stretches behind the rogue", () => {
  const profiles = new Set();
  for (const name of ["Adventurer", "Wizard", "Rogue", "Elf", "Dwarf", "Ogre", "Klingon", "Rambo"]) {
    const model = hero(name);
    assert.ok(triangles(model) < 900, name);
    assert.equal(model.getObjectByName("weapon").parent.name, "right-forearm");
    model.getObjectByName("weapon").removeFromParent();
    const size = sizeOf(model.getObjectByName("body"));
    assert.ok(size.x < 1 && size.z < .9, `${name}: ${size.toArray()}`);
    profiles.add(size.toArray().map(value => value.toFixed(2)).join(":"));
  }
  assert.equal(profiles.size, 8);
  const rogue = hero("Rogue"); rogue.getObjectByName("weapon").removeFromParent();
  assert.ok(sizeOf(rogue.getObjectByName("body")).z < .7);
});

test("every enemy has finite, bounded shared geometry through motion and reduced motion", () => {
  for (const entry of CREATURES) {
    const first = creature(entry), second = creature(entry);
    assert.equal(first.getObjectByName("core").children[0].geometry, second.getObjectByName("core").children[0].geometry);
    assert.ok(triangles(first) <= 750, entry.model);
    let meshes = 0;
    first.traverse(part => {
      if (!part.isMesh) return;
      meshes++;
      for (const attribute of Object.values(part.geometry.attributes))
        assert.ok(Array.from(attribute.array).every(Number.isFinite), entry.model);
    });
    assert.ok(meshes <= 20, `${entry.model}: ${meshes} meshes`);
    const positions = first.getObjectByName("core").children[0].geometry.attributes.position.array.slice();
    for (const time of [0, 80, 200, 500, 1500]) {
      animateCreature(first,time,true,false);
      const bounds = new THREE.Box3().setFromObject(first), size = bounds.getSize(new THREE.Vector3());
      assert.ok(size.toArray().every(value => value > .1 && value < 3.6), entry.model);
      assert.ok(bounds.min.y > -.09, `${entry.model} below floor: ${bounds.min.y}`);
    }
    animateCreature(first,2000,false,true);
    assert.equal(first.getObjectByName("creature-body").position.y, 0);
    for (const part of first.getObjectByName("creature-body").children)
      if (part.userData.restRotation) assert.deepEqual(part.rotation.toArray().slice(0,3),part.userData.restRotation);
    assert.deepEqual(first.getObjectByName("core").children[0].geometry.attributes.position.array,positions);
    assert.equal(second.rotation.y, 0);
  }
  assert.ok(sizeOf(creature({id:7})).y < .7, "snake remains a low coil");
  assert.ok(sizeOf(creature({id:50})).y < 1.4, "worm remains coiled rather than a tall spike");
  assert.equal(creature({id:22}).getObjectsByProperty("name","head").length,1,"centaur has one rider head");
});

test("mirrored wing triangle winding agrees with its normals on both sides", () => {
  for (const id of [15,25,48,56,64,65]) {
    const model = creature({id});
    for (const name of ["wing--1","wing-1"]) {
      const wing = model.getObjectByName(name);
      const membrane = wing.children.find(part => part.material.side === THREE.DoubleSide);
      assert.ok(membrane,`${id}: ${name}`);
      const geometry = membrane.geometry, position = geometry.attributes.position, normal = geometry.attributes.normal;
      for (let i = 0; i < position.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(position,i);
        const b = new THREE.Vector3().fromBufferAttribute(position,i+1);
        const c = new THREE.Vector3().fromBufferAttribute(position,i+2);
        const face = b.sub(a).cross(c.sub(a));
        assert.ok(face.dot(new THREE.Vector3().fromBufferAttribute(normal,i)) > 0,`${id}: ${name} inside-out triangle`);
      }
    }
  }
});
