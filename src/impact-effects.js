import * as THREE from "three";

// Pooled impact feedback: hit flashes, corpses, loot pops and the level-up
// column. Everything uses wall-clock lifetimes, returns exactly to rest, and
// reports when it is live so a settled Balanced scene can still stop drawing.

const CORPSE_POOL = 6, POP_POOL = 8, SPARKS = 32;
const easeOut = (u) => 1 - (1 - u) ** 3;
const easeOutBack = (u) => { const c = 1.70158, m = u - 1; return 1 + (c + 1) * m ** 3 + c * m * m; };
const clamp01 = (u) => Math.max(0, Math.min(1, u));

// A flash swaps in a clone whose only difference is the emissive uniform, so the
// GPU reuses the compiled program. Shared creature materials are never mutated.
const variants = new Map();
function flashVariant(material, color, intensity) {
  if (!material?.emissive || material.userData?.flashVariant) return null;
  let byColor = variants.get(material);
  if (!byColor) variants.set(material, byColor = new Map());
  const key = `${color}:${intensity}`;
  let variant = byColor.get(key);
  if (!variant) {
    variant = material.clone();
    variant.emissive = new THREE.Color(color);
    variant.emissiveIntensity = intensity;
    variant.onBeforeCompile = material.onBeforeCompile;
    variant.customProgramCacheKey = material.customProgramCacheKey;
    variant.userData = { ...material.userData, flashVariant: true };
    byColor.set(key, variant);
  }
  return variant;
}
const meshLists = new WeakMap();
function flashMeshes(object) {
  let list = meshLists.get(object);
  if (!list) {
    list = [];
    object.traverse((child) => {
      if (child.isMesh && !child.isInstancedMesh && child.material && !Array.isArray(child.material) &&
        child.name !== "contact-disc" && child.material.emissive) list.push(child);
    });
    meshLists.set(object, list);
  }
  return list;
}

