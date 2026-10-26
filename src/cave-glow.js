import * as THREE from "three";
import { injectTileScatter } from "./materials.js";

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
/* Torchlit relief inside the glow: stone bevels facing the hero's lantern
   brighten and the far sides darken, from the terrain's own relief map. The
   lantern sits at hand height, so light rakes across the floor. */
export const CAVE_RELIEF = Object.freeze({ height: 1.1, strength: 3, gain: 1.15 });

const uniforms = {
  uGlowCenter: { value: new THREE.Vector3() },
  uGlowRadius: { value: CAVE_GLOW.radius },
  uGlowEdge: { value: CAVE_GLOW.edge },
  uGlowWarm: { value: new THREE.Vector3(...CAVE_GLOW.warm) },
  uReliefHeight: { value: CAVE_RELIEF.height },
  uReliefStrength: { value: CAVE_RELIEF.strength },
  uReliefGain: { value: CAVE_RELIEF.gain },
};
/** Shared by every glow material; copy the hero's displayed position into it each frame. */
export const caveGlowCenter = uniforms.uGlowCenter.value;

const variants = new Map();

function injectGlow(shader, relief) {
  Object.assign(shader.uniforms, uniforms);
  if (relief) shader.uniforms.uReliefMap = { value: relief };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vGlowWorld;")
    .replace("#include <project_vertex>", `#include <project_vertex>
  vec4 glowWorld = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    glowWorld = instanceMatrix * glowWorld;
  #endif
  vGlowWorld = ( modelMatrix * glowWorld ).xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `${relief ? "#define CAVE_RELIEF\n" : ""}#include <common>
varying vec3 vGlowWorld;
uniform vec3 uGlowCenter;
uniform float uGlowRadius;
uniform float uGlowEdge;
uniform vec3 uGlowWarm;
#ifdef CAVE_RELIEF
  uniform sampler2D uReliefMap;
  uniform float uReliefHeight;
  uniform float uReliefStrength;
  uniform float uReliefGain;
#endif`)
    .replace("#include <opaque_fragment>", `float glow = 1.0 - smoothstep( 0.15, 1.0, length( vGlowWorld.xz - uGlowCenter.xz ) / uGlowRadius );
  #if defined( CAVE_RELIEF ) && defined( USE_MAP )
  {
    // World-space tangent frame from derivatives (as three's getTangentFrame),
    // so per-tile turns and shifted wall courses keep their relief aligned.
    vec3 q0 = dFdx( vGlowWorld ), q1 = dFdy( vGlowWorld );
    vec2 st0 = dFdx( vMapUv ), st1 = dFdy( vMapUv );
    vec3 faceNormal = normalize( cross( q0, q1 ) );
    vec3 q1perp = cross( q1, faceNormal ), q0perp = cross( faceNormal, q0 );
    vec3 tangent = q1perp * st0.x + q0perp * st1.x, bitangent = q1perp * st0.y + q0perp * st1.y;
    float frame = max( dot( tangent, tangent ), dot( bitangent, bitangent ) );
    frame = frame == 0.0 ? 0.0 : inversesqrt( frame );
    vec3 bump = texture2D( uReliefMap, vMapUv ).xyz * 2.0 - 1.0;
    bump.xy *= uReliefStrength;
    vec3 reliefNormal = normalize( mat3( tangent * frame, bitangent * frame, faceNormal ) * bump );
    vec3 toLantern = normalize( uGlowCenter + vec3( 0.0, uReliefHeight, 0.0 ) - vGlowWorld );
    float relief = 1.0 + ( max( dot( reliefNormal, toLantern ), 0.0 ) - max( dot( faceNormal, toLantern ), 0.0 ) ) * uReliefGain;
    outgoingLight *= mix( 1.0, clamp( relief, 0.7, 1.35 ), glow );
  }
  #endif
  outgoingLight *= mix( uGlowEdge, 1.0, glow ) * mix( vec3( 1.0 ), uGlowWarm, glow * glow );
  #include <opaque_fragment>`);
}

/** The glowing variant of an unlit cave material (cached per base material).
 *  `relief` is the terrain's normal map; its bevels catch the hero's lantern. */
export function caveGlowMaterial(base, relief = null) {
  let material = variants.get(base);
  if (material) return material;
  material = base.clone();
  material.userData.caveGlow = true;
  // A scattered floor keeps its per-tile turns under the glow.
  const scatter = !!base.userData.tileScatter;
  material.userData.caveRelief = !!relief;
  material.onBeforeCompile = (shader) => {
    if (scatter) injectTileScatter(shader);
    injectGlow(shader, relief);
  };
  material.customProgramCacheKey = () => `cave-glow${scatter ? "+tile-scatter" : ""}${relief ? "+relief" : ""}`;
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
