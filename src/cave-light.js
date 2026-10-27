import * as THREE from "three";

/*
 * Cinematic caves only: the stone is lit, not painted. Floors and walls use
 * the lit surfaces (color, relief and roughness maps), and the light comes
 * from the hero's lantern, the nearest wall torches and a dim, cool bounce,
 * falling off by the inverse square. The lantern casts live shadows. Each
 * torch's shadow holds only the walls, so torchlight stops at stone instead
 * of bleeding into the next corridor, and it is redrawn only when the torch
 * or the walls change. Balanced and Auto keep the flat, unlit caves.
 */
export const CAVE_LIGHT = Object.freeze({
  // What the dark keeps: enough to read a room's shape, not to light it.
  bounce: { sky: 0x6f8ba0, ground: 0x2a2219, intensity: 0.3 },
  // Reflections only need to be faint: they give armor its sheen.
  reflection: 0.35,
  // Held above the head and a little toward the camera, so the hero lights the
  // floor around them and every creature, crate and pillar throws its shadow
  // away from them.
  lantern: { color: 0xffb06a, intensity: 10, distance: 12, height: 2.6, reach: 0.6, shadow: 1024 },
  torch: {
    count: 4, intensity: 7, distance: 8, shadow: 256,
    // Slow swell and a quicker shiver, small enough not to strobe.
    flicker: 0.07,
    color: { caves: 0xff9440, volcano: 0xff6633 },
  },
  // Volcano fissures give off their own light, so they glow beyond the lantern.
  lava: { color: 0xff5a1e, intensity: 1.4 },
  // Flames, lava and the brightest stone bloom; the town keeps its softer glow.
  bloom: { strength: 0.32, radius: 0.5, threshold: 0.92 },
  exposure: 1.25,
});
/** Torch shadows render only this layer: walls and their caps. */
export const OCCLUDER_LAYER = 2;

/**
 * What metal sees in a cave: black above and below, with a warm band of
 * distant torchlight around the horizon. Without it, armor and blades have
 * nothing to reflect and render black. Turned into a PMREM by the world.
 */
export function caveEnvironmentScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070504);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 8, 2.2, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff9a52, side: THREE.BackSide }),
  );
  band.position.y = 0.6;
  // Two brighter flames in the band give blades a highlight to catch.
  const flame = new THREE.MeshBasicMaterial({ color: 0xffd3a0 });
  for (const angle of [0.6, 3.4]) {
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), flame);
    spot.position.set(Math.cos(angle) * 7.5, 1.2, Math.sin(angle) * 7.5);
    scene.add(spot);
  }
  scene.add(band);
  return scene;
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
