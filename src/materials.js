import * as THREE from "three";

const maps = new Map();
const materials = new Map();
const scattered = new Map();
const masonry = new Map();
const TEX = 128;
// Texels per tile. Every map paints one logical 128-unit pattern, so color,
// normal and roughness detail line up; 512 keeps joints crisp where a tile
// spans ~200 device pixels on a 2× screen, and mipmaps cover the far field.
const MAP_SIZE = 512;
const TAU = Math.PI * 2;
const details = new Map();
export const noise = (x, y = 0) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

const shade = (rgb, f, a = 1) =>
  `rgba(${rgb.map((v) => Math.min(255, Math.round(v * f))).join(",")},${a})`;

/* Draw a shape again across each edge it reaches so the map tiles seamlessly. */
function wrapped(x, y, reach, draw) {
  for (const ox of [-TEX, 0, TEX])
    for (const oy of [-TEX, 0, TEX]) {
      const px = x + ox, py = y + oy;
      if (px > -reach && px < TEX + reach && py > -reach && py < TEX + reach) draw(px, py);
    }
}

/* A hand-cut block: jittered corners softened by `radius`, inset from its cell.
   The same seed gives concentric outlines at every inset. */
function stonePath(c, [x0, y0, x1, y1], inset, seed, radius) {
  const jitter = (k) => (noise(seed, k) - 0.5) * 1.4;
  const corners = [
    [x0 + inset + jitter(1), y0 + inset + jitter(2)],
    [x1 - inset + jitter(3), y0 + inset + jitter(4)],
    [x1 - inset + jitter(5), y1 - inset + jitter(6)],
    [x0 + inset + jitter(7), y1 - inset + jitter(8)],
  ];
  const r = Math.max(0.3, Math.min(radius, (x1 - x0) / 2 - inset - 1, (y1 - y0) / 2 - inset - 1));
  c.beginPath();
  corners.forEach(([x, y], i) => {
    const [px, py] = corners[(i + 3) % 4], [nx, ny] = corners[(i + 1) % 4];
    const back = r / Math.hypot(px - x, py - y), ahead = r / Math.hypot(nx - x, ny - y);
    if (i) c.lineTo(x + (px - x) * back, y + (py - y) * back);
    else c.moveTo(x + (px - x) * back, y + (py - y) * back);
    c.quadraticCurveTo(x, y, x + (nx - x) * ahead, y + (ny - y) * ahead);
  });
  c.closePath();
}

const STONE_HUES = [[1, 1, 0.95], [1.04, 1, 0.9], [0.98, 1, 0.99], [0.97, 1.03, 0.92]];
// Floors keep a narrow palette: their per-tile instance tint carries the variety.
const FLAG_HUES = [[1, 1, 0.95], [1.02, 1, 0.93], [0.99, 1, 0.97]];
/* One stone. Shading is baked because cave terrain is unlit: a dark rim rising
   to a paler crown reads as a rounded block from every side, so floors can turn
   per tile without the light flipping. `lit` adds a top-down key for walls. */
