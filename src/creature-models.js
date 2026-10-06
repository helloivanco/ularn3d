import * as THREE from "three";
import { box, cone, contactDisc, orb } from "./models.js";

// Species ids that have a crafted mesh. Everything else keeps its sprite.
export const CREATURE_MODELS = Object.freeze({
  1: "lemming",
  2: "gnome",
  4: "jackal",
  12: "floating-eye",
  56: "red-dragon",
});

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

const make = (disc = 0.42) => {
  const group = new THREE.Group();
  group.add(contactDisc(disc));
  const body = new THREE.Group();
  body.name = "creature-body";
  group.add(body);
  return { group, body };
};

const eye = (body, x, y, z, scale = 0.028, color = 0x1a1614) => {
  const mesh = orb(body, color, x, y, z, scale, {
    emissive: color,
    emissiveIntensity: 0.4,
  });
  mesh.userData.skipOutline = true;
  return mesh;
};

// Plan shapes are the gameplay read. The camera sits steeply overhead, so a
// tall thin figure disappears and a flat body the color of the floor vanishes.
const buildLemming = () => {
  const { group, body } = make(0.46);
  const fur = 0xc4843c;
  const dark = 0x6b3d22;
  const torso = orb(body, fur, 0, 0.22, 0, 0.28);
  torso.scale.set(0.9, 0.48, 1.5);
  box(body, dark, 0, 0.36, 0.02, 0.12, 0.04, 0.62);
  orb(body, fur, 0, 0.28, -0.44, 0.16);
  orb(body, 0xf0d2a8, 0, 0.24, -0.58, 0.07);
  orb(body, 0x2a1812, 0, 0.24, -0.64, 0.028);
  for (const x of [-1, 1]) {
    const ear = orb(body, dark, x * 0.11, 0.42, -0.4, 0.075);
    ear.scale.set(0.65, 1.2, 0.5);
    eye(body, x * 0.06, 0.32, -0.56, 0.022);
    box(body, fur, x * 0.22, 0.08, -0.16, 0.12, 0.08, 0.16);
    box(body, fur, x * 0.22, 0.08, 0.22, 0.12, 0.08, 0.16);
  }
  const tail = cone(body, fur, 0, 0.2, 0.58, 0.05, 0.46, 5);
  tail.rotation.x = -Math.PI / 2;
  bodyOf(group);
  return finish(group, "lemming");
};

const buildGnome = () => {
  const { group, body } = make(0.4);
  const cloth = 0xc42828;
  const skin = 0xf0c49a;
  const boot = 0x4e4854;
  for (const x of [-0.1, 0.1]) {
    box(body, boot, x, 0.07, 0.04, 0.15, 0.12, 0.2);
    box(body, cloth, x, 0.22, 0, 0.14, 0.2, 0.15);
  }
  box(body, cloth, 0, 0.42, 0, 0.46, 0.26, 0.28);
  box(body, 0x6a3a22, 0, 0.3, 0, 0.48, 0.05, 0.24);
  box(body, 0xe6c56a, 0, 0.3, -0.13, 0.08, 0.05, 0.03);
  for (const x of [-0.26, 0.26]) {
    box(body, cloth, x, 0.44, 0, 0.11, 0.18, 0.11);
    orb(body, skin, x, 0.32, -0.05, 0.05);
  }
  orb(body, skin, 0, 0.64, -0.02, 0.14);
  const nose = orb(body, 0xe0a878, 0, 0.6, -0.15, 0.045);
  nose.scale.z = 1.4;
  const cap = orb(body, cloth, 0, 0.78, 0, 0.2);
  cap.scale.set(1.4, 0.3, 1.4);
  box(body, 0xf4f0e6, 0, 0.56, -0.1, 0.14, 0.06, 0.04);
  eye(body, -0.05, 0.66, -0.13, 0.03, 0xf0d24a);
  eye(body, 0.05, 0.66, -0.13, 0.03, 0xf0d24a);
  bodyOf(group);
  return finish(group, "gnome");
};

