#!/usr/bin/env node
/**
 * Models, rigs and animates the wall rat, then writes
 * public/models/creatures/rat.glb.
 *
 *   npm run models:rat
 *
 * Nothing is downloaded. The body is lofted from a side and top profile, the
 * details are primitives, and every clip is a periodic function sampled at
 * 30 fps, so the file is reproducible. The rat faces +Z, its feet rest on
 * y = 0, and it is about 0.8 tiles from nose to tail tip.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RAT_CLIPS } from "../src/ambient-rats.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RAT_FILE = join(root, "public/models/creatures/rat.glb");

const TAU = Math.PI * 2;
const FPS = 30;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const mix = (a, b, t) => a + (b - a) * t;
const color = (hex) => new THREE.Color(hex);

// Fur is painted near-neutral brown; each wall rat tints it at runtime.
const FUR = { back: color(0x7d6754), side: color(0xa38d77), belly: color(0xdccdba), snout: color(0xcaa597), leg: color(0x927d6b) };
const SKIN = { ear: color(0xe8a19c), earBack: color(0xb08780), nose: color(0xd97f86), paw: color(0xe6a69d), tail: color(0xc4968d), tailTip: color(0xdcb2a8) };
const EYE = color(0x0c0908), GLINT = color(0xf6f2ea), WHISKER = color(0xe6dfd5);

/* ---------- skeleton ---------- */

const bones = [];
const at = new Map();
const bone = (name, parent, x, y, z) => {
  const b = new THREE.Bone();
  b.name = name;
  const world = new THREE.Vector3(x, y, z);
  at.set(b, world);
  b.position.copy(world).sub(parent ? at.get(parent) : new THREE.Vector3());
  parent?.add(b);
  bones.push(b);
  return b;
};
const index = (b) => bones.indexOf(b);

const Root = bone("Root", null, 0, 0, 0);
const Hips = bone("Hips", Root, 0, 0.098, -0.11);
const Spine = bone("Spine", Hips, 0, 0.1, -0.035);
const Chest = bone("Chest", Spine, 0, 0.092, 0.035);
const Head = bone("Head", Chest, 0, 0.092, 0.095);
const EarL = bone("EarL", Head, 0.031, 0.13, 0.1);
const EarR = bone("EarR", Head, -0.031, 0.13, 0.1);
const ArmL = bone("ArmL", Chest, 0.038, 0.066, 0.05);
const ArmR = bone("ArmR", Chest, -0.038, 0.066, 0.05);
const LegL = bone("LegL", Hips, 0.06, 0.064, -0.105);
const LegR = bone("LegR", Hips, -0.06, 0.064, -0.105);

// The tail rests on the ground in a lazy S, its base tucked inside the rump.
const tailCurve = new THREE.CatmullRomCurve3([
  [0, 0.085, -0.195], [0, 0.058, -0.25], [0.004, 0.028, -0.3], [0.02, 0.012, -0.355],
  [0.046, 0.009, -0.41], [0.068, 0.009, -0.47], [0.076, 0.009, -0.53],
].map((p) => new THREE.Vector3(...p)));
const TAIL_AT = [0, 0.2, 0.4, 0.6, 0.8];
const tail = [];
TAIL_AT.forEach((t, k) => tail.push(bone(`Tail${k}`, k ? tail[k - 1] : Hips, ...tailCurve.getPointAt(t).toArray())));

/** Linear blend along a chain of [bone, coordinate] stations. */
const along = (value, stations) => {
  if (value <= stations[0][1]) return [[stations[0][0], 1]];
  for (let i = 0; i < stations.length - 1; i++) {
    const [a, za] = stations[i], [b, zb] = stations[i + 1];
    if (value <= zb) { const s = smooth(za, zb, value); return [[a, 1 - s], [b, s]]; }
  }
  return [[stations.at(-1)[0], 1]];
};
const SPINE = [[Hips, -0.11], [Spine, -0.035], [Chest, 0.035], [Head, 0.095]];
const TAIL = tail.map((b, k) => [b, TAIL_AT[k]]);

