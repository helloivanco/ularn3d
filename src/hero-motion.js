/** One stride across a tile. Clearly faster than a 200ms follow. The turn is still one action. */
export const STEP_MS = 120;
/**
 * How close the hero's center may come to a wall cell.
 * Tile centers sit 0.5 from a neighboring wall, so a straight step stays clear
 * and a diagonal that cuts the corner does not.
 */
export const HERO_STEP_RADIUS = 0.32;
/** Wind-up, cut, and recover. Long enough to read, short enough to stay out of the next turn. */
export const SWING_MS = 480;
/** Spell presentation. Not an attack. */
export const CAST_MS = 650;

export const FOREARM_REST = -0.28;
export const CAPE_REST = -0.25;
export const LEG_Y = 0.3;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Smoother plant at the start and end of a tile crossing. */
export const stepEase = (t) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

const cellHits = (x, z, radius, ix, iz) => {
  const nearestX = Math.max(ix - 0.5, Math.min(x, ix + 0.5));
  const nearestZ = Math.max(iz - 0.5, Math.min(z, iz + 0.5));
  const dx = x - nearestX;
  const dz = z - nearestZ;
  return dx * dx + dz * dz < radius * radius - 1e-10;
};

/** True when a hero center would stand inside rock. */
export const pointEntersWall = (x, z, solid, radius = HERO_STEP_RADIUS) => {
  const cx = Math.round(x);
  const cz = Math.round(z);
  for (let ix = cx - 2; ix <= cx + 2; ix++) {
    for (let iz = cz - 2; iz <= cz + 2; iz++) {
      if (!solid(ix, iz)) continue;
      if (cellHits(x, z, radius, ix, iz)) return true;
    }
  }
  return false;
};

/** True when the straight slide from a to b draws the center through rock. */
export const segmentEntersWall = (a, b, solid, radius = HERO_STEP_RADIUS) => {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(dist / 0.1));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (pointEntersWall(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, solid, radius)) return true;
  }
  return false;
};

const pathLength = (path) => {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    length += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  return length;
};

const pathClear = (path, solid, radius) => {
  for (let i = 1; i < path.length; i++) {
    if (segmentEntersWall(path[i - 1], path[i], solid, radius)) return false;
  }
  return true;
};

/**
 * Visual step from `from` to `to`. A clear line stays straight.
 * A diagonal that would enter rock goes through the open shoulder instead.
 * If both shoulders are rock, the route stays put — the caller lands on `to`
 * only when the step ends, so the body is never drawn inside the wall.
 */
export const stepRoute = (from, to, solid, radius = HERO_STEP_RADIUS) => {
  const start = { x: from.x, z: from.z };
  const end = { x: to.x, z: to.z };
  const straight = [start, end];
  if (!segmentEntersWall(start, end, solid, radius)) return straight;

  const sx = Math.round(start.x);
  const sz = Math.round(start.z);
  const tx = Math.round(end.x);
  const tz = Math.round(end.z);
  const dx = Math.sign(tx - sx);
  const dz = Math.sign(tz - sz);
  if (!dx || !dz) return [start, start];

  const home = { x: sx, z: sz };
  const vias = [
    { x: sx + dx, z: sz },
    { x: sx, z: sz + dz },
  ];
  let best = null;
  for (const via of vias) {
    if (solid(via.x, via.z)) continue;
    const options = [[start, via, end]];
    if (home.x !== start.x || home.z !== start.z) options.push([start, home, via, end]);
    for (const path of options) {
      if (!pathClear(path, solid, radius)) continue;
      if (!best || pathLength(path) < pathLength(best)) best = path;
    }
  }
  return best || [start, start];
};

/** Position along a route. t is 0 at the start and 1 at the end. */
export const pointOnRoute = (route, t) => {
  const time = clamp01(t);
  if (!route?.length) return { x: 0, z: 0 };
  if (route.length === 1 || time <= 0) return { x: route[0].x, z: route[0].z };
  const lengths = [];
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const len = Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
    lengths.push(len);
    total += len;
  }
  if (total < 1e-8) return { x: route[0].x, z: route[0].z };
  let remain = time * total;
  for (let i = 0; i < lengths.length; i++) {
    if (remain <= lengths[i] || i === lengths.length - 1) {
      const span = lengths[i] < 1e-8 ? 1 : remain / lengths[i];
      const a = route[i];
      const b = route[i + 1];
      return { x: a.x + (b.x - a.x) * span, z: a.z + (b.z - a.z) * span };
    }
    remain -= lengths[i];
  }
  const last = route[route.length - 1];
  return { x: last.x, z: last.z };
};