function stone(c, cell, seed, { value, inset, radius, lit = false, hues = STONE_HUES }) {
  const [x0, y0, x1, y1] = cell, w = x1 - x0, h = y1 - y0;
  const hue = hues[Math.floor(noise(seed, 9) * hues.length)];
  const v = value[0] + noise(seed, 10) * (value[1] - value[0]);
  const base = hue.map((k) => v * k);
  c.fillStyle = shade(base, 1.04);
  stonePath(c, cell, inset, seed, radius);
  c.fill();
  c.save();
  c.clip();
  // Overlapping rim strokes darken smoothly toward the arris (no stepped rings).
  c.strokeStyle = "rgba(20,22,18,0.042)";
  for (let width = 16; width > 1.2; width *= 0.8) {
    c.lineWidth = width;
    c.stroke();
  }
  for (let i = 0; i < 7; i++) {
    const x = x0 + noise(seed, 11 + i) * w, y = y0 + noise(seed, 18 + i) * h, r = 4 + noise(seed, 25 + i) * 11;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const tone = noise(seed, 32 + i) > 0.45 ? "255,246,226" : "30,32,24";
    g.addColorStop(0, `rgba(${tone},${0.06 + noise(seed, 39 + i) * 0.07})`);
    g.addColorStop(1, `rgba(${tone},0)`);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Faint sediment bands on some stones, across the long axis.
  if (noise(seed, 52) > 0.55) {
    const across = w >= h, span = across ? h : w, angle = (noise(seed, 53) - 0.5) * 0.5;
    for (let i = 0; i < 3; i++) {
      const at = 4 + noise(seed, 54 + i) * (span - 8), wave = 0.6 + noise(seed, 57 + i) * 1.2;
      c.strokeStyle = noise(seed, 60 + i) > 0.5 ? "rgba(255,248,230,0.07)" : "rgba(26,28,22,0.08)";
      c.lineWidth = 0.6 + noise(seed, 63 + i) * 1.4;
      c.beginPath();
      for (let t = 0; t <= 1.001; t += 0.125) {
        const along = (across ? x0 : y0) + t * (across ? w : h), drift = at + Math.sin(t * TAU + seed) * wave + (t - 0.5) * angle * span;
        const [px, py] = across ? [along, y0 + drift] : [x0 + drift, along];
        if (t) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.stroke();
    }
  }
  // Mid-scale grain: the texture of the rock rather than of the pixels.
  for (let i = 0, flecks = Math.round((w * h) / 9); i < flecks; i++) {
    const n = seed * 977 + i;
    c.fillStyle = noise(n, 46) > 0.55 ? "rgba(255,250,236,0.07)" : "rgba(22,24,20,0.08)";
    const size = 0.5 + noise(n, 47) * 0.9;
    c.fillRect(x0 + noise(n, 48) * w, y0 + noise(n, 49) * h, size, size * (0.5 + noise(n, 50)));
  }
  if (lit) {
    const g = c.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, "rgba(255,248,228,0.13)");
    g.addColorStop(0.32, "rgba(255,248,228,0)");
    g.addColorStop(0.68, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.18)");
    c.fillStyle = g;
    c.fillRect(x0, y0, w, h);
  }
  // Pits catch a fleck of light on their far rim.
  for (let i = 0, pits = Math.round((w * h) / 150); i < pits; i++) {
    const x = x0 + 3 + noise(seed * 31 + i, 24) * (w - 6), y = y0 + 3 + noise(seed * 31 + i, 25) * (h - 6);
    const r = 0.25 + noise(seed * 31 + i, 26) ** 2 * 0.8;
    c.fillStyle = `rgba(28,28,24,${0.22 + noise(seed * 31 + i, 27) * 0.25})`;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.fillStyle = "rgba(255,250,236,0.08)";
    c.beginPath(); c.arc(x + r * 0.6, y + r * 0.6, r * 0.6, 0, TAU); c.fill();
  }
  if (noise(seed, 30) > 0.7) {
    let x = x0 + inset + noise(seed, 31) * (w - inset * 2), y = noise(seed, 32) > 0.5 ? y0 + inset : y1 - inset;
    const points = [[x, y]], down = y < y0 + h / 2 ? 1 : -1;
    for (let i = 0; i < 4; i++) {
      x += (noise(seed, 33 + i) - 0.5) * 7;
      y += down * (2.5 + noise(seed, 37 + i) * 4);
      points.push([x, y]);
    }
    for (const [style, width, dx] of [["rgba(18,18,16,0.55)", 0.55, 0], ["rgba(255,248,230,0.1)", 0.4, 0.45]]) {
      c.strokeStyle = style; c.lineWidth = width;
      c.beginPath();
      points.forEach(([px, py], i) => (i ? c.lineTo(px + dx, py + dx) : c.moveTo(px + dx, py + dx)));
      c.stroke();
    }
  }
  c.restore();
  c.strokeStyle = "rgba(255,248,230,0.07)";
  c.lineWidth = 0.6;
  stonePath(c, cell, inset + 0.6, seed, radius);
  c.stroke();
}

function mortar(c, color) {
  c.fillStyle = color;
  c.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = noise(i, 51) > 0.5 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.14)";
    c.fillRect(noise(i, 52) * TEX, noise(i, 53) * TEX, 0.6, 0.6);
  }
}

/* Clumps of moss; painted before stones they only show in the joints. */
function moss(c, count, seed, alpha) {
  for (let i = 0; i < count; i++) {
    const x = noise(i, seed) * TEX, y = noise(i, seed + 1) * TEX, r = 1.2 + noise(i, seed + 2) * 2.6;
    wrapped(x, y, r * 2, (px, py) => {
      for (let k = 0; k < 7; k++) {
        const n = i * 7 + k;
        c.fillStyle = `rgba(${66 + noise(n, seed + 3) * 34},${92 + noise(n, seed + 4) * 34},50,${alpha})`;
        c.beginPath();
        c.arc(px + (noise(n, seed + 5) - 0.5) * r * 2, py + (noise(n, seed + 6) - 0.5) * r * 2, 0.5 + noise(n, seed + 7) * 1.1, 0, TAU);
        c.fill();
      }
    });
  }
}

