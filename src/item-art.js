import * as THREE from "three";
import { lootShade } from "./models.js";

// Presentation-only floor artwork. Engine item IDs, args, names, stats, and
// classic Amiga `o{id}.png` tiles remain unchanged.
const ITEM_ART = Object.freeze({
  // Gems / valuables
  18: "/art/items/gold-pile.png",
  50: "/art/items/diamond.png",
  51: "/art/items/ruby.png",
  52: "/art/items/emerald.png",
  53: "/art/items/sapphire.png",
  // Magical / special
  3: "/art/items/orb-of-enlightenment.png",
  45: "/art/items/amulet-of-invisibility.png",
  46: "/art/items/orb-of-dragon-slaying.png",
  47: "/art/items/scarab-of-negate-spirit.png",
  48: "/art/items/cube-of-undead-control.png",
  49: "/art/items/device-of-theft-prevention.png",
  85: "/art/items/brass-lamp.png",
  86: "/art/items/hand-of-fear.png",
  87: "/art/items/talisman-of-the-sphere.png",
  88: "/art/items/wand-of-wonder.png",
  89: "/art/items/staff-of-power.png",
  // Weapons
  26: "/art/items/sword-of-slashing.png",
  27: "/art/items/bessmans-flailing-hammer.png",
  28: "/art/items/sunsword.png",
  29: "/art/items/two-handed-sword.png",
  30: "/art/items/spear.png",
  31: "/art/items/dagger.png",
  57: "/art/items/battle-axe.png",
  58: "/art/items/long-sword.png",
  59: "/art/items/flail.png",
  65: "/art/items/lance-of-death.png",
  90: "/art/items/vorpal-blade.png",
  91: "/art/items/slayer.png",
  // Armor
  23: "/art/items/plate-mail.png",
  24: "/art/items/chain-mail.png",
  25: "/art/items/leather-armor.png",
  60: "/art/items/ring-mail.png",
  61: "/art/items/studded-leather.png",
  62: "/art/items/splint-mail.png",
  63: "/art/items/plate-armor.png",
  64: "/art/items/stainless-plate-armor.png",
  68: "/art/items/shield.png",
  92: "/art/items/elven-chain.png",
  // Rings / wearable
  32: "/art/items/ring-extra-regeneration.png",
  33: "/art/items/ring-regeneration.png",
  34: "/art/items/ring-protection.png",
  35: "/art/items/energy-ring.png",
  36: "/art/items/ring-dexterity.png",
  37: "/art/items/ring-strength.png",
  38: "/art/items/ring-cleverness.png",
  39: "/art/items/ring-damage.png",
  40: "/art/items/belt-of-striking.png",
  // Consumables (non-variant)
  43: "/art/items/book.png",
  83: "/art/items/cookie.png",
});

const POTION_ART = Object.freeze([
  "/art/items/potion-sleep.png",
  "/art/items/potion-healing.png",
  "/art/items/potion-raise-level.png",
  "/art/items/potion-increase-ability.png",
  "/art/items/potion-wisdom.png",
  "/art/items/potion-strength.png",
  "/art/items/potion-raise-charisma.png",
  "/art/items/potion-dizziness.png",
  "/art/items/potion-learning.png",
  "/art/items/potion-object-detection.png",
  "/art/items/potion-monster-detection.png",
  "/art/items/potion-forgetfulness.png",
  "/art/items/potion-water.png",
  "/art/items/potion-blindness.png",
  "/art/items/potion-confusion.png",
  "/art/items/potion-heroism.png",
  "/art/items/potion-sturdiness.png",
  "/art/items/potion-giant-strength.png",
  "/art/items/potion-fire-resistance.png",
  "/art/items/potion-treasure-finding.png",
  "/art/items/potion-instant-healing.png",
  "/art/items/potion-cure-dianthroritis.png",
  "/art/items/potion-poison.png",
  "/art/items/potion-see-invisible.png",
]);

const SCROLL_ART = Object.freeze([
  "/art/items/scroll-enchant-armor.png",
  "/art/items/scroll-enchant-weapon.png",
  "/art/items/scroll-enlightenment.png",
  "/art/items/scroll-blank-paper.png",
  "/art/items/scroll-create-monster.png",
  "/art/items/scroll-create-artifact.png",
  "/art/items/scroll-aggravate-monsters.png",
  "/art/items/scroll-time-warp.png",
  "/art/items/scroll-teleportation.png",
  "/art/items/scroll-expanded-awareness.png",
  "/art/items/scroll-haste-monsters.png",
  "/art/items/scroll-monster-healing.png",
  "/art/items/scroll-spirit-protection.png",
  "/art/items/scroll-undead-protection.png",
  "/art/items/scroll-stealth.png",
  "/art/items/scroll-magic-mapping.png",
  "/art/items/scroll-hold-monsters.png",
  "/art/items/scroll-gem-perfection.png",
  "/art/items/scroll-spell-extension.png",
  "/art/items/scroll-identify.png",
  "/art/items/scroll-remove-curse.png",
  "/art/items/scroll-annihilation.png",
  "/art/items/scroll-pulverization.png",
  "/art/items/scroll-life-protection.png",
  "/art/items/scroll-teleport-to-town.png",
]);

