import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

/*
 * Rigged KayKit bodies (CC0, Kay Lousberg) worn over the procedural hero and
 * the undead. The procedural rigs still run every pose, turn and weapon
 * contract invisibly; this only draws a skinned body that plays matching
 * clips. See scripts/build-models.mjs for where the files come from.
 */
const MODELS = "/models/";
const loader = new GLTFLoader();
const files = new Map();
const fetchModel = (path) => {
  if (!files.has(path)) {
    files.set(path, loader.loadAsync(MODELS + path).then((gltf) => {
      gltf.scene.traverse((object) => {
        // Clones share these buffers; scene teardown must not dispose them.
        if (object.geometry) object.geometry.userData.shared = true;
        // Matte like the game's own materials; the pack's sheen blew out under the hero light.
        if (object.material) object.material.roughness = 0.82;
      });
      return gltf;
    }));
  }
  return files.get(path);
};

/* Each class wears a pack body. Heights are fitted to the procedural hero. */
export const HERO_BODIES = Object.freeze({
  Adventurer: { file: "knight" },
  // From above the brim would cover the whole wizard.
  Wizard: { file: "mage", resize: { Mage_Hat: 0.74 } },
  Rogue: { file: "rogue" },
  Elf: { file: "rogue_hooded" },
  Ogre: { file: "barbarian", scale: [1.16, 1.12, 1.16], hide: ["Barbarian_Hat"] },
  Rambo: { file: "barbarian", hide: ["Barbarian_Hat"] },
  Dwarf: { file: "barbarian", scale: [1.1, 0.84, 1.1] },
  Klingon: { file: "knight", scale: [1.06, 1.04, 1.06] },
});
/*
 * Undead wear the skeleton pack; every other species keeps its procedural
 * model. `attack` names the swing they answer with when the hero is hurt.
 */
export const CREATURE_BODIES = Object.freeze({
  zombie: { file: "skeleton_minion", attack: "punch" },
  wraith: { file: "skeleton_mage", attack: "cast", resize: { Skeleton_Mage_Hat: 0.78 } },
  vampire: { file: "skeleton_rogue", attack: "thrust" },
});
/** Standing height in tiles, crown of the head without a hat. */
export const BODY_HEIGHT = 1.02;
/** Pack bodies face +Z; the procedural hero faces -Z. */
const FACING = Math.PI;
const FADE = 0.12;
/* Locomotion speed in tiles per second at a clip's own pace. */
const WALK_PACE = 1.9, RUN_PACE = 4.6, RUN_FROM = 3.2;
/* A swing's strike lands IMPACT seconds in, to match the procedural trail. */
const ATTACKS = Object.freeze({
  punch: { clip: "Unarmed_Melee_Attack_Punch_A", length: 0.42, from: 0.12 },
  slash: { clip: "1H_Melee_Attack_Chop", length: 0.5, from: 0.18 },
  heavy: { clip: "2H_Melee_Attack_Chop", length: 0.6, from: 0.2 },
  thrust: { clip: "1H_Melee_Attack_Stab", length: 0.48, from: 0.16 },
});

export const heroBody = (character) => loadBody(HERO_BODIES[character] || HERO_BODIES.Adventurer);
/** Start fetching a calling's body and the shared clips, so play opens with the hero already dressed. */
export const preloadHero = (character) => {
  const fit = HERO_BODIES[character] || HERO_BODIES.Adventurer;
  // A failure stays cached; the hero then keeps its built-in body, as when loading in play fails.
  Promise.all([fetchModel(`characters/${fit.file}.glb`), fetchModel("rig-clips.glb")]).catch(() => {});
};
/** A pack body for this species, or null when it keeps its procedural model. */
export const creatureBody = (model) => (CREATURE_BODIES[model] ? loadBody(CREATURE_BODIES[model]) : null);

async function loadBody(fit) {
  const [gltf, clips] = await Promise.all([fetchModel(`characters/${fit.file}.glb`), fetchModel("rig-clips.glb")]);
  const body = clone(gltf.scene);
  body.name = "character-skin";
  for (const name of fit.hide || []) { const part = body.getObjectByName(name); if (part) part.visible = false; }
  for (const [name, size] of Object.entries(fit.resize || {})) body.getObjectByName(name)?.scale.multiplyScalar(size);
  // Bind-pose height of the skinned body alone, so hats do not shrink the wearer.
  if (gltf.userData.height == null) {
    const bounds = new THREE.Box3();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => { if (object.isSkinnedMesh) bounds.expandByObject(object); });
    gltf.userData.height = bounds.getSize(new THREE.Vector3()).y;
  }
  const height = gltf.userData.height;
  const scale = BODY_HEIGHT / height;
  const [sx, sy, sz] = fit.scale || [1, 1, 1];
  body.scale.set(scale * sx, scale * sy, scale * sz);
  body.rotation.y = FACING;
  body.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true; object.receiveShadow = false;
    // Skinned bounds are the bind pose; a swing can reach outside them.
    object.frustumCulled = false;
  });
  return { body, clips: clips.animations, file: fit.file, attack: fit.attack };
}