/* ---------- parts ---------- */

const parts = { fur: [], skin: [] };
const scratch = { p: new THREE.Vector3(), n: new THREE.Vector3(), c: new THREE.Color() };
/**
 * Adds one piece. `paint` colours each vertex in the piece's own space,
 * `matrix` places it on the rat, and `bind` weights the placed vertex.
 */
function part(material, geometry, matrix, paint, bind) {
  geometry.deleteAttribute("uv");
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal");
  // Colours, joints and weights pack into bytes; positions and normals stay float.
  const n = position.count, colors = new Uint8Array(n * 3);
  const { p, n: q, c } = scratch;
  for (let i = 0; i < n; i++) {
    paint(p.fromBufferAttribute(position, i), q.fromBufferAttribute(normal, i), c, i);
    colors.set([c.r, c.g, c.b].map((v) => Math.round(clamp01(v) * 255)), i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3, true));
  if (matrix) geometry.applyMatrix4(matrix);
  const joints = new Uint8Array(n * 4), weights = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const pairs = bind(p.fromBufferAttribute(position, i), i).filter(([, w]) => w > 0.004).slice(0, 4);
    const total = pairs.reduce((sum, [, w]) => sum + w, 0);
    let left = 255;
    pairs.forEach(([b, w], k) => {
      const byte = k === pairs.length - 1 ? left : Math.round((w / total) * 255);
      joints[i * 4 + k] = index(b);
      weights[i * 4 + k] = byte;
      left -= byte;
    });
  }
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(joints, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4, true));
  parts[material].push(geometry);
}
const place = (position, rotation = [0, 0, 0], scale = [1, 1, 1]) => new THREE.Matrix4().compose(
  new THREE.Vector3(...position),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
  new THREE.Vector3(...scale),
);
const flat = (hex) => (p, n, c) => c.copy(hex);
const rigid = (b) => () => [[b, 1]];

/*
 * Body and head as one loft: [z, half width, half height, centre height].
 * Pear-shaped from above, the back arched over the haunches, then a narrow
 * neck and a wedge of a head ending in the snout.
 */