// Tile-aligned ashlar: every map edge is a joint, so a floor tile can turn or
// mirror (see tileScatter) without cutting a stone at its border.
const FLAG_X = [0, 30, 67, 95, 128], FLAG_Y = [0, 34, 63, 97, 128];
const FLAGS = [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 2], [2, 1, 1, 1], [0, 2, 1, 2], [1, 2, 2, 1], [3, 2, 1, 1], [1, 3, 1, 1], [2, 3, 2, 1]];
function paintFlags(c) {
  mortar(c, "#383b33");
  moss(c, 16, 60, 0.45);
  FLAGS.forEach(([x, y, w, h], i) =>
    stone(c, [FLAG_X[x], FLAG_Y[y], FLAG_X[x + w], FLAG_Y[y + h]], 100 + i, { value: [122, 150], inset: 1.3, radius: 3, hues: FLAG_HUES }));
  moss(c, 5, 70, 0.22);
}

// Running-bond wall courses with uneven block lengths. Neighboring rows keep
// their head joints at least ten units apart, including across the wrap.
const COURSES = [[0, [36, 28, 40, 24]], [17, [30, 42, 26, 30]], [30, [44, 24, 32, 28]], [50, [38, 26, 30, 34]]];
function paintCourses(c) {
  mortar(c, "#2f332f");
  moss(c, 10, 80, 0.4);
  COURSES.forEach(([offset, widths], row) => {
    let x = offset;
    widths.forEach((w, i) => {
      const seed = 200 + row * 8 + i, cx = x + w / 2, cy = row * 32 + 16;
      wrapped(cx, cy, w / 2 + 2, (px, py) =>
        stone(c, [px - w / 2, py - 16, px + w / 2, py + 16], seed, { value: [126, 168], inset: 1.2, radius: 2.4, lit: true }));
      x += w;
    });
  });
  moss(c, 4, 90, 0.2);
}

