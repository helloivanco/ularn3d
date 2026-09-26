import * as THREE from "three";

const maps = new Map();
const materials = new Map();
const TEX = 128;
export const noise = (x, y = 0) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

// Deterministic, locally generated surface maps: no network assets or loading races.
// 128² textures keep the look while cutting GPU memory and upload cost ~4× vs 256.
export function texture(kind) {
  if (maps.has(kind)) return maps.get(kind);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEX;
  const c = canvas.getContext("2d");
  c.fillStyle = kind === "grass" ? "#7c886d" : "#8a8980";
  c.fillRect(0, 0, TEX, TEX);
  if (kind === "grass") {
    for (let i = 0; i < 2800; i++) {
      const v = Math.floor(85 + noise(i, 2) * 80);
      c.fillStyle = `rgba(${v},${v + 8},${v - 12},.32)`;
      c.fillRect(
        noise(i, 3) * TEX,
        noise(i, 4) * TEX,
        1 + noise(i, 5) * 3,
        1 + noise(i, 6) * 4,
      );
    }
    for (let i = 0; i < 40; i++) {
      c.fillStyle = "#b6b79430";
      c.beginPath();
      c.ellipse(
        noise(i, 7) * TEX,
        noise(i, 8) * TEX,
        noise(i, 9) * 8,
        noise(i, 10) * 5,
        0,
        0,
        Math.PI * 2,
      );
      c.fill();
    }
  } else if (kind === "wood") {
    c.fillStyle = "#9b8b73";
    c.fillRect(0, 0, TEX, TEX);
    for (let i = 0; i < 90; i++) {
      c.strokeStyle = `rgba(36,30,20,${0.03 + noise(i) * 0.17})`;
      c.beginPath();
      const x = noise(i, 2) * TEX;
      c.moveTo(x, 0);
      c.bezierCurveTo(x + 4, 45, x - 5, 90, x + 2, TEX);
      c.stroke();
    }
    for (let x = 0; x < TEX; x += 32) {
      c.fillStyle = "#302c2860";
      c.fillRect(x, 0, 2, TEX);
    }
  } else {
    const roof = kind === "roof",
      size = roof ? 16 : 32;
    c.fillStyle = roof ? "#333d3c" : "#393f3c";
    c.fillRect(0, 0, TEX, TEX);
    for (let y = -1; y < TEX / size + 1; y++)
      for (let x = -1; x < TEX / size + 1; x++) {
        const px = x * size + (y % 2 ? size / 2 : 0),
          py = y * size;
        const v = 100 + Math.floor(noise(x + 40, y + 50) * 55);
        c.fillStyle = `rgb(${v + 5},${v + 7},${v})`;
        c.beginPath();
        c.roundRect(
          px + 1,
          py + 1,
          size - 2,
          size - (roof ? 1 : 2),
          roof ? 1 : 3,
        );
        c.fill();
        c.strokeStyle = "#ffffff20";
        c.beginPath();
        c.moveTo(px + 3, py + 2);
        c.lineTo(px + size - 3, py + 2);
        c.stroke();
      }
    for (let i = 0; i < 1800; i++) {
      c.fillStyle = noise(i, 11) > 0.5 ? "#ffffff0b" : "#00000016";
      c.fillRect(noise(i, 12) * TEX, noise(i, 13) * TEX, 1.2, 1.2);
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 2;
  map.generateMipmaps = true;
  maps.set(kind, map);
  return map;
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
export function surface(kind, color, extra = {}) {
  const map = texture(kind);
  return mat(color, {
    map,
    bumpMap: map,
    bumpScale: kind === "grass" ? 0.018 : 0.035,
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