const PROFILE = [
  [-0.2, 0.045, 0.04, 0.088], [-0.18, 0.072, 0.062, 0.093], [-0.145, 0.092, 0.078, 0.099],
  [-0.1, 0.098, 0.083, 0.101], [-0.05, 0.092, 0.077, 0.098], [0, 0.078, 0.067, 0.092],
  [0.04, 0.062, 0.058, 0.088], [0.075, 0.05, 0.05, 0.088], [0.105, 0.05, 0.047, 0.091],
  [0.14, 0.044, 0.04, 0.088], [0.175, 0.032, 0.03, 0.08], [0.205, 0.02, 0.02, 0.072],
  [0.225, 0.01, 0.011, 0.067],
];
const RUMP = [0, 0.089, -0.214], NOSE_TIP = [0, 0.066, 0.234];
function loft(profile, radial = 16, steps = 3) {
  const catmull = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  const rings = [];
  for (let i = 0; i < profile.length - 1; i++) {
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const row = (k) => profile[Math.min(profile.length - 1, Math.max(0, k))];
      rings.push([0, 1, 2, 3].map((j) => catmull(row(i - 1)[j], row(i)[j], row(i + 1)[j], row(i + 2)[j], t)));
    }
  }
  rings.push(profile.at(-1));
  const positions = [], indices = [];
  for (const [z, w, h, cy] of rings) {
    for (let s = 0; s < radial; s++) {
      const angle = (s / radial) * TAU, up = Math.sin(angle);
      // The belly is flatter than the back.
      positions.push(w * Math.cos(angle), cy + h * (up >= 0 ? up : up * 0.85), z);
    }
  }
  const rump = rings.length * radial, nose = rump + 1;
  positions.push(...RUMP, ...NOSE_TIP);
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < radial; s++) {
      const a = r * radial + s, b = (r + 1) * radial + s;
      const c = r * radial + ((s + 1) % radial), d = (r + 1) * radial + ((s + 1) % radial);
      indices.push(a, c, b, c, d, b);
    }
  }
  const last = (rings.length - 1) * radial;
  for (let s = 0; s < radial; s++) {
    const next = (s + 1) % radial;
    indices.push(rump, next, s);
    indices.push(nose, last + s, last + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

part("fur", loft(PROFILE), null, (p, n, c) => {
  c.copy(FUR.belly).lerp(FUR.side, smooth(-0.75, -0.1, n.y)).lerp(FUR.back, smooth(0.25, 0.95, n.y));
  c.lerp(FUR.snout, smooth(0.185, 0.228, p.z) * 0.75);
}, (p) => along(p.z, SPINE));

// Legs: fur down to the wrist and ankle, then bare pink paws.
const limb = (from, to, top, bottom) => {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const matrix = new THREE.Matrix4().compose(
    a.clone().add(b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.clone().sub(b).normalize()),
    new THREE.Vector3(1, 1, 1),
  );
  return [new THREE.CylinderGeometry(top, bottom, a.distanceTo(b), 7, 1), matrix];
};
for (const side of [1, -1]) {
  const arm = side > 0 ? ArmL : ArmR, leg = side > 0 ? LegL : LegR;
  part("fur", ...limb([0.038 * side, 0.066, 0.05], [0.042 * side, 0.014, 0.064], 0.014, 0.008), flat(FUR.leg), rigid(arm));
  part("skin", new THREE.SphereGeometry(0.011, 8, 5), place([0.043 * side, 0.007, 0.071], [0, 0, 0], [1.15, 0.5, 1.45]), flat(SKIN.paw), rigid(arm));
  part("fur", ...limb([0.06 * side, 0.064, -0.105], [0.064 * side, 0.013, -0.118], 0.018, 0.0095), flat(FUR.leg), rigid(leg));
  // Rats walk on long hind feet.
  part("skin", new THREE.SphereGeometry(0.013, 8, 5), place([0.066 * side, 0.007, -0.093], [0, 0, 0], [0.95, 0.5, 2.5]), flat(SKIN.paw), rigid(leg));

  // Rounded ears, pink inside, standing out and back from the crown.
  const ear = new THREE.SphereGeometry(1, 12, 8);
  const shape = ear.getAttribute("position");
  for (let i = 0; i < shape.count; i++) if (shape.getZ(i) > 0) shape.setZ(i, shape.getZ(i) * 0.3);
  ear.computeVertexNormals();
  part("skin", ear, place([0.031 * side, 0.149, 0.1], [-0.2, 0.55 * side, -0.38 * side, "YXZ"], [0.028, 0.032, 0.0075]), (p, n, c) => {
    if (p.z <= 0.05) return c.copy(SKIN.earBack);
    c.copy(SKIN.ear).lerp(SKIN.earBack, smooth(0.55, 1, Math.hypot(p.x, p.y)) * 0.6);
  }, rigid(side > 0 ? EarL : EarR));

  // Beady eyes with a glint, set into the sides of the head.
  part("skin", new THREE.SphereGeometry(0.0105, 10, 6), place([0.0295 * side, 0.106, 0.15]), flat(EYE), rigid(Head));
  part("skin", new THREE.SphereGeometry(0.0032, 5, 3), place([0.0334 * side, 0.1132, 0.1561]), flat(GLINT), rigid(Head));

  // Three whiskers a side, each a thin blade facing up.
  for (let k = 0; k < 3; k++) {
    const base = new THREE.Vector3(0.012 * side, 0.069 + (k - 1) * 0.004, 0.214 - k * 0.004);
    const angle = 0.45 - k * 0.38;
    const dir = new THREE.Vector3(side * Math.cos(angle), 0.04 * (1 - k) + 0.02, Math.sin(angle)).normalize();
    const across = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.0018);
    const tip = base.clone().addScaledVector(dir, 0.068);
    const a = base.clone().add(across), b = base.clone().sub(across);
    const up = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(tip, a)).y > 0;
    const blade = new THREE.BufferGeometry();
    blade.setAttribute("position", new THREE.Float32BufferAttribute([...(up ? [a, b] : [b, a]).flatMap((v) => v.toArray()), ...tip.toArray()], 3));
    blade.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    blade.setIndex([0, 1, 2]);
    part("skin", blade, null, flat(WHISKER), rigid(Head));
  }
}
part("skin", new THREE.SphereGeometry(0.0095, 8, 6), place(NOSE_TIP.map((v, i) => v - [0, 0.001, 0.002][i]), [0, 0, 0], [1.25, 0.9, 1]), flat(SKIN.nose), rigid(Head));

