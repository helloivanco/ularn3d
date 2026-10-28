/*
 * Runs in the browser through the dev server, for scripts/capture-site.mjs.
 * Renders each calling as it looks in play: the rigged pack body standing in
 * its idle, with the procedural hero's weapon in its hand.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { hero } from "../src/models.js";
import { heroBody } from "../src/hero-skin.js";

export const CALLINGS = ["Adventurer", "Wizard", "Rogue", "Elf", "Dwarf", "Ogre", "Klingon", "Rambo"];

// The wind-up of a chop: the weapon raised, ready for the caves.
// `fill` frames small portraits on the body alone: its height fills that share
// of the frame, so the hero reads at icon size and a long spear cannot shrink it.
export async function renderCallings({ width = 320, height = 380, scale = 2, clip = "1H_Melee_Attack_Chop", at = 0.25, fill = 0 } = {}) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(scale);
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.45;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xc8e1dd, 0x3a3328, 1.6));
  const key = new THREE.DirectionalLight(0xffd9a8, 3.2);
  key.position.set(-3, 5, 4);
  const rim = new THREE.DirectionalLight(0x8fc4d6, 2.4);
  rim.position.set(4, 3, -4);
  scene.add(key, rim);
  const camera = new THREE.PerspectiveCamera(26, width / height, 0.1, 40);
  const FRAME = new THREE.Vector3(1.15, 1.35, 2.75), AIM = new THREE.Vector3(0, 0.53, 0);
  /** Same framing for everyone, backing off a little so an oversized weapon shows more of itself. */
  const frame = (object) => {
    const box = new THREE.Box3().setFromObject(object, true), corner = new THREE.Vector3();
    for (let back = 1; back < 1.36; back *= 1.05) {
      camera.position.copy(AIM).addScaledVector(FRAME.clone().sub(AIM), back);
      camera.lookAt(AIM);
      camera.updateMatrixWorld();
      let fits = true;
      for (let i = 0; i < 8 && fits; i++) {
        corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
        fits = Math.abs(corner.x) < 0.94 && Math.abs(corner.y) < 0.94;
      }
      if (fits) return;
    }
  };
  const fillWith = (body) => {
    // The visible skin only: the weapon hangs from a hand bone, and hidden hats still have bounds.
    const box = new THREE.Box3();
    body.traverse((object) => { if (object.isSkinnedMesh && object.visible) box.expandByObject(object, true); });
    const center = box.getCenter(new THREE.Vector3());
    const distance = (box.max.y - box.min.y) / (2 * fill * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.position.copy(center).addScaledVector(FRAME.clone().sub(AIM).normalize(), distance);
    camera.lookAt(center);
  };

  const images = [];
  for (const name of CALLINGS) {
    const player = hero(name);
    // Floor marks and the lantern (unlit, it reads as a box) stay out of a portrait.
    for (const mark of ["contact-disc", "hero-outline", "hero-mark", "lantern"]) player.getObjectByName(mark)?.removeFromParent();
    const { body, clips } = await heroBody(name);
    player.add(body);
    for (const [slot, part] of [["handslotr", player.getObjectByName("weapon")]]) {
      const bone = body.getObjectByName(slot);
      if (!bone || !part) continue;
      const mount = new THREE.Group();
      mount.scale.set(1 / body.scale.x, 1 / body.scale.y, 1 / body.scale.z);
      bone.add(mount);
      part.position.set(0, 0, 0);
      part.rotation.set(0, 0, 0);
      mount.add(part);
    }
    player.getObjectByName("body").visible = false;
    // The hero faces -Z; turn it three quarters toward the camera.
    player.rotation.y = Math.PI + 0.42;
    const mixer = new THREE.AnimationMixer(body);
    mixer.clipAction(THREE.AnimationClip.findByName(clips, clip)).play();
    mixer.setTime(at);
    scene.add(player);
    player.updateMatrixWorld(true);
    if (fill) fillWith(body); else frame(player);
    renderer.render(scene, camera);
    images.push({ name, data: renderer.domElement.toDataURL("image/webp", 0.9).split(",")[1] });
    scene.remove(player);
    mixer.stopAllAction();
    body.traverse((object) => { if (object.isSkinnedMesh) object.skeleton.dispose(); });
  }
  scene.environment.dispose();
  renderer.dispose();
  return images;
}
