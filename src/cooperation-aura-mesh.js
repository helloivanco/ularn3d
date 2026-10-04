import * as THREE from "three";
import { AURA_HEIGHT, AURA_WIDTH, auraCenter } from "./cooperation-aura.js";

const AURA_Y = 0.015;

const auraMaterial = (color, opacity) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    side: THREE.DoubleSide,
  });

/** Flat unlit floor ellipse. No light, no fog, no shadow. */
export const createCooperationAura = () => {
  const group = new THREE.Group();
  group.name = "cooperation-aura";
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    auraMaterial(0x5ef0e0, 0.35),
  );
  fill.name = "cooperation-aura-fill";
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 64),
    auraMaterial(0xe8fffb, 0.85),
  );
  rim.name = "cooperation-aura-rim";
  for (const mesh of [fill, rim]) {
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(AURA_WIDTH / 2, AURA_HEIGHT / 2, 1);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.flatMark = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  group.position.y = AURA_Y;
  group.visible = false;
  group.frustumCulled = false;
  return group;
};

export const placeCooperationAura = (group, originX, originY) => {
  const center = auraCenter(originX, originY);
  group.position.set(center.x, AURA_Y, center.y);
};

/** Town stays an unhighlighted town. The bubble shows on dungeon floors. */
export const cooperationAuraShown = (level) => level !== 0;