// A long tapered tail with faint scale rings, weighted down a five-bone chain.
const TAIL_SEGMENTS = 30, TAIL_RADIAL = 7;
const tube = new THREE.TubeGeometry(tailCurve, TAIL_SEGMENTS, 1, TAIL_RADIAL, false);
const tailT = (i) => Math.floor(i / (TAIL_RADIAL + 1)) / TAIL_SEGMENTS;
{
  const position = tube.getAttribute("position"), p = new THREE.Vector3(), centre = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const t = tailT(i);
    tailCurve.getPointAt(t, centre);
    p.fromBufferAttribute(position, i).sub(centre).multiplyScalar(mix(0.0165, 0.0022, Math.pow(t, 0.85))).add(centre);
    position.setXYZ(i, p.x, p.y, p.z);
  }
}
part("skin", tube, null, (p, n, c, i) => {
  const t = tailT(i);
  c.copy(SKIN.tail).lerp(SKIN.tailTip, t).multiplyScalar(Math.round(t * TAIL_SEGMENTS) % 2 ? 0.93 : 1);
}, (p, i) => along(tailT(i), TAIL));

/* ---------- clips ---------- */

const wave = (t, d, n = 1, phase = 0) => Math.sin((TAU * n * t) / d + phase);
const swell = (t, d) => 0.5 - 0.5 * Math.cos((TAU * t) / d);
const blip = (t, d, at, width) => { const x = ((t / d - at + 1.5) % 1) - 0.5; return Math.exp(-(((x * d) / width) ** 2)); };
const tailSway = (pose, t, d, amount, lag = 0.65, n = 1) =>
  tail.forEach((b, k) => { pose[b.name] = { ...pose[b.name], r: [pose[b.name]?.r?.[0] ?? 0, amount * wave(t, d, n, -k * lag), 0] }; });