/** Slide a center out of wall cells. A point already on open floor stays put. */
export const pushOutOfWalls = (x, z, solid, radius = HERO_STEP_RADIUS) => {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < 4; pass++) {
    const cx = Math.round(px);
    const cz = Math.round(pz);
    let best = null;
    for (let ix = cx - 2; ix <= cx + 2; ix++) {
      for (let iz = cz - 2; iz <= cz + 2; iz++) {
        if (!solid(ix, iz)) continue;
        const nearestX = Math.max(ix - 0.5, Math.min(px, ix + 0.5));
        const nearestZ = Math.max(iz - 0.5, Math.min(pz, iz + 0.5));
        let dx = px - nearestX;
        let dz = pz - nearestZ;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius - 1e-10) continue;
        const dist = Math.sqrt(d2);
        const push = radius - dist + 1e-4;
        let ux;
        let uz;
        if (dist < 1e-6) {
          ux = px - ix;
          uz = pz - iz;
          const mag = Math.hypot(ux, uz) || 1;
          ux /= mag;
          uz /= mag;
        } else {
          ux = dx / dist;
          uz = dz / dist;
        }
        if (!best || push > best.push) best = { push, ux, uz };
      }
    }
    if (!best) break;
    px += best.ux * best.push;
    pz += best.uz * best.push;
  }
  return { x: px, z: pz };
};

/** Blend a stride back toward the plant. 0 is standing; 1 is the full step. */
export const dampStep = (pose, scale) => {
  const s = clamp01(scale);
  return {
    bodyY: pose.bodyY * s,
    lean: pose.lean * s,
    roll: pose.roll * s,
    leftLeg: pose.leftLeg * s,
    rightLeg: pose.rightLeg * s,
    leftLift: pose.leftLift * s,
    rightLift: pose.rightLift * s,
    leftArm: pose.leftArm * s,
    rightArm: pose.rightArm * s,
    forearmX: FOREARM_REST + (pose.forearmX - FOREARM_REST) * s,
    capeX: CAPE_REST + (pose.capeX - CAPE_REST) * s,
  };
};

export const blendKeys = (keys, t) => {
  const time = clamp01(t);
  if (time <= keys[0].t) return { x: keys[0].x, y: keys[0].y || 0, z: keys[0].z || 0 };
  let i = 1;
  while (i < keys.length - 1 && time > keys[i].t) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const span = b.t - a.t || 1;
  const u = smooth((time - a.t) / span);
  return {
    x: lerp(a.x, b.x, u),
    y: lerp(a.y || 0, b.y || 0, u),
    z: lerp(a.z || 0, b.z || 0, u),
  };
};

const blendScalar = (keys, t) => blendKeys(keys.map((key) => ({ t: key.t, x: key.x })), t).x;

const pose = (arm, fore, grip, lunge, twist, left) => (t) => ({
  arm: blendKeys(arm, t),
  forearmX: blendScalar(fore, t),
  gripZ: blendScalar(grip, t),
  lunge: blendScalar(lunge, t),
  twist: blendScalar(twist, t),
  left: blendKeys(left, t),
});

const restArm = [
  { t: 0, x: 0, y: 0, z: 0 },
  { t: 1, x: 0, y: 0, z: 0 },
];
const restFore = [
  { t: 0, x: FOREARM_REST },
  { t: 1, x: FOREARM_REST },
];
const noGrip = [
  { t: 0, x: 0 },
  { t: 1, x: 0 },
];

/**
 * Overhead chop. Shoulder x raises the blade, then drives it down in front.
 * Measured against the hero's hand so the tip clears the head before the cut.
 */
const slash = pose(
  [
    { t: 0, x: 0, y: 0, z: 0 },
    { t: 0.2, x: 1.5, y: 0.15, z: 0.35 },
    { t: 0.46, x: -1.05, y: 0.3, z: -0.1 },
    { t: 0.72, x: -0.15, y: -0.1, z: 0.15 },
    { t: 1, x: 0, y: 0, z: 0 },
  ],
  [
    { t: 0, x: FOREARM_REST },
    { t: 0.2, x: -1.15 },
    { t: 0.46, x: -0.12 },
    { t: 0.72, x: -0.4 },
    { t: 1, x: FOREARM_REST },
  ],
  [
    { t: 0, x: 0 },
    { t: 0.2, x: -0.2 },
    { t: 0.46, x: 0.45 },
    { t: 1, x: 0 },
  ],
  [
    { t: 0, x: 0 },
    { t: 0.46, x: -0.16 },
    { t: 1, x: 0 },
  ],
  [
    { t: 0, x: 0 },
    { t: 0.46, x: -0.28 },
    { t: 1, x: 0 },
  ],
  [
    { t: 0, x: 0, y: 0, z: 0 },
    { t: 0.46, x: 0.4, y: 0, z: 0.25 },
    { t: 1, x: 0, y: 0, z: 0 },
  ],
);

