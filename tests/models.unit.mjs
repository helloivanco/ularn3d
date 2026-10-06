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
  for (const name of ["Adventurer", "Wizard", "Rogue", "Elf", "Dwarf", "Ogre", "Klingon", "Rambo"]) {
    assert.ok(triangles(hero(name)) < 900, `${name} is ${triangles(hero(name))} triangles`);
  }
});

test("classes keep distinct silhouettes and starting weapons", () => {
  const weapons = {
    Adventurer: "dagger",
    Rogue: "dagger",
    Dwarf: "spear",
    Rambo: "lance",
    Wizard: "unarmed",
    Elf: "unarmed",
    Ogre: "unarmed",
    Klingon: "unarmed",
  };
  const helms = {
    Adventurer: "helm",
    Wizard: "hat",
    Rogue: "hood",
    Elf: "ears",
    Dwarf: "helm",
    Ogre: "tusks",
    Klingon: "brow",
    Rambo: "band",
  };
  for (const [name, type] of Object.entries(weapons)) {
    const player = hero(name);
    assert.equal(player.userData.heroClass, name);
    assert.equal(player.userData.helm, helms[name]);
    const weapon = player.getObjectByName("weapon");
    assert.equal(weapon.userData.weaponType, type);
    assert.equal(weapon.parent?.name, "right-forearm");
    let armedMeshes = 0;
    weapon.traverse((obj) => { if (obj.isMesh) armedMeshes++; });
    assert.equal(armedMeshes > 0, type !== "unarmed", name);
    assert.ok(player.getObjectByName("left-arm"));
    assert.ok(player.getObjectByName("right-arm"));
    assert.ok(player.getObjectByName("left-forearm"));
    assert.ok(player.getObjectByName("right-forearm"));
    assert.ok(player.getObjectByName("contact-disc"));
    let outlines = 0;
    player.traverse((obj) => { if (obj.name === "hero-outline") outlines++; });
    assert.ok(outlines > 4, name);
    assert.equal(!!player.getObjectByName("lantern"), name === "Adventurer");
  }
  assert.ok(hero("Dwarf").getObjectByName("body").scale.y < 0.9);
  assert.ok(hero("Ogre").getObjectByName("body").scale.x > 1.2);
  assert.equal(hero("Wizard").getObjectByName("cape")?.name, "cape");
  assert.equal(hero("Rogue").getObjectByName("cape"), undefined);
  assert.equal(new Set(Object.values(helms)).size, 7);
});

test("representative species use procedural models and the rest stay sprites", async () => {
  if (!globalThis.document?.createElementNS) {
    globalThis.document = {
      createElementNS() {
        return { addEventListener() {}, removeEventListener() {}, set src(_) {} };
      },
    };
  }
  const { createCreatureModel, CREATURE_MODELS } = await import("../src/creature-models.js");
  const { monsterSprite } = await import("../src/monster-art.js");
  const { faceMonster } = await import("../src/monster-art.js");
  assert.deepEqual(Object.keys(CREATURE_MODELS).map(Number).sort((a, b) => a - b), [1, 2, 4, 12, 56]);
  for (const [id, key] of Object.entries(CREATURE_MODELS)) {
    const model = createCreatureModel({ id: Number(id), name: key });
    assert.equal(model.userData.presentation, "model");
    assert.equal(model.userData.modelKey, key);
    assert.equal(model.userData.artPath, null);
    assert.ok(model.getObjectByName("contact-disc"));
    assert.ok(model.userData.body);
    let outlines = 0;
    model.traverse((obj) => { if (obj.name === "hero-outline") outlines++; });
    assert.equal(outlines, 0, key);
    faceMonster(model, { x: -1, y: 0 }, null);
    assert.ok(Math.abs(model.rotation.y - Math.PI / 2) < 0.001, key);
  }
  assert.equal(createCreatureModel({ id: 45, name: "gnome king" }), null);
  assert.equal(createCreatureModel({ id: 3, name: "hobgoblin" }), null);
  const gnome = createCreatureModel({ id: 2, name: "gnome" });
  assert.equal(gnome.getObjectByName("staff"), undefined);
  const sprite = monsterSprite({ id: 3, name: "hobgoblin" });
  assert.equal(sprite.userData.presentation, "sprite");
  assert.equal(sprite.userData.artPath, "/engine/img/m3.png");
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
