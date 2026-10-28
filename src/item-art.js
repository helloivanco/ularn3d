import * as THREE from "three";
import { lootShade } from "./models.js";

// Presentation-only floor artwork. Engine item IDs, args, names, stats, and
// classic Amiga `o{id}.png` tiles remain unchanged.
const ITEM_ART = Object.freeze({
  // Gems / valuables
  18: "/art/items/gold-pile.webp",
  50: "/art/items/diamond.webp",
  51: "/art/items/ruby.webp",
  52: "/art/items/emerald.webp",
  53: "/art/items/sapphire.webp",
  // Magical / special
  3: "/art/items/orb-of-enlightenment.webp",
  45: "/art/items/amulet-of-invisibility.webp",
  46: "/art/items/orb-of-dragon-slaying.webp",
  47: "/art/items/scarab-of-negate-spirit.webp",
  48: "/art/items/cube-of-undead-control.webp",
  49: "/art/items/device-of-theft-prevention.webp",
  85: "/art/items/brass-lamp.webp",
  86: "/art/items/hand-of-fear.webp",
  87: "/art/items/talisman-of-the-sphere.webp",
  88: "/art/items/wand-of-wonder.webp",
  89: "/art/items/staff-of-power.webp",
  // Weapons
  26: "/art/items/sword-of-slashing.webp",
  27: "/art/items/bessmans-flailing-hammer.webp",
  28: "/art/items/sunsword.webp",
  29: "/art/items/two-handed-sword.webp",
  30: "/art/items/spear.webp",
  31: "/art/items/dagger.webp",
  57: "/art/items/battle-axe.webp",
  58: "/art/items/long-sword.webp",
  59: "/art/items/flail.webp",
  65: "/art/items/lance-of-death.webp",
  90: "/art/items/vorpal-blade.webp",
  91: "/art/items/slayer.webp",
  // Armor
  23: "/art/items/plate-mail.webp",
  24: "/art/items/chain-mail.webp",
  25: "/art/items/leather-armor.webp",
  60: "/art/items/ring-mail.webp",
  61: "/art/items/studded-leather.webp",
  62: "/art/items/splint-mail.webp",
  63: "/art/items/plate-armor.webp",
  64: "/art/items/stainless-plate-armor.webp",
  68: "/art/items/shield.webp",
  92: "/art/items/elven-chain.webp",
  // Rings / wearable
  32: "/art/items/ring-extra-regeneration.webp",
  33: "/art/items/ring-regeneration.webp",
  34: "/art/items/ring-protection.webp",
  35: "/art/items/energy-ring.webp",
  36: "/art/items/ring-dexterity.webp",
  37: "/art/items/ring-strength.webp",
  38: "/art/items/ring-cleverness.webp",
  39: "/art/items/ring-damage.webp",
  40: "/art/items/belt-of-striking.webp",
  // Consumables (non-variant)
  43: "/art/items/book.webp",
  83: "/art/items/cookie.webp",
});

const POTION_ART = Object.freeze([
  "/art/items/potion-sleep.webp",
  "/art/items/potion-healing.webp",
  "/art/items/potion-raise-level.webp",
  "/art/items/potion-increase-ability.webp",
  "/art/items/potion-wisdom.webp",
  "/art/items/potion-strength.webp",
  "/art/items/potion-raise-charisma.webp",
  "/art/items/potion-dizziness.webp",
  "/art/items/potion-learning.webp",
  "/art/items/potion-object-detection.webp",
  "/art/items/potion-monster-detection.webp",
  "/art/items/potion-forgetfulness.webp",
  "/art/items/potion-water.webp",
  "/art/items/potion-blindness.webp",
  "/art/items/potion-confusion.webp",
  "/art/items/potion-heroism.webp",
  "/art/items/potion-sturdiness.webp",
  "/art/items/potion-giant-strength.webp",
  "/art/items/potion-fire-resistance.webp",
  "/art/items/potion-treasure-finding.webp",
  "/art/items/potion-instant-healing.webp",
  "/art/items/potion-cure-dianthroritis.webp",
  "/art/items/potion-poison.webp",
  "/art/items/potion-see-invisible.webp",
]);

const SCROLL_ART = Object.freeze([
  "/art/items/scroll-enchant-armor.webp",
  "/art/items/scroll-enchant-weapon.webp",
  "/art/items/scroll-enlightenment.webp",
  "/art/items/scroll-blank-paper.webp",
  "/art/items/scroll-create-monster.webp",
  "/art/items/scroll-create-artifact.webp",
  "/art/items/scroll-aggravate-monsters.webp",
  "/art/items/scroll-time-warp.webp",
  "/art/items/scroll-teleportation.webp",
  "/art/items/scroll-expanded-awareness.webp",
  "/art/items/scroll-haste-monsters.webp",
  "/art/items/scroll-monster-healing.webp",
  "/art/items/scroll-spirit-protection.webp",
  "/art/items/scroll-undead-protection.webp",
  "/art/items/scroll-stealth.webp",
  "/art/items/scroll-magic-mapping.webp",
  "/art/items/scroll-hold-monsters.webp",
  "/art/items/scroll-gem-perfection.webp",
  "/art/items/scroll-spell-extension.webp",
  "/art/items/scroll-identify.webp",
  "/art/items/scroll-remove-curse.webp",
  "/art/items/scroll-annihilation.webp",
  "/art/items/scroll-pulverization.webp",
  "/art/items/scroll-life-protection.webp",
  "/art/items/scroll-teleport-to-town.webp",
]);

const OPOTION_ID = 42;
const OSCROLL_ID = 41;
const UNKNOWN_POTION_ART = "/art/items/potion-unknown.webp";
const UNKNOWN_SCROLL_ART = "/art/items/scroll-unknown.webp";
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
// Art faces right; a fixed facing drives left/right mirroring as the
// overhead camera orbits, matching monster presentation.
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

// The potion that cures your child is the reason for the descent. Once it is
// known, it stands in a soft warm glow (never while it is still unidentified).
const CURE_ART = "/art/items/potion-cure-dianthroritis.webp";
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

// Loads item art once per path. Callers waiting on art still in flight wait on
// that texture, and run when it has loaded.
function loadArt(path, onLoad) {
  if (textures.has(path)) {
    textures.get(path).userData.waiting?.add(onLoad);
    return;
  }
  const waiting = new Set([onLoad]);
  const texture = loader.load(path, (loaded) => {
    // Baked without its pale card, edges bled (scripts/bake-item-art.mjs).
    loaded.userData.stripped = true;
    loaded.userData.waiting = null;
    waiting.forEach((callback) => callback());
  });
  texture.userData.waiting = waiting;
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

export function itemSprite(tile, invalidate = () => {}) {
  const known = tile?.known !== false;
  const path = itemArtPath(tile?.id, tile?.arg ?? 0, known);
  if (!path) return null;
  loadArt(path, invalidate);
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

// The loaded (already stripped) item art, for HUD flyers and icons.
// Null until the art has loaded. With onReady, missing art is fetched and
// onReady runs once it arrives.
export function itemArtImage(id, arg = 0, known = true, onReady = null) {
  const path = itemArtPath(id, arg, known);
  const image = path && textures.get(path)?.image;
  if (image && (image.getContext || image.complete)) return image;
  if (path && onReady) loadArt(path, onReady);
  return null;
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
