import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { noise } from "./materials.js";
import { WALL_BASE_Y, WALL_FULL } from "./wall-cut.js";
import { CandleFlames, candleSpots } from "./candle-flames.js";

/*
 * Cave set dressing from the KayKit Dungeon pack (CC0, Kay Lousberg): props in
 * corners and dead ends, torches on walls, and in Cinematic a soft shade where
 * floor meets wall. Purely visual: nothing here is picked, collides, or knows
 * about items or creatures, and placement is a pure function of the known
 * walls so a floor dresses the same way every visit.
 */
const MODELS = "/models/props/";
/* Scale from pack units to tiles, and how far the base sits off the floor. */
export const PROPS = Object.freeze({
  barrel_small: { scale: 0.32 },
  barrel_large: { scale: 0.29 },
  crates_stacked: { scale: 0.25 },
  keg: { scale: 0.26 },
  candle_triple: { scale: 0.45 },
  rubble_half: { scale: 0.14 },
  table_medium_broken: { scale: 0.26 },
  torch_mounted: { scale: 0.62, mounted: true },
  chest: { scale: 0.36 },
});
/* Nothing that could pass for loot: no bottles, small boxes or trunks. */
const CORNER = ["barrel_small", "barrel_large", "crates_stacked", "keg", "candle_triple"];
const DEAD_END = ["rubble_half", "crates_stacked", "table_medium_broken", "barrel_large"];
const ALONG = ["candle_triple"];
const SHOP = ["barrel_small", "barrel_large", "crates_stacked", "keg"];
/* South first: the default camera looks north, so south faces are the ones in view. */
const SIDES = [[0, 1], [1, 0], [-1, 0], [0, -1]];
const TORCH_Y = 0.58;
/** How far into the room a torch's light sits from the wall face. */
const TORCH_REACH = 0.4;
const SHADE_DEPTH = 0.4;