/**
 * Drives one skinned body: a looping base (idle, walk or run) and at most one
 * action on top. Weights are blended by hand so a finished action always hands
 * back to whichever base is current.
 */
export class CharacterRig {
  constructor(body, clips) {
    this.body = body;
    this.mixer = new THREE.AnimationMixer(body);
    this.actions = new Map(clips.map((clip) => [clip.name, this.mixer.clipAction(clip)]));
    this.targets = new Map();
    this.base = null; this.action = null; this.held = false;
    this.mixer.addEventListener("finished", (event) => {
      if (event.action !== this.action || this.held) return;
      this.targets.set(this.action, 0);
      this.action = null;
      if (this.base) this.targets.set(this.base, 1);
    });
    this.loop("Idle");
    this.settle();
  }
  get busy() {
    if (this.action && !this.held) return true;
    for (const [action, target] of this.targets) if (Math.abs(action.getEffectiveWeight() - target) > 1e-3) return true;
    return false;
  }
  get clip() { return (this.action || this.base)?.getClip().name ?? null; }
  start(action, weight) {
    // A base still fading out keeps its phase instead of restarting.
    if (!this.targets.has(action)) { action.reset(); action.setEffectiveWeight(weight); action.play(); }
  }
  loop(name, timeScale = 1) {
    const next = this.actions.get(name);
    if (!next) return;
    next.timeScale = timeScale;
    if (this.base === next) return;
    if (this.base) this.targets.set(this.base, 0);
    this.start(next, 0);
    next.setLoop(THREE.LoopRepeat, Infinity);
    this.targets.set(next, this.action ? 0 : 1);
    this.base = next;
  }
  /** Idle when planted, walk or run at the speed the hero actually crosses. */
  locomote(moving, speed = 0) {
    if (this.held) return;
    if (!moving) return this.loop("Idle");
    if (speed >= RUN_FROM) this.loop("Running_A", THREE.MathUtils.clamp(speed / RUN_PACE, 0.7, 1.8));
    else this.loop("Walking_A", THREE.MathUtils.clamp(speed / WALK_PACE, 0.6, 1.8));
  }
  /** One action over the base. `length` is how long it plays, in seconds. */
  play(name, { length, from = 0, hold = false } = {}) {
    const next = this.actions.get(name);
    if (!next) return;
    const duration = next.getClip().duration;
    if (this.action && this.action !== next) this.targets.set(this.action, 0);
    next.reset();
    next.setLoop(THREE.LoopOnce, 1);
    // Hold the last frame while it fades out, or the body dips toward bind pose.
    next.clampWhenFinished = true;
    next.timeScale = length ? (duration * (1 - from)) / length : 1;
    next.time = duration * from;
    next.setEffectiveWeight(this.action === next ? 1 : 0);
    next.play();
    this.targets.set(next, 1);
    if (this.base) this.targets.set(this.base, 0);
    this.action = next; this.held = hold;
  }
  attack(style, weaponType) {
    if (style === "cast") return this.cast();
    const two = ["axe", "two-handed", "greatsword", "hammer"].includes(weaponType);
    const swing = ATTACKS[two && style === "slash" ? "heavy" : style] || ATTACKS.slash;
    this.play(swing.clip, swing);
  }
  cast() { this.play("Spellcast_Shoot", { length: 0.55, from: 0.25 }); }
  hit() { if (!this.action) this.play("Hit_A", { length: 0.35, from: 0.05 }); }
  die() { this.play("Death_A", { length: 0.9, hold: true }); }
  revive() {
    if (!this.held) return;
    this.held = false;
    if (this.action) this.targets.set(this.action, 0);
    this.action = null;
    if (this.base) this.targets.set(this.base, 1);
  }
  /** Jump every weight to its target: no fade on the first frame or under reduced motion. */
  settle() {
    for (const [action, target] of this.targets) action.setEffectiveWeight(target);
    this.prune();
    this.mixer.update(0);
  }
  prune() {
    for (const [action, target] of this.targets) {
      if (target === 0 && action.getEffectiveWeight() <= 0) { action.stop(); this.targets.delete(action); }
    }
  }
  update(dt) {
    const step = dt / FADE;
    for (const [action, target] of this.targets) {
      const weight = action.getEffectiveWeight();
      action.setEffectiveWeight(target > weight ? Math.min(target, weight + step) : Math.max(target, weight - step));
    }
    this.prune();
    this.mixer.update(dt);
  }
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.body);
    // Each cloned skinned part owns a skeleton, and with it a GPU bone texture.
    this.body.traverse((object) => { if (object.isSkinnedMesh) object.skeleton.dispose(); });
  }
}
