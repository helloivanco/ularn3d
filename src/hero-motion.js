/** One stride across a tile. The turn is still one action; only the body moves. */
export const STEP_MS = 360;
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
  if (type === "dagger") return -0.5;
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
