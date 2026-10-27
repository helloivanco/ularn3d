import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import {
  AmbientRats,
  AMBIENT_RAT_POOL,
  AMBIENT_RAT_KIND,
  AMBIENT_RAT_MIN_SEP,
  RAT_CLIPS,
  RAT_POSES,
  RAT_RUN,
  lookFromTile,
} from "../src/ambient-rats.js";
import { buildRat, RAT_FILE } from "../scripts/build-rat.mjs";
import { readGlb } from "../scripts/build-models.mjs";
import { WALL_FULL, wallLip } from "../src/wall-cut.js";

const ratFile = readFileSync(RAT_FILE);
const ratModel = () =>
  new GLTFLoader().parseAsync(ratFile.buffer.slice(ratFile.byteOffset, ratFile.byteOffset + ratFile.byteLength), "");
/** Top face of a full-height wall cap, where the rats' feet rest. */
const lip = wallLip(WALL_FULL);
const WALL_TOP = lip.y + lip.thickness / 2;

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
  assert.equal(AMBIENT_RAT_POOL, 2);

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
    assert.ok(Math.abs(rat.position.y - WALL_TOP) < 1e-6);
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

test("ambient rats wear the rigged rat once it loads", async () => {
  const scene = new THREE.Scene();
  const rats = new AmbientRats(scene);
  const ring = wallRing();
  rats.setLayout(ring, 2, ring.map(() => WALL_FULL));
  // Placement does not wait for the download; the slots stay empty until it lands.
  assert.ok(rats.snapshot().rats.every((rat) => rat.presentation === "pending" && rat.clip === null));

  rats.wear(await ratModel());
  const snap = rats.snapshot();
  assert.ok(snap.count >= 1);
  for (const rat of snap.rats) {
    assert.equal(rat.presentation, "model");
    assert.ok(RAT_POSES.includes(rat.clip), rat.clip);
  }
  const [a, b] = rats.slots;
  for (const slot of rats.slots) {
    assert.deepEqual([...slot.rig.actions.keys()].sort(), [...RAT_CLIPS].sort());
    const skinned = [];
    slot.mesh.traverse((object) => { if (object.isSkinnedMesh) skinned.push(object); });
    assert.equal(skinned.length, 2);
    for (const mesh of skinned) {
      assert.equal(mesh.castShadow, false);
      assert.equal(mesh.receiveShadow, false);
      assert.equal(mesh.frustumCulled, false);
      const hits = [];
      mesh.raycast({ ray: new THREE.Ray() }, hits);
      assert.equal(hits.length, 0);
    }
    // Small enough for one wall tile, nose to tail tip, even reared up.
    const size = new THREE.Box3().setFromObject(slot.rig.model).getSize(new THREE.Vector3());
    assert.ok(size.y < 0.4 && Math.max(size.x, size.z) < 1 && Math.max(size.x, size.z) > 0.5, JSON.stringify(size));
  }
  // Each rat tints its own fur; the pink skin is one shared material.
  assert.notEqual(a.rig.fur[0], b.rig.fur[0]);
  const skin = (slot) => slot.rig.model.getObjectByProperty("type", "SkinnedMesh").parent.children.find((m) => m.material.name === "RatSkin").material;
  assert.equal(skin(a), skin(b));
  for (const slot of rats.slots.filter((s) => s.active)) {
    assert.equal(slot.rig.fur[0].color.getHex(), new THREE.Color(slot.look.tint).getHex());
    assert.ok(Math.abs(slot.body.scale.x - slot.look.size) < 1e-9);
  }

  rats.dispose();
  assert.equal(a.rig, null);
  // A model that arrives after teardown is not worn.
  rats.wear(await ratModel());
  assert.equal(a.rig, null);
});

test("a scurrying rat runs toward its next tile, then settles into a resting habit", async () => {
  const scene = new THREE.Scene();
  const rats = new AmbientRats(scene);
  const cells = [];
  for (let x = 0; x < 12; x++) cells.push({ x, y: 4 });
  rats.setLayout(cells, 5, cells.map(() => WALL_FULL));
  rats.wear(await ratModel());
  const slot = rats.slots.find((s) => s.active);
  slot.idle = 0;
  const cam = new THREE.Vector3(6, 8, 8);
  let ran = false;
  for (let i = 0; i < 40 && !ran; i++) {
    rats.update(0.25, cam);
    ran = slot.progress < 1;
  }
  assert.equal(ran, true);
  assert.equal(slot.rig.clip, RAT_RUN);
  // It swings round to face the tile it is running to.
  for (let i = 0; i < 8; i++) rats.update(0.02, cam);
  const facing = new THREE.Vector3(Math.sin(slot.body.rotation.y), 0, Math.cos(slot.body.rotation.y));
  const travel = slot.to.clone().sub(slot.from).normalize();
  assert.ok(facing.dot(travel) > 0.9, `facing ${facing.toArray()} travel ${travel.toArray()}`);
  for (let i = 0; i < 20 && slot.progress < 1; i++) rats.update(0.05, cam);
  assert.equal(slot.progress, 1);
  assert.ok(RAT_POSES.includes(slot.rig.clip), slot.rig.clip);
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
    assert.ok(Math.abs(rat.position.y - WALL_TOP) < 1e-6 || rat.scurrying);
  }
  rats.dispose();
});

