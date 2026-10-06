import * as THREE from "three";
import { WALL_FULL } from "./wall-cut.js";

/** Hard cap — a normal overhead view shows one or two, never a row of copies. */
export const AMBIENT_RAT_POOL = 2;
export const AMBIENT_RAT_KIND = "ambient-rat";
/** Chebyshev tiles. Keeps the pair off the same wall run. */
export const AMBIENT_RAT_MIN_SEP = 5;
/** Prefer the pair close enough to share a corridor, still not shoulder to shoulder. */
const AMBIENT_RAT_MAX_SEP = 6;

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

const SPRITE_W = 51;

const row = (pixels) => {
  if (pixels.length > SPRITE_W) throw new Error("ambient rat row is too wide");
  return pixels.padEnd(SPRITE_W, ".");
};

/**
 * Side-view pixel rats. Snout points right. The camera looks down, so each
 * one stands on a billboard instead of a top-down blob.
 * 1 dark back, 2 body, 3 back shade, 4 belly, 5 ear, 6 inner ear,
 * 7 eye, 8 nose, 9 foot, T tail, S tail segment.
 * Poses differ in the ear, the body, and the tail. One drawing is not a flip
 * of another.
 */
const ALERT_ROWS = [
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
].map(row);

const CROUCH_ROWS = [
  row(".................................5"),
  row("................................565"),
  row("...........111111...............555"),
  row(".........11333311111111111111111111"),
  row(".......33333333333333333333333333771"),
  row(".....2222222222222222222222222222211"),
  row("TTT44222222222222222222222222222228"),
  row("TTS4444444444444444444444444444444"),
  row("TTTS444444444444444444444444444"),
  row("TTS...444444444444444444444444"),
  row("TT........9944..9944..9944..99"),
  row("............99....99....99"),
  row("............99....99....99"),
];

const SNIFF_ROWS = [
  row(".....TT"),
  row("....TTTS"),
  row("...TTTS..........1111111"),
  row("..TSTT.........113333333111111"),
  row("...TTTT......3333333333333333771"),
  row(".....STT..22222222222222222222211"),
  row(".......S22222222222222222222222228"),
  row(".......4444444444444444444444444"),
  row(".....444444444444444444444444"),
  row("...9944..9944..9944..994499"),
  row("...99....99....99....99"),
  row("...99....99....99....99"),
  row("...99....99....99....99"),
];

const PLUMP_ROWS = [
  row(".....................5.5"),
  row("....................56565"),
  row("..........1111......56565"),
  row("........11333311....55555"),
  row("......333333333311111111"),
  row("....222222222222222222771"),
  row("..442222222222222222222211"),
  row(".4422222222222222222222228"),
  row("444444444444444444444444"),
  row("4444444444444444444444"),
  row("99444499444499444499"),
  row("..99....99....99....99"),
  row("..99....99....99....99"),
];

