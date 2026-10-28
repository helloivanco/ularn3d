import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { Sky } from "three/addons/objects/Sky.js";
import { VignetteShader } from "./cave-light.js";
import { TOWN_LIGHT, SUN_OFFSET } from "./lighting.js";

/*
 * Cinematic-only rendering: the post-processing chain and the town's sky.
 * The world loads this module on demand, so Auto and Balanced players never
 * download it, and renders plainly until it arrives.
 */

/** Bloom, contact shading, SMAA and the vignette, in the order they apply. */
export function createComposer(renderer, scene, camera, width, height, glow) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Half-res + weaker bloom: full-size UnrealBloomPass lags typical GPUs.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(Math.max(1, width * 0.5), Math.max(1, height * 0.5)),
    glow.strength,
    glow.radius,
    glow.threshold,
  );
  const ao = new SSAOPass(scene, camera, width / 2, height / 2);
  // Contact shading at tile scale (world units), not an 8-tile smear.
  ao.kernelRadius=1.2; ao.minDistance=.0005; ao.maxDistance=.01;
  // The composer sizes every pass at full resolution; AO stays at half.
  const aoSize = ao.setSize.bind(ao);
  ao.setSize = (w, h) => aoSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
  composer.addPass(ao);
  composer.addPass(bloom);
  const antialias=new SMAAPass(); composer.addPass(antialias);
  const vignette = new ShaderPass(VignetteShader); composer.addPass(vignette);
  composer.addPass(new OutputPass());
  return { composer, bloom, ao, antialias, vignette };
}

/**
 * The sky the town's PBR surfaces see: atmospheric scattering lit from the
 * same direction as the sun, without the sun's disc (the light itself makes
 * the highlights). Water and glass reflect it, and shade takes its blue.
 */
export function townSkyScene() {
  const scene = new THREE.Scene(), sky = new Sky(), { sky: look } = TOWN_LIGHT;
  sky.scale.setScalar(100);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = look.turbidity;
  uniforms.rayleigh.value = look.rayleigh;
  uniforms.mieCoefficient.value = look.mie;
  uniforms.sunPosition.value.copy(SUN_OFFSET).normalize();
  uniforms.showSunDisc.value = 0;
  scene.add(sky);
  return scene;
}