/** Each clip is a periodic pose: bone name -> { r: [x, y, z] radians, p: [dx, dy, dz] }. */
const CLIPS = {
  // Breathing, a whisker twitch every so often, ear flicks, a lazy tail.
  Idle: [3.2, (t, d) => {
    const sniff = Math.max(0, wave(t, d)) ** 3;
    const pose = {
      Hips: { p: [0, 0.0015 * wave(t, d, 2), 0] },
      Chest: { r: [0.02 * wave(t, d, 2), 0, 0] },
      Head: { r: [0.06 + 0.035 * sniff * wave(t, d, 26), 0.16 * wave(t, d, 1, 1), 0] },
      EarL: { r: [0.4 * blip(t, d, 0.62, 0.07), 0, 0] },
      EarR: { r: [0.4 * blip(t, d, 0.3, 0.07), 0, 0] },
    };
    tailSway(pose, t, d, 0.09);
    return pose;
  }],
  // Lifts the front to test the air, turning the nose left then right.
  Sniff: [2.6, (t, d) => {
    const lift = swell(t, d);
    const pose = {
      Hips: { r: [-0.12 * lift, 0, 0] },
      LegL: { r: [0.12 * lift, 0, 0] }, LegR: { r: [0.12 * lift, 0, 0] },
      Spine: { r: [-0.05 * lift, 0, 0] },
      Chest: { r: [-0.1 * lift, 0, 0] },
      ArmL: { r: [0.27 * lift, 0, 0] }, ArmR: { r: [0.27 * lift, 0, 0] },
      Head: { r: [-0.26 * lift + 0.04 * wave(t, d, 24), 0.5 * wave(t, d), 0] },
      EarL: { r: [0.16 * lift, 0, 0] }, EarR: { r: [0.16 * lift, 0, 0] },
    };
    tailSway(pose, t, d, 0.12);
    pose.Tail0.r[0] = 0.12 * lift;
    return pose;
  }],
  // Sits back on its haunches and scrubs its face with both paws.
  Groom: [2.4, (t, d) => {
    const scrub = wave(t, d, 4);
    const pose = {
      Hips: { r: [-0.45, 0, 0], p: [0, -0.002, -0.012] },
      LegL: { r: [0.45, 0, 0] }, LegR: { r: [0.45, 0, 0] },
      Spine: { r: [-0.2, 0, 0] },
      Chest: { r: [-0.2, 0, 0] },
      ArmL: { r: [-1.05 + 0.22 * scrub, 0, 0.28] }, ArmR: { r: [-1.05 + 0.22 * scrub, 0, -0.28] },
      Head: { r: [1.15 + 0.14 * wave(t, d, 4, 0.8), 0.12 * wave(t, d, 2), 0] },
      EarL: { r: [-0.15, 0, 0] }, EarR: { r: [-0.15, 0, 0] },
    };
    tailSway(pose, t, d, 0.07);
    pose.Tail0.r[0] = 0.5; pose.Tail1.r[0] = -0.1;
    return pose;
  }],
  // Rears up on its hind legs, looks about, then drops back down.
  Rear: [3.3, (t, d) => {
    const up = smooth(0.05, 0.55, t) * (1 - smooth(2.45, 2.95, t));
    const pose = {
      Hips: { r: [-0.8 * up, 0, 0], p: [0, -0.004 * up, -0.02 * up] },
      LegL: { r: [0.8 * up, 0, 0] }, LegR: { r: [0.8 * up, 0, 0] },
      Spine: { r: [-0.25 * up, 0, 0] },
      Chest: { r: [-0.25 * up, 0, 0] },
      ArmL: { r: [0.9 * up, 0, 0.12 * up] }, ArmR: { r: [0.9 * up, 0, -0.12 * up] },
      Head: { r: [1.1 * up + 0.03 * up * wave(t, d, 26), 0.5 * up * wave(t, d, 2), 0] },
      EarL: { r: [0.12 * up, 0, 0] }, EarR: { r: [0.12 * up, 0, 0] },
    };
    tailSway(pose, t, d, 0.08);
    pose.Tail0.r[0] = 1.15 * up; pose.Tail1.r[0] = -0.3 * up;
    return pose;
  }],
  // A quick trot: diagonal legs together, a low bob, the tail held out and swinging.
  Run: [0.3, (t, d) => {
    const stride = wave(t, d);
    const pose = {
      Hips: { r: [0.03 * wave(t, d, 2), 0, 0], p: [0, 0.007 * swell(t, d / 2) - 0.004, 0] },
      Spine: { r: [0, 0.05 * stride, 0] },
      Chest: { r: [-0.03 * wave(t, d, 2), 0, 0] },
      ArmL: { r: [0.6 * stride, 0, 0] }, LegR: { r: [0.6 * stride, 0, 0] },
      ArmR: { r: [-0.6 * stride, 0, 0] }, LegL: { r: [-0.6 * stride, 0, 0] },
      Head: { r: [-0.08 + 0.025 * wave(t, d, 2, 1), -0.05 * stride, 0] },
      EarL: { r: [-0.35, 0, 0] }, EarR: { r: [-0.35, 0, 0] },
    };
    tailSway(pose, t, d, 0.16, 0.9);
    // Held straighter behind than the resting curl.
    const straighten = [0, -0.12, -0.32, -0.3, -0.15];
    tail.forEach((b, k) => { pose[b.name].r[1] += straighten[k]; });
    pose.Tail0.r[0] = 0.18; pose.Tail1.r[0] = -0.12; pose.Tail2.r[0] = -0.05;
    return pose;
  }],
};