function paintGrass(c) {
  c.fillStyle = "#788863";
  c.fillRect(0, 0, TEX, TEX);
  // Broad, soft patches so a field never reads as one flat green.
  for (let i = 0; i < 18; i++) {
    const x = noise(i, 21) * TEX, y = noise(i, 22) * TEX, r = 14 + noise(i, 23) * 24;
    const tone = noise(i, 24) > 0.5 ? "164,176,98" : noise(i, 25) > 0.65 ? "108,90,58" : "42,64,36";
    wrapped(x, y, r, (px, py) => {
      const g = c.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${tone},0.24)`);
      g.addColorStop(1, `rgba(${tone},0)`);
      c.fillStyle = g;
      c.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 110; i++) {
    const x = noise(i, 41) * TEX, y = noise(i, 42) * TEX, r = 1.2 + noise(i, 43) * 1.6;
    wrapped(x, y, r * 2, (px, py) => {
      c.fillStyle = "rgba(36,54,30,0.13)";
      c.beginPath(); c.ellipse(px, py, r * 1.4, r, noise(i, 44) * 3, 0, TAU); c.fill();
    });
  }
  // Blades from dark to light so the sunlit tips sit on top.
  const blades = Array.from({ length: 3000 }, (_, i) => [i, noise(i, 31)]).sort((a, b) => a[1] - b[1]);
  for (const [i, t] of blades) {
    const x = noise(i, 32) * TEX, y = noise(i, 33) * TEX;
    const length = 3 + noise(i, 34) * 4.2, lean = (noise(i, 35) - 0.5) * 3.2, width = 0.3 + noise(i, 36) * 0.3;
    const warm = noise(i, 37) * 14;
    c.fillStyle = `rgba(${Math.round(64 + t * 116 + warm)},${Math.round(88 + t * 106)},${Math.round(52 + t * 78)},0.8)`;
    wrapped(x, y, 7, (px, py) => {
      c.beginPath();
      c.moveTo(px - width, py);
      c.quadraticCurveTo(px + lean * 0.25, py - length * 0.6, px + lean, py - length);
      c.quadraticCurveTo(px + lean * 0.25 + width * 0.4, py - length * 0.5, px + width, py);
      c.fill();
    });
  }
  for (let i = 0; i < 9; i++) {
    const x = noise(i, 46) * TEX, y = noise(i, 47) * TEX, petal = noise(i, 48) > 0.5 ? "236,230,204" : "232,208,118";
    wrapped(x, y, 4, (px, py) => {
      for (let k = 0; k < 3; k++) {
        c.fillStyle = `rgba(${petal},0.82)`;
        c.beginPath(); c.arc(px + Math.cos(k * 2.1 + i) * 0.9, py + Math.sin(k * 2.1 + i) * 0.9, 0.55, 0, TAU); c.fill();
      }
    });
  }
  for (let i = 0; i < 6; i++) {
    const x = noise(i, 56) * TEX, y = noise(i, 57) * TEX, r = 0.7 + noise(i, 58) * 1.1;
    wrapped(x, y, 4, (px, py) => {
      c.fillStyle = "rgba(30,34,26,0.45)";
      c.beginPath(); c.ellipse(px + 0.3, py + 0.4, r * 1.2, r * 0.8, 0, 0, TAU); c.fill();
      c.fillStyle = "rgba(148,144,128,0.85)";
      c.beginPath(); c.ellipse(px, py, r * 1.2, r * 0.8, 0, 0, TAU); c.fill();
    });
  }
}

/* Slate courses: rows run along the canvas x axis with their exposed lips
   toward the canvas bottom (the eave). Each row overlaps the one below it. */
function paintRoof(c) {
  c.fillStyle = "#262c2a";
  c.fillRect(0, 0, TEX, TEX);
  const rows = Array.from({ length: 8 }, (_, row) => {
    const raw = Array.from({ length: 8 }, (_, i) => 12 + noise(row * 8 + i, 71) * 8);
    const scale = TEX / raw.reduce((sum, w) => sum + w, 0);
    return { offset: (row % 2) * 7 + noise(row, 70) * 4, widths: raw.map((w) => w * scale) };
  });
  const drawRow = (row, oy) => {
    const y0 = row * 16 + oy, y1 = y0 + 17;
    let x = rows[row].offset;
    rows[row].widths.forEach((w, i) => {
      const seed = 300 + row * 8 + i, v = 102 + noise(seed, 72) * 46, mossy = noise(seed, 73) > 0.93;
      const base = mossy ? [v * 0.92, v * 1.04, v * 0.82] : [v, v * 1.01, v * 1.03];
      for (const ox of [-TEX, 0, TEX]) {
        const cx = x + w / 2 + ox;
        if (cx + w / 2 < 0 || cx - w / 2 > TEX) continue;
        const left = cx - w / 2 + 0.5, right = cx + w / 2 - 0.5, sag = (noise(seed, 74) - 0.5) * 1.2;
        const g = c.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, shade(base, 0.62));
        g.addColorStop(0.35, shade(base, 0.92));
        g.addColorStop(1, shade(base, 1.06));
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(left, y0);
        c.lineTo(right, y0);
        c.lineTo(right, y1 - 1.6);
        c.quadraticCurveTo(right, y1 + sag, right - 1.6, y1 + sag);
        c.lineTo(left + 1.6, y1 - sag);
        c.quadraticCurveTo(left, y1 - sag, left, y1 - 1.6);
        c.closePath();
        c.fill();
        c.strokeStyle = "rgba(255,250,236,0.14)";
        c.lineWidth = 0.6;
        c.beginPath(); c.moveTo(left + 1.4, y1 - 0.9 - sag); c.lineTo(right - 1.4, y1 - 0.9 + sag); c.stroke();
        for (let k = 0; k < 2; k++) {
          c.fillStyle = noise(seed, 75 + k) > 0.7 ? "rgba(214,212,170,0.2)" : "rgba(20,22,20,0.2)";
          c.beginPath();
          c.arc(left + 2 + noise(seed, 78 + k) * (w - 4), y0 + 7 + noise(seed, 81 + k) * 7, 0.4 + noise(seed, 84 + k) * 0.7, 0, TAU);
          c.fill();
        }
      }
      x += w;
    });
  };
  for (let row = 7; row >= 0; row--) drawRow(row, 0);
  drawRow(7, -TEX);
}

function paintWood(c) {
  c.fillStyle = "#3a3026";
  c.fillRect(0, 0, TEX, TEX);
  for (let p = 0; p < 4; p++) {
    const x0 = p * 32 + 0.6, tone = [156, 135, 108].map((v) => v * (0.9 + noise(p, 80) * 0.2));
    c.save();
    c.beginPath(); c.rect(x0, 0, 30.8, TEX); c.clip();
    c.fillStyle = shade(tone, 1);
    c.fillRect(x0, 0, 30.8, TEX);
    // Grain waves repeat a whole number of times per map, so planks tile vertically.
    for (let i = 0; i < 24; i++) {
      const n = p * 40 + i, gx = x0 + 1 + noise(n, 81) * 29, amp = 0.2 + noise(n, 82) * 0.9;
      const waves = 1 + Math.floor(noise(n, 83) * 2), phase = noise(n, 84) * TAU;
      c.strokeStyle = noise(n, 85) > 0.28
        ? `rgba(62,42,24,${0.1 + noise(n, 86) * 0.24})`
        : `rgba(255,236,200,${0.07 + noise(n, 86) * 0.09})`;
      c.lineWidth = 0.25 + noise(n, 87) * 0.55;
      c.beginPath();
      for (let y = 0; y <= TEX; y += 2) {
        const x = gx + Math.sin((y / TEX) * TAU * waves + phase) * amp;
        if (y) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.stroke();
    }
    if (noise(p, 88) > 0.4) {
      const kx = x0 + 8 + noise(p, 89) * 15, ky = noise(p, 90) * TEX;
      wrapped(kx, ky, 6, (px, py) => {
        for (let ring = 3; ring >= 0; ring--) {
          c.strokeStyle = `rgba(58,36,20,${0.18 + (3 - ring) * 0.08})`;
          c.lineWidth = 0.5;
          c.beginPath(); c.ellipse(px, py, 1 + ring * 0.7, 1.8 + ring * 1.1, 0, 0, TAU); c.stroke();
        }
        c.fillStyle = "rgba(52,32,18,0.7)";
        c.beginPath(); c.ellipse(px, py, 0.9, 1.5, 0, 0, TAU); c.fill();
      });
    }
    if (noise(p, 91) > 0.45) {
      const jy = 10 + noise(p, 92) * (TEX - 20);
      c.fillStyle = "rgba(30,22,14,0.75)";
      c.fillRect(x0, jy - 0.45, 30.8, 0.9);
      for (const [nx, ny] of [[4, -3], [26.8, -3], [4, 3], [26.8, 3]]) {
        c.fillStyle = "rgba(34,30,28,0.85)";
        c.beginPath(); c.arc(x0 + nx, jy + ny, 0.75, 0, TAU); c.fill();
        c.fillStyle = "rgba(220,214,200,0.3)";
        c.beginPath(); c.arc(x0 + nx - 0.25, jy + ny - 0.25, 0.3, 0, TAU); c.fill();
      }
    }
    c.restore();
    c.fillStyle = "rgba(255,240,212,0.13)";
    c.fillRect(x0, 0, 0.6, TEX);
    c.fillStyle = "rgba(0,0,0,0.26)";
    c.fillRect(x0 + 30, 0, 0.8, TEX);
  }
}

// Volcano floors: cooled basalt slabs (a periodic Voronoi of 9 jittered seeds)
// split by fissures, some still glowing. Every map edge is a joint, so per-tile
// turns stay seamless, and only joints between slabs glow so tiles agree.
function paintBasalt(c) {
  const size = c.canvas.width, k = TEX / size, N = 3, cell = TEX / N;
  const seeds = Array.from({ length: N * N }, (_, i) => [
    ((i % N) + 0.2 + noise(i, 101) * 0.6) * cell,
    (Math.floor(i / N) + 0.2 + noise(i, 102) * 0.6) * cell,
    84 + noise(i, 103) * 36,
  ]);
  const image = c.createImageData(size, size), data = image.data;
  const ease = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = (px + 0.5) * k, v = (py + 0.5) * k, gx = Math.floor(u / cell), gy = Math.floor(v / cell);
    let d1 = Infinity, d2 = Infinity, s1 = 0, s2 = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = gx + ox, cy = gy + oy, wx = (cx + N) % N, wy = (cy + N) % N, i = wy * N + wx;
      const d = Math.hypot(u - seeds[i][0] - (cx - wx) * cell, v - seeds[i][1] - (cy - wy) * cell);
      if (d < d1) { d2 = d1; s2 = s1; d1 = d; s1 = i; } else if (d < d2) { d2 = d; s2 = i; }
    }
    const border = Math.min(u, TEX - u, v, TEX - v), seam = (d2 - d1) / 2, edge = Math.min(seam, border);
    const hot = seam < border && noise(Math.min(s1, s2) * 17 + Math.max(s1, s2), 104) > 0.7;
    const o = (py * size + px) * 4;
    let r, g, b;
    if (edge < 1.2) {
      const t = 1 - edge / 1.2;
      [r, g, b] = hot ? [190 + 65 * t, 80 + 70 * t, 30 + 30 * t] : [30, 26, 24];
    } else {
      // Gas pocks: sparse darker vesicles on a one-unit grid.
      const pock = noise(Math.floor(u * 1.5), Math.floor(v * 1.5) + 211) > 0.965 ? 0.72 : 1;
      const value = seeds[s1][2] * (0.78 + 0.27 * ease(1.2, 10, edge)) * pock;
      [r, g, b] = [value * 1.03, value * 0.98, value * 0.92];
      if (hot && seam < 3.6) {
        const heat = (1 - (seam - 1.2) / 2.4) * 0.42;
        r += (205 - r) * heat; g += (95 - g) * heat; b += (45 - b) * heat;
      }
    }
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  }
  c.putImageData(image, 0, 0);
}

const PAINTERS = { flags: paintFlags, grass: paintGrass, wood: paintWood, roof: paintRoof, stone: paintCourses, basalt: paintBasalt };
const GRAIN = { flags: 9, grass: 7, wood: 5, roof: 6, stone: 9, basalt: 10 };
/* Per-texel grain, independent of the drawing transform; mips average it away. */
function grain(c, size, amount) {
  const image = c.getImageData(0, 0, size, size), data = image.data;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    let h = Math.imul(p ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    const n = (((h ^ (h >>> 16)) & 255) / 255 - 0.5) * amount;
    data[i] += n; data[i + 1] += n; data[i + 2] += n;
  }
  c.putImageData(image, 0, 0);
}

// Deterministic, locally generated surface maps: no network assets or loading races.
// Unknown kinds (the volcano's "volcanic") use the wall courses.
export function texture(kind, resolution = MAP_SIZE) {
  const mapKey = resolution === MAP_SIZE ? kind : `${kind}@${resolution}`;
  if (maps.has(mapKey)) return maps.get(mapKey);
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    // Node model checks build scenery without a canvas: one neutral texel.
    const flat = new THREE.DataTexture(new Uint8Array([138, 137, 128, 255]), 1, 1);
    flat.needsUpdate = true;
    maps.set(mapKey, flat);
    return flat;
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = resolution;
  const c = canvas.getContext("2d", { willReadFrequently: true });
  // Use one logical pattern at every resolution so color, normal and
  // roughness maps share the same courses.
  c.scale(resolution / TEX, resolution / TEX);
  (PAINTERS[kind] ?? paintCourses)(c);
  grain(c, resolution, GRAIN[kind] ?? GRAIN.stone);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  // Anisotropy stays 2 (the balanced hitch cap). Blending two mips is what
  // softens the stone; pick the nearer mip and keep linear samples inside it
  // so the mortar does not turn into nearest-neighbor blocks.
  map.anisotropy = 2;
  map.magFilter = THREE.LinearFilter;
  // Roof shingles cross LOD boundaries while orbiting. Blend adjacent mips to
  // avoid abrupt crawling bands; stone retains its existing crisp sampling.
  map.minFilter = kind === "roof" ? THREE.LinearMipmapLinearFilter : THREE.LinearMipmapNearestFilter;
  map.generateMipmaps = true;
  maps.set(mapKey, map);
  return map;
}

/**
 * The parts of a surface that give off their own light: the glowing fissures
 * and their heat haze on basalt, black everywhere else. Lit Cinematic caves
 * use it as an emissive map, so lava still glows where no lantern reaches.
 */
export function glowMap(kind) {
  const id = `${kind}!glow`;
  if (maps.has(id)) return maps.get(id);
  const source = texture(kind).image;
  if (!source.getContext) return null;
  const { width, height } = source;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const c = canvas.getContext("2d");
  const image = source.getContext("2d").getImageData(0, 0, width, height), data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    // Only the molten cores of the fissures: red far above blue. Their rims
    // and the warmed rock beside them take light rather than give it.
    const heat = Math.max(0, Math.min(1, (data[i] - data[i + 2] - 150) / 60));
    data[i] = data[i + 1] = data[i + 2] = Math.round(heat * 255);
  }
  c.putImageData(image, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  maps.set(id, map);
  return map;
}

/** Same canvas as texture(kind), sampled on a different phase so walls do not share the floor courses. */
export function shiftedTexture(kind, key, ox, oy) {
  const id = `${kind}@${key}`;
  if (maps.has(id)) return maps.get(id);
  const map = texture(kind).clone();
  map.offset.set(ox, oy);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 2;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  maps.set(id, map);
  return map;
}
/** Same canvas as texture(kind) with its own placement: repeated once per tile
 *  across a large slab, or turned a quarter so roof courses follow the ridge. */
export function placedTexture(kind, key, { repeat = [1, 1], rotation = 0 } = {}) {
  const id = `${kind}#${key}`;
  if (maps.has(id)) return maps.get(id);
  const map = texture(kind).clone();
  map.repeat.set(...repeat);
  map.center.set(0.5, 0.5);
  map.rotation = rotation;
  map.needsUpdate = true;
  maps.set(id, map);
  return map;
}
function surfaceDetails(kind, resolution=MAP_SIZE) {
  const key=`${kind}:${resolution}`;
  if (details.has(key)) return details.get(key);
  const source = texture(kind,resolution).image;
  if (!source.getContext) {
    details.set(key, {});
    return details.get(key);
  }
  const { width, height } = source;
  const pixels = source.getContext("2d").getImageData(0, 0, width, height).data;
  const normals = new Uint8Array(width * height * 4), rough = new Uint8Array(normals.length);
  const luminance = (x, y) => {
    const i = (((y + height) % height) * width + ((x + width) % width)) * 4;
    return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 765;
  };
  // The color map is a CanvasTexture (flipY), so canvas row 0 is the top of
  // the texture. Data textures upload bottom row first: write rows flipped so
  // relief lines up with the painted mortar, and point +green up the texture.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = ((height - 1 - y) * width + x) * 4;
    const dx = (luminance(x - 2, y) - luminance(x + 2, y)) * 1.6;
    const dy = (luminance(x, y + 2) - luminance(x, y - 2)) * 1.6;
    const length = Math.hypot(dx, dy, 1);
    normals[i] = (dx / length * .5 + .5) * 255;
    normals[i + 1] = (dy / length * .5 + .5) * 255;
    normals[i + 2] = (1 / length * .5 + .5) * 255; normals[i + 3] = 255;
    const value = Math.round(190 + (1 - luminance(x, y)) * 60);
    rough[i] = rough[i + 1] = rough[i + 2] = value; rough[i + 3] = 255;
  }
  const normalMap = new THREE.DataTexture(normals, width, height);
  const roughnessMap = new THREE.DataTexture(rough, width, height);
  for (const map of [normalMap, roughnessMap]) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.needsUpdate = true;
    map.anisotropy = 8;
  }
  const result = { normalMap, roughnessMap };
  details.set(key, result); return result;
}
export function mat(color, extra = {}) {
  const key = `${color?.isColor ? color.getHex() : color}|${Object.entries(
    extra,
  )
    .map(
      ([k, v]) => `${k}:${v?.isTexture ? v.uuid : v?.isColor ? v.getHex() : v}`,
    )
    .join("|")}`;
  if (!materials.has(key))
    materials.set(
      key,
      new THREE.MeshStandardMaterial({ color, roughness: 0.78, ...extra }),
    );
  return materials.get(key);
}
// Instanced floors/walls fill the screen. Lambert without a bump map cuts the
// Balanced fragment cost that MeshStandardMaterial + bump paid on every pixel.
export function matLambert(color, extra = {}) {
  const key = `L|${color?.isColor ? color.getHex() : color}|${Object.entries(
    extra,
  )
    .map(
      ([k, v]) => `${k}:${v?.isTexture ? v.uuid : v?.isColor ? v.getHex() : v}`,
    )
    .join("|")}`;
  if (!materials.has(key))
    materials.set(key, new THREE.MeshLambertMaterial({ color, ...extra }));
  return materials.get(key);
}
/* Unlit dungeon terrain: constant brightness regardless of lights or zoom. */
export function matBasic(color, extra = {}) {
  const key = `B|${color?.isColor ? color.getHex() : color}|${Object.entries(
    extra,
  )
    .map(
      ([k, v]) => `${k}:${v?.isTexture ? v.uuid : v?.isColor ? v.getHex() : v}`,
    )
    .join("|")}`;
  if (!materials.has(key))
    materials.set(key, new THREE.MeshBasicMaterial({ color, ...extra }));
  return materials.get(key);
}
/** Relief maps placed like a shifted, repeated or turned color map. */
function alignedDetails(kind, map) {
  const base = surfaceDetails(kind);
  if (!base.normalMap || !map || (!map.offset.x && !map.offset.y && map.repeat.x === 1 && map.repeat.y === 1 && !map.rotation)) return base;
  const key = `${kind}@${map.offset.x},${map.offset.y}|${map.repeat.x},${map.repeat.y}|${map.rotation}`;
  if (!details.has(key)) {
    const shift = (source) => {
      const copy = source.clone();
      copy.offset.copy(map.offset);
      copy.repeat.copy(map.repeat);
      copy.center.copy(map.center);
      copy.rotation = map.rotation;
      copy.needsUpdate = true;
      return copy;
    };
    details.set(key, { normalMap: shift(base.normalMap), roughnessMap: shift(base.roughnessMap) });
  }
  return details.get(key);
}
export function surface(kind, color, extra = {}) {
  const map = texture(kind);
  return mat(color, {
    map,
    ...alignedDetails(kind, extra.map),
    normalScale: new THREE.Vector2(kind === "grass" ? .2 : .45, kind === "grass" ? .2 : .45),
    roughness: kind === "roof" ? 0.85 : 0.88,
    ...extra,
  });
}
export function surfaceLambert(kind, color, extra = {}) {
  return matLambert(color, { map: texture(kind), ...extra });
}
// Dungeon terrain lock: MeshBasic + map. Never drop the map for “perf” unless
// Ivan explicitly requests a texture change — unmapped Basic floors go flat white.
export function surfaceBasic(kind, color, extra = {}) {
  return matBasic(color, { map: texture(kind), ...extra });
}

