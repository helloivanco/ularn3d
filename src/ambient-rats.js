import * as THREE from "three";
import { WALL_FULL } from "./wall-cut.js";

/** Hard cap — fixed pool, never grows with floor size or turns. */
export const AMBIENT_RAT_POOL = 4;
export const AMBIENT_RAT_KIND = "ambient-rat";

const BODY = 0xc48448;
const EAR = 0xe7b0a0;
const TAIL = 0xc48448;
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

/** Flat plan-view rat. Shape +Y becomes world +Z, the direction it scurries. */
const layFlat = (group, name, color, shape, y) => {
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 12),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
  );
  mesh.name = name;
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = y;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = emptyRaycast;
  group.add(mesh);
  return mesh;
};

const earShape = (x) => {
  const shape = new THREE.Shape();
  shape.absellipse(x, 0.11, 0.038, 0.026, 0, Math.PI * 2, false, 0);
  return shape;
};

/** Ribbon along a quadratic curve, wide at the rump and thin at the tip. */
const tailShape = () => {
  const start = [0, -0.1];
  const control = [0.16, -0.22];
  const end = [0.02, -0.32];
  const samples = 8;
  const center = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    center.push([
      u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
      u * u * start[1] + 2 * u * t * control[1] + t * t * end[1],
    ]);
  }
  const left = [];
  const right = [];
  for (let i = 0; i < center.length; i++) {
    const prev = center[Math.max(0, i - 1)];
    const next = center[Math.min(center.length - 1, i + 1)];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const width = 0.028 * (1 - i / (center.length - 1)) + 0.007;
    left.push([center[i][0] - ty * width, center[i][1] + tx * width]);
    right.push([center[i][0] + ty * width, center[i][1] - tx * width]);
  }
  const shape = new THREE.Shape();
  shape.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) shape.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) shape.lineTo(right[i][0], right[i][1]);
  shape.closePath();
  return shape;
};

const makeRatMesh = () => {
  const group = new THREE.Group();
  group.name = "ambient-rat";
  group.userData = {
    kind: AMBIENT_RAT_KIND,
    ambient: true,
    interactive: false,
    decorative: true,
  };
  // Haunches wide, shoulders narrow. The snout is a separate point in front.
  const body = new THREE.Shape();
  body.moveTo(-0.03, 0.04);
  body.quadraticCurveTo(-0.07, -0.04, -0.14, -0.1);
  body.quadraticCurveTo(-0.09, -0.2, 0, -0.18);
  body.quadraticCurveTo(0.09, -0.2, 0.14, -0.1);
  body.quadraticCurveTo(0.07, -0.04, 0.03, 0.04);
  body.closePath();
  const head = new THREE.Shape();
  head.moveTo(0, 0.18);
  head.quadraticCurveTo(-0.01, 0.12, -0.032, 0.02);
  head.lineTo(0.032, 0.02);
  head.quadraticCurveTo(0.01, 0.12, 0, 0.18);
  layFlat(group, "rat-body", BODY, body, 0.046);
  layFlat(group, "rat-head", BODY, head, 0.05);
  layFlat(group, "rat-ear", EAR, earShape(-0.055), 0.054);
  layFlat(group, "rat-ear", EAR, earShape(0.055), 0.054);
  layFlat(group, "rat-tail", TAIL, tailShape(), 0.048);
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
    slot.mesh.visible = true;
    slot.mesh.rotation.y = slot.yaw;
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
  update(dt, cameraPos) {
    if (!this.enabled) return false;
    let scurryingNear = false;
    this.thinkAccum += dt;
    const think = this.thinkAccum >= THINK_INTERVAL;
    if (think) this.thinkAccum = 0;

    for (const slot of this.slots) {
      if (!slot.active) continue;
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
      slot.mesh.rotation.y = slot.yaw;
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
    for (const slot of this.slots) {
      slot.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      slot.mesh.removeFromParent();
    }
    this.group.removeFromParent();
    this.clear();
  }
}