/** Keeps only the keys linear interpolation between their neighbours would miss. */
function keyframes(times, values, size, tolerance) {
  const keep = [0];
  for (let i = 1; i < times.length - 1; i++) {
    const a = keep.at(-1), b = i + 1;
    let fits = true;
    for (let j = a + 1; j <= i && fits; j++) {
      const t = (times[j] - times[a]) / (times[b] - times[a]);
      for (let k = 0; k < size && fits; k++) {
        const guess = values[a * size + k] + (values[b * size + k] - values[a * size + k]) * t;
        fits = Math.abs(guess - values[j * size + k]) <= tolerance;
      }
    }
    if (!fits) keep.push(i);
  }
  keep.push(times.length - 1);
  return [keep.map((i) => times[i]), keep.flatMap((i) => values.slice(i * size, (i + 1) * size))];
}

function sample(name, [duration, poseAt]) {
  const frames = Math.round(duration * FPS), times = [];
  for (let f = 0; f <= frames; f++) times.push((f / frames) * duration);
  const poses = times.map((t) => poseAt(t % duration, duration));
  const names = new Set(poses.flatMap((pose) => Object.keys(pose)));
  const tracks = [];
  const euler = new THREE.Euler(), quat = new THREE.Quaternion();
  for (const boneName of names) {
    const b = bones.find((candidate) => candidate.name === boneName);
    if (poses.some((pose) => pose[boneName]?.r)) {
      const values = [];
      for (const pose of poses) {
        const [x, y, z] = pose[boneName]?.r ?? [0, 0, 0];
        quat.setFromEuler(euler.set(x, y, z, "YXZ"));
        values.push(quat.x, quat.y, quat.z, quat.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, ...keyframes(times, values, 4, 0.0012)));
    }
    if (poses.some((pose) => pose[boneName]?.p)) {
      const values = poses.flatMap((pose) => b.position.clone().add(new THREE.Vector3(...(pose[boneName]?.p ?? [0, 0, 0]))).toArray());
      tracks.push(new THREE.VectorKeyframeTrack(`${boneName}.position`, ...keyframes(times, values, 3, 0.00015)));
    }
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

/* ---------- assemble ---------- */

export function buildRat() {
  const fur = mergeGeometries(parts.fur), skin = mergeGeometries(parts.skin);
  const geometry = mergeGeometries([fur, skin], true);
  const materials = [
    new THREE.MeshStandardMaterial({ name: "RatFur", vertexColors: true, roughness: 0.92, metalness: 0 }),
    new THREE.MeshStandardMaterial({ name: "RatSkin", vertexColors: true, roughness: 0.55, metalness: 0 }),
  ];
  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.name = "RatBody";
  const rat = new THREE.Group();
  rat.name = "Rat";
  rat.add(Root, mesh);
  rat.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  const clips = Object.entries(CLIPS).map(([name, clip]) => sample(name, clip));
  return { rat, clips };
}

// GLTFExporter hands its binary chunk over through FileReader, which Node lacks.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((buffer) => { this.result = buffer; this.onloadend?.(); }); }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rat, clips } = buildRat();
  const missing = RAT_CLIPS.filter((name) => !clips.some((clip) => clip.name === name));
  if (missing.length) throw new Error(`rat is missing clips: ${missing.join(", ")}`);
  const glb = await new GLTFExporter().parseAsync(rat, { binary: true, animations: clips });
  mkdirSync(dirname(RAT_FILE), { recursive: true });
  writeFileSync(RAT_FILE, Buffer.from(glb));
  const triangles = rat.getObjectByName("RatBody").geometry.index.count / 3;
  console.log(`wrote ${RAT_FILE}: ${(glb.byteLength / 1024).toFixed(1)} KB, ${triangles} triangles, ${bones.length} bones, clips ${clips.map((c) => c.name).join(" ")}`);
}
