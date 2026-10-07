import * as THREE from "three";

const maps = new Map();
const materials = new Map();
const details = new Map();
export const noise = (x, y = 0) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

// Deterministic, locally generated surface maps: no network assets or loading races.
export function texture(kind) {
  if (maps.has(kind)) return maps.get(kind);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const c = canvas.getContext("2d");
  c.scale(2, 2);
  c.fillStyle = kind === "grass" ? "#7c886d" : "#8a8980";
  c.fillRect(0, 0, 256, 256);
  if (kind === "grass") {
    for (let i = 0; i < 11000; i++) {
      const v = Math.floor(85 + noise(i, 2) * 80);
      c.fillStyle = `rgba(${v},${v + 8},${v - 12},.32)`;
      c.fillRect(
        noise(i, 3) * 256,
        noise(i, 4) * 256,
        1 + noise(i, 5) * 3,
        1 + noise(i, 6) * 4,
      );
    }
    for (let i = 0; i < 70; i++) {
      c.fillStyle = "#b6b79430";
      c.beginPath();
      c.ellipse(
        noise(i, 7) * 256,
        noise(i, 8) * 256,
        noise(i, 9) * 14,
        noise(i, 10) * 8,
        0,
        0,
        Math.PI * 2,
      );
      c.fill();
    }
  } else if (kind === "wood") {
    c.fillStyle = "#9b8b73";
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 190; i++) {
      c.strokeStyle = `rgba(36,30,20,${0.03 + noise(i) * 0.17})`;
      c.beginPath();
      const x = noise(i, 2) * 256;
      c.moveTo(x, 0);
      c.bezierCurveTo(x + 8, 90, x - 9, 180, x + 3, 256);
      c.stroke();
    }
    for (let x = 0; x < 256; x += 64) {
      c.fillStyle = "#302c2860";
      c.fillRect(x, 0, 2, 256);
    }
  } else {
    const roof = kind === "roof",
      size = roof ? 32 : 64;
    c.fillStyle = roof ? "#333d3c" : kind === "volcanic" ? "#302b2b" : "#393f3c";
    c.fillRect(0, 0, 256, 256);
    for (let y = -1; y < 256 / size + 1; y++)
      for (let x = -1; x < 256 / size + 1; x++) {
        const px = x * size + (y % 2 ? size / 2 : 0),
          py = y * size;
        const v = 100 + Math.floor(noise(x + 40, y + 50) * 55);
        c.fillStyle = `rgb(${v + 5},${v + 7},${v})`;
        c.beginPath();
        c.roundRect(
          px + 2,
          py + 2,
          size - 4,
          size - (roof ? 1 : 4),
          roof ? 2 : 5,
        );
        c.fill();
        c.strokeStyle = "#ffffff20";
        c.beginPath();
        c.moveTo(px + 5, py + 4);
        c.lineTo(px + size - 5, py + 4);
        c.stroke();
        if (!roof && noise(x + 80, y + 20) > 0.6) {
          c.strokeStyle = "#27372e44";
          c.beginPath();
          c.moveTo(px + 15, py + 2);
          c.lineTo(px + 20, py + 22);
          c.lineTo(px + 12, py + 30);
          c.stroke();
        }
      }
    for (let i = 0; i < 7500; i++) {
      c.fillStyle = noise(i, 11) > 0.5 ? "#ffffff0b" : "#00000016";
      c.fillRect(noise(i, 12) * 256, noise(i, 13) * 256, 1.5, 1.5);
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  maps.set(kind, map);
  return map;
}
function surfaceDetails(kind) {
  if (details.has(kind)) return details.get(kind);
  const source = texture(kind).image;
  const { width, height } = source;
  const pixels = source.getContext("2d").getImageData(0, 0, width, height).data;
  const normals = new Uint8Array(width * height * 4), rough = new Uint8Array(normals.length);
  const luminance = (x, y) => {
    const i = (((y + height) % height) * width + ((x + width) % width)) * 4;
    return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 765;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const dx = (luminance(x - 2, y) - luminance(x + 2, y)) * 1.6;
    const dy = (luminance(x, y - 2) - luminance(x, y + 2)) * 1.6;
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
  details.set(kind, result); return result;
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
export function surface(kind, color, extra = {}) {
  const map = texture(kind);
  return mat(color, {
    map,
    ...surfaceDetails(kind),
    normalScale: new THREE.Vector2(kind === "grass" ? .2 : .45, kind === "grass" ? .2 : .45),
    roughness: kind === "roof" ? 0.85 : 0.88,
    ...extra,
  });
}

export function releaseMaterialResources() {
  maps.forEach((map) => map.dispose());
  details.forEach(({ normalMap, roughnessMap }) => { normalMap.dispose(); roughnessMap.dispose(); });
  materials.forEach((material) => material.dispose());
}