/** Spear, lance, and staff: the point comes back, then drives forward. */
const thrust = pose(
  [
    { t: 0, x: 0, y: 0, z: 0 },
    { t: 0.22, x: 1.35, y: 0, z: 0 },
    { t: 0.46, x: 0.8, y: 0, z: 0 },
    { t: 0.72, x: 0.15, y: 0, z: 0 },
    { t: 1, x: 0, y: 0, z: 0 },
  ],
  [
    { t: 0, x: FOREARM_REST },
    { t: 0.22, x: -0.5 },
    { t: 0.46, x: -1.1 },
    { t: 1, x: FOREARM_REST },
  ],
  noGrip,
  [
    { t: 0, x: 0 },
    { t: 0.46, x: -0.18 },
    { t: 1, x: 0 },
  ],
  [
    { t: 0, x: 0 },
    { t: 0.46, x: -0.08 },
    { t: 1, x: 0 },
  ],
  [
    { t: 0, x: 0, y: 0, z: 0 },
    { t: 0.46, x: 0.2, y: 0, z: 0.08 },
    { t: 1, x: 0, y: 0, z: 0 },
  ],
);

/** Empty hand. The fist rises and drives forward. It does not trace a blade arc. */
const punch = pose(
  [
    { t: 0, x: 0, y: 0, z: 0 },
    { t: 0.2, x: 1.15, y: 0, z: -0.15 },
    { t: 0.42, x: -1.2, y: 0.08, z: 0.05 },
    { t: 0.72, x: -0.2, y: 0, z: 0 },
    { t: 1, x: 0, y: 0, z: 0 },
  ],
  [
    { t: 0, x: FOREARM_REST },
    { t: 0.2, x: -1.0 },
    { t: 0.42, x: -0.05 },
    { t: 1, x: FOREARM_REST },
  ],
  noGrip,
  [
    { t: 0, x: 0 },
    { t: 0.42, x: -0.12 },
    { t: 1, x: 0 },
  ],
  [
    { t: 0, x: 0 },
    { t: 0.42, x: -0.1 },
    { t: 1, x: 0 },
  ],
  restArm,
);

const ATTACKS = { slash, thrust, punch };

/** How the one engine attack should look. Unarmed never borrows a sword stroke. */
export const attackStyle = (weapon) => {
  const type = weapon?.type || "unarmed";
  if (!weapon?.id || type === "unarmed") return "punch";
  if (type === "spear" || type === "lance" || type === "staff") return "thrust";
  return "slash";
};

export const attackPose = (t, style = "slash") => (ATTACKS[style] || slash)(t);

/** Ready angle of the grip in the hand. The arm does the swing. */
export const weaponRestX = (type) => {
  if (type === "spear" || type === "lance") return -1.05;
  if (type === "staff") return -0.2;
  if (type === "dagger") return -1.15;
  if (type === "unarmed") return 0;
  return -0.42;
};

/**
 * One step. t = 0 and t = 1 are the plant. The middle is the stride.
 * leadRight alternates so consecutive turns switch feet.
 */
export const stepPose = (t, leadRight) => {
  const time = clamp01(t);
  const u = time <= 0 || time >= 1 ? 0 : Math.sin(Math.PI * time);
  const lead = -1.05 * u;
  const trail = 0.82 * u;
  const arm = 0.68 * u;
  return {
    bodyY: 0.14 * u,
    lean: 0.14 * u,
    roll: (leadRight ? -1 : 1) * 0.07 * u,
    leftLeg: leadRight ? trail : lead,
    rightLeg: leadRight ? lead : trail,
    leftLift: leadRight ? 0 : 0.09 * u,
    rightLift: leadRight ? 0.09 * u : 0,
    leftArm: leadRight ? -arm : arm,
    rightArm: leadRight ? arm : -arm,
    forearmX: FOREARM_REST - 0.12 * u,
    capeX: CAPE_REST - 0.28 * u,
  };
};

/** Arm lift for a cast. Returns to the hang when t is 1. */
export const castPose = (t) => {
  const u = Math.sin(clamp01(t) * Math.PI);
  return {
    arm: { x: -0.3 * u, y: 0.15 * u, z: -1.15 * u },
    forearmX: FOREARM_REST - 0.45 * u,
  };
};
