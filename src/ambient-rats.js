import * as THREE from "three";
import { WALL_FULL } from "./wall-cut.js";

/** Hard cap — fixed pool, never grows with floor size or turns. */
export const AMBIENT_RAT_POOL = 4;
export const AMBIENT_RAT_KIND = "ambient-rat";

const NEAR_SQ = 14 * 14;
const THINK_INTERVAL = 0.22;
const SCURRY_SPEED = 2.4;
const IDLE_MIN = 1.6;
const IDLE_MAX = 5.5;

const dirs = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const hash = (a, b) => {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

const emptyRaycast = () => {};

/**
 * Side-view pixel rat. Snout points right. The camera looks down, so this
 * stands on a billboard instead of a top-down blob.
 * 1 dark back, 2 body, 3 back shade, 4 belly, 5 ear, 6 inner ear,
 * 7 eye, 8 nose, 9 foot, T tail, S tail segment.
 */
const RAT_ROWS = [
  ".TT........................................555...",
  "TTTS....................................55.565...",
  ".TTSTT.................................565.565...",
  "..TSTTT...............111111...........565.555...",
  "....TTTTS.............3333331111111111111111.....",
  ".....TTTSTT...........33333333333333333333331....",
  "......TTSTTTT.........3333333333333333333333771..",
  "........STTTTSTTTTTTTT222222222222222222222272211",
  "..........TTTSTTTTSTTT222222222222222222222222228",
  ".............STTTTSTTT4444444444444444444444444..",
  "...............TTTST..44444444444444444444444....",
  "......................444444449944449944499......",
  "..............................99....99...99......",
];

const RAT_PALETTE = {
  ".": [0, 0, 0, 0],
  1: [0x3e, 0x30, 0x26, 255],
  2: [0x8c, 0x64, 0x44, 255],
  3: [0x5a, 0x42, 0x32, 255],
  4: [0xc8, 0xa2, 0x78, 255],
  5: [0xf2, 0xc0, 0xb2, 255],
  6: [0xdc, 0x8c, 0x80, 255],
  7: [0x12, 0x0e, 0x0c, 255],
  8: [0xe8, 0xa0, 0x92, 255],
  9: [0xee, 0xb2, 0xa2, 255],
  T: [0xf0, 0xc2, 0xb2, 255],
  S: [0xc2, 0x7e, 0x70, 255],
};

const RAT_TEX_W = RAT_ROWS[0].length;
const RAT_TEX_H = RAT_ROWS.length;
/** Small on a wall tile. Wide, because the rat is shown in profile. */
const RAT_W = 0.74;
const RAT_H = RAT_W * (RAT_TEX_H / RAT_TEX_W);

const ratPixels = () => {
  const data = new Uint8Array(RAT_TEX_W * RAT_TEX_H * 4);
  for (let y = 0; y < RAT_TEX_H; y++) {
    // DataTexture keeps the first row at the bottom.
    const row = RAT_ROWS[RAT_TEX_H - 1 - y];
    for (let x = 0; x < RAT_TEX_W; x++) {
      const color = RAT_PALETTE[row[x]];
      const i = (y * RAT_TEX_W + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = color[3];
    }
  }
  return data;
};

const ratTexture = new THREE.DataTexture(ratPixels(), RAT_TEX_W, RAT_TEX_H);
ratTexture.colorSpace = THREE.SRGBColorSpace;
ratTexture.magFilter = THREE.NearestFilter;
ratTexture.minFilter = THREE.NearestFilter;
ratTexture.generateMipmaps = false;
ratTexture.needsUpdate = true;

const ratMaterial = new THREE.MeshBasicMaterial({
  map: ratTexture,
  transparent: true,
  alphaTest: 0.5,
  side: THREE.DoubleSide,
  toneMapped: false,
});

const ratGeometry = new THREE.PlaneGeometry(1, 1);
ratGeometry.userData.shared = true;

const makeRatMesh = () => {
  const group = new THREE.Group();
  group.name = "ambient-rat";
  group.userData = {
    kind: AMBIENT_RAT_KIND,
    ambient: true,
    interactive: false,
    decorative: true,
  };
  const sprite = new THREE.Mesh(ratGeometry, ratMaterial);
  sprite.name = "rat-sprite";
  sprite.scale.set(RAT_W, RAT_H, 1);
  sprite.position.y = RAT_H / 2 + 0.01;
  sprite.castShadow = false;
  sprite.receiveShadow = false;
  sprite.raycast = emptyRaycast;
  group.add(sprite);
  group.raycast = emptyRaycast;
  group.visible = false;
  group.frustumCulled = true;
  return group;
};

/**
 * Tiny non-interactive rats that scurry along dungeon wall tops.
 * Lives outside actors/props so pick/combat/inventory never see them.
 */
export class AmbientRats {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = "ambient-rats";
    this.group.userData = { ambient: true, interactive: false };
    scene.add(this.group);
    this.slots = Array.from({ length: AMBIENT_RAT_POOL }, (_, i) => {
      const mesh = makeRatMesh();
      mesh.userData.slot = i;
      this.group.add(mesh);
      return {
        mesh,
        art: mesh.getObjectByName("rat-sprite"),
        active: false,
        cell: -1,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        progress: 1,
        idle: 0,
        hidden: false,
        hideFor: 0,
        yaw: Math.PI / 2,
      };
    });
    this.wallIndex = new Map();
    this.neighbors = [];
    this.wallCells = [];
    this.wallHeightAt = null;
    this.level = -1;
    this.enabled = false;
    this.thinkAccum = 0;
    this.seed = 1;
    this._camera = null;
    this._scratch = new THREE.Vector3();
  }

  clear() {
    this.wallIndex.clear();
    this.neighbors = [];
    this.wallCells = [];
    this.wallHeightAt = null;
    this.enabled = false;
    for (const slot of this.slots) {
      slot.active = false;
      slot.cell = -1;
      slot.progress = 1;
      slot.hidden = false;
      slot.hideFor = 0;
      slot.mesh.visible = false;
    }
  }

  /** Rebuild adjacency when wall layout changes. Town skips entirely. */
  setLayout(wallCells, level, wallHeightAt) {
    if (level === 0 || !wallCells?.length) {
      this.level = level;
      this.clear();
      return;
    }
    const layoutChanged =
      this.level !== level ||
      this.wallCells.length !== wallCells.length ||
      wallCells.some((t, i) => t.x !== this.wallCells[i]?.x || t.y !== this.wallCells[i]?.y);
    this.level = level;
    this.wallCells = wallCells;
    this.wallHeightAt = wallHeightAt;
    this.enabled = true;
    if (!layoutChanged && this.neighbors.length === wallCells.length) return;

    this.wallIndex.clear();
    for (let i = 0; i < wallCells.length; i++) {
      const t = wallCells[i];
      this.wallIndex.set(`${t.x},${t.y}`, i);
    }
    this.neighbors = wallCells.map((t) => {
      const list = [];
      for (const [dx, dy] of dirs) {
        const j = this.wallIndex.get(`${t.x + dx},${t.y + dy}`);
        if (j != null) list.push(j);
      }
      return list;
    });
    this.seed = (level * 9973 + wallCells.length) | 0;
    this.placeInitial();
  }

  placeInitial() {
    const n = this.wallCells.length;
    if (!n) {
      this.clear();
      return;
    }
    const used = new Set();
    let placed = 0;
    for (let attempt = 0; attempt < AMBIENT_RAT_POOL * 8 && placed < AMBIENT_RAT_POOL; attempt++) {
      const i = Math.floor(hash(this.seed, attempt + 3) * n) % n;
      if (used.has(i) || !this.neighbors[i]?.length) continue;
      used.add(i);
      const slot = this.slots[placed++];
      this.activate(slot, i, hash(this.seed, i) * IDLE_MAX);
    }
    for (let i = placed; i < AMBIENT_RAT_POOL; i++) {
      const slot = this.slots[i];
      slot.active = false;
      slot.mesh.visible = false;
    }
  }

  activate(slot, cell, idle = IDLE_MIN) {
    slot.active = true;
    slot.cell = cell;
    slot.progress = 1;
    slot.idle = idle;
    slot.hidden = false;
    slot.hideFor = 0;
    slot.yaw = Math.PI / 2;
    this.heightAt(cell, slot.from);
    slot.to.copy(slot.from);
    slot.mesh.position.copy(slot.from);
    slot.mesh.rotation.y = 0;
    slot.mesh.visible = true;
    this.face(slot);
  }

  /** Billboard the side-view sprite toward the camera and mirror it with travel. */
  face(slot) {
    const art = slot.art;
    if (!art) return;
    const fx = Math.sin(slot.yaw);
    const fz = Math.cos(slot.yaw);
    let sign = fx < -0.05 ? -1 : 1;
    const camera = this._camera;
    if (camera) {
      art.quaternion.copy(camera.quaternion);
      const right = camera.matrixWorld.elements;
      const side = fx * right[0] + fz * right[2];
      if (Math.abs(side) > 0.05) sign = side < 0 ? -1 : 1;
    }
    art.scale.set(sign * RAT_W, RAT_H, 1);
  }

  heightAt(cell, out) {
    const t = this.wallCells[cell];
    const h = this.wallHeightAt?.[cell] ?? WALL_FULL;
    out.set(t.x, h + 0.055, t.y);
    return out;
  }

  nearCamera(slot, cam) {
    if (!cam) return true;
    return slot.mesh.position.distanceToSquared(cam) < NEAR_SQ;
  }

  pickNeighbor(cell, avoid = -1) {
    const opts = this.neighbors[cell] || [];
    if (!opts.length) return -1;
    const filtered = opts.filter((j) => j !== avoid);
    const pool = filtered.length ? filtered : opts;
    return pool[Math.floor(hash(this.seed + cell, this.thinkAccum * 10 + pool.length) * pool.length) % pool.length];
  }

  /** Returns true while any near-camera rat is mid-scurry (keeps rAF alive briefly). */
  update(dt, cameraOrPos) {
    if (!this.enabled) return false;
    this._camera = cameraOrPos?.isCamera ? cameraOrPos : null;
    const cameraPos = this._camera ? this._camera.position : cameraOrPos;
    let scurryingNear = false;
    this.thinkAccum += dt;
    const think = this.thinkAccum >= THINK_INTERVAL;
    if (think) this.thinkAccum = 0;

    for (const slot of this.slots) {
      if (!slot.active) continue;
      if (slot.mesh.visible) this.face(slot);
      const near = this.nearCamera(slot, cameraPos);

      if (slot.hidden) {
        slot.hideFor -= dt;
        if (slot.hideFor <= 0 && think) {
          const n = this.wallCells.length;
          if (!n) continue;
          let cell = Math.floor(hash(this.seed, slot.mesh.userData.slot + this.thinkAccum) * n) % n;
          if (!this.neighbors[cell]?.length) cell = this.neighbors.findIndex((list) => list.length);
          if (cell < 0) continue;
          this.activate(slot, cell, IDLE_MIN + hash(cell, 9) * 2);
        }
        continue;
      }

      if (slot.progress < 1) {
        slot.progress = Math.min(1, slot.progress + dt * SCURRY_SPEED);
        const t = slot.progress * slot.progress * (3 - 2 * slot.progress);
        slot.mesh.position.lerpVectors(slot.from, slot.to, t);
        // Tiny bob while scurrying — quiet, not cartoon bounce.
        slot.mesh.position.y += Math.sin(slot.progress * Math.PI) * 0.012;
        if (near) scurryingNear = true;
        if (slot.progress >= 1) {
          slot.mesh.position.copy(slot.to);
          slot.idle = IDLE_MIN + hash(slot.cell, 4) * (IDLE_MAX - IDLE_MIN);
        }
        continue;
      }

      // Resting: snap Y to current wall height (cutaway) without waking idle frames.
      this.heightAt(slot.cell, this._scratch);
      slot.mesh.position.y = this._scratch.y;

      if (!think || !near) continue;

      slot.idle -= THINK_INTERVAL;
      if (slot.idle > 0) continue;

      // Sparse disappear / reappear (~8% of thinks when idle expires).
      if (hash(slot.cell, this.seed + Math.floor(slot.idle * 100)) < 0.08) {
        slot.hidden = true;
        slot.hideFor = 2.5 + hash(slot.cell, 7) * 4;
        slot.mesh.visible = false;
        continue;
      }

      const next = this.pickNeighbor(slot.cell, slot.cell);
      if (next < 0) {
        slot.idle = IDLE_MIN;
        continue;
      }
      slot.from.copy(slot.mesh.position);
      this.heightAt(next, slot.to);
      const dx = slot.to.x - slot.from.x;
      const dz = slot.to.z - slot.from.z;
      slot.yaw = Math.atan2(dx, dz);
      slot.cell = next;
      slot.progress = 0;
      if (near) scurryingNear = true;
    }
    return scurryingNear;
  }

  snapshot() {
    return {
      pool: AMBIENT_RAT_POOL,
      enabled: this.enabled,
      interactive: false,
      decorative: true,
      kind: AMBIENT_RAT_KIND,
      count: this.slots.filter((s) => s.active && !s.hidden).length,
      rats: this.slots
        .filter((s) => s.active)
        .map((s) => ({
          slot: s.mesh.userData.slot,
          visible: s.mesh.visible,
          hidden: s.hidden,
          interactive: false,
          decorative: true,
          kind: AMBIENT_RAT_KIND,
          cell: s.cell,
          position: { x: s.mesh.position.x, y: s.mesh.position.y, z: s.mesh.position.z },
          scurrying: s.progress < 1,
        })),
    };
  }

  dispose() {
    // Sprite geometry, material, and texture are shared by the pool.
    for (const slot of this.slots) slot.mesh.removeFromParent();
    this.group.removeFromParent();
    this.clear();
  }
}