const OPOTION_ID = 42;
const OSCROLL_ID = 41;
const UNKNOWN_POTION_ART = "/art/items/potion-unknown.png";
const UNKNOWN_SCROLL_ART = "/art/items/scroll-unknown.png";
const GOLD_ART = ITEM_ART[18];

// Flat multiply on the sprite that already exists. Above 1 brightens without a new image.
export const ITEM_SPRITE_TINT = Object.freeze({
  gold: Object.freeze([1.62, 1.34, 0.74]),
  item: Object.freeze([1.24, 1.22, 1.16]),
});

const spriteTint = (path) => {
  const [r, g, b] = path === GOLD_ART ? ITEM_SPRITE_TINT.gold : ITEM_SPRITE_TINT.item;
  return new THREE.Color(r, g, b);
};

const textures = new Map();
const materials = new Map();
const plane = new THREE.PlaneGeometry(1, 1);
plane.userData.shared = true;
const loader = new THREE.TextureLoader();
// Art faces right in the source PNGs; a fixed facing drives left/right
// mirroring as the overhead camera orbits, matching monster presentation.
const DEFAULT_FACING = Object.freeze({ x: 1, y: 0 });

export function itemArtPath(id, arg = 0, known = true) {
  if (id === OPOTION_ID) {
    if (!known) return UNKNOWN_POTION_ART;
    return POTION_ART[arg] || null;
  }
  if (id === OSCROLL_ID) {
    if (!known) return UNKNOWN_SCROLL_ART;
    return SCROLL_ART[arg] || null;
  }
  return ITEM_ART[id] || null;
}

// Generated sprites often sit on a pale card, sometimes a baked checkerboard.
// Flood-fill that plate from the edges so the item floats on the dungeon floor
// without a white halo. The fill is 4-connected and only takes neutral pixels,
// so it cannot slip through a one-pixel diagonal outline into white diamond
// facets, steel blades or a lavender bottle. Hit testing still uses the
// original plane, so click targets do not shrink.
export function stripPaleSpriteBackground(imageData, sat = 12, lumaMin = 168, alphaCut = 10) {
  const { data, width: w, height: h } = imageData;
  const n = w * h;
  const mark = new Uint8Array(n);
  const stack = [];
  const spread = (o) => {
    const r = data[o],
      g = data[o + 1],
      b = data[o + 2];
    return (r > g ? (r > b ? r : b) : g > b ? g : b) - (r < g ? (r < b ? r : b) : g < b ? g : b);
  };
  const luma = (o) => (data[o] + data[o + 1] + data[o + 2]) / 3;
  const isPale = (i) => {
    const o = i * 4;
    return data[o + 3] < alphaCut || (spread(o) <= sat && luma(o) >= lumaMin);
  };
  const push = (i) => {
    if (mark[i] || !isPale(i)) return;
    mark[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x + 1 < w) push(i + 1);
    if (i >= w) push(i - w);
    if (i + w < n) push(i + w);
  }
  clearEnclosedCheckers(imageData, mark, alphaCut);
  for (let i = 0; i < n; i++) {
    if (!mark[i]) continue;
    const o = i * 4;
    data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
  }
  return imageData;
}

// Ring and belt holes keep the generator's two-tone checker, out of reach of
// the edge fill. Clear an enclosed region only when it is a sharp neutral
// checker ringed mostly by dark or saturated item pixels; polished highlights
// and glass sit inside more bright material and stay.
function clearEnclosedCheckers({ data, width: w, height: h }, mark, alphaCut) {
  const n = w * h;
  const spread = (o) => Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]);
  const luma = (o) => (data[o] + data[o + 1] + data[o + 2]) / 3;
  const isCard = (i) => data[i * 4 + 3] >= alphaCut && spread(i * 4) <= 6 && luma(i * 4) >= 200;
  const seen = new Uint8Array(n);
  const minSize = Math.round(n * 0.0045);
  for (let start = 0; start < n; start++) {
    if (mark[start] || seen[start] || !isCard(start)) continue;
    const part = [start];
    seen[start] = 1;
    let light = 0, mid = 0, pairs = 0, sharp = 0, rim = 0, solid = 0;
    for (let k = 0; k < part.length; k++) {
      const i = part[k], x = i % w, l = luma(i * 4);
      if (l >= 244) light++;
      else if (l <= 236) mid++;
      for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || mark[j]) continue;
        if (!isCard(j)) {
          rim++;
          if (luma(j * 4) < 150 || spread(j * 4) > 40) solid++;
          continue;
        }
        if (j > i) {
          pairs++;
          if (Math.abs(luma(j * 4) - l) >= 12) sharp++;
        }
        if (!seen[j]) {
          seen[j] = 1;
          part.push(j);
        }
      }
    }
    const size = part.length;
    const checker = sharp / Math.max(1, pairs) >= 0.12 && light / size >= 0.15 && mid / size >= 0.15;
    if (size >= minSize && checker && solid / Math.max(1, rim) >= 0.35) for (const i of part) mark[i] = 1;
  }
}

