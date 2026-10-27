import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { WALL_FULL, wallLip } from "./wall-cut.js";

/** Hard cap — a normal overhead view shows one or two, never a row of copies. */
export const AMBIENT_RAT_POOL = 2;
export const AMBIENT_RAT_KIND = "ambient-rat";
/** Chebyshev tiles. Keeps the pair off the same wall run. */
export const AMBIENT_RAT_MIN_SEP = 5;
/** Prefer the pair close enough to share a corridor, still not shoulder to shoulder. */
const AMBIENT_RAT_MAX_SEP = 6;

/** Rigged rat built by scripts/build-rat.mjs. Faces +Z with its feet on y = 0. */
export const RAT_MODEL = "/models/creatures/rat.glb";
/** Each look keeps one resting habit; Run plays while it scurries. */
export const RAT_POSES = Object.freeze(["Sniff", "Groom", "Rear", "Idle"]);
export const RAT_RUN = "Run";
export const RAT_CLIPS = Object.freeze([...RAT_POSES, RAT_RUN]);

const NEAR_SQ = 14 * 14;
const THINK_INTERVAL = 0.22;
const SCURRY_SPEED = 2.4;
const IDLE_MIN = 1.6;
const IDLE_MAX = 5.5;
/** Per second. A rat swings round to its new heading within a few frames. */
const TURN_RATE = 18;
const RUN_FADE = 0.08;
const REST_FADE = 0.25;

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

/** Fur tints over the model's brown: brown, ash, sooty, sandy, dun, pale. */
const TINTS = [0xffffff, 0xcfcdcf, 0xaa9f98, 0xf2e2cc, 0xc4b8ae, 0xe2d8d1];
/** Mid fur brown in the model. */
const FUR_LIFT = 0xa38d77;

/**
 * Habit, tint, size, and resting facing for one wall tile.
 * Stable for that tile: nothing here reads the clock or the camera.
 */
export const lookFromTile = (x, y) => {
  const variant = Math.floor(hash(x + 1, y + 4) * RAT_POSES.length) % RAT_POSES.length;
  const tint = TINTS[Math.floor(hash(x + 8, y + 2) * TINTS.length) % TINTS.length];
  const size = 0.82 + Math.floor(hash(x + 5, y + 9) * 5) * 0.08;
  const flip = hash(x + 2, y + 7) < 0.5 ? -1 : 1;
  const yawBias = (hash(x + 12, y + 15) - 0.5) * 0.9;
  return { variant, tint, size, flip, yawBias };
};

let model = null;
/** One fetch for every pool. Clones share its geometry and skin material. */
const loadRat = () => {
  model ??= new GLTFLoader().loadAsync(RAT_MODEL).then((gltf) => {
    gltf.scene.traverse((object) => {
      if (object.geometry) object.geometry.userData.shared = true;
    });
    return gltf;
  });
  return model;
};

/** A soft oval under the body, so the rat sits on the stone instead of hovering. */
const shadeGeometry = (() => {
  const shape = new THREE.RingGeometry(0, 1, 20, 3);
  const position = shape.getAttribute("position");
  const colors = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const r = Math.hypot(position.getX(i), position.getY(i));
    colors.set([1, 1, 1, 1 - THREE.MathUtils.smoothstep(r, 0.35, 1)], i * 4);
  }
  shape.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  shape.userData.shared = true;
  return shape;
})();
const shadeMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
  vertexColors: true,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});

