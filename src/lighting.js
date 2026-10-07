import * as THREE from "three";

const OFFSET = new THREE.Vector3(-12, 24, 8);
const FORWARD = OFFSET.clone().normalize();
const RIGHT = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), FORWARD).normalize();
const UP = new THREE.Vector3().crossVectors(FORWARD, RIGHT);
const center = new THREE.Vector3();

// Snap in light space, not world axes, so static edges keep the same shadow
// texel phase as the hero and camera move through the world.
export function stabilizeShadow(light, position) {
  const camera = light.shadow.camera;
  const texel = (camera.right - camera.left) / light.shadow.mapSize.x;
  center.copy(RIGHT).multiplyScalar(Math.round(position.dot(RIGHT) / texel) * texel);
  center.addScaledVector(UP, Math.round(position.dot(UP) / texel) * texel);
  center.addScaledVector(FORWARD, position.dot(FORWARD));
  light.target.position.copy(center);
  light.position.copy(center).add(OFFSET);
  return texel;
}

// Slots keep their lamp identity across nearest-distance ties. A replacement
// fades to zero before moving, then fades in at the new static source.
export class TorchLighting {
  constructor(lights) {
    this.lights = lights;
    this.slots = lights.map((light) => ({ light, lamp: null, desired: null, gain: 0 }));
    this.reassignments = 0;
    this.clear();
  }
  clear() {
    for (const slot of this.slots) {
      slot.lamp = slot.desired = null; slot.gain = 0; slot.light.intensity = 0;
    }
  }
  assign(lamps, position, limit) {
    const unique = new Map(lamps.map((lamp) => [lamp.toArray().join(":"), lamp]));
    const ordered = [...unique].map(([key, point]) => ({ key, point, distance: point.distanceToSquared(position) }))
      .sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
    const candidates = new Map(ordered.map((lamp) => [lamp.key, lamp]));
    const cutoff = (ordered[Math.min(limit, ordered.length) - 1]?.distance || 0) * 1.25 + 1;
    const used = new Set();
    this.slots.forEach((slot, index) => {
      const previous = candidates.get(slot.desired?.key || slot.lamp?.key);
      slot.desired = index < limit && previous && previous.distance <= cutoff && !used.has(previous.key) ? previous : null;
      if (slot.desired) used.add(slot.desired.key);
    });
    this.slots.forEach((slot, index) => {
      if (index >= limit || slot.desired) return;
      slot.desired = ordered.find((lamp) => !used.has(lamp.key)) || null;
      if (slot.desired) used.add(slot.desired.key);
    });
  }
  update(dt, time, reduced = false) {
    let moving = false;
    for (const slot of this.slots) {
      const changing = slot.lamp?.key !== slot.desired?.key;
      const target = changing ? 0 : slot.lamp ? 1 : 0;
      const step = reduced ? 1 : Math.min(1, dt / (changing ? .12 : .18));
      slot.gain += Math.sign(target - slot.gain) * Math.min(Math.abs(target - slot.gain), step);
      if (changing && slot.gain <= 0) {
        slot.lamp = slot.desired;
        if (slot.lamp) { slot.light.position.copy(slot.lamp.point); this.reassignments++; }
        moving = !!slot.lamp || moving;
      }
      if (slot.gain !== target || changing) moving = true;
      const phase = slot.lamp ? slot.lamp.point.x * .71 + slot.lamp.point.z * 1.13 : 0;
      // Gentle, source-anchored warmth rather than a rapid brightness pulse.
      slot.light.intensity = 5 * slot.gain * (reduced ? 1 : 1 + Math.sin(time * 1.4 + phase) * .012);
    }
    return moving;
  }
}
