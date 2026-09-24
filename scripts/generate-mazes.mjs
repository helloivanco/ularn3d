#!/usr/bin/env node
/**
 * Generate maze-like 57×20 canned layouts for Ularn3d.
 * Rooms + 1-wide corridors; doors only between floor tiles.
 */
import { writeFileSync } from "node:fs";

const MAXX = 57;
const MAXY = 20;
const SIZE = MAXX * MAXY;

const makeRng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const rund = (rng, n) => Math.floor(rng() * n);
const idx = (x, y) => y * MAXX + x;

const generateLayout = (seed, opts = {}) => {
  const rng = makeRng(seed);
  const grid = new Array(SIZE).fill("#");
  const rooms = [];

  const get = (x, y) => grid[idx(x, y)];
  const set = (x, y, ch) => {
    if (x <= 0 || y <= 0 || x >= MAXX - 1 || y >= MAXY - 1) return;
    grid[idx(x, y)] = ch;
  };
  const isFloor = (x, y) => {
    if (x < 0 || y < 0 || x >= MAXX || y >= MAXY) return false;
    return get(x, y) !== "#";
  };

  const overlaps = (rx, ry, rw, rh) => {
    for (const r of rooms) {
      /* 1-cell gap keeps corridors maze-like without starving open floor. */
      if (rx < r.x + r.w + 1 && rx + rw + 1 > r.x && ry < r.y + r.h + 1 && ry + rh + 1 > r.y)
        return true;
    }
    return false;
  };

  const targetRooms = opts.rooms ?? 7 + rund(rng, 4); // 7–10
  for (let attempt = 0; attempt < 600 && rooms.length < targetRooms; attempt++) {
    const rw = 5 + rund(rng, 6); // 5–10
    const rh = 3 + rund(rng, 4); // 3–6
    const rx = 1 + rund(rng, Math.max(1, MAXX - rw - 2));
    const ry = 1 + rund(rng, Math.max(1, MAXY - rh - 2));
    if (overlaps(rx, ry, rw, rh)) continue;
    rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) });
  }
  // Fallback grid of rooms if RNG was unlucky.
  if (rooms.length < 6) {
    const presets = [
      [2, 2, 7, 4], [12, 2, 8, 4], [24, 2, 7, 3], [35, 2, 8, 4], [46, 2, 6, 4],
      [2, 9, 8, 4], [14, 10, 7, 4], [26, 9, 8, 5], [38, 10, 7, 4], [48, 9, 5, 4],
      [8, 15, 10, 3], [28, 15, 9, 3], [42, 15, 8, 3],
    ];
    for (const [x, y, w, h] of presets) {
      if (rooms.length >= 8) break;
      if (x + w >= MAXX - 1 || y + h >= MAXY - 1) continue;
      if (overlaps(x, y, w, h)) continue;
      rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
    }
  }

  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) set(x, y, " ");
  }

  const inRoom = (x, y, r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

  /** Carve a 1-wide path; first wall cell that borders the destination room becomes a door. */
  const corridor = (a, b) => {
    let x = a.cx;
    let y = a.cy;
    const path = [];
    const horizFirst = rng() < 0.5;
    const step = () => {
      path.push([x, y]);
      if (horizFirst) {
        if (x !== b.cx) x += Math.sign(b.cx - x);
        else if (y !== b.cy) y += Math.sign(b.cy - y);
      } else {
        if (y !== b.cy) y += Math.sign(b.cy - y);
        else if (x !== b.cx) x += Math.sign(b.cx - x);
      }
    };
    let guard = 200;
    while ((x !== b.cx || y !== b.cy) && guard-- > 0) step();
    path.push([b.cx, b.cy]);

    let doorPlaced = false;
    for (const [px, py] of path) {
      if (px <= 0 || py <= 0 || px >= MAXX - 1 || py >= MAXY - 1) continue;
      const wasWall = get(px, py) === "#";
      const entersB = wasWall && (
        inRoom(px - 1, py, b) || inRoom(px + 1, py, b) ||
        inRoom(px, py - 1, b) || inRoom(px, py + 1, b)
      );
      if (entersB && !doorPlaced && rng() < 0.7) {
        set(px, py, "D");
        doorPlaced = true;
      } else {
        if (get(px, py) === "D") continue;
        set(px, py, " ");
      }
    }
  };

  const order = rooms.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rund(rng, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 1; i < order.length; i++) corridor(rooms[order[i - 1]], rooms[order[i]]);
  const extras = 1 + rund(rng, 3);
  for (let e = 0; e < extras && rooms.length > 2; e++) {
    const ia = rund(rng, rooms.length);
    let ib = rund(rng, rooms.length);
    if (ia === ib) continue;
    corridor(rooms[ia], rooms[ib]);
  }

  // Convert remaining choke-point walls into extra doors.
  const doorCandidates = [];
  for (let y = 1; y < MAXY - 1; y++) {
    for (let x = 1; x < MAXX - 1; x++) {
      if (get(x, y) !== "#") continue;
      const horiz = isFloor(x - 1, y) && isFloor(x + 1, y);
      const vert = isFloor(x, y - 1) && isFloor(x, y + 1);
      if (horiz || vert) doorCandidates.push([x, y]);
    }
  }
  for (let i = doorCandidates.length - 1; i > 0; i--) {
    const j = rund(rng, i + 1);
    [doorCandidates[i], doorCandidates[j]] = [doorCandidates[j], doorCandidates[i]];
  }
  const wantDoors = Math.max(3, Math.min(doorCandidates.length, 5 + rund(rng, 6)));
  let have = grid.filter((c) => c === "D").length;
  for (let i = 0; i < doorCandidates.length && have < wantDoors; i++) {
    const [x, y] = doorCandidates[i];
    if (get(x, y) !== "#") continue;
    set(x, y, "D");
    have++;
  }

  // Markers on floor cells.
  const floors = [];
  for (let y = 1; y < MAXY - 1; y++)
    for (let x = 1; x < MAXX - 1; x++)
      if (get(x, y) === " ") floors.push([x, y]);
  for (let i = floors.length - 1; i > 0; i--) {
    const j = rund(rng, i + 1);
    [floors[i], floors[j]] = [floors[j], floors[i]];
  }

  /*
   * Keep canned floor markers sparse — makeobject() places the classic
   * per-level loot budget. Do not overstuff markers (Ivan: match earlier
   * versions' amount; never use an overstuffed build as a benchmark).
   */
  const goldN = opts.treasure ? 8 + rund(rng, 5) : 0; /* treasure: more gold than items */
  const lootN = opts.treasure ? 2 + rund(rng, 3) : 2 + rund(rng, 3); /* ~2–4, classic was ~5–7 */
  const monN = 1 + rund(rng, 3);
  let p = 0;
  for (let i = 0; i < goldN && p < floors.length; i++, p++) set(floors[p][0], floors[p][1], "$");
  for (let i = 0; i < lootN && p < floors.length; i++, p++) set(floors[p][0], floors[p][1], "-");
  for (let i = 0; i < monN && p < floors.length; i++, p++) set(floors[p][0], floors[p][1], ".");
  if (opts.eye && p < floors.length) {
    set(floors[p][0], floors[p][1], "~");
    p++;
  }
  if (opts.potion && p < floors.length) {
    set(floors[p][0], floors[p][1], "!");
    p++;
  }

  for (let x = 0; x < MAXX; x++) {
    grid[idx(x, 0)] = "#";
    grid[idx(x, MAXY - 1)] = "#";
  }
  for (let y = 0; y < MAXY; y++) {
    grid[idx(0, y)] = "#";
    grid[idx(MAXX - 1, y)] = "#";
  }

  return grid.join("");
};

