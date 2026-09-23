import * as THREE from "three";

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
]);

const OPOTION_ID = 42;
const OSCROLL_ID = 41;
const UNKNOWN_POTION_ART = "/art/items/potion-unknown.png";

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
  if (id === OSCROLL_ID) return SCROLL_ART[arg] || null;
  return ITEM_ART[id] || null;
}

// Generated sprites often sit on a pale rounded card. Flood-fill that plate
// from the edges so the item floats on the dungeon floor without a white halo.
// Hit testing still uses the original plane, so click targets do not shrink.
export function stripPaleSpriteBackground(imageData, sat = 30, lumaMin = 168, alphaCut = 10) {
  const { data, width: w, height: h } = imageData;
  const n = w * h;
  const mark = new Uint8Array(n);
  const stack = [];
  const isPale = (i) => {
    const o = i * 4;
    const r = data[o],
      g = data[o + 1],
      b = data[o + 2],
      a = data[o + 3];
    if (a < alphaCut) return true;
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    return max - min <= sat && (r + g + b) / 3 >= lumaMin;
  };
  const push = (i) => {
    if (i < 0 || i >= n || mark[i] || !isPale(i)) return;
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
    const x = i % w,
      y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x + 1 < w) push(i + 1);
    if (y > 0) push(i - w);
    if (y + 1 < h) push(i + w);
    if (x > 0 && y > 0) push(i - w - 1);
    if (x + 1 < w && y > 0) push(i - w + 1);
    if (x > 0 && y + 1 < h) push(i + w - 1);
    if (x + 1 < w && y + 1 < h) push(i + w + 1);
  }
  for (let i = 0; i < n; i++) {
    if (!mark[i]) continue;
    const o = i * 4;
    data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
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
  ctx.putImageData(imageData, 0, 0);
  texture.image = canvas;
  texture.userData.stripped = true;
  texture.needsUpdate = true;
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
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    textures.set(path, texture);
    materials.set(
      path,
      new THREE.MeshBasicMaterial({
        map: texture,
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
  group.add(artwork);
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

export function itemArtMetrics() {
  return { itemTextures: textures.size, itemMaterials: materials.size };
}

export function itemArtCatalog() {
  return {
    items: Object.keys(ITEM_ART).length,
    potions: POTION_ART.length,
    scrolls: SCROLL_ART.length,
    unknownPotion: UNKNOWN_POTION_ART,
    total: Object.keys(ITEM_ART).length + POTION_ART.length + SCROLL_ART.length + 1,
  };
}

export function releaseItemArtResources(clearCache = false) {
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  plane.dispose();
  if (clearCache) {
    textures.clear();
    materials.clear();
  }
}
