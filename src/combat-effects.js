import * as THREE from "three";

const LIMIT = 6;
const POINT_LIMIT = 96;
const PALETTE = [0x98d0fa, 0xb4e694, 0xc0a0f0, 0xf3c679, 0x82dfd3, 0xef9fbc];
const WARD_CODES = new Set(["pro", "inv", "glo", "stp", "hld", "web"]);
const point = (p) => new THREE.Vector3(p.x, 0.48, p.y);
function spellKind(spell) {
  const code = String(spell?.code || "").toLowerCase();
  const name = String(spell?.name || "").toLowerCase();
  if (code === "bal" || code === "mfi" || /fire|flame/.test(name)) return "fire";
  if (code === "cld" || /cold|ice|frost/.test(name)) return "ice";
  if (code === "lit" || /lightn|thunder/.test(name)) return "lightning";
  if (WARD_CODES.has(code) || /protection|invisibility|invulnerab|time stop/.test(name)) return "ward";
  return "arcane";
}
function colorFor(spell) {
  const kind = spellKind(spell);
  if (kind === "fire") return 0xff8a3d;
  if (kind === "ice") return 0xb9f4ff;
  if (kind === "lightning") return 0xf4f1b0;
  if (kind === "ward") return 0x8fd9a4;
  return PALETTE[(Number(spell.id) || 0) % PALETTE.length];
}

// A fixed pool bounds both CPU history and GPU buffers even during rapid casts.
export class CombatEffects {
  constructor(scene) {
    this.sequence = 0;
    this.slots = Array.from({ length: LIMIT }, () => {
      const group = new THREE.Group();
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(POINT_LIMIT * 3), 3));
      lineGeometry.setDrawRange(0, 0);
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), material);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.025, 4, 12), material);
      ring.rotation.x = -Math.PI / 2;
      const line = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
      line.frustumCulled = false;
      group.add(orb, ring, line);
      group.visible = false;
      scene.add(group);
      return { group, orb, ring, line, material, age: 0, active: false, history: [] };
    });
  }
  event(detail, reduced) {
    if (detail.kind !== "spell" || !detail.spell || !detail.from) return false;
    const key = `${detail.level}:${detail.castId ?? detail.spell.id}`;
    let slot = this.slots.filter((s) => s.active && s.key === key).sort((a, b) => b.sequence - a.sequence)[0];
    if (detail.phase === "cast" || !slot) {
      slot = this.slots.find((s) => !s.active) || this.slots.reduce((a, b) => a.sequence < b.sequence ? a : b);
      Object.assign(slot, { key, age: 0, lifetime: 0.95, active: true, sequence: ++this.sequence, history: [], spell: detail.spell.code, kind: spellKind(detail.spell) });
      slot.material.color.set(colorFor(detail.spell));
      slot.line.material.color.copy(slot.material.color);
      slot.orb.scale.set(1, 1, 1);
      slot.ring.scale.set(1, 1, 1);
      slot.ring.position.set(detail.from.x, 0.035, detail.from.y);
      slot.orb.position.copy(point(detail.from));
      slot.group.visible = true;
    }
    slot.age = 0;
    slot.startedAt = performance.now();
    slot.lifetime = detail.phase === "impact" ? 0.5 : 0.95;
    const path = (detail.path || [detail.to || detail.from]).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
    // Only join points included in this visible segment. A singleton following
    // an unseen stretch must never reveal that stretch through a long trail.
    // Wards stay on the caster: a ring, not a trail that could imply a path.
    if (slot.kind !== "ward") {
      for (let i = 1; i < path.length; i++) slot.history.push(path[i - 1], path[i]);
    }
    if (slot.history.length > POINT_LIMIT) slot.history.splice(0, slot.history.length - POINT_LIMIT);
    const positions = slot.line.geometry.attributes.position;
    slot.history.forEach((p, i) => positions.setXYZ(i, p.x, 0.4, p.y));
    positions.needsUpdate = true;
    slot.line.geometry.setDrawRange(0, slot.history.length);
    slot.segmentStart = path.length ? point(path[0]) : slot.orb.position.clone();
    slot.segmentEnd = point(path.at(-1) || detail.to || detail.from);
    if (path.length < 2) slot.segmentStart.copy(slot.segmentEnd);
    slot.reduced = reduced;
    if (reduced) slot.orb.position.copy(slot.segmentEnd);
    return true;
  }
  update(dt) {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age = (performance.now() - slot.startedAt) / 1000;
      if (slot.age >= slot.lifetime) {
        slot.active = slot.group.visible = false;
        continue;
      }
      const opacity = Math.min(1, (slot.lifetime - slot.age) / 0.25);
      slot.material.opacity = opacity;
      slot.line.material.opacity = opacity * 0.85;
      const kind = slot.kind || "arcane";
      if (slot.reduced) {
        if (kind === "ice") slot.orb.scale.set(0.7, 1.25, 0.35);
        else if (kind === "lightning") slot.orb.scale.setScalar(0.45);
        else if (kind === "fire") slot.orb.scale.setScalar(1.25);
        else slot.orb.scale.setScalar(kind === "ward" ? 0.35 : 1);
        slot.ring.scale.setScalar(kind === "ward" ? 1.35 : 1);
      } else {
        slot.orb.position.lerpVectors(slot.segmentStart, slot.segmentEnd, Math.min(1, slot.age / (kind === "lightning" ? 0.06 : 0.12)));
        if (kind === "fire") {
          slot.orb.scale.setScalar(0.85 + Math.min(1.1, slot.age * 2.4));
          slot.orb.position.y += Math.min(0.28, slot.age * 0.7);
          slot.ring.scale.setScalar(1 + Math.min(1.05, slot.age * 1.5));
        } else if (kind === "ice") {
          slot.orb.scale.set(0.65, 1.35, 0.32);
          slot.ring.scale.setScalar(1 + Math.min(0.28, slot.age * 0.35));
        } else if (kind === "lightning") {
          slot.orb.scale.setScalar(0.4);
          slot.line.material.opacity = opacity * (0.35 + Math.abs(Math.sin(slot.age * 46)) * 0.65);
          slot.ring.scale.setScalar(1 + Math.min(0.15, slot.age * 0.4));
        } else if (kind === "ward") {
          slot.orb.scale.setScalar(0.35);
          slot.ring.scale.setScalar(1 + Math.min(0.85, slot.age * 1.1));
        } else {
          slot.orb.scale.setScalar(1);
          slot.ring.scale.setScalar(1 + Math.min(0.3, slot.age * 0.5));
        }
      }
    }
  }
  clear() {
    this.slots.forEach((s) => { s.active = s.group.visible = false; s.history = []; });
  }
  metrics() {
    const active = this.slots.filter((s) => s.active);
    return { activeEffects: active.length, effectCapacity: LIMIT, effectPoints: active.reduce((n, s) => n + s.history.length, 0), lastSpell: this.slots.reduce((a, s) => s.sequence > (a?.sequence || 0) ? s : a, null)?.spell || null };
  }
  dispose() {
    for (const slot of this.slots) {
      slot.group.removeFromParent();
      slot.orb.geometry.dispose();
      slot.ring.geometry.dispose();
      slot.line.geometry.dispose();
      slot.material.dispose();
      slot.line.material.dispose();
    }
  }
}