const loader = new GLTFLoader();
const pieces = new Map();
let sharedMaterial = null;
/** Every prop is merged into one geometry in tile units, base on the floor. */
function loadProp(name) {
  if (!pieces.has(name)) {
    pieces.set(name, loader.loadAsync(`${MODELS}${name}.glb`).then((gltf) => {
      const parts = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((object) => {
        if (!object.isMesh) return;
        if (!sharedMaterial) { sharedMaterial = object.material; sharedMaterial.roughness = 0.85; }
        const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
        for (const key of Object.keys(geometry.attributes)) if (!["position", "normal", "uv"].includes(key)) geometry.deleteAttribute(key);
        parts.push(geometry);
      });
      const geometry = mergeGeometries(parts, false);
      const spec = PROPS[name];
      geometry.scale(spec.scale, spec.scale, spec.scale);
      geometry.computeBoundingBox();
      if (!spec.mounted) geometry.translate(0, -geometry.boundingBox.min.y, 0);
      geometry.computeBoundingBox();
      geometry.userData.shared = true;
      return geometry;
    }));
  }
  return pieces.get(name);
}
/** Start fetching every prop; resolves once all are ready. */
let chestGeometry = null;
loadProp("chest").then((geometry) => { chestGeometry = geometry; }).catch(() => {});
/** The pack chest once it has loaded, or null so the caller keeps its own. */
export function chestModel() {
  if (!chestGeometry || !sharedMaterial) return null;
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(chestGeometry, sharedMaterial);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

const pick = (list, roll) => list[Math.min(list.length - 1, Math.floor(roll * list.length))];

/**
 * Where props go on a floor. Corners and dead ends get furniture pushed
 * against their walls; straight runs only rarely get a small piece, and
 * corridors stay clear. Torches go on the walls the lamps already use.
 */
export function dressingPlan(tiles, level) {
  const plan = { props: [], torches: [], shade: [] };
  if (!level) return plan;
  const walls = new Set(), floors = new Set();
  for (const t of tiles) (t.wall ? walls : floors).add(`${t.x},${t.y}`);
  const isWall = (x, y) => walls.has(`${x},${y}`), isFloor = (x, y) => floors.has(`${x},${y}`);
  // Walls are counted in tile order, the order the world keeps their heights in.
  let wall = -1;
  const lit = new Set();
  for (const t of tiles) {
    if (!t.wall) continue;
    wall++;
    // A share of the lamp walls, so a torch still marks a place.
    if (noise(t.x, t.y) <= 0.87 || noise(t.x + 9, t.y + 2) > 0.6) continue;
    const side = SIDES.find(([dx, dz]) => isFloor(t.x + dx, t.y + dz));
    if (!side) continue;
    plan.torches.push({ x: t.x + side[0] * 0.5, z: t.y + side[1] * 0.5, angle: Math.atan2(side[0], side[1]), wall });
    lit.add(`${t.x + side[0]},${t.y + side[1]}`);
  }
  for (const t of tiles) {
    if (t.wall) continue;
    const sides = SIDES.filter(([dx, dz]) => isWall(t.x + dx, t.y + dz));
    for (const [dx, dz] of sides) plan.shade.push({ x: t.x + dx * (0.5 - SHADE_DEPTH / 2), z: t.y + dz * (0.5 - SHADE_DEPTH / 2), angle: Math.atan2(dx, dz) });
    // Furniture under a torch would look skewered by it.
    if (t.id !== 0 || lit.has(`${t.x},${t.y}`)) continue;
    const roll = noise(t.x + 31, t.y + 7), choice = noise(t.x + 5, t.y + 43), turn = noise(t.x + 11, t.y + 3);
    if (sides.length === 3 && roll < 0.55) {
      const [ox, oz] = SIDES.find(([dx, dz]) => !isWall(t.x + dx, t.y + dz));
      plan.props.push({ kind: pick(DEAD_END, choice), x: t.x - ox * 0.24, z: t.y - oz * 0.24, angle: Math.atan2(ox, oz) });
    } else if (sides.length === 2 && sides[0][0] !== -sides[1][0] && roll < 0.3) {
      const cx = sides[0][0] + sides[1][0], cz = sides[0][1] + sides[1][1];
      plan.props.push({ kind: pick(CORNER, choice), x: t.x + cx * 0.27, z: t.y + cz * 0.27, angle: turn * Math.PI * 2 });
    } else if (sides.length === 1 && roll < 0.05) {
      const [dx, dz] = sides[0];
      plan.props.push({ kind: pick(ALONG, choice), x: t.x + dx * 0.33 + (turn - 0.5) * 0.3 * dz, z: t.y + dz * 0.33 + (turn - 0.5) * 0.3 * dx, angle: turn * Math.PI * 2 });
    }
  }
  return plan;
}

/**
 * The town: barrels and crates beside shop fronts, lamp posts along the paths,
 * and grass tufts, wildflowers, stones and bushes on the lawns. Nothing stands
 * on a path or within a tile of a building, and nothing is taller than a
 * lamp post, so the hero is never hidden.
 */
export function townPlan(tiles, paths) {
  // `meadow` is the extra grass Cinematic grows, in patches, on the same lawns.
  const plan = { props: [], decor: [], posts: [], meadow: [] };
  const stores = tiles.filter((t) => t.store);
  const isPath = (x, y) => paths.has(`${x},${y}`);
  const nearStore = (x, y) => stores.some((s) => Math.abs(s.x - x) <= 1 && Math.abs(s.y - y) <= 1);
  for (const s of stores) {
    // The cave and volcano mouths and the home keep their own dressing.
    if ([54, 55, 56, 69].includes(s.id)) continue;
    for (const side of [-1, 1]) {
      if (noise(s.x + side * 3, s.y + 17) < 0.4) continue;
      plan.props.push({ kind: pick(SHOP, noise(s.x + side, s.y + 29)), x: s.x + side * 0.9, z: s.y + 0.8, angle: noise(s.x, s.y + side) * Math.PI * 2 });
    }
  }
  for (const t of tiles) {
    if (t.wall || t.store || t.id !== 0 || isPath(t.x, t.y) || nearStore(t.x, t.y)) continue;
    const pathSide = SIDES.find(([dx, dz]) => isPath(t.x + dx, t.y + dz));
    const a = noise(t.x + 61, t.y + 13), b = noise(t.x + 7, t.y + 77), c = noise(t.x + 19, t.y + 5);
    const lush = noise(Math.floor(t.x / 3) + 41, Math.floor(t.y / 3) + 23) * 0.6 + noise(t.x + 3, t.y + 91) * 0.4;
    for (let i = 0; i < Math.round(lush * 7); i++) {
      const x = t.x + (noise(t.x + i * 7, t.y + 101) - 0.5) * 0.92, z = t.y + (noise(t.x + 103, t.y + i * 5) - 0.5) * 0.92;
      plan.meadow.push({ kind: "tuft", x, z, angle: noise(x * 5, z * 7) * Math.PI * 2, size: 1 + noise(z * 3, x * 9) * 0.7, tint: noise(x * 11, z) });
    }
    if (pathSide && a < 0.2 && !plan.posts.some((post) => Math.abs(post.tx - t.x) + Math.abs(post.ty - t.y) < 6)) {
      const [dx, dz] = pathSide;
      plan.posts.push({ tx: t.x, ty: t.y, x: t.x + dx * 0.4, z: t.y + dz * 0.4, angle: Math.atan2(dx, dz),
        lamp: { x: t.x + dx * 0.67, y: 0.97, z: t.y + dz * 0.67 } });
      continue;
    }
    const scatter = (i, salt) => [t.x + (noise(t.x + i, t.y + salt) - 0.5) * 0.84, t.y + (noise(t.x + salt, t.y + i) - 0.5) * 0.84];
    if (a < 0.55) for (let i = 0; i < 1 + Math.floor(b * 3); i++) {
      const [x, z] = scatter(i, 31);
      plan.decor.push({ kind: "tuft", x, z, angle: noise(x * 7, z * 3) * Math.PI * 2, size: 0.8 + noise(z * 5, x) * 0.6, tint: noise(x, z * 9) });
    }
    if (c < 0.08) for (let i = 0; i < 3 + Math.floor(b * 3); i++) {
      const [x, z] = scatter(i + 4, 53);
      plan.decor.push({ kind: "flower", x, z, angle: 0, size: 0.8 + noise(x * 3, z) * 0.5, tint: noise(t.x + 3, t.y + 3) });
    } else if (c > 0.955) plan.decor.push({ kind: "stone", x: t.x + (b - 0.5) * 0.5, z: t.y + (a - 0.5) * 0.5, angle: b * 6.3, size: 0.7 + a * 0.7, tint: b });
    else if (c > 0.91 && !pathSide) plan.decor.push({ kind: "bush", x: t.x + (b - 0.5) * 0.4, z: t.y + (a - 0.5) * 0.4, angle: a * 6.3, size: 0.8 + b * 0.5, tint: a });
  }
  return plan;
}

/* Low-poly lawn pieces in tile units, base on the ground. */
const merge = (parts) => mergeGeometries(parts.map((part) => (part.index ? part.toNonIndexed() : part)));
const DECOR = {
  tuft: { color: [0x6f8f4a, 0x86a35a], shadow: false, sway: 2, build: () => merge([-1, 0, 1, 2].map((i) =>
    new THREE.ConeGeometry(0.022, 0.15 + (i % 2) * 0.05, 3).rotateZ(i * 0.22 - 0.2).translate(i * 0.03 - 0.02, 0.08, (i % 2) * 0.03 - 0.015))) },
  flower: { color: [0xf2d36b, 0xf4efe2, 0xb79ad8, 0xe0796a], shadow: false, sway: 3, build: () => merge([
    new THREE.CylinderGeometry(0.006, 0.006, 0.09, 3).translate(0, 0.045, 0),
    new THREE.IcosahedronGeometry(0.028, 0).translate(0, 0.095, 0)]) },
  stone: { color: [0x8d8f86, 0xa29f92], shadow: true, build: () => new THREE.IcosahedronGeometry(0.11, 0).scale(1, 0.55, 0.85).translate(0, 0.04, 0) },
  bush: { color: [0x4f6e3c, 0x5f7f44], shadow: true, sway: 0.25, build: () => merge([
    new THREE.IcosahedronGeometry(0.17, 0).translate(0, 0.14, 0),
    new THREE.IcosahedronGeometry(0.13, 0).translate(0.14, 0.1, 0.03),
    new THREE.IcosahedronGeometry(0.12, 0).translate(-0.12, 0.09, -0.04)]) },
  post: { color: [0x3d3a35, 0x3d3a35], shadow: true, build: () => merge([
    new THREE.BoxGeometry(0.06, 1.12, 0.06).translate(0, 0.56, 0),
    new THREE.BoxGeometry(0.035, 0.035, 0.3).translate(0, 1.08, 0.13),
    new THREE.BoxGeometry(0.12, 0.04, 0.12).translate(0, 0.02, 0)]) },
  lantern: { color: [0xffd27a, 0xffd27a], shadow: false, unlit: true, build: () => new THREE.BoxGeometry(0.1, 0.13, 0.1).translate(0, 0.97, 0.27) },
};
const decorGeometries = new Map();
const decorGeometry = (kind) => {
  if (!decorGeometries.has(kind)) {
    const geometry = DECOR[kind].build();
    for (const key of Object.keys(geometry.attributes)) if (!["position", "normal"].includes(key)) geometry.deleteAttribute(key);
    geometry.userData.shared = true;
    decorGeometries.set(kind, geometry);
  }
  return decorGeometries.get(kind);
};

/*
 * A breeze over the lawns: slow gusts roll across the town and a quicker
 * ripple runs through them. Each piece bends from its base, more toward its
 * tip, along one world direction, so neighbouring tufts lean together.
 */
const BREEZE = Object.freeze({ x: 0.8, z: 0.6 });
const swayShader = (shader, uniforms) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = "uniform float windTime;\nuniform float windStrength;\n" + shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float gust = 0.55 + 0.45 * sin(windTime * 0.9 + root.x * 0.21 + root.z * 0.13);
  float ripple = sin(windTime * 2.6 + root.x * 1.3 + root.z * 0.7) * 0.5 + sin(windTime * 4.1 + root.x * 0.6 - root.z * 1.4) * 0.25;
  float lean = windStrength * max(position.y, 0.0) * max(position.y, 0.0) * (gust * 1.4 + ripple * 0.6);
  mat3 basis = mat3(instanceMatrix);
  // World bend back into the piece's own turned, scaled frame.
  transformed += transpose(basis) * (vec3(${BREEZE.x.toFixed(2)}, 0.0, ${BREEZE.z.toFixed(2)}) * lean) / dot(basis[0], basis[0]);
#endif`);
};
function swayMaterial(windTime, strength) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
  const windStrength = { value: strength };
  // Each kind bends by its own strength; the compiled program is shared.
  material.onBeforeCompile = (shader) => swayShader(shader, { windTime, windStrength });
  return material;
}

function shadeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 4; canvas.height = 64;
  const context = canvas.getContext("2d"), gradient = context.createLinearGradient(0, 0, 0, 64);
  // Eased so a one-tile corridor darkens at its edges without banding.
  for (let i = 0; i <= 8; i++) gradient.addColorStop(i / 8, `rgba(255,255,255,${((1 - i / 8) ** 2.2).toFixed(3)})`);
  context.fillStyle = gradient; context.fillRect(0, 0, 4, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}
function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d"), gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,226,160,1)");
  gradient.addColorStop(0.35, "rgba(255,170,80,0.55)");
  gradient.addColorStop(1, "rgba(255,120,40,0)");
  context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class SetDressing {
  constructor(scene, invalidate) {
    this.scene = scene; this.invalidate = invalidate;
    this.group = new THREE.Group();
    this.group.name = "set-dressing";
    scene.add(this.group);
    this.meshes = new Map();
    this.plan = dressingPlan([], 0);
    this.cinematic = false; this.revision = 0;
    this.flamePoints = []; this.flameShown = []; this.flameRev = 0;
    this.town = townPlan([], new Set());
    this.decor = new Map();
    this.decorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
    this.windTime = { value: 0 };
    this.swayMaterials = new Map(Object.entries(DECOR).filter(([, spec]) => spec.sway).map(([kind, spec]) => [kind, swayMaterial(this.windTime, spec.sway)]));
    this.lanternMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.tint = new THREE.Color();
    const shadeGeometry = new THREE.PlaneGeometry(1, SHADE_DEPTH).rotateX(-Math.PI / 2);
    this.shade = new THREE.InstancedMesh(shadeGeometry, new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: shadeTexture(), transparent: true, opacity: 0.42, depthWrite: false,
    }), 1);
    this.shade.name = "wall-shade";
    this.shade.count = 0; this.shade.renderOrder = 1; this.shade.frustumCulled = false;
    this.group.add(this.shade);
    this.glow = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
      map: glowTexture(), size: 0.55, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.glow.name = "torch-glow";
    this.glow.frustumCulled = false;
    this.group.add(this.glow);
    this.candles = new CandleFlames(this.group, this.glow.material.map);
    this.candlePoints = []; this.candleRev = 0;
    this.matrix = new THREE.Matrix4(); this.quaternion = new THREE.Quaternion();
    this.position = new THREE.Vector3(); this.scale = new THREE.Vector3(1, 1, 1);
    this.up = new THREE.Vector3(0, 1, 0);
  }
  /** Re-plan after the known walls change. Props appear once their files load. */
  layout(tiles, level, paths = new Set()) {
    this.plan = dressingPlan(tiles, level);
    this.town = level ? townPlan([], paths) : townPlan(tiles, paths);
    const revision = ++this.revision;
    // Candles burn once their models stand (build), never ahead of them.
    if (this.candles.count) this.lightCandles([], []);
    const kinds = new Set([...this.plan.props, ...this.town.props].map((p) => p.kind));
    if (this.plan.torches.length) kinds.add("torch_mounted");
    Promise.all([...kinds].map((kind) => loadProp(kind).then((geometry) => [kind, geometry])))
      .then((loaded) => { if (revision === this.revision) this.build(new Map(loaded)); })
      .catch((error) => console.warn("Set dressing unavailable.", error));
    this.buildShade();
    this.buildGlow();
    this.buildDecor();
  }
  /** Lawn pieces and lamp posts are procedural, so they appear at once. */
  buildDecor() {
    const groups = new Map(Object.keys(DECOR).map((kind) => [kind, []]));
    for (const piece of this.town.decor) groups.get(piece.kind).push(piece);
    if (this.cinematic) groups.get("tuft").push(...this.town.meadow);
    for (const post of this.town.posts) {
      groups.get("post").push({ ...post, size: 1, tint: 0 });
      groups.get("lantern").push({ ...post, size: 1, tint: 0 });
    }
    for (const [kind, pieces] of groups) {
      const spec = DECOR[kind];
      let mesh = this.decor.get(kind);
      if (mesh && mesh.instanceMatrix.count < pieces.length) { mesh.removeFromParent(); mesh.dispose(); mesh = null; }
      if (!mesh && pieces.length) {
        mesh = new THREE.InstancedMesh(decorGeometry(kind), spec.unlit ? this.lanternMaterial : this.swayMaterials.get(kind) || this.decorMaterial, pieces.length + 32);
        mesh.name = `decor-${kind}`;
        mesh.frustumCulled = false;
        this.decor.set(kind, mesh);
        this.group.add(mesh);
      }
      if (!mesh) continue;
      mesh.castShadow = spec.shadow && this.cinematic;
      mesh.receiveShadow = !spec.unlit && this.cinematic;
      pieces.forEach((piece, i) => {
        this.position.set(piece.x, WALL_BASE_Y, piece.z);
        this.quaternion.setFromAxisAngle(this.up, piece.angle);
        this.scale.setScalar(piece.size);
        mesh.setMatrixAt(i, this.matrix.compose(this.position, this.quaternion, this.scale));
        const colors = spec.color;
        this.tint.setHex(colors[Math.min(colors.length - 1, Math.floor(piece.tint * colors.length))]);
        mesh.setColorAt(i, this.tint);
      });
      mesh.count = pieces.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  instances(kind, geometry, count) {
    let mesh = this.meshes.get(kind);
    if (mesh && mesh.instanceMatrix.count < count) { mesh.removeFromParent(); mesh.dispose(); mesh = null; }
    if (!mesh) {
      mesh = new THREE.InstancedMesh(geometry, sharedMaterial, Math.max(16, count));
      mesh.name = `prop-${kind}`;
      mesh.frustumCulled = false;
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
    }
    mesh.castShadow = mesh.receiveShadow = this.cinematic;
    mesh.count = count;
    return mesh;
  }
  place(mesh, index, x, y, z, angle, visible = true) {
    this.position.set(x, y, z);
    this.quaternion.setFromAxisAngle(this.up, angle);
    this.scale.setScalar(visible ? 1 : 0);
    mesh.setMatrixAt(index, this.matrix.compose(this.position, this.quaternion, this.scale));
  }
  build(geometries) {
    const groups = new Map();
    for (const prop of [...this.plan.props, ...this.town.props]) (groups.get(prop.kind) || groups.set(prop.kind, []).get(prop.kind)).push(prop);
    for (const [kind, mesh] of this.meshes) if (!groups.has(kind) && kind !== "torch_mounted") mesh.count = 0;
    for (const [kind, props] of groups) {
      const mesh = this.instances(kind, geometries.get(kind), props.length);
      props.forEach((prop, i) => this.place(mesh, i, prop.x, WALL_BASE_Y, prop.z, prop.angle));
      mesh.instanceMatrix.needsUpdate = true;
    }
    const { flames, lights } = candleSpots(this.plan.props, PROPS.candle_triple.scale, WALL_BASE_Y);
    this.lightCandles(flames, lights);
    if (geometries.has("torch_mounted")) {
      this.instances("torch_mounted", geometries.get("torch_mounted"), this.plan.torches.length);
      this.wallHeights(this.heights);
    } else if (this.meshes.has("torch_mounted")) this.meshes.get("torch_mounted").count = 0;
    this.invalidate();
  }
  buildShade() {
    const spots = this.cinematic ? this.plan.shade : [];
    if (this.shade.instanceMatrix.count < spots.length) {
      const next = new THREE.InstancedMesh(this.shade.geometry, this.shade.material, spots.length + 64);
      Object.assign(next, { name: this.shade.name, renderOrder: 1, frustumCulled: false });
      this.shade.removeFromParent(); this.shade.dispose();
      this.shade = next; this.group.add(next);
    }
    // The alpha ramp starts at the wall edge of each strip.
    spots.forEach((spot, i) => this.place(this.shade, i, spot.x, WALL_BASE_Y + 0.003, spot.z, spot.angle + Math.PI));
    this.shade.count = spots.length;
    this.shade.instanceMatrix.needsUpdate = true;
  }
  buildGlow() {
    const flames = this.plan.torches.map((torch) => [
      torch.x + Math.sin(torch.angle) * 0.13, TORCH_Y + 0.26, torch.z + Math.cos(torch.angle) * 0.13,
    ]);
    // Town lanterns glow too, after the torches so torch indices stay put.
    const lanterns = this.town.posts.map(({ lamp }) => [lamp.x, lamp.y, lamp.z]);
    this.glow.geometry.setAttribute("position", new THREE.Float32BufferAttribute([...flames, ...lanterns].flat(), 3));
    this.glow.geometry.computeBoundingSphere();
    this.flameShown = flames.map(() => true);
    // Each torch's light hangs a little out from its flame, so the wall beside
    // it is lit without a white-hot spot on the bracket.
    this.flamePoints = this.plan.torches.map((torch) => new THREE.Vector3(
      torch.x + Math.sin(torch.angle) * TORCH_REACH, TORCH_Y + 0.3, torch.z + Math.cos(torch.angle) * TORCH_REACH,
    ));
    this.flameRev = (this.flameRev || 0) + 1;
  }
  /** Lit flames, for the torch lights. `flameRev` changes whenever this list does. */
  flames() {
    return this.flamePoints.filter((_, i) => this.flameShown[i]);
  }
  lightCandles(flames, lights) {
    this.candles.set(flames, lights);
    this.candlePoints = lights.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.candleRev++;
  }
  /** Burning candles, one light point each, for the candle lights. `candleRev` changes with it. */
  candleLights() {
    return this.candlePoints;
  }
  /** Torches stand only on full-height walls; a cutaway column hides its torch. */
  wallHeights(heights) {
    this.heights = heights;
    const mesh = this.meshes.get("torch_mounted");
    const glow = this.glow.geometry.getAttribute("position");
    this.plan.torches.forEach((torch, i) => {
      const shown = !heights || (heights[torch.wall] ?? WALL_FULL) >= WALL_FULL - 0.001;
      if (mesh && i < mesh.count) this.place(mesh, i, torch.x, TORCH_Y, torch.z, torch.angle, shown);
      if (glow && this.flameShown[i] !== shown) {
        this.flameShown[i] = shown;
        this.flameRev++;
        glow.setY(i, shown ? TORCH_Y + 0.26 : -10);
        glow.needsUpdate = true;
      }
    });
    if (mesh) mesh.instanceMatrix.needsUpdate = true;
  }
  setCinematic(cinematic) {
    if (this.cinematic === cinematic) return;
    this.cinematic = cinematic;
    // Bloom already spreads the flame; at full strength it burned white.
    this.glow.material.opacity = cinematic ? 0.5 : 1;
    for (const mesh of this.meshes.values()) mesh.castShadow = mesh.receiveShadow = cinematic;
    for (const [kind, mesh] of this.decor) { mesh.castShadow = DECOR[kind].shadow && cinematic; mesh.receiveShadow = !DECOR[kind].unlit && cinematic; }
    this.candles.setCinematic(cinematic);
    this.buildShade();
    this.buildDecor();
  }
  /**
   * Candle flames flicker and, in Cinematic, torches breathe and the lawns
   * sway. Reduced motion holds them all still. Returns true while something
   * on this floor keeps moving, so the world keeps drawing it smoothly.
   */
  update(now, still = false) {
    if (still) return false;
    const burning = this.candles.update(now / 1000);
    if (!this.cinematic) return burning;
    this.windTime.value = now / 1000;
    this.glow.material.size = 0.55 + Math.sin(now * 0.011) * 0.04 + Math.sin(now * 0.027) * 0.03;
    return burning || this.town.decor.length > 0 || this.plan.torches.length > 0 || this.town.posts.length > 0;
  }
  snapshot() {
    return {
      props: this.plan.props.map(({ kind, x, z }) => ({ kind, x, z })),
      torches: this.plan.torches.map(({ x, z }, i) => ({ x, z, shown: this.flameShown?.[i] ?? true })),
      shade: this.shade.count,
    };
  }
  metrics() {
    let props = 0;
    for (const [kind, mesh] of this.meshes) if (kind !== "torch_mounted") props += mesh.count;
    return { dressingProps: props, dressingTorches: this.plan.torches.length, wallShade: this.shade.count,
      townDecor: this.town.decor.length, townLampPosts: this.town.posts.length,
      candleFlames: this.candles.count, meadowTufts: this.cinematic ? this.town.meadow.length : 0 };
  }
  dispose() {
    for (const mesh of this.meshes.values()) mesh.dispose();
    for (const mesh of this.decor.values()) mesh.dispose();
    this.decorMaterial.dispose(); this.lanternMaterial.dispose();
    for (const material of this.swayMaterials.values()) material.dispose();
    this.candles.dispose();
    this.shade.dispose(); this.shade.geometry.dispose(); this.shade.material.alphaMap.dispose(); this.shade.material.dispose();
    this.glow.geometry.dispose(); this.glow.material.map.dispose(); this.glow.material.dispose();
    this.group.removeFromParent();
  }
}
