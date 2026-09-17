import * as THREE from "three";

// Most species use the original, bundled Ularn sprites. The lemming uses an
// original rodent illustration in the 3D edition; its engine identity is unchanged.
// The u variants distinguish bitbug and lama nobe from their Larn counterparts.
// Visible stalkers/demons use the same revealed variants as the original engine.
const textures = new Map();
const materials = new Map();
const plane = new THREE.PlaneGeometry(1, 1);
plane.userData.shared = true;
const headingShape = new THREE.Shape();
headingShape.moveTo(0, 0.16);
headingShape.lineTo(-0.1, -0.1);
headingShape.lineTo(0.1, -0.1);
headingShape.closePath();
const headingGeometry = new THREE.ShapeGeometry(headingShape);
headingGeometry.userData.shared = true;
const headingMaterial = new THREE.MeshBasicMaterial({ color: 0xe59b79, side: THREE.DoubleSide });
const loader = new THREE.TextureLoader();

export function monsterArtPath(id) {
  if (!Number.isInteger(id) || id < 1 || id > 65) return null;
  if (id === 1) return "/art/monsters/lemming.png";
  const suffix = [19, 34].includes(id) ? "u" : id === 39 || id >= 57 ? "v" : "";
  return `/engine/img/m${id}${suffix}.png`;
}

export function monsterSprite(monster, invalidate = () => {}) {
  const path = monsterArtPath(monster.id);
  if (!path) return null;
  if (!textures.has(path)) {
    const texture = loader.load(path, invalidate);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    textures.set(path, texture);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    // The original tile images use opaque black as their background. Key it out
    // in the renderer so the bundled artwork sits naturally on the dungeon floor.
    if (path.startsWith("/engine/")) {
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>",
          "#include <map_fragment>\nif (max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) < 0.002) discard;");
      };
      material.customProgramCacheKey = () => "ularn-original-sprite-cutout-v1";
    }
    materials.set(path, material);
  }
  const group = new THREE.Group();
  const artwork = new THREE.Mesh(plane, materials.get(path));
  const rodent = monster.id === 1;
  const width = rodent ? 0.85 : 0.66;
  artwork.name = "monster-art";
  artwork.position.y = rodent ? 0.35 : 0.57;
  artwork.scale.set(width, rodent ? 0.85 : 1.15, 1);
  const heading = new THREE.Mesh(headingGeometry, headingMaterial);
  heading.name = "monster-heading";
  heading.rotation.x = -Math.PI / 2;
  heading.position.y = 0.035;
  group.add(artwork, heading);
  group.userData.artwork = artwork;
  group.userData.heading = heading;
  group.userData.artPath = path;
  group.userData.artWidth = width;
  group.userData.facing = { x: 0, y: 1 };
  return group;
}

export function faceMonster(group, facing, camera) {
  const { artwork, heading } = group.userData;
  if (!artwork) return;
  if (facing && (facing.x || facing.y)) group.userData.facing = facing;
  const direction = group.userData.facing;
  artwork.quaternion.copy(camera.quaternion);
  // The source art is a single view. Mirroring provides a legible left/right
  // change; the ground arrow gives an unambiguous heading in all eight directions.
  const right = camera.matrixWorld.elements;
  const side = direction.x * right[0] + direction.y * right[2];
  if (Math.abs(side) > 0.05) artwork.scale.x = (side < 0 ? -1 : 1) * group.userData.artWidth;
  const length = Math.hypot(direction.x, direction.y) || 1;
  heading.position.set(direction.x / length * 0.39, 0.035, direction.y / length * 0.39);
  heading.rotation.z = Math.atan2(-direction.x, -direction.y);
}

export function monsterArtMetrics() {
  return { monsterTextures: textures.size, monsterMaterials: materials.size };
}

export function releaseMonsterArtResources(clearCache = false) {
  // Species that have left the current floor still have cached GL resources.
  // Release their old-context listeners too; scene traversal cannot reach them.
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  plane.dispose();
  headingGeometry.dispose();
  headingMaterial.dispose();
  if (clearCache) {
    textures.clear();
    materials.clear();
  }
}