// Turn and mirror each instanced floor tile's maps (eight orientations hashed
// from the tile position) so one stone layout does not repeat across a room.
// Flagstone and grass maps have no edge features, so turned tiles stay seamless.
const TILE_SCATTER = `#include <uv_vertex>
#ifdef USE_INSTANCING
  {
    vec2 tileCell = floor( instanceMatrix[ 3 ].xz + 0.5 );
    float tilePick = floor( fract( sin( dot( tileCell, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ) * 8.0 );
    float tileAngle = mod( tilePick, 4.0 ) * 1.5707963;
    float tileCos = round( cos( tileAngle ) ), tileSin = round( sin( tileAngle ) );
    mat2 tileTurn = mat2( tileCos, tileSin, - tileSin, tileCos );
    vec2 tileFlip = vec2( tilePick >= 4.0 ? - 1.0 : 1.0, 1.0 );
    #ifdef USE_MAP
      vMapUv = tileTurn * ( tileFlip * ( vMapUv - 0.5 ) ) + 0.5;
    #endif
    #ifdef USE_NORMALMAP
      vNormalMapUv = tileTurn * ( tileFlip * ( vNormalMapUv - 0.5 ) ) + 0.5;
    #endif
    #ifdef USE_ROUGHNESSMAP
      vRoughnessMapUv = tileTurn * ( tileFlip * ( vRoughnessMapUv - 0.5 ) ) + 0.5;
    #endif
    #ifdef USE_EMISSIVEMAP
      vEmissiveMapUv = tileTurn * ( tileFlip * ( vEmissiveMapUv - 0.5 ) ) + 0.5;
    #endif
  }
#endif`;
export function injectTileScatter(shader) {
  shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", TILE_SCATTER);
}
/** The per-tile scattered variant of a floor material (cached per base material). */
export function tileScatter(base) {
  let material = scattered.get(base);
  if (material) return material;
  material = base.clone();
  material.userData.tileScatter = true;
  material.onBeforeCompile = injectTileScatter;
  material.customProgramCacheKey = () => "tile-scatter";
  scattered.set(base, material);
  return material;
}

