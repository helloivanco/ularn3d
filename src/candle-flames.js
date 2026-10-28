import * as THREE from "three";

/*
 * Burning candles for the KayKit triple candle: a small flame on each wick
 * that sways, stretches and brightens on its own rhythm, over a soft halo.
 * Flames are billboards drawn in the shader (no textures), additive and
 * unlit, so they burn in every graphics tier; in Cinematic their hot cores
 * cross the bloom threshold. The light they cast is the world's business:
 * `candleSpots` also says where each candle's light hangs.
 */

/* Wick tips in the pack model's units (wide, tall and short candle). */
const WICKS = [[-0.008, 0.702, 0], [0.237, 0.873, -0.048], [0.202, 0.635, 0.132]];
/** World size of one flame: quad width and height, base at the wick. */
export const FLAME = Object.freeze({ width: 0.075, height: 0.13, lift: 0.004 });

/**
 * Where a set of candle props burn: each wick's flame, and one light point a
 * little above the middle of the three. `scale` is the prop's fit to tiles and
 * `baseY` the floor height the props stand on.
 */
export function candleSpots(props, scale, baseY = 0) {
  const flames = [], lights = [];
  for (const prop of props) {
    if (prop.kind !== "candle_triple") continue;
    const cos = Math.cos(prop.angle), sin = Math.sin(prop.angle);
    let cx = 0, cz = 0, top = 0;
    for (const [x, y, z] of WICKS) {
      // The prop turns about +Y by `angle`, as SetDressing.place does.
      const wx = prop.x + (x * cos + z * sin) * scale, wz = prop.z + (-x * sin + z * cos) * scale, wy = baseY + y * scale + FLAME.lift;
      flames.push([wx, wy, wz]);
      cx += wx / WICKS.length; cz += wz / WICKS.length; top = Math.max(top, wy);
    }
    lights.push([cx, top + 0.12, cz]);
  }
  return { flames, lights };
}

const vertexShader = /* glsl */ `
uniform float time;
varying vec2 vUv;
varying float vPhase;
void main() {
  vec4 root = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vPhase = fract(sin(dot(root.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
  // Each flame stretches and settles on its own beat.
  float stretch = 1.0 + 0.11 * sin(time * 8.7 + vPhase) + 0.07 * sin(time * 21.3 + vPhase * 1.7);
  vec4 view = viewMatrix * root;
  view.xy += vec2(position.x, position.y * stretch);
  gl_Position = projectionMatrix * view;
  vUv = uv;
}`;

const fragmentShader = /* glsl */ `
uniform float time;
uniform float heat;
varying vec2 vUv;
varying float vPhase;
void main() {
  float h = vUv.y;
  // The tip leans with the draught more than the base does.
  float sway = (sin(time * 6.3 + vPhase) * 0.07 + sin(time * 14.9 + vPhase * 2.3) * 0.035) * h * h;
  float dx = vUv.x - 0.5 - sway;
  // A teardrop: round at the wick, drawn out to a point.
  float body = 0.42 * pow(sin(3.14159 * clamp(h * 0.9 + 0.08, 0.0, 1.0)), 0.65) * (1.0 - 0.6 * h);
  float d = abs(dx) / max(body, 1e-3);
  float alpha = smoothstep(1.0, 0.45, d) * smoothstep(0.0, 0.07, h) * smoothstep(1.0, 0.8, h);
  if (alpha <= 0.003) discard;
  vec3 edge = vec3(0.92, 0.3, 0.05), mid = vec3(1.0, 0.62, 0.2), core = vec3(1.0, 0.88, 0.58);
  vec3 color = mix(edge, mid, smoothstep(0.95, 0.35, d));
  color = mix(color, core, smoothstep(0.6, 0.0, d) * smoothstep(0.8, 0.25, h));
  // A faint blue root where the wax vapour burns cleanest.
  color = mix(color, vec3(0.35, 0.5, 1.0), smoothstep(0.24, 0.06, h) * smoothstep(0.9, 0.3, d) * 0.55);
  float flicker = 0.88 + 0.12 * sin(time * 17.0 + vPhase * 3.1);
  gl_FragColor = vec4(color * heat * flicker * alpha, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

let quad = null;
const flameQuad = () => {
  if (!quad) {
    quad = new THREE.PlaneGeometry(FLAME.width, FLAME.height).translate(0, FLAME.height / 2, 0);
    quad.userData.shared = true;
  }
  return quad;
};

export class CandleFlames {
  constructor(group, glowMap) {
    this.time = { value: 0 };
    this.heat = { value: 1 };
    this.material = new THREE.ShaderMaterial({
      uniforms: { time: this.time, heat: this.heat }, vertexShader, fragmentShader,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(flameQuad(), this.material, 1);
    Object.assign(this.mesh, { name: "candle-flames", count: 0, frustumCulled: false, renderOrder: 2 });
    this.halo = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
      map: glowMap, size: 0.34, transparent: true, depthWrite: false, opacity: 0.8,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    Object.assign(this.halo, { name: "candle-glow", frustumCulled: false });
    group.add(this.mesh, this.halo);
    this.matrix = new THREE.Matrix4();
    this.count = 0;
  }
  /** Burn at these wick tips (world [x, y, z]); one halo per candle light point. */
  set(flames, lights) {
    if (this.mesh.instanceMatrix.count < flames.length) {
      const next = new THREE.InstancedMesh(this.mesh.geometry, this.material, flames.length + 24);
      Object.assign(next, { name: this.mesh.name, frustumCulled: false, renderOrder: 2 });
      this.mesh.parent.add(next);
      this.mesh.removeFromParent(); this.mesh.dispose();
      this.mesh = next;
    }
    flames.forEach(([x, y, z], i) => this.mesh.setMatrixAt(i, this.matrix.makeTranslation(x, y, z)));
    this.mesh.count = this.count = flames.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    // The halo sits on the flames, a touch below the light point.
    this.halo.geometry.setAttribute("position", new THREE.Float32BufferAttribute(lights.flatMap(([x, y, z]) => [x, y - 0.1, z]), 3));
    this.halo.geometry.computeBoundingSphere();
  }
  /** Bloom spreads a Cinematic flame, so its halo and heat ease off there. */
  setCinematic(cinematic) {
    this.halo.material.opacity = cinematic ? 0.45 : 0.8;
    this.heat.value = cinematic ? 1.3 : 1;
  }
  /** Advance the flicker; returns true while there is a flame to animate. */
  update(seconds) {
    this.time.value = seconds;
    this.halo.material.size = 0.34 + Math.sin(seconds * 9.1) * 0.025 + Math.sin(seconds * 23.0) * 0.015;
    return this.count > 0;
  }
  dispose() {
    this.mesh.dispose(); this.material.dispose();
    this.halo.geometry.dispose(); this.halo.material.dispose();
  }
}
