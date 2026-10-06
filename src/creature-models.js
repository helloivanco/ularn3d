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

const make = () => {
  const group = new THREE.Group();
  group.add(contactDisc(0.4));
  const body = new THREE.Group();
  body.name = "creature-body";
  group.add(body);
  return { group, body };
};

const eye = (body, x, y, z, scale = 0.028, color = 0x1a1614) => {
  const mesh = orb(body, color, x, y, z, scale, {
    emissive: color,
    emissiveIntensity: 0.35,
  });
  mesh.userData.skipOutline = true;
  return mesh;
};

const buildLemming = () => {
  const { group, body } = make();
  const fur = 0x8a5a34;
  const belly = 0xd2b48a;
  const torso = orb(body, fur, 0, 0.22, 0.02, 0.2);
  torso.scale.set(1.05, 0.82, 1.55);
  orb(body, belly, 0, 0.16, -0.02, 0.11).scale.set(0.9, 0.55, 1.2);
  orb(body, fur, 0, 0.3, -0.28, 0.13);
  orb(body, 0xc49a6a, 0, 0.28, -0.4, 0.045);
  for (const x of [-0.07, 0.07]) {
    const ear = orb(body, 0x6b4428, x, 0.4, -0.26, 0.045);
    ear.scale.y = 0.7;
  }
  eye(body, -0.05, 0.32, -0.38);
  eye(body, 0.05, 0.32, -0.38);
  for (const x of [-0.12, 0.12]) {
    for (const z of [-0.12, 0.16]) box(body, fur, x, 0.08, z, 0.05, 0.12, 0.06);
  }
  const tail = cone(body, fur, 0, 0.2, 0.32, 0.035, 0.16, 5);
  tail.rotation.x = 1.15;
  bodyOf(group);
  return finish(group, "lemming");
};

const buildGnome = () => {
  const { group, body } = make();
  const cloth = 0x9a2a2a;
  const skin = 0xe2b184;
  const boot = 0x635563;
  for (const x of [-0.09, 0.09]) {
    box(body, boot, x, 0.07, 0.02, 0.1, 0.12, 0.14);
    box(body, cloth, x, 0.24, 0, 0.11, 0.22, 0.12);
  }
  box(body, cloth, 0, 0.46, 0, 0.32, 0.28, 0.22);
  box(body, 0x6a3a28, 0, 0.34, 0, 0.34, 0.05, 0.2);
  box(body, 0xd2b46a, 0, 0.34, -0.11, 0.06, 0.05, 0.03);
  for (const x of [-0.2, 0.2]) {
    box(body, cloth, x, 0.48, 0, 0.09, 0.2, 0.1);
    orb(body, skin, x, 0.34, -0.02, 0.045);
  }
  orb(body, skin, 0, 0.7, -0.01, 0.13);
  const nose = orb(body, 0xd09a72, 0, 0.66, -0.12, 0.04);
  nose.scale.z = 1.3;
  const cap = orb(body, cloth, 0, 0.8, 0, 0.15);
  cap.scale.set(1.15, 0.45, 1.15);
  box(body, 0xc4b49a, 0, 0.62, -0.08, 0.1, 0.06, 0.04);
  eye(body, -0.045, 0.72, -0.1, 0.022, 0xf0d24a);
  eye(body, 0.045, 0.72, -0.1, 0.022, 0xf0d24a);
  bodyOf(group);
  group.scale.setScalar(0.92);
  return finish(group, "gnome");
};

const buildJackal = () => {
  const { group, body } = make();
  const fur = 0xc4a06a;
  const dark = 0x8a6238;
  const torso = orb(body, fur, 0, 0.28, 0.02, 0.18);
  torso.scale.set(0.85, 0.9, 1.7);
  box(body, dark, 0, 0.36, 0.02, 0.12, 0.06, 0.42);
  orb(body, fur, 0, 0.36, -0.32, 0.12);
  const snout = orb(body, 0xd8bc8a, 0, 0.32, -0.46, 0.07);
  snout.scale.z = 1.45;
  orb(body, 0x2a2420, 0, 0.31, -0.54, 0.025);
  for (const x of [-1, 1]) {
    const ear = cone(body, fur, x * 0.08, 0.52, -0.3, 0.05, 0.16, 4);
    ear.rotation.z = x * -0.2;
  }
  eye(body, -0.05, 0.38, -0.4, 0.02);
  eye(body, 0.05, 0.38, -0.4, 0.02);
  for (const x of [-0.12, 0.12]) {
    for (const z of [-0.16, 0.18]) box(body, dark, x, 0.1, z, 0.05, 0.18, 0.06);
  }
  const tail = cone(body, fur, 0, 0.32, 0.38, 0.04, 0.28, 5);
  tail.rotation.x = 1.05;
  bodyOf(group);
  return finish(group, "jackal");
};

const buildFloatingEye = () => {
  const { group, body } = make();
  orb(body, 0xe7e0d2, 0, 0, 0, 0.28);
  const iris = orb(body, 0xb4532a, 0, 0.02, -0.2, 0.12, {
    emissive: 0x8a3018,
    emissiveIntensity: 0.45,
  });
  iris.scale.z = 0.45;
  const pupil = orb(body, 0x141210, 0, 0.02, -0.26, 0.05);
  pupil.scale.z = 0.4;
  for (const x of [-1, 1]) {
    const fin = cone(body, 0xcbbfa8, x * 0.26, 0.04, 0.02, 0.16, 0.05, 3);
    fin.rotation.z = x * 1.2;
  }
  body.position.y = 0.62;
  bodyOf(group);
  return finish(group, "floating-eye", 0.62);
};

const buildRedDragon = () => {
  const { group, body } = make();
  const scale = 0x8e2c28;
  const belly = 0xc47a52;
  const torso = orb(body, scale, 0, 0.42, 0.05, 0.28);
  torso.scale.set(0.9, 0.85, 1.45);
  orb(body, belly, 0, 0.32, 0.02, 0.16).scale.set(0.7, 0.45, 1.1);
  orb(body, scale, 0, 0.62, -0.38, 0.16);
  const jaw = box(body, belly, 0, 0.52, -0.52, 0.14, 0.06, 0.18);
  jaw.rotation.x = 0.2;
  for (const x of [-1, 1]) {
    const horn = cone(body, 0xe6d3a4, x * 0.08, 0.82, -0.34, 0.04, 0.18, 4);
    horn.rotation.z = x * -0.35;
    const wing = cone(body, 0x6e2422, x * 0.55, 0.58, 0.05, 0.42, 0.08, 3);
    wing.rotation.z = x * 0.7;
    wing.rotation.y = x * -0.3;
    box(body, scale, x * 0.18, 0.16, 0.05, 0.1, 0.28, 0.12);
    box(body, scale, x * 0.2, 0.16, -0.22, 0.09, 0.26, 0.1);
  }
  eye(body, -0.07, 0.66, -0.5, 0.025, 0xf0c14a);
  eye(body, 0.07, 0.66, -0.5, 0.025, 0xf0c14a);
  const tail = cone(body, scale, 0, 0.36, 0.55, 0.08, 0.55, 5);
  tail.rotation.x = 1.25;
  bodyOf(group);
  group.scale.setScalar(1.08);
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