// Walls and caps lay their courses by where they stand, not by each block's own
// faces: rows run level from block to block and around corners, bricks keep one
// size on full and cut-down walls, and wall tops pave on in one direction
// instead of turning block by block. One texture period is one tile.
const WORLD_MASONRY = (base) => `#include <uv_vertex>
#ifdef USE_INSTANCING
  {
    vec3 masonryAt = ( modelMatrix * instanceMatrix * vec4( position, 1.0 ) ).xyz;
    vec3 masonryFace = abs( mat3( instanceMatrix ) * normal );
    vec2 masonryUv = masonryFace.y > max( masonryFace.x, masonryFace.z ) ? masonryAt.xz
      : vec2( masonryFace.x > masonryFace.z ? masonryAt.z : masonryAt.x, masonryAt.y - ${base.toFixed(4)} );
    #ifdef USE_MAP
      vMapUv = ( mapTransform * vec3( masonryUv, 1.0 ) ).xy;
    #endif
    #ifdef USE_NORMALMAP
      vNormalMapUv = ( normalMapTransform * vec3( masonryUv, 1.0 ) ).xy;
    #endif
    #ifdef USE_ROUGHNESSMAP
      vRoughnessMapUv = ( roughnessMapTransform * vec3( masonryUv, 1.0 ) ).xy;
    #endif
  }
#endif`;
/** The world-laid variant of a wall material, with a course joint at `base` (cached per base material). */
export function worldMasonry(base, floorLine = 0) {
  const key = `${base.uuid}@${floorLine}`;
  let material = masonry.get(key);
  if (material) return material;
  material = base.clone();
  material.userData.worldMasonry = true;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", WORLD_MASONRY(floorLine));
  };
  material.customProgramCacheKey = () => `world-masonry:${floorLine}`;
  masonry.set(key, material);
  return material;
}

