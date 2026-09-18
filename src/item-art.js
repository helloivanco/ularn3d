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

const textures = new Map();
const materials = new Map();
const plane = new THREE.PlaneGeometry(1, 1);
plane.userData.shared = true;
const loader = new THREE.TextureLoader();
// Art faces right in the source PNGs; a fixed facing drives left/right
// mirroring as the overhead camera orbits, matching monster presentation.
const DEFAULT_FACING = Object.freeze({ x: 1, y: 0 });

export function itemArtPath(id, arg = 0) {
  if (id === OPOTION_ID) return POTION_ART[arg] || null;
  if (id === OSCROLL_ID) return SCROLL_ART[arg] || null;
  return ITEM_ART[id] || null;
}

export function itemSprite(tile, invalidate = () => {}) {
  const path = itemArtPath(tile?.id, tile?.arg ?? 0);
  if (!path) return null;
  if (!textures.has(path)) {
    const texture = loader.load(path, invalidate);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    textures.set(path, texture);
    materials.set(
      path,
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.1,
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
    total: Object.keys(ITEM_ART).length + POTION_ART.length + SCROLL_ART.length,
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