const buildJackal = () => {
  const { group, body } = make(0.5);
  const fur = 0xe2c27a;
  const dark = 0x5c3a22;
  const torso = orb(body, fur, 0, 0.26, 0.04, 0.22);
  torso.scale.set(0.72, 0.68, 2.2);
  box(body, dark, 0, 0.4, 0.06, 0.1, 0.04, 0.72);
  orb(body, fur, 0, 0.34, -0.46, 0.15);
  const snout = orb(body, 0xf3d9a6, 0, 0.3, -0.64, 0.08);
  snout.scale.set(0.85, 0.8, 1.7);
  orb(body, 0x1a1410, 0, 0.3, -0.76, 0.03);
  for (const x of [-1, 1]) {
    const ear = cone(body, dark, x * 0.1, 0.66, -0.42, 0.06, 0.34, 4);
    ear.rotation.z = x * -0.12;
    eye(body, x * 0.055, 0.4, -0.56, 0.02);
    box(body, dark, x * 0.18, 0.1, -0.14, 0.08, 0.18, 0.09);
    box(body, dark, x * 0.18, 0.1, 0.3, 0.08, 0.18, 0.09);
  }
  const tail = cone(body, fur, 0, 0.46, 0.68, 0.055, 0.52, 5);
  tail.rotation.x = -1.05;
  bodyOf(group);
  return finish(group, "jackal");
};

const buildFloatingEye = () => {
  const { group, body } = make(0.36);
  orb(body, 0xf7f3ea, 0, 0, 0, 0.38);
  const iris = orb(body, 0xd23a22, 0, 0.24, -0.1, 0.17, {
    emissive: 0xc42818,
    emissiveIntensity: 0.55,
  });
  iris.scale.set(1, 0.42, 1);
  const pupil = orb(body, 0x140e0c, 0, 0.3, -0.12, 0.075);
  pupil.scale.y = 0.4;
  for (const x of [-1, 1]) {
    const fin = box(body, 0xd5cbb8, x * 0.46, 0.02, 0, 0.32, 0.045, 0.18);
    fin.rotation.z = x * 0.45;
  }
  body.position.y = 0.82;
  bodyOf(group);
  return finish(group, "floating-eye", 0.82);
};

const buildRedDragon = () => {
  const { group, body } = make(0.55);
  const hide = 0xc4322c;
  const wing = 0x4e1414;
  const belly = 0xe0a070;
  const torso = orb(body, hide, 0, 0.36, 0.02, 0.26);
  torso.scale.set(0.8, 0.68, 1.65);
  box(body, belly, 0, 0.26, 0, 0.18, 0.06, 0.5);
  for (const z of [-0.12, 0.08, 0.26]) cone(body, wing, 0, 0.58, z, 0.045, 0.18, 4);
  orb(body, hide, 0, 0.5, -0.5, 0.17);
  box(body, belly, 0, 0.4, -0.68, 0.18, 0.07, 0.24);
  for (const x of [-1, 1]) {
    const horn = cone(body, 0xf0e2c0, x * 0.09, 0.74, -0.48, 0.04, 0.24, 4);
    horn.rotation.z = x * -0.4;
    const sail = box(body, wing, x * 0.78, 0.52, -0.02, 0.86, 0.05, 0.52);
    sail.rotation.z = x * -0.32;
    box(body, hide, x * 0.2, 0.16, -0.12, 0.12, 0.24, 0.14);
    box(body, hide, x * 0.2, 0.16, 0.28, 0.12, 0.24, 0.14);
    eye(body, x * 0.07, 0.54, -0.62, 0.032, 0xf0c14a);
  }
  const tail = cone(body, hide, 0, 0.32, 0.72, 0.08, 0.5, 5);
  tail.rotation.x = -Math.PI / 2.35;
  box(body, wing, 0, 0.4, 1.02, 0.28, 0.04, 0.16);
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
