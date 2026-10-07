import * as THREE from "three";
import { mat, matBasic, surface, noise } from "./materials.js";
import { FOREARM_REST, weaponRestX } from "./hero-motion.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { compact, disposeGeometry } from "./graphics-utils.js";
export { mat } from "./materials.js";
const shared = new Map();
const weaponModels = new Map();
const BLADE_STYLES = {
  dagger: { length: .46, width: .055, grip: .14, guard: .23, steel: 0xc2d4dc, gold: 0xbda06c, gem: 0x5b8998 },
  longsword: { length: .84, width: .12, grip: .19, guard: .3, steel: 0xcbdce4, gold: 0xc8a564, gem: 0x39798c },
  sunsword: { length: .8, width: .135, grip: .18, guard: .31, steel: 0xe2dec2, gold: 0xe3bb63, gem: 0xf4c875 },
  greatsword: { length: 1.02, width: .155, grip: .27, guard: .38, steel: 0xbfcfd9, gold: 0xb29970, gem: 0x688fa0 },
  slashing: { length: .87, width: .14, grip: .19, guard: .32, steel: 0xbadbec, gold: 0x93b7c8, gem: 0x63c4ea, bend: .065 },
  vorpal: { length: .92, width: .135, grip: .21, guard: .33, steel: 0xb8c6cd, gold: 0xd3a061, gem: 0xebad63 },
  slayer: { length: .98, width: .165, grip: .23, guard: .37, steel: 0x718c9b, gold: 0xbba176, gem: 0xd85956, bend: -.035 },
};
export function bladeStyle(weapon = {}) {
  const key = weapon?.type === "dagger" ? "dagger" :
    ({ 28: "sunsword", 29: "greatsword", 58: "longsword", 26: "slashing", 90: "vorpal", 91: "slayer" })[weapon?.id] || "longsword";
  return { key, ...BLADE_STYLES[key] };
}
const geometry = (key, create) => {
  if (!shared.has(key)) {
    const g = create();
    g.userData.shared = true;
    shared.set(key, g);
  }
  return shared.get(key);
};
// Box/orb/ring are the common solids. Rounded boxes and high-segment tori
// cost ~9× the triangles at a distance where the extra silhouette is lost.
const boxGeo = geometry("box", () => new THREE.BoxGeometry(1, 1, 1));
// Detail 0 keeps spheres readable at dungeon scale with 1/4 the triangles.
const sphereGeo = geometry("orb", () => new THREE.IcosahedronGeometry(1, 0));
const letterMaps = new Map();
function letterTexture(letter, ink, paper) {
  const key = `${letter}:${ink}:${paper}`;
  if (letterMaps.has(key)) return letterMaps.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = ink;
  ctx.font = "bold 46px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, 32, 35);
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
export function cone(g, color, x, y, z, r, h, n = 6) {
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
export function cylinder(g, color, x, y, z, r, h, n = 6, extra) {
  return mesh(
    g,
    geometry(`cylinder${n}`, () => new THREE.CylinderGeometry(1, 1, 1, n)),
    mat(color, extra),
    x,
    y,
    z,
    r,
    h,
    r,
  );
}
const CONTACT_DISC = new THREE.MeshBasicMaterial({
  color: 0x0c1210,
  transparent: true,
  opacity: 0.62,
  depthWrite: false,
  toneMapped: false,
});
const HERO_OUTLINE = new THREE.MeshBasicMaterial({
  color: 0x101816,
  side: THREE.BackSide,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

/** Flat dark disc. Not a shadow map. */
export function contactDisc(radius = 0.46) {
  const mesh = new THREE.Mesh(
    geometry("contact-disc", () => new THREE.CircleGeometry(1, 20)),
    CONTACT_DISC,
  );
  mesh.name = "contact-disc";
  mesh.userData.flatMark = true;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.scale.set(radius, radius, 1);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  return mesh;
}

const unlitAccent = (group, color, x, y, z, w, h, d, name) => {
  const mesh = new THREE.Mesh(
    geometry("unlit-accent", () => new THREE.BoxGeometry(1, 1, 1)),
    matBasic(color, { toneMapped: false }),
  );
  mesh.name = name;
  mesh.userData.flatMark = true;
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  group.add(mesh);
  return mesh;
};

const addHeroOutline = (root) => {
  const meshes = [];
  root.traverse((obj) => {
    if (!obj.isMesh || obj.userData.skipOutline) return;
    let parent = obj;
    while (parent) {
      if (parent.name === "weapon") return;
      parent = parent.parent;
    }
    meshes.push(obj);
  });
  for (const mesh of meshes) {
    const shell = new THREE.Mesh(mesh.geometry, HERO_OUTLINE);
    shell.name = "hero-outline";
    shell.userData.flatMark = true;
    shell.scale.set(1.09, 1.09, 1.09);
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.raycast = () => {};
    mesh.add(shell);
  }
};

export function ring(g, color, r = 0.4, y = 0.025) {
  const m = mesh(
    g,
    geometry("ring", () => new THREE.TorusGeometry(1, 0.026, 3, 12)),
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
  m.castShadow = m.receiveShadow = false;
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
  flame.castShadow = flame.receiveShadow = false;
  const core = orb(holder, 0xfff0c0, 0, 0.29, -0.03, 0.05, {
    emissive: 0xffdf92,
    emissiveIntensity: 5,
  });
  core.castShadow = core.receiveShadow = false;
  holder.userData.flame = true;
  return holder;
}

/** Clear grip meshes without disposing shared geometries/materials. */
export function clearWieldedWeapon(grip) {
  while (grip.children.length) grip.remove(grip.children[0]);
}

/**
 * Build the in-hand weapon so attack swings show larger unique silhouettes
 * per weapon type — not tiny floor icons stuck on a default dagger blade.
 */
function fillClassicWieldedWeapon(grip, weapon = null) {
  clearWieldedWeapon(grip);
  const id = weapon?.id ?? null;
  const type = weapon?.type || "unarmed";
  grip.userData.weaponId = id;
  grip.userData.weaponType = type;
  const restX = !id || type === "unarmed" ? 0 : weaponRestX(type);
  grip.rotation.set(restX, 0, 0);
  grip.userData.restRotationX = restX;
  if (!id || type === "unarmed") return grip;

  const metal = { metalness: 0.2, roughness: 0.42 };
  const haft = { metalness: 0.15, roughness: 0.75 };
  // Swing models are intentionally larger than ground loot icons.
  const S = 1.55;

  if (type === "staff" || id === 89) {
    cylinder(grip, 0x786249, 0, 0.12 * S, 0, 0.032 * S, 0.96 * S, 6);
    orb(grip, 0x9ed6e3, 0, 0.66 * S, 0, 0.12 * S, {
      emissive: 0x66bee7,
      emissiveIntensity: 2,
    });
    return grip;
  }
  if (type === "dagger" || id === 31) {
    // Dagger-length, but a flat edge. Local X stays horizontal under the
    // overhead camera, so that axis is the sharp side, not a brick.
    // Bright edge so the thin blade still reads under dungeon ambient light.
    const steel = { metalness: 0.4, roughness: 0.3, emissive: 0xc5d0d4, emissiveIntensity: 0.7 };
    const blade = box(grip, 0xeef3f5, 0, 0.2, 0, 0.022, 0.34, 0.056, steel);
    blade.name = "dagger-blade";
    const tip = box(grip, 0xf7fbfc, 0, 0.4, 0, 0.014, 0.08, 0.028, steel);
    tip.name = "dagger-tip";
    box(grip, 0xffffff, 0, 0.46, 0, 0.008, 0.045, 0.014, steel);
    const guard = box(grip, 0xddba70, 0, 0.02, 0, 0.11, 0.018, 0.032, metal);
    guard.name = "dagger-guard";
    box(grip, 0x463e32, 0, -0.07, 0, 0.028, 0.13, 0.032, haft);
    return grip;
  }
  if (type === "spear" || id === 30) {
    cylinder(grip, 0x6b5538, 0, 0.22 * S, 0, 0.03 * S, 1.05 * S, 6);
    cone(grip, 0xc5dedb, 0, 0.78 * S, 0, 0.06 * S, 0.26 * S, 5);
    return grip;
  }
  if (type === "lance" || id === 65) {
    cylinder(grip, 0x5a4a32, 0, 0.2 * S, 0, 0.032 * S, 1.15 * S, 6);
    cone(grip, 0xb8c8d0, 0, 0.85 * S, 0, 0.075 * S, 0.32 * S, 5);
    box(grip, 0x8a3030, 0, 0.58 * S, 0, 0.09 * S, 0.045 * S, 0.09 * S, metal);
    return grip;
  }
  if (type === "axe" || id === 57) {
    cylinder(grip, 0x5c4a32, 0, 0.16 * S, 0, 0.032 * S, 0.78 * S, 6);
    box(grip, 0xa8b4ae, 0.14 * S, 0.52 * S, 0, 0.32 * S, 0.26 * S, 0.055 * S, metal);
    box(grip, 0x8a9690, 0.26 * S, 0.52 * S, 0, 0.1 * S, 0.32 * S, 0.045 * S, metal);
    box(grip, 0x6a7670, -0.06 * S, 0.52 * S, 0, 0.12 * S, 0.14 * S, 0.045 * S, metal);
    return grip;
  }
  if (type === "flail" || id === 59) {
    cylinder(grip, 0x5c4a32, 0, 0.06 * S, 0, 0.032 * S, 0.52 * S, 6);
    orb(grip, 0x9aa6a0, 0.2 * S, 0.48 * S, 0, 0.11 * S, metal);
    orb(grip, 0x9aa6a0, 0.32 * S, 0.32 * S, 0.09 * S, 0.085 * S, metal);
    return grip;
  }
  if (type === "hammer" || id === 27) {
    cylinder(grip, 0x5c4a32, 0, 0.12 * S, 0, 0.04 * S, 0.62 * S, 6);
    box(grip, 0xb0a070, 0, 0.48 * S, 0, 0.34 * S, 0.24 * S, 0.24 * S, metal);
    box(grip, 0x8a7850, 0, 0.48 * S, 0, 0.14 * S, 0.32 * S, 0.14 * S, metal);
    orb(grip, 0xc0b080, 0, 0.62 * S, 0, 0.06 * S, metal);
    box(grip, 0xddba70, 0, -0.14 * S, 0, 0.09 * S, 0.09 * S, 0.09 * S, metal);
    return grip;
  }
  if (id === 28) {
    // Sunsword — bright blade with gold crossguard.
    box(grip, 0xffe7a0, 0, 0.36 * S, 0, 0.055 * S, 0.82 * S, 0.045 * S, {
      ...metal,
      emissive: 0xffc050,
      emissiveIntensity: 1.2,
    });
    box(grip, 0xddba70, 0, 0.02 * S, 0, 0.3 * S, 0.05 * S, 0.08 * S, metal);
    box(grip, 0x463e32, 0, -0.1 * S, 0, 0.07 * S, 0.2 * S, 0.07 * S, haft);
    return grip;
  }
  if (id === 26 || id === 90 || id === 91) {
    const blade =
      id === 91 ? 0xc45a5a : id === 90 ? 0xe8a060 : 0xa8c4e0;
    box(grip, blade, 0, 0.36 * S, 0, 0.055 * S, 0.8 * S, 0.045 * S, metal);
    box(grip, 0xddba70, 0, 0.02 * S, 0, 0.28 * S, 0.05 * S, 0.08 * S, metal);
    box(grip, 0x463e32, 0, -0.1 * S, 0, 0.07 * S, 0.2 * S, 0.07 * S, haft);
    orb(grip, 0xdab26a, 0, -0.22 * S, 0, 0.05 * S, metal);
    return grip;
  }
  if (id === 29) {
    // Two-handed sword — longer, thicker blade.
    box(grip, 0xc0cbc3, 0, 0.4 * S, 0, 0.07 * S, 0.95 * S, 0.055 * S, metal);
    box(grip, 0xddba70, 0, 0.02 * S, 0, 0.34 * S, 0.055 * S, 0.09 * S, metal);
    box(grip, 0x463e32, 0, -0.14 * S, 0, 0.08 * S, 0.26 * S, 0.08 * S, haft);
    return grip;
  }
  // Default sword / longsword / blunt blade silhouette.
  box(grip, 0xc5dedb, 0, 0.34 * S, 0, 0.055 * S, 0.78 * S, 0.05 * S, metal);
  box(grip, 0xddba70, 0, 0.02 * S, 0, 0.28 * S, 0.05 * S, 0.08 * S, metal);
  box(grip, 0x463e32, 0, -0.1 * S, 0, 0.07 * S, 0.2 * S, 0.07 * S, haft);
  orb(grip, 0xdab26a, 0, -0.22 * S, 0, 0.05 * S, metal);
  return grip;
}

export function fillWieldedWeapon(pivot, weapon = {}) {
  const type=weapon?.type || "unarmed";
  if (type !== "sword") {
    fillClassicWieldedWeapon(pivot, weapon);
    pivot.userData.weaponModel=type;
    pivot.userData.bladeLength=type === "dagger" ? .5 : 0; pivot.userData.bladeBend=0;
    if (type === "dagger") {
      const blade=pivot.getObjectByName("dagger-blade");
      if (blade) { blade.geometry=detailedBladeGeometry(0,true); blade.position.y=.03; }
      // Faceting and small grip details keep the latest thin dagger silhouette.
      const gem=geometry("dagger-small-gem",()=>new THREE.TetrahedronGeometry(1));
      markDetail(mesh(pivot,gem,mat(0xbda06c,{metalness:.6}),0,-.15,0,.03,.03,.03));
      markDetail(mesh(pivot,gem,mat(0x5b8998,{emissive:0x5b8998,emissiveIntensity:.2}),0,-.15,-.025,.015,.015,.015));
    }
    return pivot;
  }
  equipHero({ getObjectByName: () => pivot }, weapon);
  pivot.rotation.x=weaponRestX(type);
  pivot.userData.weaponId=weapon?.id ?? null; pivot.userData.restRotationX=pivot.rotation.x;
  return pivot;
}

const HERO_KITS = {
  Adventurer: {
    cloth: 0x427b78,
    skin: 0xc4aa89,
    boot: 0x544737,
    helm: "helm",
    cape: true,
    lantern: true,
    plate: true,
    weapon: { id: 31, type: "dagger", name: "dagger" },
  },
  Wizard: {
    cloth: 0x5b538b,
    skin: 0xd2bfa4,
    boot: 0x3c3834,
    helm: "hat",
    cape: true,
    plate: false,
    weapon: null,
  },
  Rogue: {
    cloth: 0x3e4e52,
    skin: 0xc4aa89,
    boot: 0x2e3330,
    helm: "hood",
    cape: false,
    plate: false,
    weapon: { id: 31, type: "dagger", name: "dagger" },
    scale: [0.92, 1.02, 0.9],
  },
  Elf: {
    cloth: 0x578564,
    skin: 0xe4c9a2,
    boot: 0x5a4634,
    helm: "ears",
    cape: true,
    plate: false,
    weapon: null,
    scale: [0.9, 1.08, 0.88],
  },
  Dwarf: {
    cloth: 0x826644,
    skin: 0xc49a78,
    boot: 0x4a3c2e,
    helm: "helm",
    cape: false,
    beard: true,
    plate: false,
    weapon: { id: 30, type: "spear", name: "spear" },
    scale: [1.18, 0.8, 1.14],
  },
  Ogre: {
    cloth: 0x6e7848,
    skin: 0x8a9158,
    boot: 0x4a4636,
    helm: "tusks",
    cape: false,
    plate: false,
    weapon: null,
    scale: [1.32, 1.22, 1.24],
  },
  Klingon: {
    cloth: 0x6a4038,
    skin: 0x8d5a48,
    boot: 0x2c2826,
    helm: "brow",
    cape: false,
    studs: true,
    plate: true,
    weapon: null,
    scale: [1.08, 1.04, 1.08],
  },
  Rambo: {
    cloth: 0x6a623c,
    skin: 0xc4926a,
    boot: 0x3a342c,
    helm: "band",
    cape: false,
    plate: false,
    weapon: { id: 65, type: "lance", name: "lance" },
  },
};

const markDetail = (mesh) => {
  mesh.userData.skipOutline = true;
  return mesh;
};

export function hero(character = "Adventurer") {
  const g = new THREE.Group(),
    body = new THREE.Group();
  const kit = HERO_KITS[character] || HERO_KITS.Adventurer;
  g.userData.heroClass = character;
  g.userData.helm = kit.helm;
  g.add(contactDisc(0.5));
  g.add(body);
  body.name = "body";
  const cloth = kit.cloth;
  const skin = kit.skin;
  for (const x of [-0.115, 0.115]) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.3, 0);
    body.add(leg);
    leg.name = x < 0 ? "left-leg" : "right-leg";
    box(leg, cloth, 0, -0.12, 0, 0.15, 0.29, 0.17);
    box(leg, kit.boot, 0, -0.26, -0.055, 0.175, 0.12, 0.26);
  }
  const torso = cone(body, cloth, 0, 0.54, 0, 0.275, 0.43, 8);
  torso.rotation.y = 0.4;
  if (kit.plate) {
    box(body, character === "Klingon" ? 0x6e5348 : 0x83978e, 0, 0.66, -0.075, 0.3, 0.24, 0.14, {
      metalness: 0.16,
      roughness: 0.48,
    });
  } else {
    box(body, cloth, 0, 0.64, -0.04, 0.28, 0.2, 0.16);
  }
  box(body, 0x705733, 0, 0.41, 0, 0.43, 0.065, 0.26);
  box(body, 0xd2b67b, 0, 0.415, -0.15, 0.075, 0.075, 0.035, {
    metalness: 0.2,
    roughness: 0.45,
  });
  if (kit.cape) {
    const cape = cone(body, cloth, 0, character === "Wizard" ? 0.5 : 0.48, 0.14, character === "Wizard" ? 0.34 : 0.31, character === "Wizard" ? 0.78 : 0.65, 6);
    cape.rotation.x = -0.25;
    cape.scale.z = 0.25;
    cape.name = "cape";
  }
  for (const x of [-0.28, 0.28]) {
    const arm = new THREE.Group();
    arm.name = x < 0 ? "left-arm" : "right-arm";
    arm.position.set(x, 0.68, 0);
    body.add(arm);
    if (kit.helm === "helm" || kit.plate) {
      orb(arm, 0x849b93, 0, 0.02, 0, 0.12, { metalness: 0.16, roughness: 0.48 });
    }
    box(arm, cloth, 0, -0.1, 0, 0.12, 0.18, 0.13);
    const forearm = new THREE.Group();
    forearm.name = x < 0 ? "left-forearm" : "right-forearm";
    forearm.position.set(0, -0.2, 0);
    forearm.rotation.x = FOREARM_REST;
    arm.add(forearm);
    box(forearm, cloth, 0, -0.08, 0, 0.1, 0.16, 0.11);
    orb(forearm, skin, 0, -0.18, -0.02, character === "Ogre" ? 0.09 : 0.07);
    if (x > 0) {
      const sword = new THREE.Group();
      sword.name = "weapon";
      sword.position.set(0.03, -0.16, -0.05);
      forearm.add(sword);
      fillWieldedWeapon(sword, kit.weapon || { id: null, type: "unarmed", name: "bare hands" });
    }
    if (x < 0 && kit.lantern) {
      const lantern = new THREE.Group();
      lantern.name = "lantern";
      lantern.position.set(-0.02, -0.2, 0.02);
      forearm.add(lantern);
      box(lantern, 0xfac96e, 0, 0, 0, 0.12, 0.15, 0.12, {
        emissive: 0xffbc53,
        emissiveIntensity: 1.4,
      });
      for (const side of [-0.073, 0.073]) box(lantern, 0x555245, side, 0, 0, 0.022, 0.19, 0.16);
      box(lantern, 0x7b714f, 0, 0.11, 0, 0.18, 0.04, 0.18);
      box(lantern, 0x7b714f, 0, -0.11, 0, 0.18, 0.04, 0.18);
    }
  }
  orb(body, skin, 0, 0.9, -0.01, character === "Ogre" ? 0.17 : 0.14);
  if (kit.helm === "helm") {
    const helm = orb(body, 0x8ca5a0, 0, 0.98, 0.01, 0.16, {
      metalness: 0.18,
      roughness: 0.46,
    });
    helm.scale.y *= 0.78;
    box(body, 0x253634, 0, 0.94, -0.13, 0.18, 0.035, 0.03);
  } else if (kit.helm === "hat") {
    cone(body, cloth, 0, 1.18, 0, 0.22, 0.5, 8);
    cylinder(body, cloth, 0, 0.98, 0, 0.24, 0.04, 8);
  } else if (kit.helm === "hood") {
    const hood = cone(body, cloth, 0, 1.02, 0.02, 0.2, 0.28, 6);
    hood.scale.z = 0.85;
  } else if (kit.helm === "ears") {
    for (const x of [-1, 1]) {
      const ear = markDetail(cone(body, skin, x * 0.14, 0.96, 0, 0.04, 0.12, 4));
      ear.rotation.z = x * -0.6;
    }
  } else if (kit.helm === "tusks") {
    for (const x of [-1, 1]) {
      const tusk = markDetail(cone(body, 0xe6dcc4, x * 0.06, 0.8, -0.12, 0.025, 0.1, 4));
      tusk.rotation.x = 0.4;
    }
  } else if (kit.helm === "brow") {
    markDetail(box(body, 0x5c3028, 0, 0.98, -0.08, 0.2, 0.04, 0.06));
  } else if (kit.helm === "band") {
    markDetail(box(body, 0x8a3030, 0, 0.98, 0, 0.2, 0.035, 0.16));
  }
  if (kit.beard) markDetail(box(body, 0x8a6840, 0, 0.78, -0.08, 0.12, 0.12, 0.06));
  if (kit.studs) {
    for (const x of [-0.08, 0.08]) markDetail(box(body, 0xd2c4a4, x, 0.66, -0.14, 0.035, 0.035, 0.02));
  }
  for (const x of [-0.04, 0.04]) {
    markDetail(box(body, 0x1c2422, x, 0.9, -0.13, 0.025, 0.018, 0.016));
  }
  if (kit.scale) body.scale.set(kit.scale[0], kit.scale[1], kit.scale[2]);
  const mark = ring(g, 0xe6d091, 0.38, 0.012);
  mark.material = mat(0xe6d091, {
    emissive: 0x8a7040,
    emissiveIntensity: 0.16,
    metalness: 0.12,
    roughness: 0.62,
  });
  addHeroOutline(body);
  return g;
}

function detailedBladeGeometry(bend = 0, simple = false) {
  return geometry(`blade:${bend}:${simple}`, () => {
    const positions = [], uvs = [];
    const stations = simple ? [[0,.55],[.72,.8],[1,0]] : [[0, .55], [.12, 1], [.72, .8], [.9, .46], [1, 0]];
    const corners = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    const vertex = (station, corner) => {
      const [y, width] = stations[station], [x, z] = corners[corner % 4];
      positions.push(x * width / 2 + bend * y * y, y, z * (1 - y * .25) / 2 * (station === stations.length - 1 ? 0 : 1));
      uvs.push(corner / 4, y);
    };
    for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < 4; j++) {
      vertex(i, j); vertex(i, j + 1); vertex(i + 1, j);
      vertex(i, j + 1); vertex(i + 1, j + 1); vertex(i + 1, j);
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    result.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    result.computeVertexNormals();
    return result;
  });
}

function detailedBlade(group, style) {
  const metal = { metalness: .85, roughness: .23 };
  mesh(group, detailedBladeGeometry(style.bend), mat(style.steel, metal), 0, .055, 0, style.width, style.length, .036);
  // The fuller and faceted section make the edge readable at gameplay scale.
  box(group, 0x758e9d, 0, style.length * .37 + .09, -.018, .014, style.length * .57, .006, { metalness: .8, roughness: .34 });
  box(group, style.gold, 0, .027, 0, .115, .066, .085, { metalness: .72, roughness: .3 });
  for (const side of [-1, 1]) {
    const wing = box(group, style.gold, side * style.guard * .28, .035, 0, style.guard * .46, .038, .072, { metalness: .72, roughness: .3 });
    wing.rotation.z = side * (style.key === "slayer" ? -.28 : .22);
    orb(group, style.gold, side * style.guard * .49, .035 + (style.key === "slayer" ? -.025 : .025), 0, .028, { metalness: .72, roughness: .3 });
  }
  cylinder(group, 0x4c3530, 0, -style.grip / 2 - .022, 0, .034, style.grip, 10);
  for (let i = 0; i < 6; i++)
    cylinder(group, 0x725348, 0, -.03 - i * style.grip / 6, 0, .038, .012, 10);
  for (const y of [-.025, -style.grip - .025])
    cylinder(group, style.gold, 0, y, 0, .042, .022, 10, { metalness: .72, roughness: .3 });
  const pommel = orb(group, style.gold, 0, -style.grip - .075, 0, .058, { metalness: .72, roughness: .3 });
  pommel.scale.y *= .75;
  orb(group, style.gem, 0, -style.grip - .075, -.047, .025, { metalness: .35, roughness: .18, emissive: style.gem, emissiveIntensity: .22 });
  if (!["dagger", "longsword", "greatsword"].includes(style.key))
    orb(group, style.gem, 0, .14, -.021, .018, { emissive: style.gem, emissiveIntensity: .7, metalness: .3, roughness: .22 });
}

export function weaponModel(weapon = {}) {
  const type = weapon?.type || "unarmed", style = bladeStyle(weapon);
  const key = ["sword", "dagger"].includes(type) ? style.key : type;
  if (!weaponModels.has(key)) {
    const model = new THREE.Group();
    const steel = 0xc4d7d5, wood = 0x8d714c;
    if (["sword", "dagger"].includes(type)) detailedBlade(model, style);
    else if (["staff", "spear", "lance"].includes(type)) {
      cylinder(model, wood, 0, .22, 0, .026, type === "lance" ? 1.4 : 1.08, 8);
      if (type === "staff") orb(model, 0x9ccbdc, 0, .78, 0, .09, { emissive: 0x76b0cf, emissiveIntensity: 1.5 });
      else cone(model, steel, 0, .87, 0, .065, .31, 4);
    } else if (type === "axe") {
      cylinder(model, wood, 0, .18, 0, .033, .8, 8);
      box(model, steel, .08, .48, 0, .34, .24, .065, { metalness: .7 });
    } else if (["hammer", "blunt", "flail"].includes(type)) {
      cylinder(model, wood, 0, .15, 0, .035, .65, 8);
      if (type === "hammer") box(model, steel, 0, .5, 0, .3, .16, .16, { metalness: .7 });
      else orb(model, type === "flail" ? steel : wood, 0, .52, 0, .12);
    }
    compact(model, true);
    model.userData = { weaponType: type, weaponModel: key, bladeLength: ["sword", "dagger"].includes(type) ? style.length + .055 : 0, bladeBend: (style.bend || 0) * style.width };
    weaponModels.set(key, model);
  }
  return weaponModels.get(key).clone();
}

export function equipHero(group, weapon) {
  const pivot = group.getObjectByName("weapon");
  if (!pivot) return;
  const type = weapon?.type || "unarmed";
  const key = ["sword", "dagger"].includes(type) ? bladeStyle(weapon).key : type;
  if (pivot.userData.weaponModel === key) return;
  disposeGeometry(pivot);
  const model = weaponModel(weapon);
  Object.assign(pivot.userData, model.userData);
  if (model.children.length) pivot.add(...model.children.slice());
}

export function releaseModelResources() {
  shared.forEach((geometry) => geometry.dispose());
  weaponModels.forEach((model) => model.traverse((part) => part.geometry?.dispose()));
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
    box(g, 0x4e6a48, -0.95, 0.16, 0.45, 0.28, 0.08, 0.22);
    box(g, 0x5c6a58, 0.95, 0.22, 0.2, 0.16, 0.1, 0.16);
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
    cylinder(g, 0x2a2624, 0, 0.02, 0, 0.7, 0.04, 12);
    cylinder(g, 0xf1b447, 0, 0.05, 0, 0.34, 0.06, 12).material = mat(0xc45a28, {
      emissive: 0xff5a16,
      emissiveIntensity: 0.85,
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
    box(g, id === 12 ? 0x8b5750 : 0x6a5340, 0, 1.48, 1.22, 0.42, 0.32, 0.05);
    box(g, 0xf0e6d0, 0, 1.48, 1.26, 0.28, 0.18, 0.02);
  }
  if (id === 69) {
    box(g, 0x6d8a55, -0.78, 0.14, 0.95, 0.32, 0.18, 0.18);
    box(g, 0xc45b4a, 0.62, 0.16, 0.98, 0.14, 0.18, 0.12);
    box(g, 0xe6c56a, 0.62, 0.28, 0.98, 0.08, 0.08, 0.08);
  }
  if (id === 16 || id === 15) {
    for (const x of [-0.48, 0.48]) cylinder(g, 0xd5d0bc, x, 0.72, 0.9, 0.08, 1.2, 6);
    block(g, "stone", 0xe4dfcb, 0, 1.34, 0.9, 1.25, 0.1, 0.24);
  }
  if (id === 10) {
    box(g, 0x1f5c64, -0.64, 2.2, 0.02, 0.05, 0.62, 0.02);
    box(g, 0xf2e2b0, -0.64, 2.55, 0.02, 0.16, 0.1, 0.02);
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
  if (id === 56) {
    g.userData.stairDirection = "up";
    g.userData.stairBlocked = false;
    cylinder(g, 0x3a322c, 0, 0.06, 0, 0.46, 0.12, 10);
    cylinder(g, 0x14110e, 0, 0.1, 0, 0.28, 0.22, 10);
    ring(g, 0xc47a3a, 0.4, 0.14);
    for (const x of [-0.12, 0.12]) box(g, 0x8a7050, x, 0.48, 0.08, 0.04, 0.72, 0.04);
    for (const y of [0.28, 0.48, 0.68]) box(g, 0x8a7050, 0, y, 0.08, 0.28, 0.03, 0.03);
    const arrow = cone(g, 0xffe08a, 0, 0.98, 0, 0.13, 0.2, 3);
    arrow.name = "up-arrow";
    unlitAccent(g, 0xffe08a, 0, 0.16, 0, 0.72, 0.04, 0.72, "stair-accent");
    return g;
  }
  if ([5, 13, 93].includes(id)) {
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
    unlitAccent(
      g,
      id === 93 ? 0xffe08a : up ? 0xb6f0bc : 0xffc078,
      0,
      up ? 0.78 : 0.48,
      up ? -0.42 : 0.36,
      0.62,
      0.05,
      0.1,
      id === 93 ? "town-exit-accent" : "stair-accent",
    );
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
    if (id === 93) {
      for (const x of [-0.5, 0.5]) box(g, 0x6a5438, x, 0.55, -0.15, 0.08, 1.05, 0.08);
      box(g, 0x8a7048, 0, 1.08, -0.15, 1.1, 0.08, 0.08);
    }
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
    unlitAccent(g, 0xf2d27a, 0, 1.02, 0.14, 0.72, 0.045, 0.05, "door-accent");
    return g;
  }
  if (id === 7 || id === 17) {
    const wet = id === 7;
    g.userData.fountain = wet ? "flowing" : "dry";
    cylinder(g, wet ? 0x6f8f86 : 0x6a6558, 0, 0.09, 0, 0.44, 0.18, 10);
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
  // Pits, dart traps, and express elevators each keep a distinct silhouette.
  if (id === 4) {
    g.userData.trapKind = "pit";
    // Deep well with cracked stone lip — reads as a hole, not a plate.
    cylinder(g, 0x030608, 0, -0.12, 0, 0.3, 0.28, 8);
    cylinder(g, 0x0c1416, 0, 0.01, 0, 0.38, 0.05, 8);
    const lip = ring(g, 0x8f7656, 0.44, 0.05);
    lip.name = "pit-rim";
    for (const [x, z, w, d] of [
      [-0.3, 0.1, 0.05, 0.22],
      [0.24, -0.2, 0.04, 0.2],
      [0.05, 0.32, 0.06, 0.14],
      [-0.12, -0.28, 0.05, 0.16],
    ]) {
      const crack = box(g, 0x5c5344, x, 0.04, z, w, 0.02, d);
      crack.rotation.y = x + z;
    }
    return g;
  }
  if (id === 74) {
    g.userData.trapKind = "dart";
    // Pressure plate with a ring of vertical darts — no pit silhouette.
    box(g, 0x6a735f, 0, 0.02, 0, 0.72, 0.035, 0.72);
    box(g, 0x55604f, 0, 0.05, 0, 0.5, 0.02, 0.5);
    ring(g, 0x8fba7a, 0.38, 0.04);
    for (const [x, z] of [
      [-0.16, -0.12],
      [0.14, -0.08],
      [-0.02, 0.16],
      [0.18, 0.14],
      [-0.2, 0.06],
      [0.08, -0.2],
    ]) {
      const dart = cone(g, 0xc9d9b4, x, 0.16, z, 0.04, 0.22, 4);
      dart.name = "dart-spike";
      dart.rotation.x = 0.12;
    }
    return g;
  }
  if (id === 6 || id === 14) {
    const up = id === 6;
    g.userData.trapKind = up ? "elevator-up" : "elevator-down";
    g.userData.elevatorDirection = up ? "up" : "down";
    if (up) {
      // Open scaffold cab with rising green chevron.
      box(g, 0x243028, 0, 0.02, 0, 0.9, 0.04, 0.9);
      box(g, 0x7a9e5a, 0, 0.1, 0, 0.62, 0.1, 0.62);
      for (const x of [-0.42, 0.42]) {
        box(g, 0x566b48, x, 0.55, -0.4, 0.08, 0.95, 0.08);
        box(g, 0x566b48, x, 0.55, 0.4, 0.08, 0.95, 0.08);
      }
      box(g, 0x6a8658, 0, 0.95, 0, 0.88, 0.06, 0.88);
      // Twin rising rails unique to the up cab.
      box(g, 0xb2e3b9, -0.2, 0.35, 0, 0.04, 0.4, 0.04);
      box(g, 0xb2e3b9, 0.2, 0.35, 0, 0.04, 0.4, 0.04);
      const arrow = cone(g, 0xb2e3b9, 0, 0.48, 0, 0.16, 0.28, 3);
      arrow.rotation.z = 0;
      arrow.name = "elevator-up-arrow";
      ring(g, 0x7a9e5a, 0.5, 0.03);
    } else {
      // Recessed amber shaft with hanging cage and down chevron.
      box(g, 0x1a1612, 0, 0.02, 0, 0.9, 0.04, 0.9);
      cylinder(g, 0x3a2e22, 0, -0.05, 0, 0.35, 0.18, 8);
      box(g, 0x9a7a52, 0, 0.08, 0, 0.55, 0.06, 0.55);
      for (const a of [-0.38, 0.38]) {
        box(g, 0x6a5a42, a, 0.35, a, 0.07, 0.55, 0.07);
        box(g, 0x6a5a42, a, 0.35, -a, 0.07, 0.55, 0.07);
      }
      box(g, 0x7a6a48, 0, 0.62, 0, 0.7, 0.05, 0.7);
      const arrow = cone(g, 0xefbb7d, 0, 0.32, 0, 0.14, 0.24, 3);
      arrow.rotation.z = Math.PI;
      arrow.name = "elevator-down-arrow";
      ring(g, 0x9a7a52, 0.48, 0.03);
    }
    return g;
  }
  if (id === 102) {
    // Town portal — twin rings with a cyan core, distinct from teleport traps.
    g.userData.portal = true;
    ring(g, 0x4ecdc4, 0.42, 0.04);
    ring(g, 0x2a9d8f, 0.28, 0.12);
    orb(g, 0x9ef0e8, 0, 0.35, 0, 0.12, {
      emissive: 0x4ecdc4,
      emissiveIntensity: 2.2,
    });
    cylinder(g, 0x1a4a48, 0, 0.08, 0, 0.08, 0.5, 6);
    return g;
  }
  if (/pit|trap/.test(n)) {
    g.userData.trapKind = "trap";
    cylinder(g, 0x091213, 0, 0.015, 0, 0.4, 0.025);
    ring(g, 0x8f7656, 0.4);
    return g;
  }
  if (/sword|dagger|blade|slayer/.test(n)) {
    const model = weaponModel({ id, type: /dagger/.test(n) ? "dagger" : "sword" });
    model.rotation.z = -.65;
    model.scale.setScalar(.75);
    model.position.y = .24;
    g.add(model);
    return g;
  }
  if (/spear|lance|axe|flail|hammer/.test(n)) {
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
  g.userData.presentation = "fallback";
  g.userData.artPath = null;
  g.add(contactDisc(0.4));
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