const makeRatMesh = () => {
  const group = new THREE.Group();
  group.name = "ambient-rat";
  group.userData = {
    kind: AMBIENT_RAT_KIND,
    ambient: true,
    interactive: false,
    decorative: true,
  };
  // Turns and scales with the rat. The model lands in here once it loads.
  const body = new THREE.Group();
  body.name = "rat-body";
  const shade = new THREE.Mesh(shadeGeometry, shadeMaterial);
  shade.name = "rat-shade";
  shade.rotation.x = -Math.PI / 2;
  shade.position.set(0, 0.003, -0.03);
  shade.scale.set(0.085, 0.2, 1);
  shade.castShadow = false;
  shade.receiveShadow = false;
  shade.renderOrder = 1;
  body.add(shade);
  group.add(body);
  group.traverse((object) => {
    object.raycast = emptyRaycast;
  });
  group.visible = false;
  group.frustumCulled = false;
  return group;
};

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const turnToward = (from, to) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * Small non-interactive rats that scurry along dungeon wall tops.
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
        body: mesh.getObjectByName("rat-body"),
        rig: null,
        active: false,
        cell: -1,
        look: null,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        progress: 1,
        idle: 0,
        hidden: false,
        hideFor: 0,
        yaw: 0,
        heading: 0,
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
    this.loading = null;
    this.disposed = false;
    this._scratch = new THREE.Vector3();
  }

  /** Fetch the rig the first time a cave floor wants rats. Town never pays for it. */
  load() {
    this.loading ??= loadRat().then(
      (gltf) => this.wear(gltf),
      (error) => {
        if (typeof window !== "undefined") console.warn("Wall rat model failed to load", error);
      },
    );
    return this.loading;
  }

  /** Dress every slot in its own clone of the rig, with its own fur material to tint. */
  wear(gltf) {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (slot.rig) continue;
      const model = clone(gltf.scene);
      model.name = "rat-model";
      const fur = [];
      model.traverse((object) => {
        object.raycast = emptyRaycast;
        if (!object.isMesh) return;
        object.castShadow = false;
        object.receiveShadow = false;
        // Skinned bounds are the bind pose; a rear or a stride reaches outside them.
        object.frustumCulled = false;
        if (object.material.name === "RatFur") {
          object.material = object.material.clone();
          fur.push(object.material);
        }
      });
      slot.body.add(model);
      const mixer = new THREE.AnimationMixer(model);
      const actions = new Map(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
      slot.rig = { model, mixer, actions, fur, clip: null };
      if (slot.active) {
        this.applyLook(slot);
        this.rest(slot, 0);
      }
    }
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
    this.load();
    const layoutChanged =
      this.level !== level ||
      this.wallCells.length !== wallCells.length ||
      wallCells.some((t, i) => t.x !== this.wallCells[i]?.x || t.y !== this.wallCells[i]?.y);
    // Exploring the same floor only adds wall: rats already placed keep their
    // tile instead of jumping to a freshly seeded layout on every step.
    const kept = this.enabled && this.level === level
      ? this.slots.map((slot) => (slot.active && !slot.hidden ? this.wallCells[slot.cell] : null))
      : null;
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
    if (kept && this.keepPlaced(kept)) return;
    this.seed = (level * 9973 + wallCells.length) | 0;
    this.placeInitial();
  }

  /** Re-index placed rats onto the new layout. False when none survive. */
  keepPlaced(kept) {
    let survivors = 0;
    this.slots.forEach((slot, i) => {
      const t = kept[i];
      const cell = t ? this.wallIndex.get(`${t.x},${t.y}`) : undefined;
      if (cell == null || !this.neighbors[cell]?.length) {
        if (slot.active && !slot.hidden) { slot.active = false; slot.look = null; slot.mesh.visible = false; }
        return;
      }
      slot.cell = cell;
      survivors++;
    });
    return survivors > 0;
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

  /** The look comes from the tile a rat appears on and stays with it while it scurries. */
  applyLook(slot) {
    const t = this.wallCells[slot.cell];
    if (!t) return;
    const look = lookFromTile(t.x, t.y);
    slot.look = look;
    slot.body.scale.setScalar(look.size);
    for (const fur of slot.rig?.fur ?? []) {
      fur.color.setHex(look.tint);
      // A faint lift of its own colour, so a sooty rat still reads on dark stone in flat caves.
      fur.emissive.setHex(FUR_LIFT).multiply(fur.color).multiplyScalar(0.14);
    }
  }

  /** Lie along the wall run, one way or the other, a little askew. */
  restingYaw(cell, look) {
    const t = this.wallCells[cell];
    const next = this.wallCells[this.neighbors[cell]?.[0]];
    const along = next ? Math.atan2(next.x - t.x, next.y - t.y) : 0;
    return along + (look.flip < 0 ? Math.PI : 0) + look.yawBias;
  }

  activate(slot, cell, idle = IDLE_MIN) {
    slot.active = true;
    slot.cell = cell;
    slot.progress = 1;
    slot.idle = idle;
    slot.hidden = false;
    slot.hideFor = 0;
    this.heightAt(cell, slot.from);
    slot.to.copy(slot.from);
    slot.mesh.position.copy(slot.from);
    slot.mesh.visible = true;
    this.applyLook(slot);
    slot.yaw = slot.heading = this.restingYaw(cell, slot.look);
    slot.body.rotation.y = slot.heading;
    this.rest(slot, 0);
  }

  /** Cross-fade to a looping clip, starting it partway in so two rats never move in step. */
  play(slot, name, fade) {
    const rig = slot.rig;
    if (!rig || rig.clip === name) return;
    const next = rig.actions.get(name);
    if (!next) return;
    const previous = rig.clip ? rig.actions.get(rig.clip) : null;
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.time = hash(slot.cell + 1, rig.clip ? rig.clip.length : 7) * next.getClip().duration;
    next.play();
    if (previous && fade > 0) previous.crossFadeTo(next, fade, false);
    else {
      previous?.stop();
      next.setEffectiveWeight(1);
    }
    rig.clip = name;
    if (!fade) rig.mixer.update(0);
  }

  /** Mostly its own habit, sometimes a plain idle or a sniff. */
  rest(slot, fade = REST_FADE) {
    const roll = hash(slot.cell + 3, this.seed + slot.mesh.userData.slot);
    const habit = RAT_POSES[slot.look?.variant ?? 0];
    this.play(slot, roll < 0.2 ? "Idle" : roll < 0.35 ? "Sniff" : habit, fade);
  }

  /** Swing round toward the way it is running, and play the rig. */
  animate(slot, dt) {
    if (slot.progress < 1) {
      const target = turnToward(slot.heading, slot.yaw);
      slot.heading += (target - slot.heading) * (1 - Math.exp(-dt * TURN_RATE));
    }
    slot.body.rotation.y = slot.heading;
    slot.rig?.mixer.update(dt);
  }

  heightAt(cell, out) {
    const t = this.wallCells[cell];
    const lip = wallLip(this.wallHeightAt?.[cell] ?? WALL_FULL);
    out.set(t.x, lip.y + lip.thickness / 2, t.y);
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
    const cameraPos = cameraOrPos?.isCamera ? cameraOrPos.position : cameraOrPos;
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

      this.animate(slot, dt);

      if (slot.progress < 1) {
        slot.progress = Math.min(1, slot.progress + dt * SCURRY_SPEED);
        const t = slot.progress * slot.progress * (3 - 2 * slot.progress);
        slot.mesh.position.lerpVectors(slot.from, slot.to, t);
        if (near) scurryingNear = true;
        if (slot.progress >= 1) {
          slot.mesh.position.copy(slot.to);
          slot.idle = IDLE_MIN + hash(slot.cell, 4) * (IDLE_MAX - IDLE_MIN);
          this.rest(slot);
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
      slot.yaw = Math.atan2(slot.to.x - slot.from.x, slot.to.z - slot.from.z);
      slot.cell = next;
      slot.progress = 0;
      this.play(slot, RAT_RUN, RUN_FADE);
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
          presentation: s.rig ? "model" : "pending",
          clip: s.rig?.clip ?? null,
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
    // Geometry, the skin material and the shade are shared by every pool. Fur is per slot.
    this.disposed = true;
    for (const slot of this.slots) {
      const rig = slot.rig;
      if (rig) {
        rig.mixer.stopAllAction();
        rig.mixer.uncacheRoot(rig.model);
        rig.model.traverse((object) => {
          if (object.isSkinnedMesh) object.skeleton.dispose();
        });
        for (const fur of rig.fur) fur.dispose();
        slot.rig = null;
      }
      slot.mesh.removeFromParent();
    }
    this.group.removeFromParent();
    this.clear();
  }
}