const PALETTE = {
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

const CROUCH_PALETTE = {
  ...PALETTE,
  1: [0x32, 0x24, 0x1c, 255],
  2: [0x74, 0x4c, 0x34, 255],
  3: [0x4e, 0x38, 0x2a, 255],
  4: [0xb0, 0x84, 0x5e, 255],
  5: [0xf4, 0xc4, 0xb6, 255],
  6: [0xd8, 0x90, 0x84, 255],
  8: [0xe4, 0xa4, 0x96, 255],
  9: [0xec, 0xb0, 0xa0, 255],
  T: [0xf2, 0xc6, 0xb8, 255],
  S: [0xb8, 0x74, 0x66, 255],
};

const SNIFF_PALETTE = {
  ...PALETTE,
  1: [0x3a, 0x32, 0x2a, 255],
  2: [0x86, 0x6c, 0x56, 255],
  3: [0x5c, 0x4c, 0x3e, 255],
  4: [0xb6, 0x98, 0x7a, 255],
  5: [0xf6, 0xcc, 0xbe, 255],
  6: [0xe0, 0xa8, 0x98, 255],
  8: [0xec, 0xb4, 0xa4, 255],
  9: [0xf0, 0xbc, 0xac, 255],
  T: [0xf4, 0xce, 0xc0, 255],
  S: [0xc8, 0x96, 0x84, 255],
};

const PLUMP_PALETTE = {
  ...PALETTE,
  1: [0x46, 0x2c, 0x1e, 255],
  2: [0x9c, 0x5c, 0x38, 255],
  3: [0x6a, 0x40, 0x2c, 255],
  4: [0xbe, 0x88, 0x5c, 255],
  5: [0xf8, 0xc8, 0xb4, 255],
  6: [0xe4, 0x98, 0x84, 255],
  8: [0xf0, 0xa8, 0x90, 255],
  9: [0xf2, 0xb4, 0x9c, 255],
  T: [0xf6, 0xc4, 0xb0, 255],
  S: [0xc4, 0x78, 0x60, 255],
};

const TINTS = [0xffffff, 0xf4d7c0, 0xd9c3aa, 0xc4a48c, 0xe8d2c2, 0xb89a84];

const paintSprite = (rows, palette) => {
  const width = rows[0].length;
  const height = rows.length;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const source = rows[height - 1 - y];
    if (source.length !== width) throw new Error("ambient rat rows disagree");
    for (let x = 0; x < width; x++) {
      const color = palette[source[x]];
      if (!color) throw new Error(`ambient rat pixel ${source[x]}`);
      const i = (y * width + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = color[3];
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.userData.shared = true;
  return { texture, width, height, data };
};

const RAT_VARIANTS = [
  paintSprite(ALERT_ROWS, PALETTE),
  paintSprite(CROUCH_ROWS, CROUCH_PALETTE),
  paintSprite(SNIFF_ROWS, SNIFF_PALETTE),
  paintSprite(PLUMP_ROWS, PLUMP_PALETTE),
];

/** Pixel buffers for tests. Shared with the billboards. */
export const ambientRatSprites = () =>
  RAT_VARIANTS.map((variant) => ({
    width: variant.width,
    height: variant.height,
    data: variant.data,
  }));

/**
 * Pose, tint, size, and facing for one wall tile.
 * Stable for that tile: nothing here reads the clock or the camera.
 */
export const lookFromTile = (x, y) => {
  const variant = Math.floor(hash(x + 1, y + 4) * RAT_VARIANTS.length) % RAT_VARIANTS.length;
  const tint = TINTS[Math.floor(hash(x + 8, y + 2) * TINTS.length) % TINTS.length];
  const size = 0.82 + Math.floor(hash(x + 5, y + 9) * 5) * 0.08;
  const flip = hash(x + 2, y + 7) < 0.5 ? -1 : 1;
  const yawBias = (hash(x + 12, y + 15) - 0.5) * 0.9;
  return { variant, tint, size, flip, yawBias };
};

/** Small on a wall tile. Wide, because the rat is shown in profile. */
const RAT_W = 0.74;
const ALERT = RAT_VARIANTS[0];
const RAT_H = RAT_W * (ALERT.height / ALERT.width);

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
  const material = new THREE.MeshBasicMaterial({
    map: ALERT.texture,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const sprite = new THREE.Mesh(ratGeometry, material);
  sprite.name = "rat-sprite";
  sprite.scale.set(RAT_W, RAT_H, 1);
  sprite.position.y = RAT_H / 2 + 0.02;
  sprite.castShadow = false;
  sprite.receiveShadow = false;
  sprite.frustumCulled = false;
  sprite.raycast = emptyRaycast;
  group.add(sprite);
  group.raycast = emptyRaycast;
  group.visible = false;
  group.frustumCulled = false;
  return group;
};

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

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
        look: null,
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
      slot.look = null;
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

  separated(cell, chosen, maxSep) {
    const t = this.wallCells[cell];
    for (const other of chosen) {
      const sep = chebyshev(t, this.wallCells[other]);
      if (sep < AMBIENT_RAT_MIN_SEP) return false;
      if (maxSep != null && sep > maxSep) return false;
    }
    return true;
  }

  differentPose(cell, chosen) {
    if (!chosen.length) return true;
    const look = lookFromTile(this.wallCells[cell].x, this.wallCells[cell].y);
    return chosen.every((other) => {
      const tile = this.wallCells[other];
      return look.variant !== lookFromTile(tile.x, tile.y).variant;
    });
  }

  /** Prefer a pair across the corridor, so a north-facing view does not stack them. */
  across(cell, chosen) {
    if (!chosen.length) return true;
    const t = this.wallCells[cell];
    return chosen.every((other) => {
      const o = this.wallCells[other];
      return Math.abs(t.x - o.x) >= Math.abs(t.y - o.y);
    });
  }

  placeInitial() {
    const n = this.wallCells.length;
    if (!n) {
      this.clear();
      return;
    }
    const order = [];
    for (let i = 0; i < n; i++) {
      if (!this.neighbors[i]?.length) continue;
      order.push({ i, h: hash(this.seed, i + 3) });
    }
    order.sort((a, b) => a.h - b.h || a.i - b.i);
    const chosen = [];
    const take = (maxSep, distinct, lateral) => {
      for (const { i } of order) {
        if (chosen.length >= AMBIENT_RAT_POOL) return;
        if (chosen.includes(i)) continue;
        if (!this.separated(i, chosen, chosen.length ? maxSep : null)) continue;
        if (distinct && !this.differentPose(i, chosen)) continue;
        if (lateral && !this.across(i, chosen)) continue;
        chosen.push(i);
      }
    };
    take(AMBIENT_RAT_MAX_SEP, true, true);
    if (chosen.length < AMBIENT_RAT_POOL) take(AMBIENT_RAT_MAX_SEP, true, false);
    if (chosen.length < AMBIENT_RAT_POOL) take(AMBIENT_RAT_MAX_SEP, false, false);
    if (chosen.length < AMBIENT_RAT_POOL) take(null, false, false);
    for (let placed = 0; placed < chosen.length; placed++) {
      const cell = chosen[placed];
      this.activate(this.slots[placed], cell, hash(this.seed, cell) * IDLE_MAX);
    }
    for (let i = chosen.length; i < AMBIENT_RAT_POOL; i++) {
      const slot = this.slots[i];
      slot.active = false;
      slot.look = null;
      slot.mesh.visible = false;
    }
  }

  applyLook(slot) {
    const t = this.wallCells[slot.cell];
    const art = slot.art;
    if (!t || !art) return;
    const look = lookFromTile(t.x, t.y);
    slot.look = look;
    const variant = RAT_VARIANTS[look.variant];
    if (art.material.map !== variant.texture) {
      art.material.map = variant.texture;
      art.material.needsUpdate = true;
    }
    art.material.color.setHex(look.tint);
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
    this.applyLook(slot);
    this.face(slot);
  }

  /** Billboard the side-view sprite. Resting facing comes from the tile. */
  face(slot) {
    const art = slot.art;
    if (!art) return;
    const look = slot.look;
    const variant = RAT_VARIANTS[look?.variant ?? 0];
    const size = look?.size ?? 1;
    const w = RAT_W * size;
    const h = w * (variant.height / variant.width);
    let sign = look?.flip ?? 1;
    const camera = this._camera;
    if (slot.progress < 1) {
      const fx = Math.sin(slot.yaw);
      const fz = Math.cos(slot.yaw);
      if (camera) {
        const right = camera.matrixWorld.elements;
        const side = fx * right[0] + fz * right[2];
        if (Math.abs(side) > 0.05) sign = side < 0 ? -1 : 1;
      } else if (fx < -0.05) sign = -1;
    }
    if (camera) {
      art.quaternion.copy(camera.quaternion);
      const bias = look?.yawBias ?? 0;
      if (bias) art.rotateY(bias);
    }
    art.scale.set(sign * w, h, 1);
    art.position.y = h / 2 + 0.02;
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

  apartFrom(cell, slot) {
    const t = this.wallCells[cell];
    if (!t) return false;
    for (const other of this.slots) {
      if (other === slot || !other.active || other.hidden) continue;
      const o = this.wallCells[other.cell];
      if (o && chebyshev(t, o) < AMBIENT_RAT_MIN_SEP) return false;
    }
    return true;
  }

  pickNeighbor(cell, slot) {
    const opts = (this.neighbors[cell] || []).filter((j) => this.apartFrom(j, slot));
    if (!opts.length) return -1;
    return opts[Math.floor(hash(this.seed + cell, this.thinkAccum * 10 + opts.length) * opts.length) % opts.length];
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
          let cell = -1;
          for (let k = 0; k < n && k < 48; k++) {
            const candidate = Math.floor(hash(this.seed + slot.mesh.userData.slot + 1, k + 3) * n) % n;
            if (!this.neighbors[candidate]?.length) continue;
            if (!this.apartFrom(candidate, slot)) continue;
            cell = candidate;
            break;
          }
          if (cell < 0) {
            slot.hideFor = 1;
            continue;
          }
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

      const next = this.pickNeighbor(slot.cell, slot);
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
      this.applyLook(slot);
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
      minSeparation: AMBIENT_RAT_MIN_SEP,
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
          appearance: s.look
            ? {
                variant: s.look.variant,
                tint: s.look.tint,
                size: s.look.size,
                flip: s.look.flip,
              }
            : null,
        })),
    };
  }

  dispose() {
    // Geometry and sprite textures are shared by every pool. Materials are not.
    for (const slot of this.slots) {
      slot.art?.material?.dispose();
      slot.mesh.removeFromParent();
    }
    this.group.removeFromParent();
    this.clear();
  }
}
