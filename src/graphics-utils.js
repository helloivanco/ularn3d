import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const mergedMaterials = new Map();

// Bake tint into vertices so differently colored parts share one draw call.
// Texture, transparency and emission remain separate material families.
export function compact(group, shared = false) {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  const sets = new Map();
  group.traverseVisible((object) => {
    if (!object.isMesh || object.isInstancedMesh || Array.isArray(object.material)) return;
    const source = object.material;
    const key = [source.type, source.map?.uuid, source.normalMap?.uuid,
      source.roughnessMap?.uuid, source.bumpMap?.uuid, source.metalness,
      source.roughness, source.emissive?.getHex(), source.emissiveIntensity,
      source.transparent, source.opacity, source.side, source.depthWrite, source.depthTest,
      source.polygonOffset, source.polygonOffsetFactor, source.polygonOffsetUnits,
      object.castShadow, object.receiveShadow].join(":");
    if (!mergedMaterials.has(key)) {
      const material = source.clone();
      material.color.set(0xffffff);
      material.vertexColors = true;
      mergedMaterials.set(key, material);
    }
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = source.color.r; colors[i + 1] = source.color.g; colors[i + 2] = source.color.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push(geometry);
  });
  const sprites = [];
  group.traverseVisible((object) => { if (object.isSprite) sprites.push(object); });
  group.clear();
  for (const [key, geometries] of sets) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach((part) => part.dispose());
    geometry.userData.shared = shared;
    const mesh = new THREE.Mesh(geometry, mergedMaterials.get(key));
    const flags = key.split(":");
    mesh.castShadow = flags.at(-2) === "true";
    mesh.receiveShadow = flags.at(-1) === "true";
    group.add(mesh);
  }
  sprites.forEach((sprite) => group.add(sprite));
  return group;
}

export function disposeGeometry(group) {
  group.traverse((object) => {
    if (object.isInstancedMesh) object.dispose();
    if (object.geometry && !object.geometry.userData.shared) object.geometry.dispose();
  });
  group.clear();
}

export function percentile(values, fraction = 0.95) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export function sample(values, value, limit = 180) {
  values.push(value);
  if (values.length > limit) values.shift();
}

export function releaseCompactMaterials() {
  mergedMaterials.forEach((material) => material.dispose());
}
