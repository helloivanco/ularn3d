import * as THREE from "three";

const REST = [0, 0, 0, .12, 0, -.08, -.3, 0, 0];
const SAMPLES = 8;
const IMPACT_TIME = .105;
const smooth = (t) => t * t * (3 - 2 * t);
export const WALK_SETTLE_MS = 280;
// The earlier edition's exponential glide, with a finite tail so quick input
// can retarget the displayed position and a stopped hero settles exactly.
export function walkProgress(elapsed) {
  if (elapsed >= WALK_SETTLE_MS) return 1;
  return (1 - Math.exp(-Math.max(0, elapsed) * .011)) / (1 - Math.exp(-WALK_SETTLE_MS * .011));
}

// A single retargetable action, never a queue. All times are presentation-only;
// damage and turns have already resolved before this receives an engine event.
export class HeroAnimation {
  constructor(scene, hero) {
    this.pose = REST.slice();
    this.sequence = this.impacts = 0;
    this.history = Array.from({ length: SAMPLES }, () => ({ base: new THREE.Vector3(), tip: new THREE.Vector3() }));
    this.base = new THREE.Vector3(); this.tip = new THREE.Vector3();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((SAMPLES - 1) * 18), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array((SAMPLES - 1) * 18), 3));
    geometry.setDrawRange(0, 0);
    this.trail = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: 0xcfe5e9, vertexColors: true, transparent: true, opacity: .32,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    this.trail.frustumCulled = false;
    const sparks = new THREE.BufferGeometry();
    sparks.setAttribute("position", new THREE.BufferAttribute(new Float32Array(10 * 3), 3));
    this.sparks = new THREE.Points(sparks, new THREE.PointsMaterial({
      color: 0xffdeb0, size: .06, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.sparks.frustumCulled = false;
    this.trail.visible = this.sparks.visible = false;
    scene.add(this.trail, this.sparks);
    this.bind(hero);
  }
  bind(hero) {
    this.hero = hero;
    this.body = hero.getObjectByName("body");
    this.arm = hero.getObjectByName("right-arm");
    this.weapon = hero.getObjectByName("weapon");
    this.clear();
  }
  apply(pose) {
    if (!this.body || !this.arm || !this.weapon) return;
    this.body.rotation.y = pose[0]; this.body.rotation.z = pose[1]; this.body.position.z = pose[2];
    this.arm.rotation.set(pose[3], pose[4], pose[5]);
    this.weapon.rotation.set(pose[6], pose[7], pose[8]);
  }
  start(detail, now = performance.now(), reduced = false, visibleTarget = true) {
    if (reduced || !this.weapon) { this.clear(); return; }
    // Continue from the currently displayed pose on rapid input.
    const origin = [this.body.rotation.y, this.body.rotation.z, this.body.position.z,
      this.arm.rotation.x, this.arm.rotation.y, this.arm.rotation.z,
      this.weapon.rotation.x, this.weapon.rotation.y, this.weapon.rotation.z];
    this.pose = origin.slice();
    const chain = this.startedAt !== undefined && now - this.startedAt < 450;
    const side = chain ? -this.side : 1;
    this.side = side; this.startedAt = now; this.sequence++;
    this.historyCount = 0; this.trail.visible = this.sparks.visible = false;
    this.impactPlayed = false;
    this.active = true;
    this.cast = detail.kind === "spell";
    this.phase = this.cast ? "cast" : "windup";
    this.blade = !this.cast && ["sword", "dagger"].includes(detail.weapon?.type || this.weapon.userData.weaponType);
    this.hit = !this.cast && !!detail.hit && visibleTarget;
    this.target = detail.to ? { ...detail.to } : null;
    if (this.cast) {
      this.frames = [[0, origin], [.16, [0, 0, 0, .85, 0, -.25, -1.45, 0, -.1]], [.4, [0, 0, 0, .7, 0, -.15, -1.1, 0, 0]], [.65, REST]];
    } else {
      this.frames = [
        [0, origin],
        [.055, [.22 * side, -.045 * side, .035, .8, .16 * side, -.9 * side, -.2, -.15 * side, -.35 * side]],
        [IMPACT_TIME, [-.23 * side, .06 * side, -.08, 1, -.15 * side, .45 * side, -1.95, .1 * side, .4 * side]],
        [.17, [-.3 * side, .07 * side, -.055, .65, .06 * side, .7 * side, -2.05, 0, .55 * side]],
        [.33, REST],
      ];
    }
    this.apply(origin);
  }
  updatePose(now) {
    const age = Math.max(0, (now - this.startedAt) / 1000);
    this.age = age;
    if (age >= this.frames.at(-1)[0]) {
      for (let i = 0; i < REST.length; i++) this.pose[i] = REST[i];
      this.apply(this.pose); this.active = false; this.phase = "idle";
      return;
    }
    let index = 1;
    while (index < this.frames.length - 1 && age > this.frames[index][0]) index++;
    const [a, from] = this.frames[index - 1], [b, to] = this.frames[index];
    const progress = smooth(Math.min(1, (age - a) / (b - a)));
    for (let i = 0; i < REST.length; i++) this.pose[i] = from[i] + (to[i] - from[i]) * progress;
    this.apply(this.pose);
    this.phase = this.cast ? "cast" : age < .055 ? "windup" : age < .17 ? "strike" : "recover";
  }
  update(now = performance.now()) {
    if (!this.active) return;
    this.updatePose(now);
    if (this.blade && this.age >= .055 && this.age < .18) {
      this.weapon.updateWorldMatrix(true, false);
      this.base.set(0, this.weapon.userData.bladeLength * .38, 0).applyMatrix4(this.weapon.matrixWorld);
      this.tip.set(this.weapon.userData.bladeBend || 0, this.weapon.userData.bladeLength, 0).applyMatrix4(this.weapon.matrixWorld);
      if (this.historyCount === SAMPLES) {
        for (let i = 0; i < SAMPLES - 1; i++) {
          this.history[i].base.copy(this.history[i + 1].base);
          this.history[i].tip.copy(this.history[i + 1].tip);
        }
      } else this.historyCount++;
      const sample = this.history[this.historyCount - 1];
      sample.base.copy(this.base); sample.tip.copy(this.tip);
      this.lastTrailAt = now;
      const position = this.trail.geometry.attributes.position, color = this.trail.geometry.attributes.color;
      let vertex = 0;
      for (let i = 1; i < this.historyCount; i++) {
        const previous = this.history[i - 1], current = this.history[i];
        for (const [point, fade] of [[previous.base, (i - 1) / SAMPLES], [previous.tip, (i - 1) / SAMPLES], [current.tip, i / SAMPLES], [previous.base, (i - 1) / SAMPLES], [current.tip, i / SAMPLES], [current.base, i / SAMPLES]]) {
          position.setXYZ(vertex, point.x, point.y, point.z);
          color.setXYZ(vertex++, fade * .8, fade * .9, fade);
        }
      }
      position.needsUpdate = color.needsUpdate = true;
      this.trail.geometry.setDrawRange(0, vertex);
    }
    this.trail.material.opacity = .32 * Math.max(0, 1 - (now - (this.lastTrailAt || 0)) / 85);
    this.trail.visible = this.historyCount > 1 && this.trail.material.opacity > 0;
    const impactAge = this.age - IMPACT_TIME;
    if (this.hit && this.target && impactAge >= 0 && impactAge < .18) {
      if (!this.impactPlayed) { this.impactPlayed = true; this.impacts++; }
      this.sparks.visible = true;
      const positions = this.sparks.geometry.attributes.position;
      for (let i = 0; i < 10; i++) {
        const angle = i * 2.39996, radius = .025 + impactAge * (.6 + i % 3 * .15);
        positions.setXYZ(i, this.target.x + Math.cos(angle) * radius, .55 + Math.sin(i * 1.7) * radius - impactAge * .25, this.target.y + Math.sin(angle) * radius);
      }
      positions.needsUpdate = true;
      this.sparks.material.opacity = Math.max(0, 1 - impactAge / .18);
    } else this.sparks.visible = false;
    if (!this.active) this.trail.visible = this.sparks.visible = false;
  }
  clear() {
    this.active = false; this.phase = "idle";
    this.startedAt = undefined; this.side = 1; this.historyCount = 0;
    this.trail.visible = this.sparks.visible = false;
    this.trail.geometry.setDrawRange(0, 0);
    this.pose = REST.slice(); this.apply(this.pose);
  }
  metrics() {
    return { weaponModel: this.weapon?.userData.weaponModel || "unarmed", attackPhase: this.phase, attackSequence: this.sequence,
      bladeTrailPoints: this.trail.visible ? this.historyCount : 0, impactVisible: this.sparks.visible, weaponImpacts: this.impacts,
      armRotation: this.arm?.rotation.toArray().slice(0, 3), weaponRotation: this.weapon?.rotation.toArray().slice(0, 3) };
  }
  dispose() {
    this.clear();
    for (const mesh of [this.trail, this.sparks]) {
      mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose();
    }
  }
}
