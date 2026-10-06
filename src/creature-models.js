import * as THREE from "three";
import { box, contactDisc, cylinder, mat, orb } from "./models.js";

// Species ids that have a crafted mesh. Everything else keeps its sprite.
export const CREATURE_MODELS = Object.freeze({
  1: "lemming",
  2: "gnome",
  4: "jackal",
  12: "floating-eye",
  56: "red-dragon",
});

const roundGeo = new THREE.SphereGeometry(1, 14, 10);
roundGeo.userData.shared = true;
const irisGeo = new THREE.CircleGeometry(1, 14);
irisGeo.userData.shared = true;

const finish = (group, key, hover = 0) => {
  group.name = `creature-${key}`;
  group.userData.presentation = "model";
  group.userData.modelKey = key;
  group.userData.artPath = null;
  group.userData.facing = { x: 0, y: 1 };
  group.userData.hover = hover;
  return group;
};

const bodyOf = (group) => {
  const body = group.children.find((child) => child.name === "creature-body");
  group.userData.body = body;
  return body;
};

const make = (disc = 0.32) => {
  const group = new THREE.Group();
  group.add(contactDisc(disc));
  const body = new THREE.Group();
  body.name = "creature-body";
  group.add(body);
  return { group, body };
};

const pupil = (body, x, y, z) => {
  const mesh = box(body, 0x1a1614, x, y, z, 0.035, 0.02, 0.02);
  mesh.userData.skipOutline = true;
  return mesh;
};

// Each mesh stays inside one tile and about as tall as the hero. Parts are
// boxes so the steep overhead camera sees a body, not a gem or a spike.
const buildLemming = () => {
  const { group, body } = make(0.34);
  const fur = 0xc4843c;
  const dark = 0x6b3d22;
  box(body, fur, 0, 0.16, 0.02, 0.32, 0.16, 0.42);
  box(body, dark, 0, 0.25, 0.02, 0.1, 0.03, 0.28);
  box(body, fur, 0, 0.2, -0.26, 0.2, 0.14, 0.16);
  box(body, 0xf0d2a8, 0, 0.16, -0.36, 0.1, 0.08, 0.08);
  for (const x of [-1, 1]) {
    box(body, dark, x * 0.08, 0.32, -0.24, 0.07, 0.08, 0.05);
    box(body, fur, x * 0.16, 0.07, -0.08, 0.08, 0.06, 0.1);
    box(body, fur, x * 0.16, 0.07, 0.16, 0.08, 0.06, 0.1);
    pupil(body, x * 0.05, 0.24, -0.34);
  }
  box(body, fur, 0, 0.16, 0.34, 0.06, 0.04, 0.2);
  bodyOf(group);
  return finish(group, "lemming");
};

const buildGnome = () => {
  const { group, body } = make(0.3);
  const cloth = 0xc42828;
  const skin = 0xf0c49a;
  const boot = 0x4e4854;
  for (const x of [-1, 1]) {
    box(body, boot, x * 0.08, 0.06, 0.02, 0.1, 0.1, 0.14);
    box(body, cloth, x * 0.08, 0.2, 0, 0.1, 0.18, 0.11);
    box(body, cloth, x * 0.18, 0.42, 0, 0.08, 0.2, 0.08);
    orb(body, skin, x * 0.18, 0.28, -0.02, 0.04);
    pupil(body, x * 0.035, 0.58, -0.1);
  }
  box(body, cloth, 0, 0.4, 0, 0.26, 0.22, 0.16);
  box(body, 0x6a3a22, 0, 0.3, 0, 0.28, 0.04, 0.17);
  box(body, 0xe6c56a, 0, 0.3, -0.09, 0.06, 0.035, 0.02);
  orb(body, skin, 0, 0.58, -0.01, 0.09);
  box(body, 0xf4f0e6, 0, 0.5, -0.08, 0.08, 0.05, 0.03);
  cylinder(body, cloth, 0, 0.72, 0, 0.12, 0.05, 12);
  bodyOf(group);
  return finish(group, "gnome");
};