/**
 * Copy neighboring item colors into fully transparent pixels (alpha stays 0).
 * Mipmaps average color and alpha separately, so transparent black would
 * otherwise darken every edge as the 256 px art shrinks to tile size.
 */
export function bleedTransparentEdges(imageData, passes = 6) {
  const { data, width: w, height: h } = imageData;
  let filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = data[i * 4 + 3] > 0 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = filled.slice();
    let changed = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!filled[j]) continue;
        r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; count++;
      }
      if (!count) continue;
      data[i * 4] = r / count; data[i * 4 + 1] = g / count; data[i * 4 + 2] = b / count;
      next[i] = 1; changed = true;
    }
    filled = next;
    if (!changed) break;
  }
  return imageData;
}

function stripLoadedTexture(texture) {
  const image = texture.image;
  if (!image || texture.userData.stripped || !image.width) return;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  stripPaleSpriteBackground(imageData);
  bleedTransparentEdges(imageData);
  ctx.putImageData(imageData, 0, 0);
  texture.image = canvas;
  texture.userData.stripped = true;
  texture.needsUpdate = true;
}

// The potion that cures your child is the reason for the descent. Once it is
// known, it stands in a soft warm glow (never while it is still unidentified).
const CURE_ART = "/art/items/potion-cure-dianthroritis.png";
let cureGlow;
function cureGlowMaterial() {
  if (cureGlow) return cureGlow;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const c = canvas.getContext("2d");
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,226,150,0.85)");
  g.addColorStop(0.45, "rgba(255,196,110,0.32)");
  g.addColorStop(1, "rgba(255,180,90,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  cureGlow = new THREE.MeshBasicMaterial({
    map, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
  });
  return cureGlow;
}

export function itemSprite(tile, invalidate = () => {}) {
  const known = tile?.known !== false;
  const path = itemArtPath(tile?.id, tile?.arg ?? 0, known);
  if (!path) return null;
  if (!textures.has(path)) {
    const texture = loader.load(path, (loaded) => {
      stripLoadedTexture(loaded);
      invalidate();
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    // The 256 px illustrations are drawn at roughly 30–90 px. Trilinear mips
    // keep them clean while minified; nearest sampling shimmered and stair-stepped.
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 2;
    textures.set(path, texture);
    materials.set(
      path,
      new THREE.MeshBasicMaterial({
        map: texture,
        color: spriteTint(path),
        transparent: true,
        alphaTest: 0.2,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
  }
  const group = new THREE.Group();
  const artwork = new THREE.Mesh(plane, materials.get(path));
  const width = 0.72;
  artwork.name = "item-art";
  artwork.position.y = 0.42;
  artwork.scale.set(width, width, 1);
  // A soft contact shade, like the one creatures stand on, so loot rests on the floor.
  group.add(lootShade(0.36), artwork);
  if (path === CURE_ART) {
    const glow = new THREE.Mesh(plane, cureGlowMaterial());
    glow.name = "cure-glow";
    glow.position.z = -0.02;
    glow.scale.setScalar(1.6);
    glow.renderOrder = -1;
    artwork.add(glow);
  }
  group.userData.artwork = artwork;
  group.userData.artPath = path;
  group.userData.artWidth = width;
  group.userData.facing = { ...DEFAULT_FACING };
  group.userData.itemArt = true;
  return group;
}

export function faceItem(group, camera) {
  const { artwork } = group.userData;
  if (!artwork) return;
  artwork.quaternion.copy(camera.quaternion);
  const direction = group.userData.facing || DEFAULT_FACING;
  const right = camera.matrixWorld.elements;
  const side = direction.x * right[0] + direction.y * right[2];
  if (Math.abs(side) > 0.05) artwork.scale.x = (side < 0 ? -1 : 1) * group.userData.artWidth;
}

// The already-stripped canvas of loaded floor art, for HUD flyers and icons.
// Null until the floor sprite has loaded once; nothing is fetched here.
export function itemArtImage(id, arg = 0, known = true) {
  const path = itemArtPath(id, arg, known);
  const image = path && textures.get(path)?.image;
  return image && (image.getContext || image.complete) ? image : null;
}

export function itemArtMetrics() {
  return { itemTextures: textures.size, itemMaterials: materials.size };
}

export function itemArtCatalog() {
  return {
    items: Object.keys(ITEM_ART).length,
    potions: POTION_ART.length,
    scrolls: SCROLL_ART.length,
    unknownPotion: UNKNOWN_POTION_ART,
    unknownScroll: UNKNOWN_SCROLL_ART,
    total: Object.keys(ITEM_ART).length + POTION_ART.length + SCROLL_ART.length + 2,
  };
}

export function releaseItemArtResources(clearCache = false) {
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  cureGlow?.map.dispose();
  cureGlow?.dispose();
  plane.dispose();
  if (clearCache) {
    textures.clear();
    materials.clear();
  }
}