test("wall rats stay apart and keep a tile-stable look", () => {
  const scene = new THREE.Scene();
  const rats = new AmbientRats(scene);
  const cells = [];
  for (let x = 0; x < 36; x++) cells.push({ x, y: 4 });
  rats.setLayout(cells, 4, cells.map(() => WALL_FULL));
  const snap = rats.snapshot();
  assert.equal(snap.count, 2);
  const [a, b] = snap.rats;
  const sep = Math.max(Math.abs(a.position.x - b.position.x), Math.abs(a.position.z - b.position.z));
  assert.ok(sep >= AMBIENT_RAT_MIN_SEP, `separation ${sep}`);
  assert.ok(a.appearance && b.appearance);
  const same =
    a.appearance.variant === b.appearance.variant &&
    a.appearance.tint === b.appearance.tint &&
    a.appearance.size === b.appearance.size &&
    a.appearance.flip === b.appearance.flip;
  assert.equal(same, false);

  for (const slot of rats.slots) slot.idle = 30;
  const before = rats.snapshot().rats.map((rat) => rat.appearance);
  const cam = new THREE.Vector3(8, 8, 8);
  for (let i = 0; i < 6; i++) rats.update(0.05, cam);
  assert.deepEqual(
    rats.snapshot().rats.map((rat) => rat.appearance),
    before,
  );

  const again = lookFromTile(3, 4);
  assert.deepEqual(again, lookFromTile(3, 4));
  const looks = new Set();
  for (let x = 0; x < 24; x++) {
    const look = lookFromTile(x, 4);
    looks.add(`${look.variant}|${look.tint}|${look.size}|${look.flip}`);
  }
  assert.ok(looks.size >= 8, `variety ${looks.size}`);
  rats.dispose();
});

test("the rat model is a small rigged rodent with every clip the wall rats play", async () => {
  const { json } = readGlb(ratFile);
  assert.equal(json.skins.length, 1);
  assert.deepEqual(json.animations.map((clip) => clip.name).sort(), [...RAT_CLIPS].sort());
  assert.ok(statSync(RAT_FILE).size < 160 * 1024, "rat.glb is too large");

  const gltf = await ratModel();
  const meshes = [];
  gltf.scene.traverse((object) => { if (object.isSkinnedMesh) meshes.push(object); });
  assert.deepEqual(meshes.map((mesh) => mesh.material.name).sort(), ["RatFur", "RatSkin"]);
  // Brown fur; pink ears, nose, paws and tail; near-black eyes.
  const tally = { brown: 0, pink: 0, eye: 0 };
  const color = new THREE.Color();
  for (const mesh of meshes) {
    const colors = mesh.geometry.getAttribute("color");
    for (let i = 0; i < colors.count; i++) {
      color.fromBufferAttribute(colors, i).convertLinearToSRGB();
      const { r, g, b } = color;
      if (r < 0.1 && g < 0.1 && b < 0.1) tally.eye++;
      else if (r > 0.75 && r > g + 0.12 && b > 0.45) tally.pink++;
      else if (r > 0.35 && r < 0.75 && g < r - 0.04 && b < g) tally.brown++;
    }
  }
  assert.ok(tally.brown > 200 && tally.pink > 100 && tally.eye > 20, JSON.stringify(tally));

  // Every clip loops (its last pose is its first) and no two clips move the same way.
  const mixerPose = (clip, at) => {
    const rat = gltf.scene.clone(true);
    const mixer = new THREE.AnimationMixer(rat);
    mixer.clipAction(clip).play();
    mixer.setTime(at);
    const pose = [];
    rat.traverse((object) => { if (object.isBone) pose.push(...object.quaternion.toArray(), ...object.position.toArray()); });
    return pose;
  };
  const poses = new Set();
  for (const clip of gltf.animations) {
    const first = mixerPose(clip, 0), last = mixerPose(clip, clip.duration - 1e-6);
    first.forEach((v, i) => assert.ok(Math.abs(v - last[i]) < 0.02, `${clip.name} does not loop`));
    poses.add(mixerPose(clip, clip.duration * 0.4).map((v) => v.toFixed(3)).join());
  }
  assert.equal(poses.size, RAT_CLIPS.length);
});

test("rat.glb is exactly what scripts/build-rat.mjs writes", async () => {
  const { rat, clips } = buildRat();
  const glb = await new GLTFExporter().parseAsync(rat, { binary: true, animations: clips });
  assert.equal(Buffer.compare(Buffer.from(glb), ratFile), 0, "run npm run models:rat");
});

test("exploring more wall on the same floor leaves placed rats where they are", () => {
  const scene = new THREE.Scene();
  const rats = new AmbientRats(scene);
  const ring = wallRing();
  rats.setLayout(ring, 3, ring.map(() => WALL_FULL));
  const before = rats.slots.filter((slot) => slot.active).map((slot) => ({ ...rats.wallCells[slot.cell] }));
  assert.ok(before.length > 0);
  // New wall appears ahead of the explored ring, shifting every index after it.
  const grown = [{ x: 3, y: 3 }, { x: 3, y: 4 }, ...ring, { x: 13, y: 12 }];
  rats.setLayout(grown, 3, grown.map(() => WALL_FULL));
  const after = rats.slots.filter((slot) => slot.active).map((slot) => ({ ...rats.wallCells[slot.cell] }));
  assert.deepEqual(after, before);
  // A new floor still lays rats out from scratch.
  rats.setLayout(grown, 4, grown.map(() => WALL_FULL));
  assert.ok(rats.snapshot().count > 0);
  rats.dispose();
});