const buildJackal = () => {
  const { group, body } = make(0.36);
  const fur = 0xe2c27a;
  const dark = 0x5c3a22;
  box(body, fur, 0, 0.2, 0.04, 0.2, 0.16, 0.42);
  box(body, dark, 0, 0.29, 0.04, 0.08, 0.03, 0.28);
  box(body, fur, 0, 0.26, -0.26, 0.16, 0.14, 0.16);
  box(body, 0xf3d9a6, 0, 0.22, -0.42, 0.1, 0.08, 0.16);
  box(body, 0x1a1410, 0, 0.22, -0.51, 0.04, 0.03, 0.03);
  for (const x of [-1, 1]) {
    box(body, dark, x * 0.06, 0.42, -0.26, 0.045, 0.14, 0.045);
    box(body, dark, x * 0.1, 0.08, -0.06, 0.06, 0.12, 0.07);
    box(body, dark, x * 0.1, 0.08, 0.18, 0.06, 0.12, 0.07);
    pupil(body, x * 0.04, 0.3, -0.34);
  }
  box(body, fur, 0, 0.22, 0.38, 0.05, 0.04, 0.22);
  bodyOf(group);
  return finish(group, "jackal");
};

const buildFloatingEye = () => {
  const { group, body } = make(0.28);
  const shell = new THREE.Mesh(roundGeo, mat(0xf7f3ea));
  shell.scale.setScalar(0.22);
  body.add(shell);
  const iris = new THREE.Mesh(
    irisGeo,
    mat(0xd23a22, { emissive: 0xc42818, emissiveIntensity: 0.35, side: THREE.DoubleSide }),
  );
  iris.scale.setScalar(0.1);
  iris.position.set(0, 0.16, -0.08);
  iris.rotation.x = -0.85;
  body.add(iris);
  const dot = new THREE.Mesh(irisGeo, mat(0x140e0c, { side: THREE.DoubleSide }));
  dot.scale.setScalar(0.045);
  dot.position.set(0, 0.175, -0.1);
  dot.rotation.x = -0.85;
  body.add(dot);
  for (const x of [-1, 1]) {
    const fin = box(body, 0xd5cbb8, x * 0.28, 0, 0, 0.12, 0.025, 0.08);
    fin.rotation.z = x * 0.3;
  }
  body.position.y = 0.62;
  bodyOf(group);
  return finish(group, "floating-eye", 0.62);
};

const buildRedDragon = () => {
  const { group, body } = make(0.36);
  const hide = 0xc4322c;
  const wing = 0x6a1818;
  const belly = 0xe0a070;
  box(body, hide, 0, 0.24, 0.02, 0.24, 0.16, 0.36);
  box(body, belly, 0, 0.33, 0.02, 0.1, 0.03, 0.22);
  box(body, hide, 0, 0.32, -0.26, 0.16, 0.14, 0.16);
  box(body, belly, 0, 0.26, -0.36, 0.12, 0.05, 0.1);
  for (const x of [-1, 1]) {
    box(body, 0xf0e2c0, x * 0.05, 0.44, -0.28, 0.03, 0.08, 0.03);
    const sail = box(body, wing, x * 0.28, 0.36, 0, 0.28, 0.035, 0.26);
    sail.rotation.y = x * -0.2;
    box(body, hide, x * 0.1, 0.1, -0.04, 0.07, 0.12, 0.08);
    box(body, hide, x * 0.1, 0.1, 0.14, 0.07, 0.12, 0.08);
    pupil(body, x * 0.04, 0.36, -0.34);
  }
  box(body, hide, 0, 0.22, 0.36, 0.07, 0.05, 0.24);
  box(body, wing, 0, 0.24, 0.5, 0.14, 0.025, 0.08);
  bodyOf(group);
  return finish(group, "red-dragon");
};

const BUILDERS = {
  lemming: buildLemming,
  gnome: buildGnome,
  jackal: buildJackal,
  "floating-eye": buildFloatingEye,
  "red-dragon": buildRedDragon,
};

export function createCreatureModel(monster) {
  const key = CREATURE_MODELS[monster?.id];
  const build = key && BUILDERS[key];
  if (!build) return null;
  return build();
}
