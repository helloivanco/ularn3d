import * as THREE from "three";
import { mat, matBasic, surface, noise, placedTexture } from "./materials.js";
import { FOREARM_REST, weaponRestX } from "./hero-motion.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { compact, disposeGeometry, featherContact } from "./graphics-utils.js";
import { WALL_BASE_Y, FLOOR_CENTER_Y, FLOOR_HEIGHT, FLOOR_BOTTOM_Y } from "./wall-cut.js";
import { STAIR_COLORS } from "./map.js";

// Ways up are green and ways down red, the same colors as their map glyphs and compass arrows.
const WAY = Object.freeze({ up: new THREE.Color(STAIR_COLORS.up).getHex(), down: new THREE.Color(STAIR_COLORS.down).getHex() });
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
let mirrorGlassMaterial;
function mirrorGlass() {
  if (mirrorGlassMaterial) return mirrorGlassMaterial;
  if (typeof document === "undefined" || typeof document.createElement !== "function") return (mirrorGlassMaterial = matBasic(0xa9c2c7, { toneMapped: false }));
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const c = canvas.getContext("2d");
  const sky = c.createLinearGradient(0, 0, 32, 128);
  sky.addColorStop(0, "#eef5f4");
  sky.addColorStop(0.5, "#a3bcc2");
  sky.addColorStop(1, "#4d6872");
  c.fillStyle = sky;
  c.fillRect(0, 0, 64, 128);
  for (const [x0, w, a] of [[6, 14, 0.38], [26, 5, 0.22]]) {
    c.fillStyle = `rgba(255,255,255,${a})`;
    c.beginPath();
    c.moveTo(x0, 128);
    c.lineTo(x0 + w, 128);
    c.lineTo(x0 + w + 44, 0);
    c.lineTo(x0 + 44, 0);
    c.closePath();
    c.fill();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.userData.shared = true;
  return (mirrorGlassMaterial = matBasic(0xffffff, { map, toneMapped: false }));
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
  if (group.userData.buildingPart) m.userData.buildingPart = group.userData.buildingPart;
  group.add(m);
  return m;
}
export function box(g, color, x, y, z, w, h, d, extra) {
  return mesh(g, boxGeo, mat(color, extra), x, y, z, w, h, d);
}
export function block(g, kind, color, x, y, z, w, h, d, extra) {
  return mesh(g, boxGeo, surface(kind, color, extra), x, y, z, w, h, d);
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
export function tapered(g, color, x, y, z, r, h, top = .72, depth = 1, extra) {
  return mesh(g, geometry(`taper:${top}`, () => new THREE.CylinderGeometry(top, 1, 1, 6)),
    mat(color, extra), x, y, z, r, h, r * depth);
}
const CONTACT_DISC = new THREE.MeshBasicMaterial({
  color: 0x0c1210,
  transparent: true,
  opacity: 0.62,
  depthWrite: false,
  toneMapped: false,
  vertexColors: true,
});
const LOOT_SHADE = new THREE.MeshBasicMaterial({
  color: 0x0c1210,
  transparent: true,
  opacity: 0.56,
  depthWrite: false,
  toneMapped: false,
  vertexColors: true,
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
    geometry("contact-disc", () => featherContact(new THREE.CircleGeometry(1, 20))),
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
/** Floor loot's shade: a solid core out to half the radius, then a feathered
 *  rim. A sprite stands over the center, so a cone fade would hide its dark
 *  part behind the art. Not a shadow map. */
export function lootShade(radius = 0.32) {
  const mesh = contactDisc(radius);
  mesh.geometry = geometry("loot-shade", () => {
    const shape = new THREE.RingGeometry(0, 1, 24, 2);
    const position = shape.getAttribute("position"), colors = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++)
      colors.set([1, 1, 1, Math.hypot(position.getX(i), position.getY(i)) < 0.75 ? 1 : 0], i * 4);
    shape.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    return shape;
  });
  mesh.material = LOOT_SHADE;
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
      if (parent.name === "weapon" || parent.name === "lantern") return;
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
  if (g.userData.buildingPart) holder.userData.buildingPart = g.userData.buildingPart;
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
    // One solid from the guard to the point. Separate box tips left a blunt,
    // stepped end beyond the faceted blade. X remains the thin overhead edge.
    const steel = { metalness: 0.4, roughness: 0.3, emissive: 0xc5d0d4, emissiveIntensity: 0.12 };
    const blade = pointedBlade(grip, 0xe2eaf0, 0, 0.03, 0, 0.022, 0.45, 0.056, steel, 0, true);
    blade.name = "dagger-blade";
    const tip = new THREE.Object3D();
    tip.name = "dagger-tip";
    tip.position.y = 1;
    blade.add(tip);
    const guard = box(grip, 0xddba70, 0, 0.02, 0, 0.11, 0.018, 0.032, metal);
    guard.name = "dagger-guard";
    box(grip, 0x463e32, 0, -0.07, 0, 0.028, 0.13, 0.032, haft);
    const gem = geometry("dagger-small-gem", () => new THREE.TetrahedronGeometry(1));
    markDetail(mesh(grip, gem, mat(0xbda06c, { metalness: .6 }), 0, -.15, 0, .03, .03, .03));
    markDetail(mesh(grip, gem, mat(0x5b8998, { emissive: 0x5b8998, emissiveIntensity: .2 }), 0, -.15, -.025, .015, .015, .015));
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
    pivot.userData.bladeLength=type === "dagger" ? .48 : 0; pivot.userData.bladeBend=0;
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
    cloth: 0x536d78,
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
  const root = new THREE.Group(), body = new THREE.Group();
  const kit = HERO_KITS[character] || HERO_KITS.Adventurer;
  const cloth = kit.cloth, skin = kit.skin;
  const bareArms = character === "Ogre" || character === "Rambo";
  const trim = character === "Wizard" ? 0xc4ae79 : character === "Elf" ? 0xa8bc79 : 0xa88b5c;
  root.userData.heroClass = character;
  root.userData.helm = kit.helm;
  root.add(contactDisc(.5), body); body.name = "body";
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * .115, .3, 0);
    leg.name = side < 0 ? "left-leg" : "right-leg"; body.add(leg);
    box(leg, cloth, 0, -.055, 0, .15, .15, .17);
    const knee = new THREE.Group(); knee.name = side < 0 ? "left-knee" : "right-knee";
    knee.position.y = -.14; leg.add(knee);
    markDetail(box(knee,cloth,0,-.055,0,.14,.13,.15));
    const foot = new THREE.Group(); foot.name = side < 0 ? "left-foot" : "right-foot";
    foot.position.set(0,-.11,-.01);knee.add(foot);
    box(foot,kit.boot,0,-.01,-.045,.175,.1,.26);
  }
  // A chest and waist rather than a pointed cone. The existing bones/rest
  // transforms remain the walking and weapon animation contract.
  tapered(body, cloth, 0, .57, 0, .22, .38, 1.18, .84);
  if (kit.plate) {
    markDetail(box(body, character === "Klingon" ? 0x71544b : 0x83978e, 0, .65, -.1, .3, .23, .13,
      { metalness: .16, roughness: .48 }));
  } else markDetail(box(body, bareArms ? skin : cloth, 0, .66, -.055, .28, .2, .16));
  markDetail(box(body, 0x60482f, 0, .41, 0, .43, .065, .26));
  markDetail(box(body, trim, 0, .415, -.15, .075, .065, .03));
  if (kit.cape) {
    const cape = tapered(body, cloth, 0, .46, .13, character === "Wizard" ? .29 : .25,
      character === "Wizard" ? .7 : .59, .58, .24);
    cape.rotation.x = -.25; cape.name = "cape";
  }
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.name = side < 0 ? "left-arm" : "right-arm";
    arm.position.set(side * (character === "Ogre" ? .25 : .28), .68, 0); body.add(arm);
    if (kit.helm === "helm" || kit.plate) {
      const shoulder = character === "Klingon"
        ? box(arm, 0x635e5a, 0, .02, 0, .22, .12, .21)
        : orb(arm, 0x849b93, 0, .02, 0, .12, { metalness: .16, roughness: .48 });
      if (character === "Klingon") shoulder.rotation.z = side * .22;
    }
    box(arm, bareArms ? skin : cloth, 0, -.1, 0, bareArms ? .14 : .12, .18, .13);
    const forearm = new THREE.Group(); forearm.name = side < 0 ? "left-forearm" : "right-forearm";
    forearm.position.set(0, -.2, 0); forearm.rotation.x = FOREARM_REST; arm.add(forearm);
    markDetail(box(forearm, bareArms ? skin : cloth, 0, -.08, 0, .1, .16, .11));
    orb(forearm, skin, 0, -.18, -.02, character === "Ogre" ? .09 : .07);
    if (["Rogue", "Elf", "Klingon", "Rambo"].includes(character))
      markDetail(box(forearm, kit.boot, 0, -.065, -.055, .115, .085, .025));
    if (side > 0) {
      const weapon = new THREE.Group(); weapon.name = "weapon";
      weapon.position.set(.03, -.16, -.05); forearm.add(weapon);
      fillWieldedWeapon(weapon, kit.weapon || { id: null, type: "unarmed", name: "bare hands" });
    }
    if (side < 0 && kit.lantern) {
      const lantern = new THREE.Group(); lantern.name = "lantern";
      lantern.position.set(-.02, -.2, .02); forearm.add(lantern);
      box(lantern, 0xfac96e, 0, 0, 0, .12, .15, .12, { emissive: 0xffbc53, emissiveIntensity: 1.4 });
      for (const x of [-.073, .073]) box(lantern, 0x555245, x, 0, 0, .022, .19, .16);
      box(lantern, 0x7b714f, 0, .11, 0, .18, .04, .18);
      box(lantern, 0x7b714f, 0, -.11, 0, .18, .04, .18);
    }
  }
  const head = orb(body, skin, 0, .9, -.01, character === "Ogre" ? .17 : .14);
  head.name = "hero-head";
  markDetail(box(body, skin, 0, .895, -.151, .036, .04, .036));
  if (kit.helm === "helm") {
    const helm = orb(body, 0x8ca5a0, 0, .98, .01, .16, { metalness: .18, roughness: .46 });
    helm.scale.y *= .78;
    markDetail(cylinder(body, character === "Dwarf" ? 0xb19869 : 0x617a76, 0, .953, .01, .164, .028, 6));
    markDetail(box(body, 0x253634, 0, .935, -.14, .18, .029, .025));
  } else if (kit.helm === "hat") {
    const hat = cone(body, cloth, 0, 1.15, .02, .2, .42, 8); hat.rotation.z = -.13;
    cylinder(body, cloth, 0, .98, 0, .235, .035, 8);
    markDetail(cylinder(body, trim, 0, 1.01, 0, .175, .025, 8));
    const tip = markDetail(cone(body, cloth, -.045, 1.36, .02, .064, .16, 6)); tip.rotation.z = -.65;
  } else if (kit.helm === "hood") {
    // Multiplying is essential: assigning .85 here used to make a 1.7-unit
    // hood that stretched behind the head and hid the entire rogue.
    const hood = orb(body, cloth, 0, .94, .035, .19); hood.scale.multiply(new THREE.Vector3(1, 1.04, .85));
    markDetail(box(body,0x83999e,0,1.025,.145,.024,.1,.022));
    markDetail(box(body, skin, 0, .893, -.129, .115, .12, .045));
    markDetail(box(body, 0x273236, 0, .865, -.16, .13, .03, .028));
  } else if (kit.helm === "ears") {
    const hair = markDetail(orb(body, 0x70523c, 0, .96, .035, .155)); hair.scale.multiply(new THREE.Vector3(.92, .63, .8));
    for (const side of [-1, 1]) {
      const ear = markDetail(cone(body, skin, side * .17, .942, -.005, .036, .17, 4));
      ear.rotation.z = -side * 1.05;
    }
  } else if (kit.helm === "tusks") {
    markDetail(box(body, skin, 0, .817, -.115, .21, .1, .1));
    for (const side of [-1, 1]) {
      const tusk = markDetail(cone(body, 0xe6dcc4, side * .084, .83, -.18, .029, .125, 4)); tusk.rotation.x = -.18;
    }
  } else if (kit.helm === "brow") {
    const hair = markDetail(orb(body, 0x302927, 0, .978, .035, .15)); hair.scale.multiply(new THREE.Vector3(.85, .65, .8));
    for (let i = 0; i < 3; i++)
      markDetail(box(body, 0x593229, 0, .923 + i * .03, -.144 + i * .015, .13 - i * .025, .023, .035));
  } else if (kit.helm === "band") {
    const hair = markDetail(orb(body, 0x3e3027, 0, .967, .02, .153)); hair.scale.y *= .67;
    markDetail(cylinder(body, 0xa53e33, 0, .98, 0, .154, .04, 8));
    for (const side of [-1, 1]) {
      const tie = markDetail(box(body, 0xa53e33, side * .05, .916, .145, .038, .15, .027)); tie.rotation.z = side * .3;
    }
  }
  if (kit.beard) {
    for (const x of [-.04, .04]) {
      const beard = markDetail(cone(body, 0x785232, x, .78, -.135, .065, .19, 5)); beard.rotation.z = Math.PI;
      markDetail(box(body, 0xc1a366, x, .715, -.157, .034, .025, .025));
    }
  }
  if (kit.studs) for (const x of [-.1, 0, .1])
    markDetail(box(body, 0xc4b9a3, x, .66, -.174, .028, .028, .018));
  for (const x of [-.047, .047]) markDetail(box(body, 0x1c2422, x, .907, -.147, .027, .021, .02));
  if (character === "Adventurer") {
    markDetail(box(body, 0x574332, 0, .62, .226, .26, .27, .12));
    const strap = markDetail(box(body, 0x705733, -.105, .65, -.177, .045, .23, .027)); strap.rotation.z = -.15;
  } else if (character === "Wizard") {
    for (const x of [-.1, .1]) markDetail(box(body, trim, x, .56, -.164, .026, .24, .023));
    markDetail(orb(body, 0x76b6c5, 0, .695, -.162, .04, { emissive: 0x4f8591, emissiveIntensity: .22 }));
  } else if (character === "Elf") {
    const leaf = markDetail(cone(body, trim, -.125, .69, -.16, .04, .12, 4)); leaf.rotation.z = -.45;
    const seam = markDetail(box(body, 0x365d48, .08, .56, -.151, .035, .23, .024)); seam.rotation.z = .25;
  } else if (character === "Rogue") {
    for (const x of [-.2, .2]) markDetail(box(body, 0x655440, x, .425, -.045, .075, .12, .105));
    const strap = markDetail(box(body, 0x8b7960, 0, .65, -.153, .034, .23, .025)); strap.rotation.z = -.35;
  } else if (character === "Dwarf") {
    markDetail(box(body, 0x534434, 0, .655, -.147, .22, .1, .035));
  } else if (bareArms) {
    const strap = markDetail(box(body, 0x473c2b, 0, .635, -.16, .05, .245, .033)); strap.rotation.z = character === "Rambo" ? -.45 : .45;
    if (character === "Rambo") for (let i = 0; i < 3; i++)
      markDetail(box(body, 0xbfa676, -.075 + i * .045, .675 - i * .035, -.179, .025, .055, .025));
  }
  if (kit.scale) body.scale.set(...kit.scale);
  const mark = ring(root, 0xe6d091, .38, .012);
  mark.name = "hero-mark";
  mark.material = mat(0xe6d091, { emissive: 0x8a7040, emissiveIntensity: .16, metalness: .12, roughness: .62 });
  addHeroOutline(body);
  return root;
}