export class ImpactEffects {
  constructor(scene) {
    this.scene = scene;
    this.flashes = [];
    this.corpseRoot = new THREE.Group();
    this.corpseRoot.name = "corpses";
    scene.add(this.corpseRoot);
    this.corpses = [];
    this.pivots = Array.from({ length: CORPSE_POOL }, () => new THREE.Group());
    this.pops = [];
    this.halo = null;
    this.counts = { flashes: 0, corpses: 0, pops: 0, levelUps: 0 };
  }
  // Tint every mesh of an object for `ms` of presentation time.
  flash(object, now, { color = 0xffffff, intensity = .85, ms = 70, delay = 0 } = {}) {
    if (!object) return;
    const existing = this.flashes.find((entry) => entry.object === object);
    if (existing) { existing.start = Math.min(existing.start, now + delay); existing.until = Math.max(existing.until, now + delay + ms); existing.color = color; existing.intensity = intensity; return; }
    this.flashes.push({ object, start: now + delay, until: now + delay + ms, color, intensity, swapped: null });
    this.counts.flashes++;
  }
  applyFlash(entry, on) {
    if (on && !entry.swapped) {
      entry.swapped = [];
      for (const mesh of flashMeshes(entry.object)) {
        const variant = flashVariant(mesh.material, entry.color, entry.intensity);
        if (!variant) continue;
        entry.swapped.push(mesh, mesh.material);
        mesh.material = variant;
      }
    } else if (!on && entry.swapped) {
      for (let i = 0; i < entry.swapped.length; i += 2) entry.swapped[i].material = entry.swapped[i + 1];
      entry.swapped = null;
    }
  }
  stopFlash(object) {
    const index = this.flashes.findIndex((entry) => entry.object === object);
    if (index < 0) return;
    this.applyFlash(this.flashes[index], false);
    this.flashes.splice(index, 1);
  }
  // A slain creature leaves the actor set (no picking, no hover) and falls.
  corpse(mesh, now, away, { reduced = false, flash = 1, onDone }) {
    if (this.corpses.length >= CORPSE_POOL) this.finishCorpse(this.corpses[0]);
    const pivot = this.pivots.find((p) => !p.parent) || new THREE.Group();
    pivot.position.copy(mesh.position);
    pivot.rotation.set(0, 0, 0);
    mesh.position.set(0, 0, 0);
    pivot.add(mesh);
    this.corpseRoot.add(pivot);
    const length = Math.hypot(away.x, away.z) || 1;
    const disc = mesh.getObjectByName("contact-disc");
    this.corpses.push({ mesh, pivot, start: now, away: { x: away.x / length, z: away.z / length }, reduced, onDone, disc, discScale: disc?.scale.x ?? 1 });
    this.flash(mesh, now, { delay: reduced ? 0 : 105, ms: reduced ? 250 : 90, intensity: .9 * flash });
    this.counts.corpses++;
  }
  finishCorpse(entry) {
    const index = this.corpses.indexOf(entry);
    if (index >= 0) this.corpses.splice(index, 1);
    this.stopFlash(entry.mesh);
    entry.pivot.removeFromParent();
    entry.pivot.remove(entry.mesh);
    entry.onDone?.(entry.mesh);
  }
  // A newly dropped item springs out of the ground instead of appearing.
  pop(group, now, delay = 0) {
    if (this.pops.length >= POP_POOL) this.finishPop(this.pops[0]);
    const baseY = group.position.y;
    group.scale.setScalar(0.001);
    this.pops.push({ group, start: now + delay, baseY });
    this.counts.pops++;
  }
  finishPop(entry) {
    const index = this.pops.indexOf(entry);
    if (index >= 0) this.pops.splice(index, 1);
    entry.group.scale.setScalar(1);
    entry.group.position.y = entry.baseY;
  }
  ensureHalo() {
    if (this.halo) return this.halo;
    const group = new THREE.Group();
    group.name = "level-up";
    const column = new THREE.CylinderGeometry(.55, .75, 4.2, 20, 1, true);
    const colors = new Float32Array(column.attributes.position.count * 4);
    for (let i = 0; i < column.attributes.position.count; i++) {
      const y = column.attributes.position.getY(i) / 4.2 + .5;
      colors.set([1, .86, .52, (1 - y) * .9], i * 4);
    }
    column.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    column.translate(0, 2.1, 0);
    const glow = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };
    const beam = new THREE.Mesh(column, new THREE.MeshBasicMaterial({ ...glow, vertexColors: true, side: THREE.DoubleSide }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(.82, 1, 48), new THREE.MeshBasicMaterial({ ...glow, color: 0xffd889 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = .04;
    const sparkPositions = new Float32Array(SPARKS * 3);
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));
    const sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({ ...glow, color: 0xffe2a0, size: .09 }));
    sparks.frustumCulled = beam.frustumCulled = ring.frustumCulled = false;
    group.add(beam, ring, sparks);
    group.visible = false;
    this.scene.add(group);
    // Fixed spark seeds: presentation noise never touches any engine RNG.
    const seeds = Float32Array.from({ length: SPARKS * 3 }, (_, i) => (Math.sin(i * 12.9898) * 43758.5453) % 1);
    return this.halo = { group, beam, ring, sparks, seeds, start: 0, ms: 1100, color: 0xffd889 };
  }
  levelUp(position, now, { reduced = false, gold = false } = {}) {
    const halo = this.ensureHalo();
    halo.group.position.copy(position);
    halo.start = now; halo.ms = gold ? 1800 : 1100; halo.reduced = reduced;
    const tint = gold ? 0xffc65a : 0xffd889;
    halo.ring.material.color.setHex(tint); halo.sparks.material.color.setHex(gold ? 0xffd27a : 0xffe2a0);
    halo.group.visible = true;
    this.counts.levelUps++;
  }
  updateHalo(now) {
    const halo = this.halo;
    if (!halo?.group.visible) return false;
    const u = (now - halo.start) / halo.ms;
    if (u >= 1) { halo.group.visible = false; return false; }
    const fade = u < .15 ? u / .15 : 1 - (u - .15) / .85;
    halo.beam.material.opacity = halo.reduced ? .6 * fade : fade;
    halo.beam.scale.set(1 - u * .35, halo.reduced ? 1 : .4 + easeOut(clamp01(u * 2.2)) * .6, 1 - u * .35);
    const ringU = clamp01(u / .55);
    halo.ring.scale.setScalar(halo.reduced ? 1.6 : .3 + easeOut(ringU) * 2.9);
    halo.ring.material.opacity = (1 - ringU) * .85;
    const positions = halo.sparks.geometry.attributes.position.array, rise = easeOut(clamp01(u * 1.3));
    for (let i = 0; i < SPARKS; i++) {
      const angle = halo.seeds[i * 3] * Math.PI * 2, radius = .2 + Math.abs(halo.seeds[i * 3 + 1]) * .7;
      positions[i * 3] = Math.cos(angle + u * 2) * radius * (1 + u * .6);
      positions[i * 3 + 1] = .2 + rise * (1.6 + Math.abs(halo.seeds[i * 3 + 2]) * 2.2);
      positions[i * 3 + 2] = Math.sin(angle + u * 2) * radius * (1 + u * .6);
    }
    halo.sparks.geometry.attributes.position.needsUpdate = true;
    halo.sparks.material.opacity = fade;
    halo.sparks.visible = !halo.reduced;
    return true;
  }
  update(now) {
    let live = false;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const entry = this.flashes[i];
      if (now >= entry.until) { this.applyFlash(entry, false); this.flashes.splice(i, 1); continue; }
      this.applyFlash(entry, now >= entry.start);
      live = true;
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const entry = this.corpses[i], t = now - entry.start;
      if (entry.reduced ? t > 260 : t > 720) { this.finishCorpse(entry); continue; }
      live = true;
      if (entry.reduced) continue;
      const topple = easeOut(clamp01((t - 175) / 180)), sink = clamp01((t - 360) / 340);
      const tilt = topple * 1.35;
      entry.pivot.rotation.set(entry.away.z * tilt, 0, -entry.away.x * tilt);
      entry.mesh.position.set(entry.away.x * topple * .22, -sink * sink * .75, entry.away.z * topple * .22);
      if (entry.disc) entry.disc.scale.setScalar(entry.discScale * (1 - sink));
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const entry = this.pops[i], u = (now - entry.start) / 320;
      if (u >= 1) { this.finishPop(entry); continue; }
      live = true;
      const k = clamp01(u);
      entry.group.scale.setScalar(Math.max(.001, easeOutBack(k)));
      entry.group.position.y = entry.baseY + Math.sin(Math.PI * k) * .18;
    }
    if (this.updateHalo(now)) live = true;
    return live;
  }
  get active() { return !!(this.flashes.length || this.corpses.length || this.pops.length || this.halo?.group.visible); }
  // Level changes, context loss and hidden tabs end every effect at rest.
  clear() {
    for (const entry of [...this.flashes]) this.applyFlash(entry, false);
    this.flashes.length = 0;
    for (const entry of [...this.corpses]) this.finishCorpse(entry);
    for (const entry of [...this.pops]) this.finishPop(entry);
    if (this.halo) this.halo.group.visible = false;
  }
  releaseMaterials() {
    variants.forEach((byColor) => byColor.forEach((variant) => variant.dispose()));
    variants.clear();
  }
  metrics() {
    return { flashesLive: this.flashes.length, corpsesLive: this.corpses.length, popsLive: this.pops.length,
      levelUpLive: !!this.halo?.group.visible, impactCounts: { ...this.counts } };
  }
}
