import * as THREE from "three";

const maps = new Map();
const materials = new Map();
const TEX = 128;
const details = new Map();
export const noise = (x, y = 0) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

// Deterministic, locally generated surface maps: no network assets or loading races.
// 128² textures keep the look while cutting GPU memory and upload cost ~4× vs 256.
export function texture(kind, resolution = 128) {
  const mapKey=resolution===128 ? kind : `${kind}@${resolution}`;
  if (maps.has(mapKey)) return maps.get(mapKey);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = resolution;
  const c = canvas.getContext("2d");
  // Use one logical pattern at every resolution. Previously the color map
  // cropped a different set of courses than the 512px normal/roughness maps.
  c.scale(resolution / TEX, resolution / TEX);
  c.fillStyle = kind === "grass" ? "#7c886d" : "#8a8980";
  c.fillRect(0, 0, TEX, TEX);
  if (kind === "grass") {
    for (let i = 0; i < 16; i++) {
      const dirt = noise(i, 21) > 0.45;
      c.fillStyle = dirt ? "rgba(92,74,46,0.28)" : "rgba(62,86,48,0.34)";
      c.beginPath();
      c.ellipse(
        noise(i, 22) * TEX,
        noise(i, 23) * TEX,
        8 + noise(i, 24) * 22,
        5 + noise(i, 25) * 14,
        noise(i, 26) * 3,
        0,
        Math.PI * 2,
      );
      c.fill();
    }
    for (let i = 0; i < 2800; i++) {
      const v = Math.floor(70 + noise(i, 2) * 100);
      const moss = noise(i, 7) > 0.72;
      c.fillStyle = moss
        ? `rgba(${v - 20},${v + 16},${v - 28},.4)`
        : `rgba(${v},${v + 8},${v - 16},.34)`;
      c.fillRect(
        noise(i, 3) * TEX,
        noise(i, 4) * TEX,
        1 + noise(i, 5) * 3,
        1 + noise(i, 6) * 5,
      );
    }
    for (let i = 0; i < 40; i++) {
      c.fillStyle = noise(i, 11) > 0.6 ? "#8a734430" : "#b6b79430";
      c.beginPath();
      c.ellipse(
        noise(i, 7) * TEX,
        noise(i, 8) * TEX,
        noise(i, 9) * 8,
        noise(i, 10) * 5,
        noise(i, 12),
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
        const wear = noise(x + 2, y + 6);
        const chip = wear > 0.82 ? 3 : 0;
        c.fillStyle = `rgb(${v + 5},${v + 7},${v - (wear < 0.18 ? 8 : 0)})`;
        c.beginPath();
        c.roundRect(
          px + 1 + chip * 0.3,
          py + 1,
          size - 2 - chip,
          size - (roof ? 1 : 2) - (wear > 0.9 ? 2 : 0),
          roof ? 1 : 2 + wear * 2,
        );
        c.fill();
        if (!roof && wear > 0.74) {
          c.fillStyle = "rgba(58,78,48,0.35)";
          c.fillRect(px + 3, py + size - 7, size - 8, 3);
        }
        c.strokeStyle = wear > 0.5 ? "#ffffff14" : "#ffffff22";
        c.beginPath();
        c.moveTo(px + 3, py + 2);
        c.lineTo(px + size - 4, py + 2);
        c.stroke();
      }
    if (!roof) {
      for (let i = 0; i < 22; i++) {
        c.strokeStyle = `rgba(28,24,18,${0.2 + noise(i, 20) * 0.45})`;
        c.lineWidth = 1;
        c.beginPath();
        const x = noise(i, 21) * TEX;
        const y = noise(i, 22) * TEX;
        c.moveTo(x, y);
        c.lineTo(x + (noise(i, 23) - 0.5) * 36, y + 6 + noise(i, 24) * 26);
        c.stroke();
      }
      for (let i = 0; i < 12; i++) {
        c.fillStyle = `rgba(86,68,40,${0.1 + noise(i, 40) * 0.16})`;
        c.beginPath();
        c.ellipse(
          noise(i, 41) * TEX,
          noise(i, 42) * TEX,
          8 + noise(i, 43) * 18,
          4 + noise(i, 44) * 10,
          noise(i, 45),
          0,
          Math.PI * 2,
        );
        c.fill();
      }
    }
    for (let i = 0; i < 1800; i++) {
      c.fillStyle = noise(i, 11) > 0.5 ? "#ffffff0b" : "#00000016";
      c.fillRect(noise(i, 12) * TEX, noise(i, 13) * TEX, 1.2, 1.2);
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  // Anisotropy stays 2 (the balanced hitch cap). Blending two mips is what
  // softens the stone; pick the nearer mip and keep linear samples inside it
  // so the mortar does not turn into nearest-neighbor blocks.
  map.anisotropy = 2;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapNearestFilter;
  map.generateMipmaps = true;
  maps.set(mapKey, map);
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
function surfaceDetails(kind, resolution=512) {
  const key=`${kind}:${resolution}`;
  if (details.has(key)) return details.get(key);
  const source = texture(kind,resolution).image;
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
export function surfaceLambert(kind, color, extra = {}) {
  return matLambert(color, { map: texture(kind), ...extra });
}
// Dungeon terrain lock: MeshBasic + map. Never drop the map for “perf” unless
// Ivan explicitly requests a texture change — unmapped Basic floors go flat white.
export function surfaceBasic(kind, color, extra = {}) {
  return matBasic(color, { map: texture(kind), ...extra });
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
}
