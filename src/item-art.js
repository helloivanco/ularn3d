import * as THREE from "three";

// Presentation-only floor artwork for notable artifacts. Engine item IDs,
// names, stats, and classic Amiga `o{id}.png` tiles remain unchanged.
const ITEM_ART = Object.freeze({
  3: "/art/items/orb-of-enlightenment.png",
  26: "/art/items/sword-of-slashing.png",
  27: "/art/items/bessmans-flailing-hammer.png",
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
  91: "/art/items/slayer.png",
  92: "/art/items/elven-chain.png",
});

const textures = new Map();
const materials = new Map();
const plane = new THREE.PlaneGeometry(1, 1);
plane.userData.shared = true;
const loader = new THREE.TextureLoader();
// Art faces right in the source PNGs; a fixed facing drives left/right
// mirroring as the overhead camera orbits, matching monster presentation.
const DEFAULT_FACING = Object.freeze({ x: 1, y: 0 });

export function itemArtPath(id) {
  return ITEM_ART[id] || null;
}

export function itemSprite(tile, invalidate = () => {}) {
  const path = itemArtPath(tile?.id);
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

export function releaseItemArtResources(clearCache = false) {
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  plane.dispose();
  if (clearCache) {
    textures.clear();
    materials.clear();
  }
}
