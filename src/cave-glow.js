import * as THREE from "three";

/*
 * Cinematic caves only: a warm pool of light around the hero on the unlit
 * floor and walls, fading toward a dimmer edge. The materials stay
 * MeshBasic with their stone maps; the shader scales the final color by
 * distance from the hero. Balanced and Auto keep the flat cave materials.
 */
export const CAVE_GLOW = Object.freeze({ radius: 7.5, edge: 0.55, warm: [1.14, 1.02, 0.84] });
/* The hero's point light in Cinematic caves, matched to the floor glow. It
   hangs well above the head so the helmet is lit, not blown out. */
export const CAVE_HERO_LIGHT = Object.freeze({ intensity: 9, distance: 10, height: 3 });

const uniforms = {
  uGlowCenter: { value: new THREE.Vector3() },
  uGlowRadius: { value: CAVE_GLOW.radius },
  uGlowEdge: { value: CAVE_GLOW.edge },
  uGlowWarm: { value: new THREE.Vector3(...CAVE_GLOW.warm) },
};
/** Shared by every glow material; copy the hero's displayed position into it each frame. */
export const caveGlowCenter = uniforms.uGlowCenter.value;

const variants = new Map();

function injectGlow(shader) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vGlowWorld;")
    .replace("#include <project_vertex>", `#include <project_vertex>
  vec4 glowWorld = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    glowWorld = instanceMatrix * glowWorld;
  #endif
  vGlowWorld = ( modelMatrix * glowWorld ).xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
varying vec3 vGlowWorld;
uniform vec3 uGlowCenter;
uniform float uGlowRadius;
uniform float uGlowEdge;
uniform vec3 uGlowWarm;`)
    .replace("#include <opaque_fragment>", `float glow = 1.0 - smoothstep( 0.15, 1.0, length( vGlowWorld.xz - uGlowCenter.xz ) / uGlowRadius );
  outgoingLight *= mix( uGlowEdge, 1.0, glow ) * mix( vec3( 1.0 ), uGlowWarm, glow * glow );
  #include <opaque_fragment>`);
}

/** The glowing variant of an unlit cave material (cached per base material). */
export function caveGlowMaterial(base) {
  let material = variants.get(base);
  if (material) return material;
  material = base.clone();
  material.userData.caveGlow = true;
  material.onBeforeCompile = injectGlow;
  material.customProgramCacheKey = () => "cave-glow";
  variants.set(base, material);
  return material;
}

export function releaseCaveGlowResources(clear = false) {
  variants.forEach((material) => material.dispose());
  if (clear) variants.clear();
}

/** A soft darkening toward the frame edges, centered on the hero. */
export const VignetteShader = {
  name: "VignetteShader",
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uStrength: { value: 0.2 },
  },
  vertexShader: `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
  fragmentShader: `uniform sampler2D tDiffuse;
uniform vec2 uCenter;
uniform float uAspect;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec4 color = texture2D( tDiffuse, vUv );
  float edge = smoothstep( 0.35, 1.05, length( ( vUv - uCenter ) * vec2( uAspect, 1.0 ) ) );
  color.rgb *= 1.0 - uStrength * edge;
  gl_FragColor = color;
}`,
};
