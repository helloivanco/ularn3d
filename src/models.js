import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mat, surface, noise } from "./materials.js";
export { mat } from "./materials.js";
const shared = new Map();
const geometry = (key, create) => {
  if (!shared.has(key)) {
    const g = create();
    g.userData.shared = true;
    shared.set(key, g);
  }
  return shared.get(key);
};
const boxGeo = geometry("box", () => new RoundedBoxGeometry(1, 1, 1, 1, 0.055));
const sphereGeo = geometry("orb", () => new THREE.IcosahedronGeometry(1, 2));
const letterMaps = new Map();
function letterTexture(letter, ink, paper) {
  const key = `${letter}:${ink}:${paper}`;
  if (letterMaps.has(key)) return letterMaps.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = ink;
  ctx.font = "bold 92px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, 64, 70);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.shared = true;
  letterMaps.set(key, map);
  return map;
}
function letterPlate(group, letter, ink, paper, x, y, z, w, h, rx = -Math.PI / 2) {
  const plate = new THREE.Mesh(
    geometry("letter-plate", () => new THREE.PlaneGeometry(1, 1)),
    mat(0xffffff, { map: letterTexture(letter, ink, paper) }),
  );
  plate.position.set(x, y, z);
  plate.scale.set(w, h, 1);
  plate.rotation.x = rx;
  plate.castShadow = true;
  group.add(plate);
  return plate;
}
function mesh(group, geo, material, x, y, z, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}
export function box(g, color, x, y, z, w, h, d, extra) {
  return mesh(g, boxGeo, mat(color, extra), x, y, z, w, h, d);
}
export function block(g, kind, color, x, y, z, w, h, d) {
  return mesh(g, boxGeo, surface(kind, color), x, y, z, w, h, d);
}
export function orb(g, color, x, y, z, r, extra) {
  return mesh(g, sphereGeo, mat(color, extra), x, y, z, r, r, r);
}
export function cone(g, color, x, y, z, r, h, n = 8) {
  return mesh(
    g,
    geometry(`cone${n}`, () => new THREE.ConeGeometry(1, 1, n)),
    mat(color, { flatShading: true }),
    x,
    y,
    z,
    r,
    h,
    r,
  );
}
export function cylinder(g, color, x, y, z, r, h, n = 12) {
  return mesh(
    g,
    geometry(`cylinder${n}`, () => new THREE.CylinderGeometry(1, 1, 1, n)),
    mat(color),
    x,
    y,
    z,
    r,
    h,
    r,
  );
}
export function ring(g, color, r = 0.4, y = 0.025) {
  const m = mesh(
    g,
    geometry("ring", () => new THREE.TorusGeometry(1, 0.026, 6, 48)),
    mat(color, {
      emissive: color,
      emissiveIntensity: 0.65,
      metalness: 0.5,
      roughness: 0.3,
    }),
    0,
    y,
    0,
    r,
    r,
    r,
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}
export function tree(scale = 1) {
  const g = new THREE.Group();
  block(g, "wood", 0x6b5a45, 0, 0.65, 0, 0.14, 1.3, 0.14);
  for (let i = 0; i < 4; i++) {
    const crown = cone(
      g,
      [0x2d5046, 0x365f4d, 0x426c51, 0x527857][i],
      0,
      0.8 + i * 0.38,
      0,
      0.65 - i * 0.115,
      1.05,
      7,
    );
    crown.rotation.y = i * 0.7;
  }
  g.scale.setScalar(scale);
  return g;
}
function beam(g, color, a, b, r = 0.04) {
  const av = new THREE.Vector3(...a),
    bv = new THREE.Vector3(...b);
  const m = cylinder(
    g,
    color,
    ...av.clone().add(bv).multiplyScalar(0.5).toArray(),
    r,
    av.distanceTo(bv),
    6,
  );
  m.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    bv.sub(av).normalize(),
  );
  return m;
}
export function torch(g, x, y, z, scale = 1) {
  const holder = new THREE.Group();
  holder.position.set(x, y, z);
  holder.scale.setScalar(scale);
  g.add(holder);
  cylinder(holder, 0x61533a, 0, 0, 0, 0.04, 0.36);
  cone(holder, 0x332d28, 0, 0.17, 0, 0.11, 0.14);
  const flame = orb(holder, 0xffcc68, 0, 0.32, 0, 0.095, {
    emissive: 0xff931f,
    emissiveIntensity: 4,
    roughness: 1,
  });
  flame.scale.y *= 1.8;
  orb(holder, 0xfff0c0, 0, 0.29, -0.03, 0.05, {
    emissive: 0xffdf92,
    emissiveIntensity: 5,
  });
  holder.userData.flame = true;
  return holder;
}
export function hero(character = "Adventurer") {
  const g = new THREE.Group(),
    body = new THREE.Group();
  g.add(body);
  body.name = "body";
  const colors = {
    Adventurer: 0x427b78,
    Wizard: 0x5b538b,
    Rogue: 0x465d61,
    Elf: 0x578564,
    Dwarf: 0x826644,
    Ogre: 0x727751,
    Klingon: 0x934f41,
    Rambo: 0x706844,
  };
  const cloth = colors[character] || colors.Adventurer;
  for (const x of [-0.115, 0.115]) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.3, 0);
    body.add(leg);
    leg.name = x < 0 ? "left-leg" : "right-leg";
    box(leg, 0x3c4847, 0, -0.12, 0, 0.15, 0.29, 0.17);
    box(leg, 0x544737, 0, -0.26, -0.055, 0.175, 0.12, 0.26);
  }
  const torso = cone(body, cloth, 0, 0.54, 0, 0.275, 0.43, 8);
  torso.rotation.y = 0.4;
  box(body, 0x83978e, 0, 0.66, -0.075, 0.3, 0.24, 0.14, {
    metalness: 0.7,
    roughness: 0.34,
  });
  box(body, 0x705733, 0, 0.41, 0, 0.43, 0.065, 0.26);
  box(body, 0xd2b67b, 0, 0.415, -0.15, 0.075, 0.075, 0.035, { metalness: 0.7 });
  const cape = cone(body, cloth, 0, 0.48, 0.14, 0.31, 0.65, 6);
  cape.rotation.x = -0.25;
  cape.scale.z = 0.25;
  cape.name = "cape";
  for (const x of [-0.28, 0.28]) {
    orb(body, 0x849b93, x, 0.7, 0, 0.135, { metalness: 0.65, roughness: 0.4 });
    box(body, cloth, x, 0.51, 0, 0.13, 0.3, 0.14);
    orb(body, 0xbd9d78, x, 0.35, -0.02, 0.073);
  }
  orb(body, 0xc4aa89, 0, 0.92, -0.005, 0.145);
  const helm = orb(body, 0x8ca5a0, 0, 1.0, 0.015, 0.167, {
    metalness: 0.8,
    roughness: 0.32,
  });
  helm.scale.y *= 0.78;
  box(body, 0x253634, 0, 0.959, -0.14, 0.19, 0.038, 0.035);
  box(body, 0xc4aa71, 0, 0.99, -0.162, 0.028, 0.15, 0.02, { metalness: 0.7 });
  if (character === "Wizard") {
    cone(body, cloth, 0, 1.21, 0, 0.24, 0.55, 8);
    const brim = cylinder(body, cloth, 0, 1.0, 0, 0.25, 0.045);
  }
  const sword = new THREE.Group();
  sword.name = "weapon";
  sword.position.set(0.31, 0.38, -0.11);
  body.add(sword);
  box(sword, 0xc5dedb, 0, 0.3, 0, 0.048, 0.68, 0.045, {
    metalness: 0.95,
    roughness: 0.2,
  });
  box(sword, 0xddba70, 0, 0.02, 0, 0.24, 0.045, 0.07, {
    metalness: 0.8,
    roughness: 0.3,
  });
  box(sword, 0x463e32, 0, -0.085, 0, 0.06, 0.17, 0.06);
  orb(sword, 0xdab26a, 0, -0.19, 0, 0.042, { metalness: 0.8 });
  if (character === "Wizard") {
    sword.children.forEach((m) => (m.visible = false));
    cylinder(sword, 0x786249, 0, 0.12, 0, 0.032, 0.96);
    orb(sword, 0x9ed6e3, 0, 0.66, 0, 0.12, {
      emissive: 0x66bee7,
      emissiveIntensity: 2,
    });
  }
  const lantern = new THREE.Group();
  lantern.position.set(-0.33, 0.24, 0);
  body.add(lantern);
  box(lantern, 0xfac96e, 0, 0, 0, 0.12, 0.15, 0.12, {
    emissive: 0xffbc53,
    emissiveIntensity: 2.4,
  });
  for (const x of [-0.073, 0.073])
    box(lantern, 0x555245, x, 0, 0, 0.022, 0.19, 0.16);
  box(lantern, 0x7b714f, 0, 0.11, 0, 0.18, 0.04, 0.18);
  box(lantern, 0x7b714f, 0, -0.11, 0, 0.18, 0.04, 0.18);
  if (character === "Dwarf") body.scale.set(1.2, 0.83, 1.12);
  if (character === "Ogre") body.scale.set(1.28, 1.2, 1.18);
  ring(g, 0xe6d091, 0.38, 0.012);
  return g;
}
function windowDetail(g, x, y, z, w = 0.25, h = 0.33) {
  block(g, "wood", 0x544c39, x, y, z, w + 0.07, h + 0.07, 0.055);
  box(g, 0xffd899, x, y, z + 0.031, w, h, 0.025, {
    emissive: 0xffb74d,
    emissiveIntensity: 1.15,
    roughness: 0.25,
  });
  box(g, 0x665a40, x, y, z + 0.05, 0.025, h, 0.028);
  box(g, 0x665a40, x, y, z + 0.05, w, 0.025, 0.028);
  block(
    g,
    "stone",
    0xc2bea0,
    x,
    y - h / 2 - 0.05,
    z + 0.03,
    w + 0.12,
    0.06,
    0.12,
  );
}
function roof(g, color, y, w, d, h) {
  for (const side of [-1, 1]) {
    const slab = block(
      g,
      "roof",
      color,
      (side * w) / 4,
      y + h / 2,
      0,
      Math.hypot(w / 2, h),
      0.085,
      d,
    );
    slab.rotation.z = -side * Math.atan2(h, w / 2);
  }
  beam(g, 0x827d68, [0, y + h, -d / 2], [0, y + h, d / 2], 0.055);
  for (const z of [-d / 2, d / 2]) {
    beam(g, 0x5c584a, [-w / 2, y, z], [0, y + h, z], 0.05);
    beam(g, 0x5c584a, [0, y + h, z], [w / 2, y, z], 0.05);
  }
}
export const LANDMARK_NAMES = {
  69: "HOME",
  12: "DND STORE",
  77: "TRADING POST",
  80: "REVENUE SERVICE",
  16: "BANK OF ULARN",
  15: "BANK",
  10: "THE COLLEGE",
  54: "THE CAVES",
  55: "THE VOLCANO",
  93: "TOWN",
  100: "THE HIDEOUT",
};
export function building(id) {
  const g = new THREE.Group();
  if (id === 54) {
    block(g, "stone", 0x879184, 0, 0.09, 0, 1.85, 0.18, 1.4);
    for (const side of [-1, 1]) {
      block(g, "stone", 0x818d81, side * 0.65, 0.74, 0, 0.39, 1.4, 0.7);
      block(g, "stone", 0xb3b79e, side * 0.65, 0.17, 0, 0.52, 0.24, 0.85);
      block(g, "stone", 0xb3b79e, side * 0.65, 1.36, 0, 0.5, 0.16, 0.84);
    }
    const arch = new THREE.Mesh(
      geometry(
        "arch",
        () => new THREE.TorusGeometry(0.56, 0.19, 6, 12, Math.PI),
      ),
      surface("stone", 0x9caa97),
    );
    arch.position.set(0, 1.34, 0);
    g.add(arch);
    box(g, 0x061116, 0, 0.73, 0.18, 0.91, 1.46, 0.15);
    for (let i = 0; i < 4; i++)
      block(
        g,
        "stone",
        0x9b9e86,
        0,
        0.025 + i * 0.065,
        0.88 - i * 0.19,
        1.02,
        0.12,
        0.22,
      );
    torch(g, -0.9, 0.85, 0.35);
    torch(g, 0.9, 0.85, 0.35);
    ring(g, 0xa4d3c0, 0.52, 0.02);
    for (const x of [-0.64, 0.64])
      for (let i = 0; i < 3; i++)
        box(g, 0xa8b594, x, 0.52 + i * 0.23, 0.358, 0.12, 0.026, 0.025, {
          emissive: 0x52767a,
          emissiveIntensity: 0.4,
        });
    return g;
  }
  if (id === 55) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 0.64;
      const rock = orb(
        g,
        0x463e3a,
        Math.cos(a) * r,
        0.24,
        Math.sin(a) * r,
        0.32,
      );
      rock.scale.y *= 1.8;
    }
    cylinder(g, 0xf1b447, 0, 0.04, 0, 0.52, 0.08, 24).material = mat(0xee872d, {
      emissive: 0xff5a16,
      emissiveIntensity: 2.5,
    });
    for (let i = 0; i < 5; i++) {
      const shard = cone(
        g,
        0x473c37,
        Math.sin(i * 3) * 0.7,
        0.3,
        Math.cos(i * 3) * 0.7,
        0.22,
        0.8,
        5,
      );
      shard.rotation.z = (i - 2) * 0.18;
    }
    return g;
  }
  const stone = id === 69 ? 0xddd0a3 : id === 10 ? 0xb0c1b2 : 0xbbbaa5;
  const roofColor =
    id === 12
      ? 0x8b5750
      : id === 77
        ? 0x8d7960
        : id === 10
          ? 0x4a7a80
          : 0x577976;
  block(g, "stone", 0x8a9380, 0, 0.1, 0, 1.72, 0.22, 1.52);
  block(g, "stone", stone, 0, 0.76, 0, 1.42, 1.2, 1.2);
  for (const x of [-0.72, 0.72])
    for (const z of [-0.6, 0.6])
      block(g, "wood", 0x685b46, x, 0.79, z, 0.085, 1.27, 0.085);
  block(g, "wood", 0x75634b, 0, 0.37, 0.615, 1.45, 0.07, 0.06);
  block(g, "wood", 0x75634b, 0, 1.34, 0.615, 1.48, 0.085, 0.07);
  roof(g, roofColor, 1.36, 1.82, 1.62, 0.65);
  // The triangular gable and its timber braces sit under the two shingle slopes.
  const gable = cone(g, stone, 0, 1.56, 0, 0.72, 0.48, 4);
  gable.rotation.y = Math.PI / 4;
  gable.scale.z = 0.82;
  block(g, "wood", 0x6a5441, 0, 0.51, 0.635, 0.34, 0.88, 0.07);
  box(g, 0xbba765, 0.105, 0.49, 0.686, 0.04, 0.06, 0.03, { metalness: 0.8 });
  windowDetail(g, -0.46, 0.93, 0.625, 0.22, 0.34);
  windowDetail(g, 0.46, 0.93, 0.625, 0.22, 0.34);
  block(g, "stone", 0xb1b09a, 0, 0.16, 0.8, 0.65, 0.14, 0.43);
  block(g, "stone", 0x8f9689, 0.43, 1.98, -0.28, 0.22, 0.62, 0.26);
  block(g, "stone", 0xb9b9a1, 0.43, 2.3, -0.28, 0.29, 0.075, 0.31);
  torch(g, -0.24, 0.82, 0.72, 0.52);
  if (id === 10 || id === 16) {
    block(g, "stone", 0x9da996, -0.64, 1.1, -0.36, 0.65, 2.2, 0.67);
    const r = cone(g, roofColor, -0.64, 2.59, -0.36, 0.56, 0.9, 8);
    r.material = surface("roof", roofColor);
    windowDetail(g, -0.64, 1.78, -0.005, 0.19, 0.42);
    orb(g, 0xe5c57d, -0.64, 3.08, -0.36, 0.052, {
      emissive: 0xdbb05a,
      emissiveIntensity: 1.8,
    });
  }
  if (id === 12 || id === 77) {
    for (let i = 0; i < 6; i++) {
      const awning = box(
        g,
        i % 2 ? 0xddd2a3 : roofColor,
        -0.6 + i * 0.24,
        1.04,
        0.99,
        0.24,
        0.045,
        0.75,
      );
      awning.rotation.x = 0.2;
    }
    for (const x of [-0.65, 0.65])
      block(g, "wood", 0x756343, x, 0.48, 1.26, 0.045, 0.96, 0.045);
    block(g, "wood", 0x8c7046, 0.42, 0.27, 1.02, 0.45, 0.42, 0.36);
    for (const z of [0.86, 1.2])
      box(g, 0x4c4b3c, 0.42, 0.27, z, 0.46, 0.06, 0.025);
  }
  return g;
}
export function itemModel(tile) {
  const g = new THREE.Group(),
    id = tile.id,
    n = tile.name.toLowerCase();
  if (tile.store && id !== 56) return building(id);
  if (tile.wall) {
    box(g, 0x52605c, 0, 0.52, 0, 0.98, 1.04, 0.98);
    box(g, 0x67716a, 0, 1.08, 0, 1.015, 0.09, 1.015);
    for (let i = 0; i < 2; i++)
      box(g, 0x36423f, 0, 0.34 + i * 0.37, 0.493, 0.98, 0.025, 0.015);
    return g;
  }
  if ([5, 13, 56, 93].includes(id)) {
    const up = id !== 13;
    const blocked = !!tile.stair?.blocked;
    g.userData.stairDirection = up ? "up" : "down";
    g.userData.stairBlocked = blocked;
    box(g, up ? 0x56645b : 0x081116, 0, 0.01, 0, 0.94, 0.04, 0.94);
    for (let i = 0; i < 5; i++) {
      const step = box(g, up ? 0xc1cdb1 : 0x9b8e72, 0,
        up ? 0.09 + i * 0.115 : 0.29 - i * 0.057,
        0.35 - i * 0.15, 0.72, 0.09, 0.16);
      step.name = `step-${i}`;
    }
    // Raised handrails lead to the upper landing; a dark well frames the descent.
    for (const x of [-0.43, 0.43]) {
      if (up) beam(g, 0xa6b898, [x, 0.3, 0.42], [x, 0.87, -0.4], 0.035);
      else box(g, 0x5c5748, x, 0.14, 0, 0.075, 0.27, 0.92);
    }
    if (blocked) {
      const landing = new THREE.Group();
      landing.name = "stair-blockage";
      const y = up ? 0.66 : 0.25;
      box(landing, 0x756e60, 0, y, -0.3, 0.8, 0.42, 0.28);
      for (let i = 0; i < 4; i++) {
        const rubble = orb(landing, 0x89816d, (i - 1.5) * 0.18,
          y - 0.16, -0.05 + (i % 2) * 0.1, 0.14 + (i % 2) * 0.025);
        rubble.scale.y = 0.65;
      }
      // A cross over the blocked landing stays legible from the overhead view.
      beam(landing, 0xd39a71, [-0.28, y + 0.23, -0.45], [0.28, y + 0.23, -0.15], 0.055);
      beam(landing, 0xd39a71, [-0.28, y + 0.23, -0.15], [0.28, y + 0.23, -0.45], 0.055);
      g.add(landing);
    } else {
      const arrow = cone(g, up ? 0xb2e3b9 : 0xefbb7d, 0.0, up ? 0.86 : 0.56, -0.3, 0.16, 0.2, 3);
      arrow.rotation.z = up ? 0 : Math.PI;
      arrow.name = up ? "up-arrow" : "down-arrow";
    }
    ring(g, up ? 0x9ac8a1 : 0xb49d6b, 0.46);
    return g;
  }
  if (id === 19 || id === 20) {
    box(g, 0x6c766a, -0.38, 0.6, 0, 0.16, 1.2, 0.2);
    box(g, 0x6c766a, 0.38, 0.6, 0, 0.16, 1.2, 0.2);
    box(g, 0x8a8e79, 0, 1.2, 0, 0.94, 0.15, 0.23);
    if (id === 20) {
      box(g, 0x776044, 0, 0.6, 0, 0.62, 1.12, 0.1);
      for (const y of [0.25, 0.83])
        box(g, 0x303c37, 0, y, 0.07, 0.64, 0.06, 0.07);
      orb(g, 0xccae6a, 0.2, 0.56, 0.1, 0.055);
    }
    return g;
  }
  if (id === 7 || id === 17) {
    const wet = id === 7;
    g.userData.fountain = wet ? "flowing" : "dry";
    cylinder(g, 0x81958e, 0, 0.09, 0, 0.44, 0.18, 10);
    const rim = new THREE.Mesh(geometry("fountain-rim", () => new THREE.TorusGeometry(0.36, 0.08, 6, 10)), mat(0x81958e));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.29;
    g.add(rim);
    cylinder(g, 0x625e4d, 0, 0.19, 0, 0.33, 0.02, 10);
    cylinder(g, 0x93a499, 0, 0.57, 0, 0.08, 0.65);
    orb(g, wet ? 0x9ec8ba : 0x7a8274, 0, 0.9, 0, 0.11);
    if (wet || tile.draining) {
      const water = new THREE.Group();
      water.name = "fountain-water";
      water.position.y = 0.19;
      cylinder(water, 0x51a8ae, 0, 0.075, 0, 0.32, 0.025, 10);
      for (const x of [-0.15, 0.15]) {
        const stream = cylinder(water, 0x83d4db, x, 0.32, 0, 0.023, 0.49, 6);
        stream.rotation.z = x > 0 ? -0.2 : 0.2;
      }
      g.add(water);
      if (!wet) {
        g.userData.drainAge = 0;
        g.userData.drainStartedAt = performance.now();
      }
    }
    if (!wet) {
      // Exposed sediment and cracks remain after the water recedes.
      for (const x of [-0.19, 0.18]) {
        const crack = box(g, 0x363b31, x, 0.204, 0.05, 0.017, 0.008, 0.27);
        crack.rotation.y = x * 3;
      }
    }
    return g;
  }
  if (id === 1) {
    box(g, 0x788a81, 0, 0.1, 0, 0.85, 0.2, 0.7);
    box(g, 0xabb19b, 0, 0.43, 0, 0.58, 0.65, 0.42);
    box(g, 0xc3c3a3, 0, 0.8, 0, 0.82, 0.12, 0.66);
    orb(g, 0xc6aeed, 0, 1.02, 0, 0.12, {
      emissive: 0x9d6ac6,
      emissiveIntensity: 1,
    });
    return g;
  }
  if (id === 44) {
    box(g, 0x80643c, 0, 0.22, 0, 0.58, 0.44, 0.39);
    box(g, 0xba9c56, 0, 0.3, 0.21, 0.09, 0.22, 0.03);
    for (const x of [-0.21, 0.21])
      box(g, 0xc1a464, x, 0.24, 0, 0.05, 0.48, 0.41);
    return g;
  }
  if (id === 42) {
    orb(g, 0x759d9a, 0, 0.22, 0, 0.2, {
      emissive: 0x4b808b,
      emissiveIntensity: 0.35,
    });
    cylinder(g, 0xabc3b0, 0, 0.43, 0, 0.065, 0.21);
    cylinder(g, 0xad8751, 0, 0.55, 0, 0.073, 0.045);
    ring(g, 0x759d9a, 0.3);
    return g;
  }
  if (id === 41 || id === 43) {
    const book = id === 43;
    if (book) {
      box(g, 0x7c5750, 0, 0.09, 0, 0.42, 0.16, 0.52);
      box(g, 0xf0e2bf, 0.02, 0.12, 0, 0.36, 0.1, 0.46);
      letterPlate(g, "B", "#3b2416", "#f3e6c4", 0.02, 0.185, 0, 0.22, 0.28);
    } else {
      box(g, 0xddc998, 0, 0.08, 0, 0.4, 0.05, 0.5);
      cylinder(g, 0xc4ae78, 0, 0.09, -0.26, 0.055, 0.4, 8);
      cylinder(g, 0xc4ae78, 0, 0.09, 0.26, 0.055, 0.4, 8);
      letterPlate(g, "S", "#4a2f14", "#f7edd2", 0, 0.12, 0, 0.2, 0.26);
    }
    return g;
  }
  if (id === 18) {
    for (let i = 0; i < 5; i++)
      cylinder(
        g,
        0xd7b260,
        Math.sin(i * 3) * 0.17,
        0.04 + i * 0.035,
        Math.cos(i * 3) * 0.12,
        0.1,
        0.06,
      );
    return g;
  }
  if (id === 2 || id === 79) {
    box(g, 0xa29367, 0, 0.4, 0, 0.55, 0.15, 0.45);
    box(g, 0x8a7954, 0, 0.74, 0.22, 0.58, 0.8, 0.1);
    for (const x of [-0.22, 0.22])
      box(g, 0x9c875b, x, 0.25, 0, 0.09, 0.5, 0.38);
    orb(g, 0x739990, 0, 1.08, 0.15, 0.09);
    return g;
  }
  if (/pit|trap/.test(n)) {
    cylinder(g, 0x091213, 0, 0.015, 0, 0.4, 0.025);
    ring(g, 0x8f7656, 0.4);
    return g;
  }
  if (/sword|dagger|spear|lance|blade|slayer|axe|flail|hammer/.test(n)) {
    const blade = box(g, 0xc0cbc3, 0, 0.3, 0, 0.07, 0.61, 0.07);
    blade.rotation.z = -0.6;
    box(g, 0xba985d, -0.15, 0.1, 0, 0.25, 0.06, 0.09);
    return g;
  }
  if (/armor|mail|plate|shield/.test(n)) {
    cone(g, 0x8a9e97, 0, 0.26, 0, 0.27, 0.45, 6);
    box(g, 0xa5b4a6, 0, 0.48, 0, 0.47, 0.12, 0.26);
    return g;
  }
  if (id === 8) {
    cylinder(g, 0x8a988b, 0, 0.12, 0, 0.32, 0.24);
    const h = hero();
    h.scale.setScalar(0.75);
    h.position.y = 0.25;
    h.traverse((o) => {
      if (o.isMesh) o.material = mat(0x9ba897);
    });
    g.add(h);
    return g;
  }
  if (id === 1) {
    block(g, "stone", 0x879589, 0, 0.18, 0, 0.6, 0.36, 0.5);
    block(g, "stone", 0xb2bca7, 0, 0.4, 0, 0.84, 0.15, 0.66);
    for (const x of [-0.28, 0.28]) {
      cylinder(g, 0xd9c8a2, x, 0.58, 0, 0.045, 0.25);
      orb(g, 0xffd182, x, 0.74, 0, 0.04, {
        emissive: 0xffbd54,
        emissiveIntensity: 3,
      });
    }
    return g;
  }
  if (id === 11) {
    block(g, "wood", 0x8a764e, 0, 0.6, 0, 0.56, 1.1, 0.1);
    box(g, 0x9fc5c5, 0, 0.64, -0.06, 0.43, 0.84, 0.025, {
      metalness: 0.9,
      roughness: 0.08,
    });
    for (const x of [-0.22, 0.22]) box(g, 0x88704d, x, 0.12, 0, 0.1, 0.24, 0.3);
    return g;
  }
  if ((id >= 32 && id <= 39) || id === 40 || id === 45) {
    const hoop = ring(g, 0xdbbb72, 0.18, 0.18);
    hoop.rotation.x = 0.6;
    orb(g, 0x86b8ad, 0, 0.34, -0.03, 0.065, {
      emissive: 0x528e83,
      emissiveIntensity: 0.7,
    });
    return g;
  }
  if (id >= 50 && id <= 53) {
    const color = [0xc6dfdc, 0xc56570, 0x6bbb96, 0x699ac9][id - 50];
    const gem = mesh(
      g,
      geometry("gem", () => new THREE.OctahedronGeometry(1)),
      mat(color, {
        metalness: 0.4,
        roughness: 0.17,
        emissive: color,
        emissiveIntensity: 0.2,
      }),
      0,
      0.24,
      0,
      0.19,
      0.27,
      0.19,
    );
    gem.rotation.z = 0.2;
    ring(g, color, 0.28);
    return g;
  }
  if (id === 22) {
    orb(g, 0xd1dfce, 0, 0.35, 0, 0.24);
    orb(g, 0x83b5ca, 0, 0.35, -0.19, 0.135, {
      emissive: 0x61a6c8,
      emissiveIntensity: 0.6,
    });
    orb(g, 0x172c3b, 0, 0.35, -0.31, 0.062);
    ring(g, 0xb8a2d0, 0.34);
    return g;
  }
  if (id === 48) {
    box(g, 0x8d799f, 0, 0.23, 0, 0.35, 0.35, 0.35, {
      metalness: 0.5,
      emissive: 0x67537d,
      emissiveIntensity: 0.4,
    });
    return g;
  }
  const color = /ruby|annihilation/.test(n)
    ? 0xc76f76
    : /emerald/.test(n)
      ? 0x76bd9a
      : /sapphire|eye/.test(n)
        ? 0x7bb9cf
        : 0xc0a66d;
  orb(g, color, 0, 0.24, 0, 0.18, { emissive: color, emissiveIntensity: 0.4 });
  ring(g, color, 0.27);
  return g;
}
export function monsterModel(monster) {
  const g = new THREE.Group(),
    n = monster.name.toLowerCase();
  let c = 0x918876;
  try {
    if (monster.color) c = new THREE.Color(monster.color);
  } catch {
    /* Default */
  }
  if (/dragon|demon|hellfire/.test(n)) {
    cone(g, c, 0, 0.43, 0, 0.34, 0.78, 6);
    orb(g, c, 0, 0.96, -0.04, 0.25);
    for (const x of [-1, 1]) {
      const wing = cone(g, c, x * 0.42, 0.67, 0.15, 0.45, 0.16, 3);
      wing.rotation.set(0, 0, x * 0.6);
      cone(g, 0xe1c9a0, x * 0.15, 1.2, 0, 0.065, 0.29);
      box(g, c, x * 0.23, 0.17, 0, 0.18, 0.34, 0.3);
    }
    const tail = cone(g, c, 0, 0.2, 0.6, 0.15, 0.9);
    tail.rotation.x = 1.2;
  } else if (/snake|worm|naga|centipede/.test(n)) {
    for (let i = 0; i < 6; i++)
      orb(
        g,
        c,
        Math.sin(i) * 0.13,
        0.15,
        0.35 - i * 0.14,
        0.14 + (i === 5 ? 0.03 : 0),
      );
  } else if (/eye|vortex|sphere/.test(n)) {
    orb(g, c, 0, 0.58, 0, 0.33, { emissive: c, emissiveIntensity: 0.3 });
    orb(g, 0xe5dec5, 0, 0.57, -0.27, 0.14);
    orb(g, 0x191d1c, 0, 0.57, -0.39, 0.065);
  } else if (/mold|fung|mound|cube/.test(n)) {
    if (/cube/.test(n))
      box(g, c, 0, 0.35, 0, 0.68, 0.7, 0.68, {
        transparent: true,
        opacity: 0.7,
      });
    else {
      cylinder(g, 0xaeac88, 0, 0.18, 0, 0.09, 0.35);
      cone(g, c, 0, 0.44, 0, 0.4, 0.32, 7);
    }
  } else if (
    /bat|bug|ant|spider|le[mn]ming|rat|jackal|hound|lizard|rothe/.test(n)
  ) {
    const body = orb(g, c, 0, 0.25, 0, 0.25);
    body.scale.z *= 1.3;
    orb(g, c, 0, 0.35, -0.3, 0.17);
    for (const x of [-0.2, 0.2])
      for (const z of [-0.15, 0.2]) box(g, c, x, 0.1, z, 0.065, 0.23, 0.075);
    if (/bat/.test(n))
      for (const x of [-0.4, 0.4]) {
        const wing = cone(g, c, x, 0.4, 0, 0.33, 0.07, 3);
        wing.rotation.z = x;
      }
  } else {
    const cloth = new THREE.Color(c).multiplyScalar(0.48);
    box(g, cloth, 0, 0.5, 0, 0.37, 0.5, 0.27);
    box(g, 0x625243, 0, 0.31, 0, 0.39, 0.065, 0.29);
    box(g, 0xb9a26c, 0, 0.31, -0.155, 0.07, 0.07, 0.035, { metalness: 0.7 });
    for (const x of [-0.19, 0.19])
      orb(g, 0x7a867c, x, 0.68, 0, 0.115, { metalness: 0.45 });
    orb(g, c, 0, 0.85, -0.19, 0.068);
    for (const x of [-0.3, 0.3]) orb(g, c, x, 0.28, 0, 0.075);
    if (/wizard|lich|magician|gnome/.test(n)) {
      cone(g, cloth, 0, 1.11, 0, 0.24, 0.39, 7);
      cylinder(g, 0x736147, 0.36, 0.5, 0, 0.028, 0.9);
      orb(g, 0xb28ccf, 0.36, 0.97, 0, 0.072, {
        emissive: 0x9870ba,
        emissiveIntensity: 1.2,
      });
    } else if (!/ghost|wraith|poltergeist/.test(n)) {
      const weapon = box(g, 0x9cabaa, 0.32, 0.46, -0.08, 0.045, 0.48, 0.045, {
        metalness: 0.7,
      });
      weapon.rotation.x = -0.3;
      box(g, 0xb9a16c, 0.32, 0.24, -0.04, 0.16, 0.035, 0.05);
    }

    orb(g, c, 0, 0.88, 0, 0.2);
    for (const x of [-0.13, 0.13])
      box(g, 0x394642, x, 0.16, 0, 0.12, 0.32, 0.16);
    for (const x of [-0.3, 0.3]) box(g, c, x, 0.5, 0, 0.12, 0.45, 0.14);
    if (/wraith|ghost|poltergeist/.test(n)) cone(g, c, 0, 0.35, 0, 0.36, 0.6);
  }
  for (const x of [-0.075, 0.075])
    orb(
      g,
      0xe7a17c,
      x,
      /dragon|demon|hellfire/.test(n)
        ? 1.01
        : /bug|ant|lemming|rat|hound|jackal/.test(n)
          ? 0.4
          : 0.91,
      -0.185,
      0.024,
      { emissive: 0xed7742, emissiveIntensity: 2 },
    );
  ring(g, 0xbd705b, 0.37);
  return g;
}