const wallPct = (s) => ((s.match(/#/g) || []).length / s.length) * 100;

const orphanDoors = (s) => {
  let bad = 0;
  for (let y = 0; y < MAXY; y++) {
    for (let x = 0; x < MAXX; x++) {
      if (s[idx(x, y)] !== "D") continue;
      const floor = (xx, yy) => {
        if (xx < 0 || yy < 0 || xx >= MAXX || yy >= MAXY) return false;
        const c = s[idx(xx, yy)];
        return c !== "#" && c !== "D";
      };
      const horiz = floor(x - 1, y) && floor(x + 1, y);
      const vert = floor(x, y - 1) && floor(x, y + 1);
      if (!horiz && !vert) bad++;
    }
  }
  return bad;
};

const openCells = (s) => (s.match(/[^#]/g) || []).length;

const generateGood = (seed, opts = {}) => {
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 80; i++) {
    const s = generateLayout(seed + i * 9973, opts);
    if (s.length !== SIZE) continue;
    if (orphanDoors(s) > 0) continue;
    const wp = wallPct(s);
    const open = openCells(s);
    const doors = (s.match(/D/g) || []).length;
    if (doors < 2) continue;
    /* Prefer ~45–58% walls and 420–620 open cells (classic loot density). */
    const openScore = open >= 420 && open <= 620 ? 100 : -Math.abs(open - 520);
    const wallScore = wp >= 42 && wp <= 58 ? 50 : -Math.abs(wp - 50);
    const score = openScore + wallScore + doors;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
    if (wp >= 42 && wp <= 58 && open >= 420 && open <= 620 && doors >= 2) return s;
  }
  return best || generateLayout(seed, opts);
};

const formatMaze = (s) => {
  const lines = [];
  for (let y = 0; y < MAXY; y++) lines.push(s.slice(y * MAXX, (y + 1) * MAXX));
  return "`\\\n" + lines.map((l) => l + "\\").join("\n") + "\n`";
};

const COMMON = [];
const LARN = [];
const ULARN = [];
const TREASURE = [];

for (let i = 0; i < 12; i++) {
  COMMON.push(generateGood(11000 + i * 17, { eye: i === 0, potion: i === 0 }));
  LARN.push(generateGood(22000 + i * 19, {}));
  TREASURE.push(generateGood(44000 + i * 23, { treasure: true }));
}
for (let i = 0; i < 109; i++) {
  ULARN.push(generateGood(55000 + i * 31, { eye: i % 20 === 0, potion: i % 20 === 7 }));
}

const uniq = (arr, base) => {
  const seen = new Set();
  for (let i = 0; i < arr.length; i++) {
    let s = arr[i];
    let n = 0;
    while (seen.has(s) && n < 80) {
      s = generateGood(base + i * 1000 + n * 37, {});
      n++;
    }
    seen.add(s);
    arr[i] = s;
  }
};
uniq(COMMON, 90000);
uniq(LARN, 91000);
uniq(ULARN, 92000);
uniq(TREASURE, 93000);

const stats = (name, arr) => {
  const wps = arr.map(wallPct).sort((a, b) => a - b);
  const orphans = arr.reduce((n, s) => n + orphanDoors(s), 0);
  const doors = arr.map((s) => (s.match(/D/g) || []).length);
  console.log(
    name,
    arr.length,
    "wall%",
    wps[0].toFixed(1),
    wps[(wps.length / 2) | 0].toFixed(1),
    wps[wps.length - 1].toFixed(1),
    "doors",
    Math.min(...doors),
    "–",
    Math.max(...doors),
    "orphans",
    orphans,
  );
};
stats("COMMON", COMMON);
stats("LARN", LARN);
stats("ULARN", ULARN);
stats("TREASURE", TREASURE);

{
  const s = COMMON[0];
  console.log("--- COMMON[0] ---");
  for (let y = 0; y < MAXY; y++) console.log(s.slice(y * MAXX, (y + 1) * MAXX));
}

const out = `'use strict';

var USED_MAZES = [];
var MAZES; // this is now set in create.js / config.js

const COMMON_MAZES = [
${COMMON.map(formatMaze).join(",\n")}
];

const LARN_MAZES = [
${LARN.map(formatMaze).join(",\n")}
];

const ULARN_MAZES = [
${ULARN.map(formatMaze).join(",\n")}
];

const TREASURE_MAZES = [
${TREASURE.map(formatMaze).join(",\n")}
];
`;

writeFileSync("/workspace/public/engine/mazes.js", out);
console.log("wrote mazes.js", out.length, "bytes");