function detailedBladeGeometry(bend = 0, simple = false) {
  return geometry(`blade:${bend}:${simple}`, () => {
    const positions = [], uvs = [];
    const stations = simple ? [[0, 1], [.55, .78], [.82, .38], [1, 0]] : [[0, .55], [.12, 1], [.72, .8], [.9, .46], [1, 0]];
    const corners = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    const vertex = (station, corner) => {
      const [y, width] = stations[station], [x, z] = corners[corner % 4];
      positions.push(x * width / 2 + bend * y * y, y, z * width / 2);
      uvs.push(corner / 4, y);
    };
    for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < 4; j++) {
      vertex(i, j); vertex(i, j + 1); vertex(i + 1, j);
      // All four ridges meet at one point; a second triangle here would have
      // two identical tip vertices and no area.
      if (i < stations.length - 2) {
        vertex(i, j + 1); vertex(i + 1, j + 1); vertex(i + 1, j);
      }
    }
    for (let j = 0; j < 4; j++) {
      positions.push(0, 0, 0); uvs.push(.5, 0);
      vertex(0, j + 1); vertex(0, j);
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    result.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    result.computeVertexNormals();
    return result;
  });
}

/** Closed diamond section with thin cutting edges and a single tapered tip. */
export function pointedBlade(group, color, x, y, z, width, length, thickness, extra, bend = 0, simple = false) {
  return mesh(group, detailedBladeGeometry(bend, simple), mat(color, extra), x, y, z, width, length, thickness);
}