/** D11 and below, including the volcano, share one warmer stone multiply. */
export const WARM_STONE_LEVEL = 11;

// Multiply colors only. The stone/grass images stay; floors read lighter than walls.
export const STONE_TINT = Object.freeze({
  townFloor: 0xffffff,
  townWall: 0x99aba7,
  townCap: 0xb2bbad,
  caveFloor: 0xd0d9d3,
  caveWall: 0x73847d,
  caveCap: 0x7d8e87,
  warmFloor: 0xe6d0b4,
  warmWall: 0x856856,
  warmCap: 0x8f735c,
});

export const stoneTint = (level = 0) => {
  if (!level)
    return {
      floor: STONE_TINT.townFloor,
      wall: STONE_TINT.townWall,
      cap: STONE_TINT.townCap,
    };
  if (level >= WARM_STONE_LEVEL)
    return {
      floor: STONE_TINT.warmFloor,
      wall: STONE_TINT.warmWall,
      cap: STONE_TINT.warmCap,
    };
  return {
    floor: STONE_TINT.caveFloor,
    wall: STONE_TINT.caveWall,
    cap: STONE_TINT.caveCap,
  };
};


export function releaseMaterialResources() {
  maps.forEach((map) => map.dispose());
  details.forEach(({ normalMap, roughnessMap }) => { normalMap.dispose(); roughnessMap.dispose(); });
  materials.forEach((material) => material.dispose());
  scattered.forEach((material) => material.dispose());
  masonry.forEach((material) => material.dispose());
}