function detailedBlade(group, style) {
  const metal = { metalness: .85, roughness: .23 };
  pointedBlade(group, style.steel, 0, .055, 0, style.width, style.length, .036, metal, style.bend);
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
    // A slab's u runs along its slope (toward the ridge on the left side, the
    // eave on the right). A quarter turn lays the slate courses along the ridge
    // with their lips toward the eave.
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
      { map: placedTexture("roof", side < 0 ? "slope-left" : "slope-right", { rotation: (side * Math.PI) / 2 }) },
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
  g.userData.buildingPart = "base";
  // An opaque floor supports the hero when the roof and near walls cut away.
  block(g, "stone", 0x8a9380, 0, -0.06, 0, 1.72, 0.12, 1.52);
  for (const [part, x, z, width, depth] of [
    ["front", 0, 0.54, 1.42, 0.12],
    ["back", 0, -0.54, 1.42, 0.12],
    ["left", -0.65, 0, 0.12, 0.96],
    ["right", 0.65, 0, 0.12, 0.96],
  ]) {
    g.userData.buildingPart = part;
    block(g, "stone", stone, x, 0.68, z, width, 1.36, depth);
  }
  for (const x of [-0.72, 0.72])
    for (const z of [-0.6, 0.6]) {
      g.userData.buildingPart = z > 0 ? "front" : "back";
      block(g, "wood", 0x685b46, x, 0.68, z, 0.085, 1.36, 0.085);
    }
  g.userData.buildingPart = "front";
  block(g, "wood", 0x75634b, 0, 0.37, 0.615, 1.45, 0.07, 0.06);
  block(g, "wood", 0x75634b, 0, 1.34, 0.615, 1.48, 0.085, 0.07);
  g.userData.buildingPart = "roof";
  roof(g, roofColor, 1.36, 1.82, 1.62, 0.65);
  // The triangular gable and its timber braces sit under the two shingle slopes.
  const gable = cone(g, stone, 0, 1.56, 0, 0.72, 0.48, 4);
  gable.rotation.y = Math.PI / 4;
  gable.scale.z = 0.82;
  g.userData.buildingPart = "front";
  block(g, "wood", 0x6a5441, 0, 0.51, 0.635, 0.34, 0.88, 0.07);
  box(g, 0xbba765, 0.105, 0.49, 0.686, 0.04, 0.06, 0.03, { metalness: 0.8 });
  windowDetail(g, -0.46, 0.93, 0.625, 0.22, 0.34);
  windowDetail(g, 0.46, 0.93, 0.625, 0.22, 0.34);
  g.userData.buildingPart = "base";
  block(g, "stone", 0xb1b09a, 0, 0.015, 0.8, 0.65, 0.06, 0.43);
  g.userData.buildingPart = "roof";
  block(g, "stone", 0x8f9689, 0.43, 1.98, -0.28, 0.22, 0.62, 0.26);
  block(g, "stone", 0xb9b9a1, 0.43, 2.3, -0.28, 0.29, 0.075, 0.31);
  g.userData.buildingPart = "front";
  torch(g, -0.24, 0.82, 0.72, 0.52);
  if (id === 10 || id === 16) {
    g.userData.buildingPart = "roof";
    block(g, "stone", 0x9da996, -0.64, 1.1, -0.36, 0.65, 2.2, 0.67);
    const r = cone(g, roofColor, -0.64, 2.59, -0.36, 0.56, 0.9, 8);
    r.material = surface("roof", roofColor);
    windowDetail(g, -0.64, 1.78, -0.005, 0.19, 0.42);
    orb(g, 0xe5c57d, -0.64, 3.08, -0.36, 0.052, {
      emissive: 0xdbb05a,
      emissiveIntensity: 1.8,
    });
  }
  g.userData.buildingPart = "front";
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
    g.userData.buildingPart = "base";
    box(g, 0x6d8a55, -0.78, 0.14, 0.95, 0.32, 0.18, 0.18);
    box(g, 0xc45b4a, 0.62, 0.16, 0.98, 0.14, 0.18, 0.12);
    box(g, 0xe6c56a, 0.62, 0.28, 0.98, 0.08, 0.08, 0.08);
  }
  if (id === 16 || id === 15) {
    g.userData.buildingPart = "front";
    for (const x of [-0.48, 0.48]) cylinder(g, 0xd5d0bc, x, 0.72, 0.9, 0.08, 1.2, 6);
    block(g, "stone", 0xe4dfcb, 0, 1.34, 0.9, 1.25, 0.1, 0.24);
  }
  if (id === 10) {
    g.userData.buildingPart = "roof";
    box(g, 0x1f5c64, -0.64, 2.2, 0.02, 0.05, 0.62, 0.02);
    box(g, 0xf2e2b0, -0.64, 2.55, 0.02, 0.16, 0.1, 0.02);
  }
  return g;
}
/** Stairs going down are a well cut into the floor, so their tile draws no floor slab. */
export const opensFloor = (tile) => tile.id === 13;
export function itemModel(tile) {
  const g = new THREE.Group(),
    id = tile.id,
    n = tile.name.toLowerCase();
  if (tile.store && id !== 56) return building(id);
  if (tile.wall) {
    box(g, 0x52605c, 0, 0.52, 0, 1, 1.04, 1);
    box(g, 0x67716a, 0, 1.085, 0, 1, 0.09, 1);
    for (let i = 0; i < 2; i++)
      box(g, 0x36423f, 0, 0.34 + i * 0.37, 0.504, 0.98, 0.025, 0.015);
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
    const arrow = cone(g, WAY.up, 0, 0.98, 0, 0.13, 0.2, 3);
    arrow.name = "up-arrow";
    unlitAccent(g, WAY.up, 0, 0.16, 0, 0.72, 0.04, 0.72, "stair-accent");
    return g;
  }
  if ([5, 13, 93].includes(id)) {
    const up = id !== 13;
    const blocked = !!tile.stair?.blocked;
    g.userData.stairDirection = up ? "up" : "down";
    g.userData.stairBlocked = blocked;
    // Every part rests on something: solid steps, posted rails, and marks laid
    // on a surface. Both flights climb or descend toward -z.
    let rest;
    if (up) {
      for (let i = 0; i < 5; i++) {
        const top = 0.11 * (i + 1), front = 0.42 - i * 0.17, back = i === 4 ? -0.46 : front - 0.17;
        const step = box(g, 0xc1cdb1, 0, (top + WALL_BASE_Y) / 2, (front + back) / 2,
          0.72, top - WALL_BASE_Y, front - back);
        step.name = `step-${i}`;
      }
      rest = { y: 0.55, z: -0.36 };
      for (const x of [-0.41, 0.41]) {
        box(g, 0x8a9a80, x, 0.15, 0.4, 0.05, 0.33, 0.05);
        box(g, 0x8a9a80, x, 0.42, -0.42, 0.05, 0.87, 0.05);
        beam(g, 0xa6b898, [x, 0.3, 0.4], [x, 0.84, -0.42], 0.025);
      }
      unlitAccent(g, WAY.up, 0, 0.554, -0.275, 0.72, 0.008, 0.03,
        id === 93 ? "town-exit-accent" : "stair-accent");
    } else {
      // The stairwell is cut into the floor (see opensFloor): a stone rim, a
      // dark lining, and steps that fall away into the dark.
      const rim = 0.025;
      for (const [x, z, w, d] of [[-0.44, 0, 0.12, 1], [0.44, 0, 0.12, 1], [0, -0.45, 0.76, 0.1], [0, 0.45, 0.76, 0.1]]) {
        box(g, 0x9aa393, x, (rim + WALL_BASE_Y) / 2, z, w, rim - WALL_BASE_Y, d);
        box(g, 0x353b34, x, FLOOR_CENTER_Y, z, w, FLOOR_HEIGHT, d);
      }
      [0x8f8a76, 0x6b6757, 0x4b483d, 0x2e2c26].forEach((color, i) => {
        const top = WALL_BASE_Y - 0.035 * (i + 1);
        const step = box(g, color, 0, (top + FLOOR_BOTTOM_Y) / 2, 0.32 - i * 0.16,
          0.76, top - FLOOR_BOTTOM_Y, 0.16);
        step.name = `step-${i}`;
      });
      mesh(g, boxGeo, matBasic(0x050709), 0, FLOOR_BOTTOM_Y + 0.005, -0.32, 0.76, 0.01, 0.16).name = "stair-depth";
      rest = { y: FLOOR_BOTTOM_Y + 0.012, z: -0.32 };
      unlitAccent(g, WAY.down, 0, rim + 0.003, 0.415, 0.76, 0.006, 0.03, "stair-accent");
    }
    if (blocked) {
      const landing = new THREE.Group();
      landing.name = "stair-blockage";
      // A fallen block covers the landing, or fills the well past the rim.
      // Loose stones lie on the step in front of it, clear of the cross.
      const [bottom, top] = up ? [rest.y, rest.y + 0.3] : [FLOOR_BOTTOM_Y, 0.06];
      box(landing, 0x8a8270, 0, (bottom + top) / 2, up ? -0.36 : -0.2, 0.72, top - bottom, up ? 0.2 : 0.4);
      for (let i = 0; i < 4; i++) {
        const rubble = orb(landing, 0xa39b85, (i - 1.5) * 0.17,
          up ? 0.5 : 0.02, (up ? -0.2 : 0.28) + (i % 2) * 0.05, 0.085 + (i % 2) * 0.02);
        rubble.scale.y *= 0.7;
      }
      // A cross over the blocked landing stays legible from the overhead view.
      const cz = up ? -0.36 : -0.16;
      beam(landing, 0xd39a71, [-0.28, top + 0.03, cz - 0.15], [0.28, top + 0.03, cz + 0.15], 0.055);
      beam(landing, 0xd39a71, [-0.28, top + 0.03, cz + 0.15], [0.28, top + 0.03, cz - 0.15], 0.055);
      g.add(landing);
    } else {
      // A chevron laid on the landing, or at the foot of the well, reads as up
      // or down from the default north-up camera.
      const arrow = new THREE.Mesh(
        geometry("stair-chevron", () => {
          const shape = new THREE.Shape([[-0.15, -0.06], [0, 0.06], [0.15, -0.06], [0.09, -0.06], [0, 0.012], [-0.09, -0.06]]
            .map(([x, y]) => new THREE.Vector2(x, y)));
          return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
        }),
        matBasic(up ? WAY.up : WAY.down, { toneMapped: false }),
      );
      arrow.position.set(0, rest.y + 0.004, rest.z);
      if (!up) arrow.rotation.y = Math.PI;
      arrow.userData.flatMark = true;
      arrow.name = up ? "up-arrow" : "down-arrow";
      g.add(arrow);
    }
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
    // A holy altar: dressed stone, a violet runner, two lit candles and the
    // floating orb of the classic tile.
    block(g, "stone", 0x7f8f86, 0, 0.11, 0, 0.88, 0.22, 0.7);
    block(g, "stone", 0xaeb5a0, 0, 0.42, 0, 0.6, 0.42, 0.44);
    block(g, "stone", 0xc8c6ab, 0, 0.68, 0, 0.84, 0.1, 0.64);
    box(g, 0x5e3a6e, 0, 0.735, 0, 0.24, 0.012, 0.66);
    for (const z of [-0.33, 0.33]) box(g, 0xd4b062, 0, 0.6, z, 0.24, 0.16, 0.012, { metalness: 0.6, roughness: 0.35 });
    for (const x of [-0.31, 0.31]) {
      cylinder(g, 0xe6dcc2, x, 0.81, -0.17, 0.035, 0.15);
      orb(g, 0xffd182, x, 0.92, -0.17, 0.032, { emissive: 0xffbd54, emissiveIntensity: 3 });
    }
    orb(g, 0xc6aeed, 0, 1.04, 0.04, 0.11, { emissive: 0x9d6ac6, emissiveIntensity: 1 });
    return g;
  }
  if (id === 44) {
    // Iron-bound chest: plank body, barrel lid, straps and a brass lock.
    block(g, "wood", 0x7b5a34, 0, 0.19, 0, 0.6, 0.34, 0.4);
    const lid = block(g, "wood", 0x86643a, 0, 0.36, 0, 0.6, 0.4, 0.4);
    lid.geometry = geometry("chest-lid", () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, false, 0, Math.PI));
    lid.rotation.z = Math.PI / 2;
    lid.scale.set(0.4, 0.6, 0.4);
    const iron = { metalness: 0.6, roughness: 0.45 };
    for (const x of [-0.2, 0.2]) {
      box(g, 0x3a3935, x, 0.19, 0, 0.05, 0.35, 0.42, iron);
      const strap = cylinder(g, 0x3a3935, x, 0.36, 0, 0.206, 0.05, 10, iron);
      strap.rotation.z = Math.PI / 2;
    }
    box(g, 0xd0a94e, 0, 0.33, 0.205, 0.1, 0.12, 0.02, { metalness: 0.7, roughness: 0.3 });
    box(g, 0x1c1712, 0, 0.32, 0.217, 0.022, 0.045, 0.006);
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
    // The handsome jewel-encrusted throne. Prying the gems loose turns it into
    // the engine's "massive throne", which keeps the seat but shows empty sockets.
    const jewels = id === 2;
    const gilt = { metalness: 0.7, roughness: 0.3 };
    block(g, "stone", 0x7e7a68, 0, 0.07, 0, 0.8, 0.14, 0.68);
    box(g, 0x8a6f3e, 0, 0.32, -0.02, 0.56, 0.16, 0.46);
    box(g, 0x7a2f36, 0, 0.415, 0, 0.48, 0.03, 0.38);
    box(g, 0x8a6f3e, 0, 0.82, -0.23, 0.58, 0.92, 0.1);
    box(g, 0x7a2f36, 0, 0.78, -0.175, 0.42, 0.62, 0.012);
    for (const x of [-0.31, 0.31]) {
      box(g, 0x8a6f3e, x, 0.46, -0.02, 0.08, 0.14, 0.48);
      box(g, 0xd4b062, x, 0.54, 0.2, 0.09, 0.04, 0.09, gilt);
      orb(g, 0xd4b062, x * 0.95, 1.33, -0.23, 0.05, gilt);
    }
    box(g, 0xd4b062, 0, 1.29, -0.23, 0.66, 0.05, 0.12, gilt);
    const sockets = [[0, 1.15], [-0.15, 0.98], [0.15, 0.98], [0, 0.82]];
    const stones = [0xd9455a, 0x3cbf7a, 0x4a7fe0, 0xe6f2ff];
    sockets.forEach(([x, y], i) => {
      box(g, 0xd4b062, x, y, -0.172, 0.09, 0.09, 0.012, gilt);
      if (jewels) {
        const gem = orb(g, stones[i], x, y, -0.158, 0.042, { emissive: stones[i], emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.15 });
        gem.name = "throne-jewel";
      } else box(g, 0x14100c, x, y, -0.166, 0.05, 0.05, 0.008);
    });
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
  if (id === 74 || id === 73) {
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
  if (id === 66 || id === 67) {
    g.userData.trapKind = "arrow";
    // A pressure plate set into the floor, scored with an arrowhead.
    box(g, 0x45483f, 0, 0.012, 0, 0.64, 0.025, 0.64);
    box(g, 0x6e7266, 0, 0.03, 0, 0.5, 0.02, 0.5);
    unlitAccent(g, 0xd8b56a, 0, 0.043, 0.05, 0.035, 0.01, 0.3, "arrow-shaft");
    for (const side of [-1, 1]) {
      const barb = unlitAccent(g, 0xd8b56a, side * 0.045, 0.043, -0.13, 0.035, 0.01, 0.13, "arrow-head");
      barb.rotation.y = side * 0.75;
    }
    for (const [x, z] of [[-0.27, 0], [0.27, 0], [0, -0.27], [0, 0.27]]) box(g, 0x16180f, x, 0.04, z, x ? 0.02 : 0.12, 0.01, z ? 0.02 : 0.12);
    return g;
  }
  if (id === 75 || id === 76) {
    g.userData.trapKind = "trapdoor";
    // A wooden hatch on iron straps over a dark gap.
    box(g, 0x070909, 0, 0.008, 0, 0.66, 0.016, 0.66);
    for (const x of [-0.155, 0.155]) block(g, "wood", 0x6e5536, x, 0.032, 0, 0.29, 0.03, 0.6);
    for (const z of [-0.19, 0.19]) box(g, 0x34342f, 0, 0.05, z, 0.6, 0.012, 0.05, { metalness: 0.6, roughness: 0.45 });
    const pull = ring(g, 0x8f7a52, 0.055, 0.058);
    pull.position.x = 0.2;
    return g;
  }
  if (id === 9 || id === 78) {
    g.userData.trapKind = "teleport";
    // A rune circle humming with violet light, unlike the cyan town portal.
    cylinder(g, 0x1c1826, 0, 0.01, 0, 0.42, 0.012, 12);
    ring(g, 0x9b6cf0, 0.4, 0.03);
    ring(g, 0x9b6cf0, 0.24, 0.032);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const rune = unlitAccent(g, 0xc9a8ff, Math.cos(a) * 0.32, 0.034, Math.sin(a) * 0.32, 0.07, 0.008, 0.02, "teleport-rune");
      rune.rotation.y = -a;
    }
    return g;
  }
  if (id === 82) {
    g.userData.hazard = "annihilation";
    // The sphere of annihilation: a lightless void ringed by a violet horizon.
    cylinder(g, 0x07050a, 0, 0.012, 0, 0.36, 0.012, 12);
    const core = new THREE.Mesh(geometry("annihilation-core", () => new THREE.IcosahedronGeometry(1, 2)), matBasic(0x000000));
    core.name = "annihilation-core";
    core.position.y = 0.44;
    core.scale.setScalar(0.28);
    g.add(core);
    for (const tilt of [0.55, -0.55]) {
      const halo = ring(g, 0x8a4dd6, 0.36, 0.44);
      halo.rotation.x = -Math.PI / 2 + tilt;
      halo.rotation.z = tilt;
    }
    return g;
  }
  // Dealer McDope's wares and the amulet of life preservation.
  if (id === 95) {
    cylinder(g, 0xe9e4d8, 0, 0.14, 0, 0.09, 0.22, 10);
    cylinder(g, 0xc84a3c, 0, 0.27, 0, 0.096, 0.05, 10);
    box(g, 0xf4d35e, 0, 0.14, -0.086, 0.1, 0.09, 0.012);
    for (const [x, z] of [[0.15, 0.05], [0.19, -0.04], [-0.15, 0.08]]) orb(g, 0xf2f0e8, x, 0.025, z, 0.03).scale.y = 0.015;
    return g;
  }
  if (id === 96) {
    const inks = [0xe25a7a, 0xf0c64a, 0x55b4e0, 0x8bd16a];
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++)
      box(g, inks[(x + z * 2) % inks.length], (x - 1) * 0.1, 0.015, (z - 1) * 0.1, 0.092, 0.01, 0.092);
    return g;
  }
  if (id === 97) {
    box(g, 0x4a3320, 0, 0.06, 0, 0.28, 0.1, 0.18);
    box(g, 0xd8d2c0, 0, 0.062, 0, 0.29, 0.106, 0.07);
    return g;
  }
  if (id === 98) {
    for (const [x, z, s] of [[-0.09, 0.03, 1], [0.08, -0.04, 0.8], [0.02, 0.1, 0.65]]) {
      cylinder(g, 0xeee6d2, x, 0.09 * s, z, 0.03 * s, 0.18 * s, 6);
      const cap = orb(g, 0xa8452e, x, 0.19 * s, z, 0.1 * s);
      cap.scale.y = 0.055 * s;
      for (const [dx, dz] of [[0.04, 0], [-0.03, 0.03], [0, -0.04]]) orb(g, 0xf3ecdc, x + dx * s, 0.235 * s, z + dz * s, 0.014 * s);
    }
    return g;
  }
  if (id === 99) {
    cylinder(g, 0xcfe3e8, 0.07, 0.11, 0, 0.05, 0.2, 8, { transparent: true, opacity: 0.55, roughness: 0.1 });
    cylinder(g, 0x2b2a2a, 0.07, 0.225, 0, 0.052, 0.035, 8);
    cone(g, 0xf4f2ee, -0.09, 0.04, 0.03, 0.1, 0.08, 8);
    return g;
  }
  if (id === 101) {
    const gilt = { metalness: 0.7, roughness: 0.3 };
    const chain = ring(g, 0xd4b062, 0.2, 0.03);
    chain.position.z = 0.08;
    cylinder(g, 0xd4b062, 0, 0.04, -0.12, 0.09, 0.04, 10, gilt);
    orb(g, 0xe04a5e, 0, 0.075, -0.12, 0.065, { emissive: 0xc0304a, emissiveIntensity: 0.7, roughness: 0.2 }).scale.y = 0.04;
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
    // A great marble statue: a hero figure in pale stone on a stepped plinth.
    block(g, "stone", 0x8c958a, 0, 0.06, 0, 0.8, 0.12, 0.8);
    block(g, "stone", 0xc3c1b0, 0, 0.21, 0, 0.6, 0.18, 0.6);
    const h = hero();
    h.scale.setScalar(0.95);
    h.position.y = 0.3;
    const marble = mat(0xaeab9f, { roughness: 0.6 });
    const extras = [];
    h.traverse((o) => {
      if (["hero-outline", "contact-disc", "hero-mark"].includes(o.name)) extras.push(o);
      else if (o.isMesh) o.material = marble;
    });
    extras.forEach((o) => o.removeFromParent());
    g.add(h);
    return g;
  }
  if (id === 11) {
    // A gilded standing mirror. A reflective metal plane renders black where
    // there is no environment map, so the glass is a painted, unlit reflection.
    block(g, "wood", 0x6e5a3e, 0, 0.62, 0, 0.6, 1.18, 0.08);
    const gilt = { metalness: 0.7, roughness: 0.32 };
    for (const y of [0.05, 1.19]) box(g, 0xd4b062, 0, y, 0, 0.64, 0.05, 0.1, gilt);
    for (const x of [-0.3, 0.3]) box(g, 0xd4b062, x, 0.62, 0, 0.04, 1.18, 0.1, gilt);
    orb(g, 0xd4b062, 0, 1.25, 0, 0.05, gilt);
    for (const side of [-1, 1]) {
      const glass = new THREE.Mesh(geometry("mirror-glass", () => new THREE.PlaneGeometry(1, 1)), mirrorGlass());
      glass.name = "mirror-glass";
      glass.position.set(0, 0.63, side * 0.042);
      glass.rotation.y = side > 0 ? 0 : Math.PI;
      glass.scale.set(0.48, 1.0, 1);
      g.add(glass);
    }
    for (const x of [-0.24, 0.24]) box(g, 0x5c4a33, x, 0.08, 0, 0.1, 0.16, 0.34);
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
