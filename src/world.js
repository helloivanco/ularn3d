import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { caveGlowMaterial, caveGlowCenter, releaseCaveGlowResources, VignetteShader, CAVE_HERO_LIGHT } from "./cave-glow.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mat, matBasic, surface, surfaceLambert, surfaceBasic, noise, shiftedTexture, placedTexture, tileScatter, reliefMap, stoneTint, releaseMaterialResources } from "./materials.js";
import { pixelAlignWorld } from "./pixel-align.js";
import { monsterSprite, faceMonster, monsterArtMetrics, releaseMonsterArtResources } from "./monster-art.js";
import { createCreatureModel } from "./creature-models.js";
import { itemSprite, faceItem, itemArtMetrics, releaseItemArtResources } from "./item-art.js";
import { CombatEffects } from "./combat-effects.js";
import { ImpactEffects } from "./impact-effects.js";
import { Trauma, PresentationClock } from "./feedback.js";
import { StaticTiles } from "./static-world.js";
import { TerrainGrid, ChunkedTerrainMesh } from "./terrain-grid.js";
import { creature, faceCreature, animateCreature, creatureMetrics, releaseCreatureResources } from "./creatures.js";
import { compact, percentile, sample, releaseCompactMaterials, bakeWallRelief } from "./graphics-utils.js";
import { HeroAnimation, WALK_SETTLE_MS, walkProgress } from "./hero-animation.js";
import { TorchLighting, stabilizeShadow } from "./lighting.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { wallHeight, wallLip, WALL_TILE_SIZE, WALL_BASE_Y, FLOOR_HEIGHT, FLOOR_CENTER_Y, groundSlab } from "./wall-cut.js";
import { AmbientRats, AMBIENT_RAT_POOL } from "./ambient-rats.js";
import { auraControl } from "./cooperation-aura.js";
import {
  createCooperationAura,
  placeCooperationAura,
  cooperationAuraShown,
} from "./cooperation-aura-mesh.js";
import {
  box,
  block,
  orb,
  tree,
  hero,
  equipHero,
  releaseModelResources,
  cone,
  building,
  itemModel,
  ring,
  fillWieldedWeapon,
  monsterModel,
  LANDMARK_NAMES,
} from "./models.js";
import {
  attackPose,
  attackStyle,
  CAST_MS,
  blendStep,
  castPose,
  dampStep,
  LEG_Y,
  pointOnRoute,
  pushOutOfWalls,
  STEP_MS,
  STEP_CONTACT,
  StepGlide,
  stepCurve,
  stepPose,
  stepRoute,
  SWING_MS,
} from "./hero-motion.js";

const UP = new THREE.Vector3(0, 1, 0);
/** Spread of per-frame hero speed in the middle of a walk (0 is perfectly even). */
const stepJitter = (speeds) => {
  const middle = speeds.slice(Math.floor(speeds.length * 0.2), Math.ceil(speeds.length * 0.8));
  if (middle.length < 6) return 0;
  const mean = middle.reduce((a, b) => a + b, 0) / middle.length;
  if (mean <= 0) return 0;
  const variance = middle.reduce((a, b) => a + (b - mean) ** 2, 0) / middle.length;
  return Math.round(Math.sqrt(variance) / mean * 1000) / 1000;
};
const routeLength = (route) => {
  let length = 0;
  for (let i = 1; i < route.length; i++) length += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
  return length;
};
const FLOOR_LIMIT = 40 * 32;
/* North-aligned default: pure +Z offset looks toward game north (−Z / −map Y). */
const GAME_CAMERA_Y = 15.5;
const GAME_CAMERA_DIST = Math.hypot(2.8, 8.5);
const GAME_CAMERA = new THREE.Vector3(0, GAME_CAMERA_Y, GAME_CAMERA_DIST);
const CAMERA_PREF_KEY = "ularn3d.camera";
/*
 * Auto spends headroom on resolution, from below native up to the screen's
 * own density (Retina included), never above 2×. Tiers above the screen's
 * density are skipped. The reached tier is remembered on this device.
 */
const AUTO_TIER_KEY = "ularn3d.autoTier";
const EMBER_COLOR = 0xff7a3c;
/* Cinematic vignette strength: deeper in the caves, faint in town. */
const VIGNETTE = { town: 0.16, caves: 0.42, volcano: 0.36 };
const AUTO_CAPS = [0.65, 0.75, 1, 1.5, 2];
const AUTO_LABELS = ["low", "balanced", "high", "sharp", "native"];
export const autoTierLimit = (ratio = globalThis.devicePixelRatio || 1) => ratio > 1.5 + 1e-6 ? 4 : ratio > 1 + 1e-6 ? 3 : 2;
const readAutoTier = () => {
  try {
    const stored = localStorage.getItem(AUTO_TIER_KEY);
    const tier = stored == null ? NaN : Number(stored);
    return Number.isInteger(tier) && tier >= 0 ? Math.min(tier, autoTierLimit()) : 1;
  } catch { return 1; }
};
const northCameraOffset = (radius = GAME_CAMERA_DIST, elevationY = GAME_CAMERA_Y) => {
  const horiz = Math.max(5, Math.min(46, radius));
  const y = Math.max(4, Math.min(40, elevationY));
  return new THREE.Vector3(0, y, horiz);
};
/*
 * Caves frame closer than town so a freshly lit corridor fills the view rather
 * than a field of dark. Town and caves remember zoom separately; the top-level
 * fields stay the town preference, so older saved preferences still read.
 */
const CAVE_CAMERA = Object.freeze({ radius: 7.6, elevation: 13 });
const cameraRegion = (level) => (level > 0 ? "caves" : "town");
const cameraEntry = (value) => {
  const radius = Number(value?.radius), elevation = Number(value?.elevation);
  return Number.isFinite(radius) && Number.isFinite(elevation) ? { radius, elevation } : null;
};
// Parsed once: the camera is captured every turn and must not re-read storage.
let cameraStore;
const readCameraStore = () => {
  if (cameraStore !== undefined) return cameraStore;
  try {
    const parsed = JSON.parse(localStorage.getItem(CAMERA_PREF_KEY) || "null");
    cameraStore = parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    cameraStore = null;
  }
  return cameraStore;
};
const readCameraPrefs = (level = 0) => {
  const stored = readCameraStore();
  if (cameraRegion(level) === "caves") return cameraEntry(stored?.caves) || { ...CAVE_CAMERA };
  return cameraEntry(stored);
};
let writtenCameraPrefs = "";
const writeCameraPrefs = (offset, level = 0) => {
  try {
    const entry = { radius: Math.hypot(offset.x, offset.z), elevation: offset.y };
    const stored = readCameraStore() || {};
    const next = cameraRegion(level) === "caves"
      ? { ...stored, caves: entry }
      : { ...stored, ...entry };
    const value = JSON.stringify(next);
    // Every turn captures the camera; storage is touched only when zoom or tilt changed.
    if (value === writtenCameraPrefs) return;
    cameraStore = next;
    localStorage.setItem(CAMERA_PREF_KEY, value);
    writtenCameraPrefs = value;
  } catch {}
};
function destroy(group) {
  group.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material?.userData.cutaway) o.material.dispose();
    if (o.isSprite) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
  group.clear();
}
function batch(group, { castShadow = true } = {}) {
  group.updateMatrixWorld(true);
  const sets = new Map(),
    sprites = [];
  group.traverse((o) => {
    if (o.isSprite) {
      sprites.push(o);
      return;
    }
    if (!o.isMesh) return;
    const part = o.userData.buildingPart;
    const key = `${o.material.uuid}:${part || ''}`;
    if (!sets.has(key)) sets.set(key, { material: o.material, part, geometries: [] });
    sets
      .get(key)
      .geometries.push(
        (o.geometry.index
          ? o.geometry.toNonIndexed()
          : o.geometry.clone()
        ).applyMatrix4(o.matrixWorld),
      );
  });
  group.clear();
  for (const { material, part, geometries } of sets.values()) {
    const merged = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    const m = new THREE.Mesh(merged, material);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    if (part) m.userData.buildingPart = part;
    group.add(m);
  }
  sprites.forEach((s) => group.add(s));
}
function label(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 100;
  const c = canvas.getContext("2d");
  c.fillStyle = "#102226dc";
  c.beginPath();
  c.roundRect(4, 16, 504, 64, 10);
  c.fill();
  c.strokeStyle = "#cfb78270";
  c.lineWidth = 2;
  c.stroke();
  c.font = "26px Georgia";
  c.textAlign = "center";
  c.fillStyle = "#ebd7a8";
  c.fillText(text, 256, 58);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  s.scale.set(2.35, 0.46, 1);
  s.position.y = 3.7;
  s.renderOrder = 10;
  return s;
}

export class World {
  constructor(container, onTile, onHover) {
    this.container = container;
    this.onTile = onTile;
    this.onHover = onHover;
    this.state = null;
    this.level = null;
    this.objects = new Map();
    this.tileIndex = new Map();
    this.frameSamples = []; this.renderSamples = []; this.inputSamples = []; this.updateSamples = [];
    // Hero speed per frame during the latest walk: a stop-go glide shows up as dips.
    this.heroSpeeds = []; this.heroLast = new THREE.Vector3(); this.longTasks = 0;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => { this.longTasks += list.getEntries().length; });
      this.longTaskObserver.observe({ type: "longtask" });
    } catch { this.longTaskObserver = null; }
    this.autoTier = readAutoTier(); this.qualityChangedAt = performance.now();
    this.monsters = new Map();
    this.tick = 0;
    this.lastPlayer = null;
    this.pointers = new Map();
    this.gesture = false;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.lost = false;
    this.wallCells = [];
    this.lamps = [];
    this.lastTime = performance.now();
    this.activeUntil = this.lastTime + 1000;
    this.renderedFrames = 0;
    this.paused = false;
    this.disposed = false;
    this.events = new AbortController();
    this.quality = "auto";
    try {
      this.quality = localStorage.getItem("ularn3d.quality") || this.quality;
    } catch {}
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x112c32);
    this.scene.fog = new THREE.FogExp2(0x112c32, 0.022);
    this.camera = new THREE.PerspectiveCamera(
      37,
      innerWidth / innerHeight,
      0.3,
      180,
    );
    this.camera.position.set(13, 17, 19);
    // MSAA is a context-creation flag. Balanced skips it: fill-rate on the web
    // is its hitch. Auto keeps it at every tier, so edges stay clean while
    // resolution adapts; switching into Auto from Balanced takes effect on reload.
    this.msaa = this.quality !== "balanced";
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.msaa,
      powerPreference: "high-performance",
      stencil: false,
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.shadowMap.enabled = this.quality === "cinematic";
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = this.quality === "cinematic";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping =
      this.quality === "cinematic"
        ? THREE.ACESFilmicToneMapping
        : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = this.quality === "cinematic" ? 1.15 : 1;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.dataset.engine = "webgl";
    this.environment = null;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: !this.reduced,
      dampingFactor: 0.075,
      maxPolarAngle: Math.PI * 0.43,
      minPolarAngle: 0.3,
      minDistance: 5,
      maxDistance: 46,
      enablePan: false,
    });
    this.ambient = new THREE.HemisphereLight(0xc4e4eb, 0x32422c, 1.65);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffd499, 3.9);
    this.sun.position.set(-12, 24, 8);
    this.sun.castShadow = this.quality === "cinematic";
    this.sun.shadow.mapSize.set(this.quality === "cinematic" ? 2048 : 256, this.quality === "cinematic" ? 2048 : 256);
    Object.assign(this.sun.shadow.camera, {
      left: -12,
      right: 12,
      top: 12,
      bottom: -12,
      near: 1,
      far: 80,
    });
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0x78b9cf, 1.1);
    this.fill.position.set(10, 10, -10);
    this.scene.add(this.fill);
    this.terrain = new THREE.Group();
    this.props = new THREE.Group();
    this.actors = new THREE.Group();
    this.scene.add(this.terrain, this.props, this.actors);
    this.staticTiles = new StaticTiles(this.props);
    this.effects = new CombatEffects(this.scene);
    // Game feel: impact effects, screen shake and a presentation clock that
    // hit-stop can hold. None of them can delay or simulate an engine action.
    this.impact = new ImpactEffects(this.scene);
    this.trauma = new Trauma({ seed: 1.3 });
    this.actionClock = new PresentationClock();
    this.fxOffset = { x: 0, y: 0 };
    this.killMarks = new Map();
    this.feel = { flashes: true, shake: .7 };
    this.frameHooks = new Set();
    this.heroHurtAt = -Infinity;
    this.collapsedAt = null; this.lens = null;
    // The death beat keeps its effects alive while menus would otherwise clear them.
    this.keepFeel = false;
    // Thin aim-assist spokes shown while a spell waits for a direction.
    const aimPositions = new Float32Array(8 * 2 * 3);
    const dirs = [
      [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];
    for (let i = 0; i < 8; i++) {
      const [dx, dy] = dirs[i];
      aimPositions.set([0, 0.04, 0, dx * 3.2, 0.04, dy * 3.2], i * 6);
    }
    const aimGeo = new THREE.BufferGeometry();
    aimGeo.setAttribute("position", new THREE.BufferAttribute(aimPositions, 3));
    this.aimGrid = new THREE.LineSegments(
      aimGeo,
      new THREE.LineBasicMaterial({
        color: 0xd8e6ef,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    this.aimGrid.visible = false;
    this.aimGrid.frustumCulled = false;
    this.scene.add(this.aimGrid);
    // Exact shared edges: undersized tiles leak, oversized coplanar tops fight
    // for the same depth samples. Integer centers and half-tile edges join.
    const floorGeo = new THREE.BoxGeometry(WALL_TILE_SIZE, FLOOR_HEIGHT, WALL_TILE_SIZE);
    this.floor = new ChunkedTerrainMesh(
      floorGeo,
      surface("flags", 0xffffff),
      FLOOR_LIMIT,
    );
    this.floor.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.floor.count = 0;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.grassFloor = new ChunkedTerrainMesh(
      floorGeo,
      surface("grass", 0xffffff),
      FLOOR_LIMIT,
    );
    this.grassFloor.count = 0;
    this.grassFloor.receiveShadow = true;
    this.scene.add(this.grassFloor);
    this.rubble = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.11, 0),
      matBasic(0x5e655c),
      48,
    );
    this.embers = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.045, 0.12, 4),
      new THREE.MeshBasicMaterial({ color: EMBER_COLOR, toneMapped: false }),
      24,
    );
    for (const decor of [this.rubble, this.embers]) {
      decor.count = 0;
      decor.visible = false;
      decor.castShadow = false;
      decor.receiveShadow = false;
      decor.frustumCulled = false;
      this.scene.add(decor);
    }
    this.cooperationAura = createCooperationAura();
    this.scene.add(this.cooperationAura);
    const wallGeo = bakeWallRelief(new THREE.BoxGeometry(1, 1, 1));
    floorGeo.userData.shared=wallGeo.userData.shared=true;
    this.floorGeometry=floorGeo; this.wallGeometry=wallGeo;
    this.walls = new ChunkedTerrainMesh(
      wallGeo,
      surface("stone", 0x99aba7),
      FLOOR_LIMIT,
    );
    this.caps = new ChunkedTerrainMesh(
      wallGeo,
      surface("stone", 0xb2bbad),
      FLOOR_LIMIT,
    );
    for (const mesh of [this.walls, this.caps]) {
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
    }
    const terrainFamilies = [this.floor, this.grassFloor, this.walls, this.caps];
    this.grid = { clear: () => terrainFamilies.forEach(mesh => mesh.clear()), get rebuilds() { return terrainFamilies.reduce((sum, mesh) => sum + mesh.rebuilds, 0); } };
    this.player = hero();
    this.heroAnimation = new HeroAnimation(this.scene, this.player);
    this.player.visible = false;
    this.bindHero();
    this.scene.add(this.player);
    this.playerLight = new THREE.PointLight(0xffc172, 6, 8, 2);
    this.playerLight.visible = false;
    this.playerLight.intensity = 0;
    this.scene.add(this.playerLight);
    this.wallHeightAt = [];
    this.wallLayout = 0;
    this.wallLayoutKey = null;
    this.structureKey = null;
    this.staticKey = null;
    this.lastStructureRev = null;
    this.lastActorRev = null;
    this.structureFastPath = 0;
    this.monsterFastPath = 0;
    this.revFastPath = 0;
    this.shadowUpdates = 0;
    this.ambientRatsNear = false;
    // Decorative wall-top rats: fixed pool, never in actors/props/pick.
    this.ambientRats = new AmbientRats(this.scene);
    this.torchLights = Array.from({ length: 6 }, () => {
      const l = new THREE.PointLight(0xffa64c, 0, 6, 2);
      this.scene.add(l);
      return l;
    });
    this.lighting = new TorchLighting(this.torchLights);
    this.marker = new THREE.Group();
    ring(this.marker, 0xf0d491, 0.46, 0.018);
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.routePointCount = 0;
    this.waterMaterial = mat(0x123b43, { metalness: 0.65, roughness: 0.28 });
    this.waterTime = { value: 0 };
    this.waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.waterTime = this.waterTime;
      shader.vertexShader = "uniform float waterTime;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\ntransformed.z += sin(position.x*.4 + waterTime*.4)*.045 + cos(position.y*.6 + waterTime*.3)*.035;",
      );
    };
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(250, 250, 4, 4),
      this.waterMaterial,
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -0.9;
    this.scene.add(this.water);
    const particles = new Float32Array(160 * 3);
    for (let i = 0; i < 160; i++) {
      particles[i * 3] = (noise(i, 1) - 0.5) * 30;
      particles[i * 3 + 1] = noise(i, 2) * 7;
      particles[i * 3 + 2] = (noise(i, 3) - 0.5) * 24;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(particles, 3));
    this.dust = new THREE.Points(
      pg,
      new THREE.PointsMaterial({
        color: 0xf1d8a0,
        size: 0.027,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    this.scene.add(this.dust);
    this.burst = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const p = orb(this.burst, 0xeacd8d, 0, 0, 0, 0.035, {
        emissive: 0xffb653,
        emissiveIntensity: 3,
      });
      p.userData.velocity = new THREE.Vector3(
        (noise(i, 12) - 0.5) * 2,
        1 + noise(i, 13),
        (noise(i, 14) - 0.5) * 2,
      );
    }
    this.burst.visible = false;
    this.scene.add(this.burst);
    this.burstAge = 1;
    // Balanced never allocates UnrealBloomPass. Typical machines hitch on the
    // extra fullscreen passes even when the pass is flagged disabled.
    this.composer = null;
    this.bloom = null;
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.ground = new THREE.Plane(UP, 0);
    this.scratchMatrix = new THREE.Matrix4();
    this.scratchScale = new THREE.Vector3();
    this.scratchPosition = new THREE.Vector3();
    this.scratchColor = new THREE.Color();
    this.scratchOffset = new THREE.Vector3();
    this.scratchCam = new THREE.Vector3();
    this.lastCamQuat = new THREE.Quaternion();
    this.lastCamQuatValid = false;
    this.identityQ = new THREE.Quaternion();
    this.spinQ = new THREE.Quaternion();
    this.scratchEuler = new THREE.Euler();
    this.heldCameraOffset = null;
    this.pickHits = [];
    this.cameraLive = false;
    this.followFrom = new THREE.Vector3();
    this.followCam = new THREE.Vector3();
    this.followStart = 0;
    this.followMs = 0;
    this.followHeld = true;
    this.followRoute = null;
    // Velocity-continuous tile crossings: a held run cruises between plants.
    this.glide = new StepGlide();
    this.stepDir = new THREE.Vector2();
    this.stepLength = 0;
    this.stepCruised = false;
    this.stepFar = false;
    this.runActive = false;
    this.runNextAt = 0;
    this.stepLate = 4;
    this.stepInterval = STEP_MS;
    this.lastStepAt = 0;
    this.stepStartedAt = 0;
    this.stepHome = null;
    this.stepDest = null;
    this.solidTiles = new Set();
    this.heroBounds = new THREE.Box3();
    this.boundsCorner = new THREE.Vector3();
    this.cutawayRay = new THREE.Raycaster();
    this.cutawayHits = [];
    this.cutawayTarget = new THREE.Vector3();
    this.cutawayDirection = new THREE.Vector3();
    this.yawFrom = 0;
    this.yawTo = 0;
    this.yawEase = false;
    this.pixelSlots = [];
    this.pixelCount = 0;
    this.drawSize = new THREE.Vector2();
    this.lampPool = [];
    this.billboards = [];
    this.draining = [];
    this.torchBudget = 0;
    const canvas = this.renderer.domElement;
    const listen = (target, name, handler) => target.addEventListener(name, handler, { signal: this.events.signal });
    listen(canvas, "pointerdown", (e) => {
      this.cameraLive = true;
      this.invalidate();
      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        time: performance.now(),
        moved: e.button !== 0,
      });
      if (this.pointers.size > 1) this.gesture = true;
    });
    listen(canvas, "pointermove", (e) => {
      this.invalidate();
      const p = this.pointers.get(e.pointerId);
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) p.moved = true;
      if (p?.moved || this.gesture || this.pointers.size > 1) return;
      this.hoverPointer={clientX:e.clientX,clientY:e.clientY}; this.hoverDirty=true;
    });
    listen(canvas, "pointerup", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p && !p.moved && !this.gesture && performance.now() - p.time < 700) {
        const t = this.pick(e);
        if (t) this.onTile(t);
      }
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) this.gesture = false;
    });
    listen(canvas, "pointercancel", (e) => {
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) this.gesture = false;
    });
    listen(canvas, "pointerleave", () => {
      this.hoverPointer = null;
      this.marker.visible = false;
      this.hoverPointer=null; this.hoverDirty=false;
      this.onHover(null);
      this.invalidate();
    });
    listen(canvas, "webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      this.heroAnimation.clear();
      this.clearFeel();
      this.footstepPending=null;
      this.stopFrames();
      this.releaseLostResources();
      window.dispatchEvent(new Event("ularn:graphics-lost"));
    });
    listen(canvas, "webglcontextrestored", () => {
      this.environment = null;
      this.applyGpuQuality();
      this.lost = false;
      this.resize();
      this.invalidate();
      window.dispatchEvent(new Event("ularn:graphics-restored"));
    });
    listen(window, "resize", () => this.resize());
    listen(document, "visibilitychange", () => {
      if (document.hidden) { this.heroAnimation.clear(); this.clearFeel(); this.stopFrames(); }
      else { this.lastTime = performance.now(); this.effects.clear(); this.invalidate(); }
    });
    listen(window, "ularn:combat", (event) => {
      const detail = event.detail;
      if (!this.state || detail?.level !== this.level || document.hidden) return;
      const actionNow = this.actionNow();
      if (detail.kind === "weapon") {
        this.attackAge = 0;
        this.attackStartedAt = actionNow;
        this.attackStyle = attackStyle(detail.weapon);
        const visible = !!detail.to && this.state.tiles.some(tile => tile.x === detail.to.x && tile.y === detail.to.y && tile.monster);
        this.heroAnimation.start(detail, actionNow, this.reduced, visible);
      }
      if (this.effects.event(detail, this.reduced) && detail.phase === "cast") { this.castAge = 0; this.castStartedAt = actionNow; }
      if ((detail.kind === "weapon" || detail.phase === "cast") && detail.to && detail.from &&
        (detail.to.x !== detail.from.x || detail.to.y !== detail.from.y)) {
        this.player.rotation.y = Math.atan2(detail.to.x - detail.from.x, detail.to.y - detail.from.y) + Math.PI;
        this.yawFrom = this.yawTo = this.player.rotation.y;
        this.yawEase = false;
      }
      this.invalidate();
    });
    this.controls.addEventListener("change", () => {
      if (!this.animating) this.invalidate();
    });
    this.controls.addEventListener("start", () => {
      this.cameraTween = null;
      this.cameraLive = true;
      this.invalidate();
    });
    this.controls.addEventListener("end", () => {
      this.cameraLive = false;
      this.captureCamera();
    });
    this.setQuality(this.quality, false);
    this.preview();
    this.invalidate();
    // Read-only graphics metrics make regressions measurable without a gameplay backdoor.
    window.ularnGraphics = Object.freeze({
      metrics: () => ({
        quality: this.quality,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        lights: this.scene.children.filter((o) => o.isLight && o.visible && o.intensity > 0).length,
        environment: !!this.scene.environment,
        shadowMap: this.sun.shadow.mapSize.x,
        antialias: this.msaa,
        bloom: !!(this.bloom && this.bloom.enabled && this.composer),
        composer: !!this.composer,
        ambient: this.ambient.intensity,
        sun: this.sun.intensity,
        fill: this.fill.intensity,
        playerLight: !!(this.playerLight.visible && this.playerLight.intensity),
        contextLost: this.lost,
        frameMs: this.frameMs || 0,
        renderedFrames: this.renderedFrames,
        frameLimit: this.frameLimit(),
        effectiveQuality: AUTO_LABELS[this.effectiveTier], autoTierLimit: autoTierLimit(),
        activeFrameP95: percentile(this.frameSamples), renderP95: percentile(this.renderSamples),
        inputLatencyP95: percentile(this.inputSamples), updateP95: percentile(this.updateSamples),
        longTasks: this.longTasks, stepJitter: stepJitter(this.heroSpeeds), heroSpeeds: this.heroSpeeds.map((v) => Math.round(v * 100) / 100),
        cameraSettling: !!(this.cameraTween || this.viewEasing),
        terrainRebuilds: this.grid.rebuilds, staticChunks: this.staticTiles.chunks.size,
        routePoints: this.routePointCount, routeVisible: false,
        heroPosition: this.player.position.toArray(), heroScreen: this.project(this.player.position), viewport: this.viewportRect,
        ...creatureMetrics(), ...window.ularnPersistence?.metrics(),
        idle: performance.now() > this.activeUntil,
        suspended: document.hidden || this.paused || this.lost,
        cameraElevation: Math.atan2(this.camera.position.y - this.controls.target.y,
          Math.hypot(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z)) * 180 / Math.PI,
        cameraYaw: Math.atan2(
          this.camera.position.x - this.controls.target.x,
          this.camera.position.z - this.controls.target.z,
        ) * 180 / Math.PI,
        cameraOffset: [
          this.camera.position.x - this.controls.target.x,
          this.camera.position.y - this.controls.target.y,
          this.camera.position.z - this.controls.target.z,
        ],
        fogDensity: this.scene.fog?.density ?? 0,
        sunVisible: !!(this.sun.visible && this.sun.intensity > 0),
        fillVisible: !!(this.fill.visible && this.fill.intensity > 0),
        pointLights: this.torchLights.filter((l) => l.visible && l.intensity > 0).length +
          (this.playerLight.visible && this.playerLight.intensity > 0 ? 1 : 0),
        monsterActors: this.monsters.size,
        propGroups: this.objects.size,
        floorInstances: this.floor.count + this.grassFloor.count,
        floorSpan: this.floor.geometry?.parameters?.width ?? null,
        wallInstances: this.walls.count,
        shadowUpdates: this.shadowUpdates,
        shadowTexelSize: (this.sun.shadow.camera.right-this.sun.shadow.camera.left)/this.sun.shadow.mapSize.x,
        torchReassignments:this.lighting.reassignments,
        antialiasing:this.cinematicRendering() ? "SMAA" : this.msaa ? "MSAA" : "none",
        caveGlow: !!this.floor.material?.userData?.caveGlow, caveRelief: !!this.floor.material?.userData?.caveRelief, vignette: !!(this.vignette && this.composer && this.cinematicRendering()),
        wallRelief:!!this.walls.geometry.getAttribute("color"),
        shadowMapEnabled: this.renderer.shadowMap.enabled,
        sunCastShadow: !!this.sun.castShadow,
        wallCastShadow: this.walls.castShadow,
        floorReceiveShadow: this.floor.receiveShadow,
        floorMaterial: this.floor.material?.type || null,
        auraMaterial:
          this.cooperationAura?.getObjectByName("cooperation-aura-fill")
            ?.material?.type || null,
        auraVisible: !!this.cooperationAura?.visible,
        auraCastShadow: !!this.cooperationAura?.getObjectByName(
          "cooperation-aura-fill",
        )?.castShadow,
        floorMapped: !!this.floor.material?.map,
        wallMapped: !!this.walls.material?.map,
        floorColor: this.floor.material?.color?.getHexString?.() ?? null,
        wallColor: this.walls.material?.color?.getHexString?.() ?? null,
        floorAnisotropy: this.floor.material?.map?.anisotropy ?? null,
        toneMapping: this.renderer.toneMapping,
        dustVisible: !!this.dust?.visible,
        waterVisible: !!this.water?.visible,
        pixelRatio: this.renderer.getPixelRatio(),
        structureFastPath: this.structureFastPath,
        monsterFastPath: this.monsterFastPath,
        revFastPath: this.revFastPath,
        ...monsterArtMetrics(),
        ...this.creaturePresentation(),
        ...itemArtMetrics(),
        ...this.effects.metrics(),
        ...this.heroAnimation.metrics(),
        ...this.impact.metrics(),
        trauma: Math.round(this.trauma.value * 1000) / 1000,
        shakePx: Math.round(Math.hypot(this.fxOffset.x, this.fxOffset.y) * 100) / 100,
        hitStopActive: this.actionClock.holding(performance.now()),
        collapsed: this.collapsedAt != null,
        cameraRegion: this.cameraRegion || null,
      }),
      beginExpeditionCamera: () => this.beginExpeditionCamera(),
      creatures: () => [...this.monsters.values()].map(({ mesh, species }) => ({
        uid: mesh.userData.uid, species, tile: { ...mesh.userData.tile },
        facing: { ...mesh.userData.facing },
        model: mesh.userData.model, family: mesh.userData.family, position: mesh.position.toArray(),
        facingYaw: mesh.rotation.y,
        presentation: mesh.userData.presentation || (mesh.userData.artPath ? "sprite" : "fallback"),
        model: mesh.userData.modelKey || null,
        art: mesh.userData.artPath || null,
        mirrored: mesh.userData.artwork?.scale.x < 0,
      })),
      projectTile: (x,y,height=0) => this.project(new THREE.Vector3(x,height,y)),
      props: () => [...this.objects.values()].flatMap(({ mesh }) => {
        const art = mesh.userData.itemArt;
        if (!art) return [];
        const map = art.userData.artwork?.material?.map;
        const image = map?.image;
        let cornerAlpha = null;
        if (image?.getContext) {
          const ctx = image.getContext("2d");
          const a = ctx.getImageData(0, 0, 1, 1).data[3];
          const b = ctx.getImageData(image.width - 1, 0, 1, 1).data[3];
          cornerAlpha = Math.max(a, b);
        }
        return [{
          tile: { ...mesh.userData.tile },
          id: mesh.userData.itemId,
          arg: mesh.userData.itemArg ?? 0,
          art: art.userData.artPath,
          mirrored: art.userData.artwork?.scale.x < 0,
          stripped: !!map?.userData.stripped,
          cornerAlpha,
        }];
      }),
      landmarks: () => [...this.objects.values()].flatMap(({ mesh }) => [mesh, ...mesh.children]
        .filter((child) => child.userData.fountain || child.userData.stairDirection || child.userData.trapKind)
        .map((child) => ({
          tile: { ...mesh.userData.tile },
          fountain: child.userData.fountain,
          waterVisible: !!child.getObjectByName("fountain-water")?.visible,
          stairDirection: child.userData.stairDirection,
          stairBlocked: child.userData.stairBlocked,
          trapKind: child.userData.trapKind,
          elevatorDirection: child.userData.elevatorDirection,
          label: mesh.userData.landmarkLabel,
        }))),
      walls: () => {
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        return this.wallCells.map((tile, i) => {
          this.walls.getMatrixAt(i, this.scratchMatrix);
          this.scratchMatrix.decompose(position, quaternion, scale);
          return { x: tile.x, y: tile.y, height: scale.y };
        });
      },
      heroWeapon: () => ({
        id: this.heroWeapon?.userData?.weaponId ?? null,
        type: this.heroWeapon?.userData?.weaponType ?? null,
        meshes: this.heroWeapon?.children?.length ?? 0,
        hasArt: !!this.heroWeapon?.getObjectByName("weapon-art"),
      }),
      heroMotion: () => {
        const now = performance.now();
        const swing = this.attackStartedAt == null ? 1 : (this.actionNow(now) - this.attackStartedAt) / SWING_MS;
        const step = this.followLive() ? this.glide.progress(now) : 1;
        return {
          style: this.attackStyle || "punch",
          armed: (this.heroWeapon?.children?.length || 0) > 0,
          weaponType: this.heroWeapon?.userData?.weaponType ?? "unarmed",
          swinging: swing >= 0 && swing < 1,
          swing: Math.max(0, Math.min(1, swing)),
          stepping: step >= 0 && step < 1,
          step: Math.max(0, Math.min(1, step)),
          bodyY: this.heroBody?.position.y ?? 0,
          rightArmX: this.heroRightArm?.rotation.x ?? 0,
          rightArmZ: this.heroRightArm?.rotation.z ?? 0,
          leftLegX: this.heroLeftLeg?.rotation.x ?? 0,
          rightLegX: this.heroRightLeg?.rotation.x ?? 0,
          leftKneeX: this.heroLeftKnee?.rotation.x ?? 0,
          rightKneeX: this.heroRightKnee?.rotation.x ?? 0,
          leftFootX: this.heroLeftFoot?.rotation.x ?? 0,
          rightFootX: this.heroRightFoot?.rotation.x ?? 0,
          footfalls: this.footfalls || 0,
        };
      },
      buildings: () => (this.cutawayBuildings || []).map(mesh => ({
        tile: {...mesh.userData.tile}, opacity: mesh.userData.opacity ?? 1,
        obscuresHero: !!mesh.userData.obscuresHero,
        depthWrite: (mesh.userData.buildingParts || []).every(child => child.material.depthWrite),
        parts: (mesh.userData.buildingParts || []).map(child => ({
          part: child.userData.buildingPart, visible: child.visible,
          opacity: child.material.opacity, transparent: child.material.transparent,
          depthWrite: child.material.depthWrite,
        })),
      })),
      ambientRats: () => this.ambientRats?.snapshot() ?? {
        pool: AMBIENT_RAT_POOL,
        enabled: false,
        interactive: false,
        decorative: true,
        count: 0,
        rats: [],
      },
    });
  }
  invalidate() {
    if (this.disposed) return;
    if (performance.now() > this.activeUntil) {
      this.lastTime = performance.now() - 1000 / 60;
      this.nextFrameTime = 0;
    }
    this.activeUntil = performance.now() + 1100;
    this.scheduleFrame();
  }
  followLive() {
    return !!(this.followStart && this.followMs && !this.followHeld);
  }
  frameLimit() {
    if (this.paused) return 4;
    const idle = performance.now() > this.activeUntil;
    const follow = this.followLive();
    if (idle && this.state && ["auto", "balanced"].includes(this.quality) && !this.hasMotion && !follow && !this.cameraLive)
      return 0;
    if (this.state && (this.cameraLive || this.hasMotion || follow || !idle)) return 60;
    return 12;
  }
  stopFrames() {
    clearTimeout(this.frameTimer);
    cancelAnimationFrame(this.frameRequest);
    this.frameTimer = this.frameRequest = null;
  }
  scheduleFrame() {
    if (this.disposed || document.hidden || this.lost) return;
    const idle = performance.now() > this.activeUntil;
    const effectsActive = this.effects.slots.some((slot) => slot.active);
    const ambientActive = !!this.ambientRatsNear;
    const follow = this.followLive();
    if (idle && !this.hasMotion && !follow && !this.cameraLive && !effectsActive && !ambientActive &&
      (["auto", "balanced"].includes(this.quality) || this.reduced || this.paused) && this.state) return;
    const live = !this.paused && !!this.state && (this.cameraLive || this.hasMotion || follow || effectsActive || ambientActive || !idle);
    // A pending low-rate timeout would hold the first step frame off vsync.
    if (live && this.frameTimer != null) {
      clearTimeout(this.frameTimer);
      this.frameTimer = null;
    }
    if (this.frameTimer != null || this.frameRequest != null) return;
    const fps = this.frameLimit() || 12;
    const delay = live ? 0 : Math.max(0, 1000 / fps - (performance.now() - this.lastTime));
    const kick = () => {
      this.frameRequest = requestAnimationFrame((frameTime) => {
        this.frameRequest = null;
        this.animate(frameTime);
      });
    };
    if (delay > 0) {
      this.frameTimer = setTimeout(() => {
        this.frameTimer = null;
        kick();
      }, delay);
    } else kick();
  }
  setPaused(paused) {
    if (this.paused === !!paused) return;
    this.paused = !!paused;
    if (this.paused) this.footstepPending = null;
    if (this.paused) this.heroAnimation.clear();
    if (this.paused && !this.keepFeel) this.clearFeel();
    this.nextFrameTime = 0;
    this.invalidate();
  }
  actionNow(real = performance.now()) { return this.actionClock.now(real); }
  setFeel(settings) { this.feel = { ...settings }; }
  setReduced(reduced) {
    this.reduced = !!reduced;
    this.controls.enableDamping = !this.reduced;
    if (this.reduced) this.clearFeel();
    this.invalidate();
  }
  clearFeel() {
    this.impact.clear();
    this.trauma.reset();
    this.actionClock.reset();
    this.killMarks.clear();
    this.fxOffset.x = this.fxOffset.y = 0;
    if (this.viewOffset) this.applyViewOffset();
    for (const actor of this.monsters.values()) actor.kick = null;
  }
  shake(amount) {
    if (this.reduced || !(amount > 0)) return;
    this.trauma.add(amount, performance.now());
    this.invalidate();
  }
  // Freeze action animations at blade contact, never input or engine time.
  hold(ms) {
    if (this.reduced) return;
    this.actionClock.hold(ms, performance.now() + 105);
    this.invalidate();
  }
  kick(actor, kind, toward, at) {
    const dx = toward.x - actor.target.x, dz = toward.z - actor.target.z, length = Math.hypot(dx, dz) || 1;
    actor.kick = { kind, x: dx / length, z: dz / length, at };
  }
  // The engine already resolved the blow; this only shows it landing.
  hitMonster(uid, { at, from, killed = false } = {}) {
    const now = this.actionNow(), flash = this.feel.flashes ? 1 : .35;
    if (killed) { this.killMarks.set(uid, { at: now, from: from ? { x: from.x, z: from.y } : null, flash }); return; }
    const actor = this.monsters.get(uid);
    if (!actor) return;
    this.impact.flash(actor.mesh, now, { delay: this.reduced ? 0 : 105, ms: this.feel.flashes ? 75 : 120, intensity: .85 * flash });
    if (!this.reduced && from) this.kick(actor, "flinch", { x: 2 * actor.target.x - from.x, z: 2 * actor.target.z - from.y }, now + 105);
    this.invalidate();
  }
  lungeMonster(uid, hero) {
    const actor = this.monsters.get(uid);
    if (!actor || this.reduced) return;
    this.kick(actor, "lunge", { x: hero.x, z: hero.y }, this.actionNow());
    this.invalidate();
  }
  heroHurt() {
    const now = this.actionNow();
    this.heroHurtAt = now;
    const flash = this.feel.flashes ? 1 : .35;
    this.impact.flash(this.player, now, { color: 0xff3b2a, intensity: .7 * flash, ms: this.feel.flashes ? 90 : 140 });
    this.invalidate();
  }
  levelUp() {
    this.impact.levelUp(this.player.position, this.actionNow(), { reduced: this.reduced });
    this.invalidate();
  }
  victory() {
    this.impact.levelUp(this.player.position, this.actionNow(), { reduced: this.reduced, gold: true });
    this.invalidate();
  }
  /*
   * Arrival and death framing are lens moves: they ease the projection zoom and
   * never move the orbit camera, so cutaways, terrain chunks and the saved zoom
   * are untouched. Descending settles in from wide; climbing from close.
   */
  arrive(direction) {
    if (this.reduced) return;
    this.lensTo(direction === "up" ? 1.08 : .9, 1, 560);
  }
  collapse(on = true) {
    this.collapsedAt = on ? this.actionNow() : null;
    if (on && !this.reduced) this.lensTo(this.camera.zoom, 1.2, 1200);
    this.invalidate();
  }
  lensTo(from, to, ms) {
    this.lens = { start: performance.now(), from, to, ms };
    this.camera.zoom = from;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }
  stepLens(now) {
    const lens = this.lens;
    if (!lens) return false;
    const u = Math.min(1, (now - lens.start) / lens.ms), eased = 1 - (1 - u) ** 3;
    this.camera.zoom = lens.from + (lens.to - lens.from) * eased;
    this.camera.updateProjectionMatrix();
    if (u >= 1) this.lens = null;
    return true;
  }
  actorPosition(uid) { return this.monsters.get(uid)?.mesh.position ?? null; }
  // Allocation-free projection for DOM overlays that follow world points.
  projectInto(x, z, height, out) {
    this.scratchPosition.set(x, height, z).project(this.camera);
    out.x = (this.scratchPosition.x + 1) * innerWidth / 2;
    out.y = (1 - this.scratchPosition.y) * innerHeight / 2;
    out.visible = this.scratchPosition.z < 1;
    return out;
  }
  releaseLostResources(clearArtCache = false) {
    // Remove disposal listeners tied to the lost GL context before restoration.
    // Keep the CPU-side artwork: Three.js uploads it again on the next render.
    // Otherwise later level/quality changes try to delete stale WebKit handles.
    this.clearFeel();
    this.impact.releaseMaterials();
    const geometries = new Set([this.floorGeometry, this.wallGeometry].filter(Boolean)),
      materials = new Set(),
      textures = new Set();
    this.scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      }
      if (object.isInstancedMesh) object.dispose();
    });
    for (const material of materials) {
      for (const value of Object.values(material))
        if (value?.isTexture) textures.add(value);
      material.dispose();
    }
    geometries.forEach((geometry) => geometry.dispose());
    textures.forEach((texture) => texture.dispose());
    releaseCreatureResources(clearArtCache);
    releaseModelResources(); releaseMaterialResources(); releaseCompactMaterials(); releaseCaveGlowResources(clearArtCache);
    releaseMonsterArtResources(clearArtCache);
    releaseItemArtResources(clearArtCache);
    this.sun.shadow.dispose();
    this.disposeComposer();
    this.environment?.dispose();
    this.environment = null;
    this.scene.environment = null;
  }
  bindHero() {
    this.heroBody = this.player.getObjectByName("body");
    this.heroLeftLeg = this.player.getObjectByName("left-leg");
    this.heroRightLeg = this.player.getObjectByName("right-leg");
    this.heroLeftKnee = this.player.getObjectByName("left-knee");
    this.heroRightKnee = this.player.getObjectByName("right-knee");
    this.heroLeftFoot = this.player.getObjectByName("left-foot");
    this.heroRightFoot = this.player.getObjectByName("right-foot");
    this.heroWeapon = this.player.getObjectByName("weapon");
    this.heroCape = this.player.getObjectByName("cape");
    this.heroLeftArm = this.player.getObjectByName("left-arm");
    this.heroRightArm = this.player.getObjectByName("right-arm");
    this.heroLeftForearm = this.player.getObjectByName("left-forearm");
    this.heroRightForearm = this.player.getObjectByName("right-forearm");
    this.heroWeaponKey = null;
  }
  setLeg(leg, rotationX, lift) {
    if (!leg) return;
    leg.rotation.x = rotationX;
    leg.position.y = LEG_Y + lift;
  }
  setArm(arm, x, y, z) {
    if (!arm) return;
    arm.rotation.set(x, y, z);
  }
  setForearm(arm, x) {
    if (!arm) return;
    arm.rotation.set(x, 0, 0);
  }
  setWeaponGrip(gripZ = 0) {
    const weapon = this.heroWeapon;
    if (!weapon) return;
    weapon.rotation.set(weapon.userData.restRotationX || 0, 0, gripZ);
  }
  skipsHeroBody(obj) {
    let node = obj;
    while (node) {
      if (node.name === "weapon" || node.name === "contact-disc") return true;
      // Only the rig has a body footprint. The ground ring's rotated bounding
      // box can span adjacent walls even though the circular ring fits, making
      // wall correction alternate forever at diagonal corridor corners.
      if (node === this.heroBody) return false;
      node = node.parent;
    }
    return true;
  }
  heroBodyBox() {
    const box = this.heroBounds;
    box.makeEmpty();
    const corner = this.boundsCorner;
    this.player.updateMatrixWorld(true);
    this.player.traverse((obj) => {
      if (!obj.isMesh || this.skipsHeroBody(obj)) return;
      const geom = obj.geometry;
      if (!geom.boundingBox) geom.computeBoundingBox();
      const bb = geom.boundingBox;
      for (const x of [bb.min.x, bb.max.x]) {
        for (const y of [bb.min.y, bb.max.y]) {
          for (const z of [bb.min.z, bb.max.z]) {
            corner.set(x, y, z).applyMatrix4(obj.matrixWorld);
            box.expandByPoint(corner);
          }
        }
      }
    });
    return box;
  }
  ensureSolid() {
    // Solid cells change only with the known structure, not on every step.
    const rev = this.state?.structureRev;
    const key = rev == null ? null : `${this.level}|${rev}|${this.wallLayout}|${this.wallCells.length}`;
    if (key !== null && key === this.solidKey) return;
    this.solidKey = key;
    const set = this.solidTiles;
    set.clear();
    for (const tile of this.wallCells) set.add(`${tile.x},${tile.y}`);
    const tiles = this.state?.tiles;
    if (tiles) {
      for (const tile of tiles) {
        if (tile.wall || tile.closed) set.add(`${tile.x},${tile.y}`);
      }
    }
  }
  isSolid(ix, iz) {
    if (this.stepHome && ix === this.stepHome.x && iz === this.stepHome.z) return false;
    if (this.stepDest && ix === this.stepDest.x && iz === this.stepDest.z) return false;
    return this.solidTiles.has(`${ix},${iz}`);
  }
  finishStepTiles() {
    if (this.stepDest) this.stepHome = { x: this.stepDest.x, z: this.stepDest.z };
    this.stepDest = null;
    this.followRoute = null;
  }
  nearSolid() {
    const x = Math.round(this.player.position.x);
    const z = Math.round(this.player.position.z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (this.isSolid(x + dx, z + dz)) return true;
      }
    }
    return false;
  }
  bodyHitsRock() {
    const box = this.heroBodyBox();
    if (box.isEmpty()) return false;
    const minX = Math.round(box.min.x) - 1;
    const maxX = Math.round(box.max.x) + 1;
    const minZ = Math.round(box.min.z) - 1;
    const maxZ = Math.round(box.max.z) + 1;
    for (let ix = minX; ix <= maxX; ix++) {
      for (let iz = minZ; iz <= maxZ; iz++) {
        if (!this.isSolid(ix, iz)) continue;
        if (box.max.x > ix - 0.5 + 0.001 && box.min.x < ix + 0.5 - 0.001 &&
          box.max.z > iz - 0.5 + 0.001 && box.min.z < iz + 0.5 - 0.001) return true;
      }
    }
    return false;
  }
  applyStepPose(pose) {
    const body = this.heroBody;
    body.position.y = pose.bodyY;
    body.position.z = 0;
    body.rotation.x = pose.lean;
    body.rotation.y = 0;
    body.rotation.z = pose.roll;
    this.setLeg(this.heroLeftLeg, pose.leftLeg, pose.leftLift);
    this.setLeg(this.heroRightLeg, pose.rightLeg, pose.rightLift);
    for (const [joint,angle] of [[this.heroLeftKnee,pose.leftKnee],[this.heroRightKnee,pose.rightKnee],
      [this.heroLeftFoot,pose.leftFoot],[this.heroRightFoot,pose.rightFoot]])
      if (joint) joint.rotation.x = angle || 0;
    this.setArm(this.heroLeftArm, pose.leftArm, 0, 0);
    this.setArm(this.heroRightArm, pose.rightArm, 0, 0);
    this.setForearm(this.heroLeftForearm, pose.forearmX);
    this.setForearm(this.heroRightForearm, pose.forearmX);
    if (this.heroCape) this.heroCape.rotation.x = pose.capeX;
    this.setWeaponGrip(0);
    this.lastStepPose = pose;
  }
  fitStride(pose) {
    if (!this.nearSolid()) return pose;
    this.applyStepPose(pose);
    if (!this.bodyHitsRock()) return pose;
    const planted = dampStep(pose, 0);
    this.applyStepPose(planted);
    if (this.bodyHitsRock()) return planted;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      const scaled = dampStep(pose, mid);
      this.applyStepPose(scaled);
      if (this.bodyHitsRock()) hi = mid;
      else lo = mid;
    }
    return dampStep(pose, lo);
  }
  keepBodyOutOfRock() {
    if (!this.player || !this.solidTiles.size) return;
    if (!this.nearSolid()) return;
    for (let pass = 0; pass < 3; pass++) {
      const box = this.heroBodyBox();
      if (box.isEmpty()) return;
      let dx = 0;
      let dz = 0;
      const minX = Math.round(box.min.x) - 1;
      const maxX = Math.round(box.max.x) + 1;
      const minZ = Math.round(box.min.z) - 1;
      const maxZ = Math.round(box.max.z) + 1;
      for (let ix = minX; ix <= maxX; ix++) {
        for (let iz = minZ; iz <= maxZ; iz++) {
          if (!this.isSolid(ix, iz)) continue;
          const overlapX = Math.min(box.max.x, ix + 0.5) - Math.max(box.min.x, ix - 0.5);
          const overlapZ = Math.min(box.max.z, iz + 0.5) - Math.max(box.min.z, iz - 0.5);
          if (overlapX <= 0.001 || overlapZ <= 0.001) continue;
          if (overlapX < overlapZ) {
            const dir = (box.min.x + box.max.x) * 0.5 < ix ? -1 : 1;
            dx += dir * (overlapX + 0.001);
          } else {
            const dir = (box.min.z + box.max.z) * 0.5 < iz ? -1 : 1;
            dz += dir * (overlapZ + 0.001);
          }
        }
      }
      if (!dx && !dz) return;
      this.player.position.x += dx;
      this.player.position.z += dz;
    }
  }
  faceStep(eased) {
    const route = this.followRoute;
    const bent = route && route.length > 2;
    if (!bent) {
      if (this.yawEase)
        this.player.rotation.y = this.yawFrom + (this.yawTo - this.yawFrom) * eased;
      return;
    }
    const here = pointOnRoute(route, eased);
    const ahead = pointOnRoute(route, Math.min(1, eased + 0.08));
    const fx = ahead.x - here.x;
    const fz = ahead.z - here.z;
    if (fx * fx + fz * fz < 1e-8) return;
    this.player.rotation.y = Math.atan2(fx, fz) + Math.PI;
  }
  // Steps follow real time; swings, casts and reactions follow the action clock.
  poseHero(now, act = now) {
    const body = this.heroBody;
    if (!body) return false;
    if (this.reduced) {this.applyStepPose(stepPose(1,false)); return this.poseReactions(act);}
    const swingT = this.attackStartedAt == null ? 1 : (act - this.attackStartedAt) / SWING_MS;
    const castT = this.castStartedAt == null ? 1 : (act - this.castStartedAt) / CAST_MS;
    const stepping = this.followLive();
    const swinging = swingT >= 0 && swingT < 1;
    const casting = castT >= 0 && castT < 1;
    // Stride by distance covered, so feet do not slide when a crossing is stretched.
    const stepTime = stepping ? this.glide.progress(now) : 1;
    const rawStep = blendStep(stepping ? this.stepPoseFrom : null,
      stepPose(stepTime,!!this.stepLeadRight,(this.heroWeapon?.children.length || 0)>0),stepTime);
    const step = stepping ? this.fitStride(rawStep) : rawStep;
    this.applyStepPose(step);
    if (casting && !swinging) {
      const cast = castPose(castT);
      this.setArm(this.heroRightArm, cast.arm.x, cast.arm.y, cast.arm.z);
      this.setForearm(this.heroRightForearm, cast.forearmX);
    }
    if (swinging) {
      const attack = attackPose(swingT, this.attackStyle || "punch");
      this.setArm(this.heroRightArm, attack.arm.x, attack.arm.y, attack.arm.z);
      this.setForearm(this.heroRightForearm, attack.forearmX);
      this.setArm(this.heroLeftArm, attack.left.x, attack.left.y, attack.left.z);
      body.position.z = attack.lunge;
      body.rotation.y = attack.twist;
      this.setWeaponGrip(attack.gripZ);
    }
    const reacting = this.poseReactions(act);
    return stepping || swinging || casting || reacting;
  }
  /**
   * Hurt flinch, idle breath and the death collapse, layered after the step
   * pose so each returns to rest on its own. Breath never keeps frames alive.
   */
  poseReactions(act) {
    const body = this.heroBody;
    if (!body) return false;
    if (this.collapsedAt != null) {
      const u = this.reduced ? 1 : Math.min(1, (act - this.collapsedAt) / 600), eased = 1 - (1 - u) ** 3;
      // The hero faces -z, so positive pitch falls backward, away from the blow.
      body.rotation.x = 1.3 * eased;
      body.position.y -= .22 * eased;
      return u < 1;
    }
    let live = false;
    const t = act - this.heroHurtAt;
    if (!this.reduced && t >= 0 && t < 260) {
      const k = Math.sin(Math.PI * Math.min(1, t / 70) / 2) * Math.exp(-Math.max(0, t - 70) / 70);
      body.rotation.x += .16 * k;
      body.position.z += .07 * k;
      live = true;
    }
    if (!this.reduced && this.state && !this.state.over) {
      const env = this.cinematicRendering() ? 1 : Math.max(0, Math.min(1, (this.activeUntil - performance.now()) / 500));
      body.position.y += Math.sin(act * .0021) * .006 * env;
    }
    return live;
  }
  creaturePresentation() {
    let model = 0;
    let sprite = 0;
    let fallback = 0;
    for (const actor of this.monsters.values()) {
      const presentation = actor.mesh.userData.presentation;
      if (presentation === "model") model++;
      else if (presentation === "sprite") sprite++;
      else fallback++;
    }
    return { creatureModels: model, creatureSprites: sprite, creatureFallbacks: fallback };
  }
  syncHeroWeapon(state) {
    const grip = this.heroWeapon;
    if (!grip) return;
    const weapon = state?.weapon || { id: null, type: "unarmed", name: "bare hands" };
    const key = `${weapon.id ?? "none"}:${weapon.type}`;
    if (key === this.heroWeaponKey) return;
    this.heroWeaponKey = key;
    fillWieldedWeapon(grip, weapon);
    this.heroAnimation?.bind(this.player);
    // Unique 3D grip meshes only — no tiny floor-art plate stuck on the blade.
  }
  buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer),
      environment = new RoomEnvironment();
    this.environment?.dispose();
    this.environment = pmrem.fromScene(environment, 0.04);
    environment.dispose();
    pmrem.dispose();
  }
  disposeComposer() {
    if (!this.composer) {
      this.bloom = null;
      return;
    }
    this.composer.passes.forEach((pass) => pass.dispose());
    this.composer.dispose();
    this.composer = null;
    this.bloom = null;
    this.vignette = null;
  }
  ensureComposer() {
    if (this.composer) return;
    const width = this.container.clientWidth || innerWidth;
    const height = this.container.clientHeight || innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Half-res + weaker bloom: full-size UnrealBloomPass lags typical GPUs.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, width * 0.5), Math.max(1, height * 0.5)),
      0.1,
      0.4,
      1.45,
    );
    this.ao = new SSAOPass(this.scene, this.camera, width / 2, height / 2);
    // Contact shading at tile scale (world units), not an 8-tile smear.
    this.ao.kernelRadius=1.2; this.ao.minDistance=.0005; this.ao.maxDistance=.01;
    // The composer sizes every pass at full resolution; AO stays at half.
    const aoSize = this.ao.setSize.bind(this.ao);
    this.ao.setSize = (w, h) => aoSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    this.composer.addPass(this.ao);
    this.composer.addPass(this.bloom);
    this.antialias=new SMAAPass(); this.composer.addPass(this.antialias);
    this.vignette = new ShaderPass(VignetteShader); this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());
  }
  applyLevelLighting() {
    const cinematic = this.cinematicRendering();
    const town = !this.state || this.state.level === 0;
    const volcano = this.state?.level > 15;
    if (town) {
      this.ambient.intensity = 1.75;
      this.sun.intensity = 4.15;
      this.fill.intensity = 1.25;
      this.sun.visible = true;
      this.fill.visible = true;
      if (this.scene.fog) this.scene.fog.density = 0.02;
    } else {
      /* Constant dungeon light: ambient only, no directional/point, no fog dimming.
         Cinematic lowers the ambient and lets the hero's light carry nearby detail. */
      this.ambient.intensity = cinematic ? 1.35 : 1.7;
      this.sun.intensity = 0;
      this.fill.intensity = 0;
      this.sun.visible = false;
      this.fill.visible = false;
      if (this.scene.fog) this.scene.fog.density = 0;
    }
    // Embers reach the bloom threshold only in Cinematic.
    this.embers?.material.color.setHex(EMBER_COLOR).multiplyScalar(cinematic ? 6 : 1);
    if (this.state) {
      this.fill.color.set(
        volcano ? 0xb54c35 : town ? (cinematic ? 0xd7b07a : 0x78b9cf) : 0x8eb8c9,
      );
    }
    this.disablePointLights();
  }
  disablePointLights() {
    this.playerLight.visible = false;
    this.playerLight.intensity = 0;
    this.torchLights.forEach((light) => {
      light.visible = false;
      light.intensity = 0;
    });
  }
  // Auto spends headroom on sharpness. The full post-processing/shadow stack
  // is an explicit Cinematic choice, avoiding a large automatic cost cliff.
  cinematicRendering() { return this.quality === "cinematic"; }
  qualityPixelRatio() {
    const cap=this.cinematicRendering()?1.5:this.quality==="auto"?AUTO_CAPS[Math.min(this.effectiveTier, autoTierLimit())]:.75;
    return Math.min(devicePixelRatio,cap);
  }
  applyGpuQuality() {
    const cinematic = this.cinematicRendering();
    // Balanced caps below native DPR: 1440×1000 fill already dominates web frame time.
    this.renderer.setPixelRatio(this.qualityPixelRatio());
    // Balanced never runs a shadow pass — walls already do not cast, and the
    // leftover sun/hero shadow setup still cost town frames in Chrome.
    this.renderer.shadowMap.enabled = cinematic;
    this.renderer.shadowMap.type = cinematic ? THREE.PCFShadowMap : THREE.BasicShadowMap;
    this.sun.castShadow = cinematic;
    this.sun.shadow.mapSize.set(cinematic ? 2048 : 256, cinematic ? 2048 : 256);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.renderer.toneMapping = cinematic
      ? THREE.ACESFilmicToneMapping
      : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = cinematic ? 1.15 : 1;
    if (cinematic) {
      this.ensureComposer();
      this.bloom.enabled = true;
    } else this.disposeComposer();
    this.torchBudget = 0;
    this.disablePointLights();
    const town = !this.state || this.state.level === 0;
    if (cinematic && town) {
      if (!this.environment) this.buildEnvironment();
      this.scene.environment = this.environment.texture;
      this.scene.environmentIntensity = 0.24;
    } else {
      this.scene.environment = null;
      this.scene.environmentIntensity = 0;
    }
    // Walls and floors filled the shadow pass on every walk frame. Balanced keeps
    // shadows off entirely; cinematic restores contact shadows.
    this.walls.castShadow = cinematic;
    this.caps.castShadow = cinematic;
    this.floor.receiveShadow = cinematic;
    this.grassFloor.receiveShadow = cinematic;
    this.walls.receiveShadow = cinematic;
    this.caps.receiveShadow = cinematic;
    this.player?.traverse((object) => {
      if (!object.isMesh) return;
      if (object.userData.flatMark) {
        object.castShadow = false;
        object.receiveShadow = false;
        return;
      }
      object.castShadow = cinematic;
      object.receiveShadow = cinematic;
    });
    for (const actor of this.monsters.values()) actor.mesh.traverse(object => {
      const flags = object.userData.presentationShadows;
      if (!object.isMesh || !flags) return;
      object.castShadow = cinematic && flags.cast;
      object.receiveShadow = cinematic && flags.receive;
    });
    this.cooperationAura?.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
    });
    this.applyFloorMaterials();
    this.applyLevelLighting();
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    if (cinematic) this.markShadowUpdate();
  }
  floorSurface(kind, color, extra, scatter = false) {
    const dungeon = this.state && this.state.level !== 0;
    const turned = (material) => (scatter ? tileScatter(material) : material);
    // Flat caves: MeshBasic (constant light, no torch/zoom dim) WITH stone/grass
    // maps. Do not strip map/texture unless Ivan explicitly asks for texture changes.
    // Cinematic adds a warm pool around the hero on the same unlit, mapped material.
    if (dungeon) {
      const flat = turned(surfaceBasic(kind, color, extra));
      return this.cinematicRendering() ? caveGlowMaterial(flat, reliefMap(kind)) : flat;
    }
    return turned(this.cinematicRendering()
      ? surface(kind, color, extra)
      : surfaceLambert(kind, color, extra));
  }
  applyFloorMaterials() {
    const tint = stoneTint(this.state?.level ?? 0);
    const courses = shiftedTexture("stone", "courses", 0.37, 0.19);
    // Floors turn per tile; walls and caps keep their courses level.
    const volcano = (this.state?.level ?? 0) > 15;
    this.floor.material = this.floorSurface(volcano ? "basalt" : "flags", tint.floor, undefined, true);
    this.grassFloor.material = this.floorSurface("grass", 0xffffff, undefined, true);
    this.walls.material = this.floorSurface("stone", tint.wall, { map: courses, vertexColors:true });
    this.caps.material = this.floorSurface("stone", tint.cap, { map: courses, vertexColors:true });
  }
  floorVariation(level, grass, x, y) {
    const n = noise(x, y);
    const n2 = noise(x + 11, y + 4);
    if (grass) {
      // Half the former spread around the same mean: the blade map carries the
      // detail, so the lawn no longer reads as a yellow/green checkerboard.
      this.scratchColor.setRGB(0.575 + n * 0.11, 0.62 + n2 * 0.08, 0.38 + n * 0.04);
      return this.scratchColor;
    }
    if (!level) {
      this.scratchColor.setHex(0xb6b49c).multiplyScalar(0.84 + n * 0.2);
      return this.scratchColor;
    }
    if (level > 15) {
      if (n > 0.94) this.scratchColor.setRGB(1.15, 0.58, 0.34);
      else this.scratchColor.setRGB(0.7 + n2 * 0.12, 0.64 + n * 0.08, 0.58 + n2 * 0.04);
      return this.scratchColor;
    }
    const base = 0.95 + n * 0.08;
    if (n2 > 0.88) this.scratchColor.setRGB(base * 0.9, base * 1.03, base * 0.86);
    else if (n2 < 0.1) this.scratchColor.setRGB(base * 1.04, base * 0.95, base * 0.84);
    else this.scratchColor.setRGB(base, base, base * 0.98);
    return this.scratchColor;
  }
  markShadowUpdate() {
    this.renderer.shadowMap.needsUpdate = true;
    this.shadowUpdates++;
  }
  syncPlayerLight() {
    const enabled=this.cinematicRendering() && !!this.state;
    if (!enabled) { this.disablePointLights(); this.lightKey = null; return; }
    const town = this.state.level===0;
    this.playerLight.visible=true;
    // A carried flame breathes a little in the caves; reduced motion holds it steady.
    const flicker = town || this.reduced ? 0 : Math.sin(this.tick * 7.3) * .035 + Math.sin(this.tick * 13.1 + 1.7) * .025;
    this.playerLight.intensity=town ? 3.5 : CAVE_HERO_LIGHT.intensity * (1 + flicker);
    this.playerLight.distance=town ? 8 : CAVE_HERO_LIGHT.distance;
    this.torchLights.forEach((light,index)=>{light.visible=town && index<4;});
    if (!town) return;
    // Torch choice depends only on the hero's tile and the lamp set.
    const key = this.playerTarget ? `${this.playerTarget.x},${this.playerTarget.z}|${this.lampRev}` : null;
    if (key && key !== this.lightKey) { this.lightKey = key; this.lighting.assign(this.lamps,this.playerTarget,4); }
  }
  setQuality(value, persist = true) {
    this.quality = ["auto", "cinematic", "balanced"].includes(value)
      ? value
      : "balanced";
    if (persist)
      try {
        localStorage.setItem("ularn3d.quality", this.quality);
      } catch {}
    this.applyQuality();
  }
  applyQuality() {
    this.effectiveTier = this.quality === "auto" ? this.autoTier : this.quality === "cinematic" ? 2 : 1;
    this.applyGpuQuality();
    const cinematic=this.cinematicRendering();
    if (cinematic) this.ensureComposer(); else this.disposeComposer();
    if (this.composer) {
      this.bloom.enabled=this.ao.enabled=this.antialias.enabled=cinematic;
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
    }
    this.syncAmbientDust();
    this.resize();
  }
  /**
   * Town keeps its pollen. Cinematic adds cool cave dust and volcano embers
   * around the hero; Balanced and Auto caves stay flat and still.
   */
  syncAmbientDust() {
    const level = this.state?.level ?? 0, town = level === 0;
    this.dust.visible = town || (this.cinematicRendering() && !this.reduced);
    const material = this.dust.material;
    if (town) { material.color.setHex(0xf1d8a0); material.opacity = .5; material.size = .027; }
    else if (level > 15) { material.color.setHex(0xff8a3d); material.opacity = .75; material.size = .05; }
    else { material.color.setHex(0xa9c7cf); material.opacity = .32; material.size = .032; }
    if (this.dust.visible && this.state) this.dust.position.set(this.state.x, 0, this.state.y);
  }
  adaptQuality(now, frameMs) {
    if (this.quality !== "auto" || this.frameSamples.length < 20) return;
    const p95 = percentile(this.frameSamples);
    this.overBudgetMs = p95 > 20 ? (this.overBudgetMs || 0) + frameMs : 0;
    this.headroomMs = p95 < 19 ? (this.headroomMs || 0) + frameMs : 0;
    if (this.overBudgetMs > 2000 && this.autoTier > 0) this.autoTier--;
    else if (this.headroomMs > 5000 && this.autoTier < autoTierLimit()) this.autoTier++;
    else return;
    try { localStorage.setItem(AUTO_TIER_KEY, String(this.autoTier)); } catch {}
    this.qualityChangedAt = now; this.overBudgetMs = this.headroomMs = 0;
    this.frameSamples.length = 0; this.applyQualityWhenSettled();
  }
  /** Center the vignette on the hero, whatever panels have shifted the framing. */
  aimVignette() {
    const uniforms = this.vignette.uniforms, level = this.state?.level ?? 0;
    uniforms.uStrength.value = !this.state || !level ? VIGNETTE.town : level > 15 ? VIGNETTE.volcano : VIGNETTE.caves;
    uniforms.uAspect.value = this.camera.aspect;
    this.scratchPosition.copy(this.player.position).setY(0.6).project(this.camera);
    uniforms.uCenter.value.set(
      Math.min(1, Math.max(0, this.scratchPosition.x * 0.5 + 0.5)),
      Math.min(1, Math.max(0, this.scratchPosition.y * 0.5 + 0.5)),
    );
  }
  applyQualityWhenSettled() {
    // A resize mid-step is a long frame and a visible pop; wait for the plant.
    if (this.followLive() || this.cameraLive) { this.qualityPending = true; return; }
    this.qualityPending = false;
    this.applyQuality();
  }
  project(position) {
    this.camera.updateMatrixWorld();
    const point = position.clone().project(this.camera);
    return { x: (point.x + 1) * innerWidth / 2, y: (1 - point.y) * innerHeight / 2 };
  }
  setViewportRect(rect) {
    this.viewportRect = { ...rect };
    const x = innerWidth / 2 - (rect.left + rect.right) / 2, y = innerHeight / 2 - (rect.top + rect.bottom) / 2;
    const resized = this.viewSize?.width !== innerWidth || this.viewSize?.height !== innerHeight;
    this.viewSize = { width: innerWidth, height: innerHeight };
    this.viewTarget = { x, y };
    // A window resize reframes at once; a panel opening (effects rail, HUD)
    // slides the framing over a few frames instead of jumping sideways.
    if (resized || !this.viewOffset || this.reduced || !this.state) {
      this.viewOffset = { x, y };
      this.applyViewOffset();
    } else this.viewEasing = true;
    this.invalidate();
  }
  // Shake rides on the framing offset in screen space, so follow, picking and
  // cutaways never see a perturbed camera position.
  applyViewOffset() {
    this.camera.setViewOffset(innerWidth, innerHeight, this.viewOffset.x + this.fxOffset.x, this.viewOffset.y + this.fxOffset.y, innerWidth, innerHeight);
  }
  stepShake(now) {
    const was = this.fxOffset.x !== 0 || this.fxOffset.y !== 0;
    const live = this.trauma.offset(now, this.fxOffset, 10, this.reduced ? 0 : this.feel.shake ?? .7);
    if ((live || was) && this.viewOffset) this.applyViewOffset();
    return live;
  }
  stepViewOffset(dt) {
    if (!this.viewEasing) return;
    const blend = 1 - Math.exp(-dt / 0.05), view = this.viewOffset, target = this.viewTarget;
    view.x += (target.x - view.x) * blend;
    view.y += (target.y - view.y) * blend;
    if (Math.abs(target.x - view.x) < 0.5 && Math.abs(target.y - view.y) < 0.5) {
      view.x = target.x; view.y = target.y; this.viewEasing = false;
    }
    this.applyViewOffset();
  }
  setRoute(points = []) {
    // Preserve read-only travel diagnostics without drawing guidance lines.
    this.routePointCount = Math.min(points.length, FLOOR_LIMIT + 1);
    this.invalidate();
  }
  resize() {
    const width = this.container.clientWidth || innerWidth;
    const height = this.container.clientHeight || innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer?.setSize(width, height);
    this.invalidate();
  }
  mountains(width, height, offsetX = 0, offsetY = 0) {
    for (let i = 0; i < 18; i++) {
      const x = noise(i, 62) * (width + 20) - 10 + offsetX,
        z =
          (i % 2 ? -22 - noise(i, 63) * 14 : height + 20 + noise(i, 64) * 14) +
          offsetY;
      const rock = cone(
        this.terrain,
        0x345250,
        x,
        1.5,
        z,
        4 + noise(i, 65) * 4,
        7 + noise(i, 66) * 9,
        5,
      );
      rock.rotation.y = noise(i, 67) * 6;
    }
  }
  preview() {
    block(this.terrain, "stone", 0x66756b, 2, -0.35, 0, 21, 0.55, 16, { map: placedTexture("stone", "preview-base", { repeat: [21, 16] }) });
    block(this.terrain, "grass", 0x9eaa77, 2, -0.07, 0, 20.9, 0.06, 15.9, { map: placedTexture("grass", "preview-field", { repeat: [21, 16] }) });
    for (let x = -8; x < 13; x++)
      for (let y = -7; y < 8; y++)
        if (y === 1 || x === 4)
          block(
            this.terrain,
            "flags",
            0xc7bda0,
            x,
            0.003,
            y,
            0.99,
            0.025,
            0.99,
          );
    const town = new THREE.Group();
    for (const [id, x, z, s] of [
      [69, -2, 4, 1.4],
      [12, 1, 0, 1.25],
      [10, 6, -3, 1.65],
      [16, 8, 3, 1.3],
      [77, 1, -4, 1.3],
      [54, 8, -6, 1.5],
    ]) {
      const b = building(id);
      b.position.set(x, 0, z);
      b.scale.setScalar(s);
      town.add(b);
    }
    // The title never fades or cuts away a building, so all six merge by
    // shared material: one draw per material instead of one per building.
    // Labels keep their placement by baking each building's transform first.
    town.updateMatrixWorld(true);
    const labels = [];
    town.traverse((o) => { if (o.isSprite) labels.push(o); });
    for (const sprite of labels) {
      sprite.matrixWorld.decompose(sprite.position, sprite.quaternion, sprite.scale);
      sprite.removeFromParent();
    }
    batch(town);
    labels.forEach((sprite) => town.add(sprite));
    this.props.add(town);
    for (let i = 0; i < 100; i++) {
      const x = noise(i, 9) * 25 - 10,
        y = noise(i, 10) * 21 - 10;
      if ((x > 11 || x < -5 || y < -6 || y > 6) && !(x > 6 && y < -5)) {
        const t = tree(0.65 + noise(i, 15) * 0.65);
        t.position.set(x, 0, y);
        this.terrain.add(t);
      }
    }
    for (let i = 0; i < 28; i++) {
      const x = noise(i, 43) * 24 - 10,
        z = noise(i, 44) * 19 - 9;
      if (Math.abs(z) > 6 || x > 11 || x < -7) {
        const rock = orb(
          this.terrain,
          0x6a7c70,
          x,
          -0.32,
          z,
          0.55 + noise(i, 45),
        );
        rock.scale.y = 0.65;
      }
    }
    this.mountains(20, 16, -7, -8);
    batch(this.terrain, { castShadow: false });
    this.camera.position.set(21, 20, 26);
    this.controls.target.set(-3, 0, 0);
    this.controls.autoRotate = !this.reduced;
    this.controls.autoRotateSpeed = 0.12;
  }
  townPaths(tiles) {
    const points = tiles.filter((t) => t.store);
    const paths = new Set();
    if (!points.length) return paths;
    const center = {
      x: Math.round(points.reduce((a, p) => a + p.x, 0) / points.length),
      y: Math.round(points.reduce((a, p) => a + p.y, 0) / points.length),
    };
    for (const p of points) {
      let x = p.x,
        y = p.y;
      while (y !== center.y) {
        paths.add(`${x},${y}`);
        y += Math.sign(center.y - y);
      }
      while (x !== center.x) {
        paths.add(`${x},${y}`);
        x += Math.sign(center.x - x);
      }
      paths.add(`${x},${y}`);
    }
    return paths;
  }
  captureCamera() {
    this.heldCameraOffset = this.camera.position.clone().sub(this.controls.target);
    writeCameraPrefs(this.heldCameraOffset, this.level);
    return this.heldCameraOffset;
  }
  applyHeldCamera(target) {
    const offset =
      this.heldCameraOffset && this.heldCameraOffset.lengthSq() > 1
        ? this.heldCameraOffset.clone()
        : GAME_CAMERA.clone();
    this.cameraTween = null;
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
    this.controls.update();
    this.controls.enableDamping = damping;
    this.heldCameraOffset = offset;
    this.followHeld = true;
  }
  /* New game / load: north yaw, preferred zoom/elevation from prior sessions. */
  beginExpeditionCamera(target = null) {
    const prefs = readCameraPrefs(this.state?.level ?? 0);
    this.cameraRegion = cameraRegion(this.state?.level ?? 0);
    this.heldCameraOffset = northCameraOffset(
      prefs?.radius ?? GAME_CAMERA_DIST,
      prefs?.elevation ?? GAME_CAMERA_Y,
    );
    if (target || this.state) {
      const at = target || new THREE.Vector3(this.state.x, 0, this.state.y);
      this.applyHeldCamera(at);
      this.updateWalls();
      this.invalidate();
    }
    return this.heldCameraOffset.clone();
  }
  update(state) {
    const started = performance.now();
    try { this.applyUpdate(state); }
    finally { sample(this.updateSamples, performance.now() - started); }
  }
  applyUpdate(state) {
    const old = this.state;
    if (old && this.level != null) this.captureCamera();
    this.state = state;
    this.hoverDirty = true;
    // Snapshot tiles are reused objects, but the old index still says which
    // squares were already charted: loot appearing there was dropped, not found.
    const knownBefore = this.tileIndex;
    this.tileIndex = new Map(state.tiles.map((tile) => [tile.y * state.width + tile.x, tile]));
    this.controls.autoRotate = false;
    const isNew = this.level !== state.level;
    if (isNew) {
      this.frameSamples.length = 0; this.overBudgetMs = this.headroomMs = 0; this.lastFrameActive = false;
      destroy(this.terrain);
      this.staticTiles.clear();
      this.grid.clear();
      destroy(this.props);
      this.objects.forEach(({ mesh }) => { if (!mesh.parent) destroy(mesh); });
      this.objects.clear();
      this.tileGeometrySignature = null;
      this.setRoute();
      destroy(this.actors);
      this.monsters.clear();
      this.effects.clear();
      this.clearFeel();
      this.ambientRats?.clear();
      this.lamps = []; this.lampRev = (this.lampRev || 0) + 1;
      this.wallHeightAt.length = 0;
      this.wallView = null;
      this.wallLayoutKey = null;
      this.structureKey = null;
      this.level = state.level;
      this.lastPlayer = null;
      // Crossing between town and caves restores that region's zoom, keeping the yaw.
      const region = cameraRegion(state.level);
      if (this.cameraRegion && this.cameraRegion !== region && this.heldCameraOffset) {
        const prefs = readCameraPrefs(state.level);
        if (prefs) {
          const yaw = Math.atan2(this.heldCameraOffset.x, this.heldCameraOffset.z);
          const north = northCameraOffset(prefs.radius, prefs.elevation);
          this.heldCameraOffset.set(Math.sin(yaw) * north.z, north.y, Math.cos(yaw) * north.z);
        }
      }
      this.cameraRegion = region;
      this.walkPhase = 0; this.walkStartedAt = undefined;
      const town = state.level === 0,
        volcano = state.level > 15;
      this.scene.background.set(
        town ? 0x112c32 : volcano ? 0x261b1a : 0x0b1821,
      );
      this.scene.fog.color.copy(this.scene.background);
      this.applyLevelLighting();
      this.applyFloorMaterials();
      this.water.visible = town;
      this.syncAmbientDust();
      this.paths = this.townPaths(state.tiles);
      this.staticKey = null;
      this.structureKey = null;
      this.lastStructureRev = null;
      this.lastActorRev = null;
      if (!town) {
        const base = groundSlab(-0.625);
        const slab = box(
          this.terrain,
          volcano ? 0x22191a : 0x101d24,
          (state.width - 1) / 2,
          base.y,
          (state.height - 1) / 2,
          state.width,
          base.height,
          state.height,
        );
        // Town terrain is merged with castShadow off. The dungeon slab used to
        // recast a 57×20 box into the shadow map on every cutaway step.
        slab.castShadow = false;
        slab.receiveShadow = false;
        // Unlit in the background color: the explored floor sits in the dark
        // without a lit footprint edge drawing a hard seam across the view.
        slab.material = matBasic(this.scene.background.getHex());
        slab.name = "cave-slab";
      } else {
        const base = groundSlab(-0.715);
        // One texture repeat per tile: the land outside the walls keeps the
        // same texel density as the plaza instead of one map stretched 67×17.
        block(
          this.terrain,
          "grass",
          0x70806e,
          (state.width - 1) / 2,
          base.y,
          (state.height - 1) / 2,
          state.width,
          base.height,
          state.height,
          { map: placedTexture("grass", `town-ground-${state.width}x${state.height}`, { repeat: [state.width, state.height] }) },
        );
        for (let i = 0; i < 48; i++) {
          const x = noise(i, 63) * (state.width + 6) - 3,
            z =
              i % 2
                ? -1.7 - noise(i, 61) * 5
                : state.height + 0.6 + noise(i, 62) * 5;
          const t = tree(0.55 + noise(i, 69));
          t.position.set(x, -0.1, z);
          this.terrain.add(t);
        }
        for (let i = 0; i < 24; i++) {
          const rock = orb(
            this.terrain,
            0x6d7f70,
            noise(i, 80) * state.width,
            -0.28,
            i % 2 ? -0.7 : state.height - 0.3,
            0.23 + noise(i, 81) * 0.55,
          );
          rock.scale.y = 0.7;
        }
        this.mountains(state.width, state.height);
        batch(this.terrain, { castShadow: false });
      }
    }
    if (this.character !== state.character) {
      this.scene.remove(this.player);
      destroy(this.player);
      this.player = hero(state.character);
      this.heroAnimation.bind(this.player);
      this.character = state.character;
      this.bindHero();
      this.scene.add(this.player);
    }
    const ids = new Set();
    let floorIndex = 0,
      grassIndex = 0;
    let wallLayout = 0;
    let wallCount = 0;
    let lampIndex = 0;
    // Bridge already hashed known tiles into structureRev/actorRev. Trust those
    // on quiet walks so we do not re-walk every HAVESEEN cell just to early-return.
    if (
      !isNew &&
      state.structureRev != null &&
      state.structureRev === this.lastStructureRev &&
      this.wallCells.length > 0
    ) {
      if (state.actorRev === this.lastActorRev) {
        this.structureFastPath++;
        this.revFastPath++;
        this.syncMovers(state, old);
        this.invalidate();
        return;
      }
      this.lastActorRev = state.actorRev;
      this.monsterFastPath++;
      this.revFastPath++;
      this.syncMonsterActors(state);
      this.syncMovers(state, old);
      this.invalidate();
      return;
    }
    let floorHash = state.tiles.length ^ (state.level * 9973);
    let propHash = 0;
    let monsterHash = 0;
    for (const t of state.tiles) {
      const grass =
        state.level === 0 && this.paths && !this.paths.has(`${t.x},${t.y}`);
      floorHash =
        (Math.imul(floorHash, 16777619) ^
          ((t.x + 1) * 73471 + (t.y + 1) * 19349663 + (grass ? 1 : 0))) |
        0;
      if (t.wall) {
        wallCount++;
        wallLayout =
          (Math.imul(wallLayout, 16777619) ^ ((t.x + 1) * 73471 + (t.y + 1))) |
          0;
      } else if (t.id !== 0) {
        propHash =
          (Math.imul(propHash, 16777619) ^
            ((t.x + 1) * 131 +
              (t.y + 1) * 17 +
              t.id * 997 +
              (t.arg ?? 0) * 13 +
              (t.known === false ? 2 : 0) +
              (t.stair?.blocked ? 1 : 0))) |
          0;
      }
      if (t.monster) {
        const uid = t.monster.uid ?? `${t.x},${t.y}`;
        monsterHash =
          (Math.imul(monsterHash, 16777619) ^
            ((t.x + 1) * 131 +
              (t.y + 1) * 17 +
              (t.monster.id ?? 0) * 997 +
              String(uid).length * 13)) |
          0;
      }
    }
    this.wallLayout = wallLayout ^ wallCount;
    const staticKey = `${floorHash}|${this.wallLayout}|${propHash}|${state.tiles.length}`;
    const structureKey = `${staticKey}|${monsterHash}`;
    this.lastStructureRev = state.structureRev ?? null;
    this.lastActorRev = state.actorRev ?? null;
    // Walking a known floor with only hero/monster motion must not rebuild
    // every floor instance and prop group.
    if (!isNew && this.staticKey === staticKey && this.wallCells.length === wallCount) {
      this.floorHash = floorHash;
      if (this.structureKey === structureKey) {
        this.structureFastPath++;
        this.syncMovers(state, old);
        this.invalidate();
        return;
      }
      this.structureKey = structureKey;
      this.monsterFastPath++;
      this.syncMonsterActors(state);
      this.syncMovers(state, old);
      this.invalidate();
      return;
    }
    this.staticKey = staticKey;
    this.structureKey = structureKey;
    this.wallCells = [];
    this.lamps.length = 0; this.lampRev = (this.lampRev || 0) + 1;
    const rebuildFloors = isNew || this.floorHash !== floorHash;
    this.floorHash = floorHash;
    let rubbleIndex = 0;
    let emberIndex = 0;
    const matrix = this.scratchMatrix;
    const takeLamp = (x, y, z) => {
      const lamp =
        this.lampPool[lampIndex] ||
        (this.lampPool[lampIndex] = new THREE.Vector3());
      lampIndex++;
      lamp.set(x, y, z);
      this.lamps.push(lamp);
    };
    for (const t of state.tiles) {
      const key = `${t.x},${t.y}`;
      ids.add(key);
      const sig = `${t.id}:${t.arg ?? 0}:${t.known === false ? "u" : "k"}${t.stair?.blocked ? ":blocked" : ""}${t.doorFacing != null ? `:df${t.doorFacing}` : ""}`;
      const prev = this.objects.get(key);
      const grass = state.level === 0 && !this.paths.has(key);
      if (rebuildFloors) {
        const color = this.floorVariation(state.level, grass, t.x, t.y);
        this.spinQ.setFromAxisAngle(
          UP,
          Math.floor(noise(t.x + 4, t.y + 9) * 4) * (Math.PI / 2),
        );
        this.scratchPosition.set(t.x, FLOOR_CENTER_Y, t.y);
        this.scratchScale.set(1, 1, 1);
        matrix.compose(this.scratchPosition, this.spinQ, this.scratchScale);
        const floor = grass ? this.grassFloor : this.floor,
          index = grass ? grassIndex++ : floorIndex++;
        floor.setMatrixAt(index, matrix);
        floor.setColorAt(index, color);
        const roll = noise(t.x + 40, t.y + 11);
        if (!t.wall && t.id === 0 && state.level > 0 && state.level <= 15 && roll > 0.965 && rubbleIndex < 48) {
          this.scratchEuler.set(0, roll * 6, 0);
          this.spinQ.setFromEuler(this.scratchEuler);
          const size = 0.65 + noise(t.x + 2, t.y + 6) * 0.7;
          this.scratchPosition.set(t.x + (noise(t.x, t.y + 3) - 0.5) * 0.4, 0.06, t.y + (noise(t.x + 5, t.y) - 0.5) * 0.4);
          this.scratchScale.set(size, size * 0.6, size);
          matrix.compose(this.scratchPosition, this.spinQ, this.scratchScale);
          this.rubble.setMatrixAt(rubbleIndex++, matrix);
        }
        if (!t.wall && t.id === 0 && state.level > 15 && roll > 0.94 && emberIndex < 24) {
          this.scratchEuler.set(0, roll * 4, 0);
          this.spinQ.setFromEuler(this.scratchEuler);
          this.scratchPosition.set(t.x + (noise(t.x + 1, t.y) - 0.5) * 0.5, 0.07, t.y + (noise(t.x, t.y + 2) - 0.5) * 0.5);
          this.scratchScale.set(1, 0.8 + noise(t.x + 7, t.y) * 0.6, 1);
          matrix.compose(this.scratchPosition, this.spinQ, this.scratchScale);
          this.embers.setMatrixAt(emberIndex++, matrix);
        }
      }
      if (t.wall) this.wallCells.push(t);
      if (t.store && t.id !== 55) takeLamp(t.x - 0.2, 1.25, t.y + 0.75);
      if (t.id === 55) takeLamp(t.x, 0.5, t.y);
      if (t.wall && noise(t.x, t.y) > 0.87) takeLamp(t.x, 1.45, t.y);
      // Empty floors and walls are already InstancedMeshes. A Group per
      // HAVESEEN tile made large dungeon rooms walk like molasses.
      if (t.wall || t.id === 0) {
        if (prev) {
          this.staticTiles.remove(key,t);
          this.props.remove(prev.mesh);
          destroy(prev.mesh);
          this.objects.delete(key);
        }
        continue;
      }
      if (prev?.sig === sig) continue;
      if (prev) {
        this.staticTiles.remove(key, t);
        this.props.remove(prev.mesh);
        destroy(prev.mesh);
      }
      const g = new THREE.Group();
      g.position.set(t.x, 0, t.y);
      g.userData.tile = { x: t.x, y: t.y };
      const art = itemSprite(t, () => this.invalidate());
      const model =
        art ||
        itemModel({
          ...t,
          draining:
            t.id === 17 && prev?.sig?.startsWith("7:") && !this.reduced,
        });
      if ((t.id === 19 || t.id === 20) && t.doorFacing != null) {
        model.rotation.y = t.doorFacing;
      }
      g.add(model);
      if (art) {
        g.userData.itemArt = art;
        g.userData.itemId = t.id;
        g.userData.itemArg = t.arg ?? 0;
        faceItem(art, this.camera);
      }
      if (t.store) {
        // Batching replaces the model group with merged meshes. Keep its
        // stair meaning on the tile group so the surface shaft stays legible.
        if (model.userData.stairDirection) {
          g.userData.stairDirection = model.userData.stairDirection;
          g.userData.stairBlocked = model.userData.stairBlocked;
        }
        g.position.set(0, 0, 0);
        batch(g);
        g.position.set(t.x, 0, t.y);
      }
      if (t.store || t.id === 93) {
        g.userData.landmarkLabel =
          t.id === 56 ? "SURFACE SHAFT" : LANDMARK_NAMES[t.id] || "LANDMARK";
        const text = label(g.userData.landmarkLabel);
        text.position.y =
          t.id === 56 || t.id === 93
            ? 1.2
            : [10, 16].includes(t.id)
              ? 3.5
              : 2.7;
        g.add(text);
      }
      const dynamic = !!art || t.store || [7, 17, 5, 13, 56, 93].includes(t.id);
      if (art && !isNew && !this.reduced && knownBefore.has(t.y * state.width + t.x) && prev?.sig?.split(":")[0] !== String(t.id)) {
        const nearKill = this.impact.corpses.some(({ pivot }) => Math.max(Math.abs(pivot.position.x - t.x), Math.abs(pivot.position.z - t.y)) <= 1);
        this.impact.pop(g, this.actionNow(), nearKill && !this.reduced ? 160 : 0);
      }
      if (dynamic) {
        this.props.add(g);
        if (t.store && ![54, 55, 56].includes(t.id)) {
          g.userData.building = true;
          g.userData.buildingParts = [];
          g.userData.buildingOccluders = [];
          g.traverse((object) => {
            if (!object.isMesh) return;
            g.userData.buildingParts.push(object);
            if (object.userData.buildingPart === "base") return;
            g.userData.buildingOccluders.push(object);
            object.material = object.material.clone();
            object.material.transparent = false;
            object.material.depthWrite = true;
            object.material.userData.cutaway = true;
          });
        }
      } else this.staticTiles.set(key, g);
      this.objects.set(key, { sig, mesh: g });
    }
    this.syncMonsterActors(state);
    this.staticTiles.flush();
    if (rebuildFloors) {
      for (const [m, count] of [
        [this.floor, floorIndex],
        [this.grassFloor, grassIndex],
      ]) {
        m.count = count;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.computeBoundingSphere();
      }
      this.rubble.count = rubbleIndex;
      this.embers.count = emberIndex;
      this.rubble.visible = rubbleIndex > 0;
      this.embers.visible = emberIndex > 0;
      this.rubble.instanceMatrix.needsUpdate = true;
      this.embers.instanceMatrix.needsUpdate = true;
      if (rubbleIndex) this.rubble.computeBoundingSphere();
      if (emberIndex) this.embers.computeBoundingSphere();
    }
    for (const [key, o] of this.objects)
      if (!ids.has(key)) {
        this.staticTiles.remove(key,o.mesh.userData.tile);
        this.props.remove(o.mesh);
        destroy(o.mesh);
        this.objects.delete(key);
      }
    this.billboards.length = 0;
    this.draining.length = 0;
    this.cutawayBuildings = [];
    for (const { mesh } of this.objects.values()) {
      if (mesh.userData.building) this.cutawayBuildings.push(mesh);
      if (mesh.userData.itemArt) this.billboards.push(mesh.userData.itemArt);
      let fountain = mesh.userData.fountainMesh;
      if (!fountain) {
        fountain = mesh.children.find(
          (child) => child.userData.drainAge !== undefined,
        );
        if (fountain) mesh.userData.fountainMesh = fountain;
      }
      if (fountain?.userData.drainStartedAt) this.draining.push(fountain);
    }
    this.walls.count = this.caps.count = this.wallCells.length;
    // Seed rats from the new wall set before the first cutaway pass.
    this.ambientRats.setLayout(this.wallCells, state.level, this.wallHeightAt);
    this.syncMovers(state, old);
    if (isNew && this.cinematicRendering()) this.markShadowUpdate();
    this.invalidate();
  }
  syncMonsterActors(state) {
    const creatures = new Set();
    for (const tile of state.tiles) {
      const monster = tile.monster;
      if (!monster) continue;
      const uid = monster.uid ?? `${tile.x},${tile.y}`;
      creatures.add(uid);
      let actor = this.monsters.get(uid);
      if (actor && actor.species !== monster.id) {
        actor.mesh.removeFromParent();
        destroy(actor.mesh);
        this.monsters.delete(uid);
        actor = null;
      }
      if (!actor) {
        const mesh =
          creature(monster) ||
          createCreatureModel(monster) ||
          monsterSprite(monster, () => this.invalidate()) ||
          monsterModel(monster);
        if (mesh.userData.model) { mesh.userData.presentation="model"; mesh.userData.modelKey=mesh.userData.model; }
        mesh.position.set(tile.x, 0, tile.y);
        mesh.traverse((object) => {
          if (!object.isMesh) return;
          object.userData.presentationShadows = { cast: object.castShadow, receive: object.receiveShadow };
          if (!this.cinematicRendering()) object.castShadow = object.receiveShadow = false;
        });
        actor = {
          mesh,
          species: monster.id,
          target: new THREE.Vector3(tile.x, 0, tile.y),
          start: new THREE.Vector3(tile.x, 0, tile.y), movedAt: 0,
          glide: new StepGlide(), dir: new THREE.Vector2(), length: 0, chained: false,
        };
        this.monsters.set(uid, actor);
        this.actors.add(mesh);
      }
      if (actor.target.x !== tile.x || actor.target.z !== tile.y) this.moveActor(actor, tile);
      actor.mesh.userData.uid = uid;
      actor.mesh.userData.tile = { x: tile.x, y: tile.y };
      if (actor.mesh.userData.model) faceCreature(actor.mesh, monster.facing);
      else faceMonster(actor.mesh, monster.facing, this.camera);
    }
    for (const [uid, actor] of this.monsters)
      if (!creatures.has(uid)) {
        // Only a blow the engine reported as fatal leaves a falling corpse;
        // anything that just left sight (teleport, invisibility) vanishes.
        const mark = this.killMarks.get(uid);
        actor.mesh.removeFromParent();
        if (mark) {
          this.killMarks.delete(uid);
          const from = mark.from || { x: this.player.position.x, z: this.player.position.z };
          this.impact.corpse(actor.mesh, mark.at, { x: actor.target.x - from.x, z: actor.target.z - from.z },
            { reduced: this.reduced, flash: mark.flash, onDone: destroy });
        } else destroy(actor.mesh);
        this.monsters.delete(uid);
      }
    if (this.killMarks.size > 16) this.killMarks.clear();
  }
  /**
   * Creatures cross a tile on the hero's step curve. One that moved last turn
   * too (a chaser during a held run) keeps its speed; a jump of more than two
   * tiles lands at once.
   */
  moveActor(actor, tile) {
    const now = this.motionClock(), glide = actor.glide;
    const jump = Math.max(Math.abs(actor.target.x - tile.x), Math.abs(actor.target.z - tile.y));
    actor.nominal = Math.max(1, Math.hypot(actor.target.x - tile.x, actor.target.z - tile.y));
    const speed = glide.carry(now) * actor.length;
    actor.start.copy(actor.mesh.position);
    actor.target.set(tile.x, 0, tile.y);
    actor.chained = !!actor.movedAt && now - actor.movedAt < 400;
    actor.movedAt = now;
    const dx = actor.target.x - actor.start.x, dz = actor.target.z - actor.start.z;
    actor.length = Math.hypot(dx, dz);
    if (jump > 2 || this.reduced || actor.length < 1e-6) {
      actor.start.copy(actor.target);
      actor.mesh.position.copy(actor.target);
      glide.plan(now, 0, 1);
      return;
    }
    const along = Math.max(0, speed * (actor.dir.x * dx + actor.dir.y * dz) / actor.length);
    actor.dir.set(dx / actor.length, dz / actor.length);
    const cruise = actor.chained && this.runActive;
    const ms = cruise ? this.stepInterval : STEP_MS;
    glide.plan(now, ms, 0, along / actor.length, cruise ? actor.nominal / ms / actor.length : 0);
  }
  syncMovers(state, old) {
    this.player.visible = true;
    if (!this.playerTarget) this.playerTarget = new THREE.Vector3();
    const target = this.playerTarget.set(state.x, 0, state.y);
    if (!this.lastPlayer) {
      this.footstepPending=null;
      this.player.position.copy(target);
      this.stepHome = { x: state.x, z: state.y };
      this.stepDest = null;
      this.applyHeldCamera(target);
      this.yawEase = false;
    } else if (this.lastPlayer.x !== state.x || this.lastPlayer.y !== state.y) {
      const facing =
        Math.atan2(state.x - this.lastPlayer.x, state.y - this.lastPlayer.y) +
        Math.PI;
      if (this.reduced) {
        this.player.rotation.y = facing;
        this.yawEase = false;
      } else {
        this.yawFrom = this.player.rotation.y;
        const dy = Math.atan2(Math.sin(facing - this.yawFrom), Math.cos(facing - this.yawFrom));
        this.yawTo = this.yawFrom + dy;
        this.yawEase = true;
      }
      const nearby = old && old.level === state.level && Math.max(Math.abs(state.x-old.x),Math.abs(state.y-old.y))===1;
      this.startFollow(target,nearby ? {x:state.x,y:state.y,level:state.level} : null);
    }
    // Embers mark a wound; spending a spell is not one.
    if (
      old &&
      old.level === state.level &&
      state.hp < old.hp
    ) {
      this.burstAge = 0;
      this.burstStartedAt = performance.now();
      this.burst.visible = !this.reduced;
      this.burst.position.copy(target);
      this.burst.children.forEach((p) => p.position.set(0, 0.5, 0));
    }
    this.lastPlayer = { x: state.x, y: state.y };
    this.syncHeroWeapon(state);
    this.syncPlayerLight();
    if (this.aimGrid) {
      const show = !!state.aimAssist && state.maze && !state.over;
      this.aimGrid.visible = show;
      if (show) this.aimGrid.position.set(state.x, 0, state.y);
    }
    // Balanced keeps the sun over the map center so the shadow map does not
    // chase the hero every step. Cinematic still follows the player.
    // Skip frustum rewrites entirely when shadows are off (Balanced / dungeon).
    if (this.renderer.shadowMap.enabled && this.sun.castShadow) {
      if (this.cinematicRendering()) {
        this.sun.position.set(state.x - 12, 24, state.y + 8);
        this.sun.target.position.copy(target);
      } else {
        const cx = (state.width - 1) / 2;
        const cz = (state.height - 1) / 2;
        this.sun.position.set(cx - 12, 24, cz + 8);
        this.sun.target.position.set(cx, 0, cz);
        const extent = Math.max(state.width, state.height) * 0.55 + 8;
        Object.assign(this.sun.shadow.camera, {
          left: -extent,
          right: extent,
          top: extent,
          bottom: -extent,
        });
        this.sun.shadow.camera.updateProjectionMatrix();
      }
    }
    if (this.dust.visible) this.dust.position.set(state.x, 0, state.y);
    if (this.torchBudget > 0 && this.lamps.length) {
      this.lamps.sort(
        (a, b) => a.distanceToSquared(target) - b.distanceToSquared(target),
      );
    }
    this.syncCooperationAura(state);
    this.updateWalls();
    this.ensureSolid();
  }
  syncCooperationAura(state) {
    if (!this.cooperationAura) return;
    const show = cooperationAuraShown(state?.level) && auraControl(state).overlay;
    this.cooperationAura.visible = show;
    const allies = typeof window.ularn?.party === "function" ? window.ularn.party() : [];
    const others = show
      ? allies.filter((member) => member.alive && member.dungeon === state.level && (member.x !== state.x || member.y !== state.y))
      : [];
    if (!this.allyAuras) this.allyAuras = [];
    while (this.allyAuras.length < others.length) {
      const aura = createCooperationAura();
      aura.name = "cooperation-aura-ally";
      this.scene.add(aura);
      this.allyAuras.push(aura);
    }
    this.allyAuras.forEach((aura, index) => {
      const member = others[index];
      aura.visible = !!member;
      if (member) placeCooperationAura(aura, member.x, member.y);
    });
    if (!show) return;
    placeCooperationAura(this.cooperationAura, state.x, state.y);
  }
  updateWalls(dt = 0) {
    if (!this.state) return;
    const toward = this.scratchOffset
      .copy(this.camera.position)
      .sub(this.controls.target)
      .setY(0);
    if (toward.lengthSq() < 1e-8) return;
    toward.normalize();
    const town = this.state.level === 0;
    // Town heights never change. Skip player/orbit from the cache key so a
    // plaza walk does not rebuild every wall matrix.
    const viewKey = town
      ? `t:${this.wallLayout}`
      : [
          this.state.x,
          this.state.y,
          Math.round(toward.x * 50),
          Math.round(toward.z * 50),
          this.wallLayout,
        ].join(":");
    if (this.wallView === viewKey) return;
    this.wallView = viewKey;
    const layoutChanged = this.wallLayoutKey !== this.wallLayout;
    this.wallLayoutKey = this.wallLayout;
    if (layoutChanged) this.wallHeightAt.length = 0;
    let changed = 0;
    for (let i = 0; i < this.wallCells.length; i++) {
      const t = this.wallCells[i],
        dx = t.x - this.state.x,
        dz = t.y - this.state.y;
      const h = wallHeight(dx, dz, toward.x, toward.z, town);
      if (!layoutChanged && this.wallHeightAt[i] === h) continue;
      this.wallHeightAt[i] = h;
      changed++;
      this.scratchPosition.set(t.x, h / 2 + WALL_BASE_Y, t.y);
      this.scratchScale.set(WALL_TILE_SIZE, h, WALL_TILE_SIZE);
      this.spinQ.setFromAxisAngle(
        UP,
        Math.floor(noise(t.x + 4, t.y + 9) * 4) * (Math.PI / 2),
      );
      this.scratchMatrix.compose(
        this.scratchPosition,
        this.spinQ,
        this.scratchScale,
      );
      this.walls.setMatrixAt(i, this.scratchMatrix);
      if (layoutChanged) {
        const drift = 0.93 + noise(t.x + 17, t.y + 6) * 0.1;
        const moss = noise(t.x + 2, t.y + 21) > 0.84;
        const scorch = this.state.level > 15 ? 0.82 : 1;
        this.scratchColor.setRGB(
          drift * (moss ? 0.9 : 1) * scorch,
          drift * (moss ? 1.04 : 1) * scorch,
          drift * (moss ? 0.88 : 1) * scorch,
        );
        this.walls.setColorAt(i, this.scratchColor);
        this.caps.setColorAt(i, this.scratchColor);
      }
      const lip = wallLip(h, town);
      this.scratchPosition.y = lip.y;
      this.scratchScale.set(lip.overhang, lip.thickness, lip.overhang);
      this.scratchMatrix.compose(
        this.scratchPosition,
        this.spinQ,
        this.scratchScale,
      );
      this.caps.setMatrixAt(i, this.scratchMatrix);
    }
    if (layoutChanged || !this.ambientRats.enabled) {
      this.ambientRats.setLayout(this.wallCells, this.state.level, this.wallHeightAt);
    }
    if (!changed) return;
    for (const mesh of [this.walls, this.caps]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (layoutChanged && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (layoutChanged) mesh.computeBoundingSphere();
    }
    if (layoutChanged) this.markShadowUpdate();
  }

  pick(e) {
    if (!this.state || !this.state.maze || this.state.over || this.lost)
      return null;
    this.mouse.set(
      (e.clientX / innerWidth) * 2 - 1,
      (-e.clientY / innerHeight) * 2 + 1,
    );
    this.ray.setFromCamera(this.mouse, this.camera);
    this.pickHits.length = 0;
    this.ray.intersectObjects(this.actors.children, true, this.pickHits);
    this.ray.intersectObjects(this.props.children, true, this.pickHits);
    this.ray.intersectObjects(this.staticTiles.pickTargets(this.ray.ray), true, this.pickHits);
    this.ray.intersectObject(this.walls, false, this.pickHits);
    this.ray.intersectObject(this.caps, false, this.pickHits);
    for (const hit of this.pickHits) {
      if (hit.object.isSprite) continue;
      if (hit.object.userData.wallCells) return hit.object.userData.wallCells[hit.instanceId] || null;
      let o = hit.object;
      while (o && !o.userData.tile) o = o.parent;
      if (o?.userData.tile) {
        const { x, y } = o.userData.tile;
        return this.tileIndex.get(y * this.state.width + x) || null;
      }
    }
    if (!this.ray.ray.intersectPlane(this.ground, this.scratchPosition)) return null;
    const x = Math.round(this.scratchPosition.x),
      y = Math.round(this.scratchPosition.z);
    return this.state.tiles.find((t) => t.x === x && t.y === y) || null;
  }
  /** Where the camera is headed: the end of a running orbit ease, or where it is. */
  cameraGoal() {
    if (this.cameraTween) return new THREE.Vector3().setFromSpherical(this.cameraTween.to);
    return this.camera.position.clone().sub(this.controls.target);
  }
  /** Orbit to a new offset over a short ease instead of jumping. */
  tweenCamera(offset, ms = 140) {
    if (this.reduced) {
      this.cameraTween = null;
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
      this.captureCamera();
      this.updateWalls();
      this.invalidate();
      return;
    }
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const to = new THREE.Spherical().setFromVector3(offset);
    const turn = to.theta - from.theta;
    this.cameraTween = { start: performance.now(), ms, from, to, turn: Math.atan2(Math.sin(turn), Math.cos(turn)), at: new THREE.Spherical() };
    this.invalidate();
  }
  stepCameraTween(now) {
    const tween = this.cameraTween;
    if (!tween) return;
    const u = Math.max(0, Math.min(1, (now - tween.start) / tween.ms)), eased = stepCurve(u);
    tween.at.set(
      tween.from.radius + (tween.to.radius - tween.from.radius) * eased,
      tween.from.phi + (tween.to.phi - tween.from.phi) * eased,
      tween.from.theta + tween.turn * eased,
    );
    this.camera.position.copy(this.controls.target).add(this.scratchOffset.setFromSpherical(tween.at));
    if (u < 1) return;
    this.cameraTween = null;
    this.captureCamera();
    this.updateWalls();
  }
  rotate(direction) {
    this.tweenCamera(this.cameraGoal().applyAxisAngle(UP, (direction * Math.PI) / 4));
  }
  zoom(factor) {
    this.tweenCamera(this.cameraGoal().multiplyScalar(factor).clampLength(5, 46));
  }
  reset() {
    if (this.state) {
      this.footstepPending=null;
      const prefs = readCameraPrefs(this.state.level);
      this.heldCameraOffset = northCameraOffset(
        prefs?.radius ?? GAME_CAMERA_DIST,
        prefs?.elevation ?? GAME_CAMERA_Y,
      );
      const offset = this.camera.position.clone().sub(this.controls.target);
      this.controls.target.set(this.state.x, 0, this.state.y);
      this.camera.position.copy(this.controls.target).add(offset);
      if (this.playerTarget) this.player.position.copy(this.playerTarget);
      this.followHeld = true;
      this.finishStepTiles();
      this.yawEase = false;
      this.controls.update();
      writeCameraPrefs(this.heldCameraOffset);
      this.tweenCamera(this.heldCameraOffset.clone());
    }
  }
  emitFootstep() {
    const step=this.footstepPending;this.footstepPending=null;
    if (!step || this.paused || this.lost || document.hidden || !this.state?.maze || this.state.over) return;
    this.footfalls=(this.footfalls||0)+1;
    window.dispatchEvent(new CustomEvent("ularn:footstep",{detail:{...step,right:!!this.stepLeadRight}}));
  }
  /**
   * A crossing starts where the hero was last drawn, at the time it was drawn.
   * The next frame's vsync time can precede a step that lands in the same
   * frame, which would otherwise draw the start position twice.
   */
  motionClock() {
    const now = performance.now();
    return this.frameNow && now - this.frameNow < 40 ? this.frameNow : now;
  }
  startFollow(target,footstep=null) {
    const now = this.motionClock();
    const live = this.followLive();
    // Speed carried in from the crossing in progress, or from one that just handed over
    // (possibly before a frame has drawn its final position).
    const speed = this.glide.carry(now) * this.stepLength;
    const fromX = this.stepDir.x, fromZ = this.stepDir.y;
    if (this.stepCruised && this.lastStepAt && now - this.lastStepAt < 400)
      this.stepInterval += (Math.min(STEP_MS * 1.3, Math.max(STEP_MS, now - this.lastStepAt)) - this.stepInterval) * 0.3;
    if (this.runNextAt) {
      const late = performance.now() - this.runNextAt;
      if (late >= 0 && late < 60) this.stepLate += (late - this.stepLate) * 0.25;
    }
    this.runNextAt = 0;
    this.lastStepAt = now;
    this.stepStartedAt = performance.now();
    if (!live && speed === 0) this.heroSpeeds.length = 0;
    this.stepPoseFrom=live ? this.lastStepPose : null;
    this.footstepPending=document.hidden || this.lost ? null : footstep;
    this.followFrom.copy(this.player.position);
    this.followCam.copy(this.controls.target);
    this.followStart = now;
    const moving =
      this.followFrom.distanceToSquared(target) > 1e-8 ||
      this.followCam.distanceToSquared(target) > 1e-8;
    const dx = target.x - this.followFrom.x, dz = target.z - this.followFrom.z;
    const distance = Math.hypot(dx, dz);
    // Several tiles in one turn (a run or a short hop) glides; a teleport lands at once.
    const far = distance > 1.5;
    let snap = this.reduced || !moving || distance > 12;
    if (moving && footstep) this.stepLeadRight = !this.stepLeadRight;
    this.stepHome = { x: Math.round(this.followFrom.x), z: Math.round(this.followFrom.z) };
    this.stepDest = { x: Math.round(target.x), z: Math.round(target.z) };
    this.ensureSolid();
    if (!snap) {
      this.followRoute = stepRoute(
        { x: this.followFrom.x, z: this.followFrom.z },
        { x: target.x, z: target.z },
        (x, z) => this.isSolid(x, z),
      );
      this.stepLength = routeLength(this.followRoute);
      if (far && this.stepLength < 1e-6) snap = true;
    }
    this.followHeld = snap;
    this.hasMotion = !snap;
    if (snap) {
      this.glide.plan(now, 0, 1);
      this.followMs = 0;
      this.stepCruised = this.stepFar = false;
      this.snapFollow();
      this.finishStepTiles();
      this.emitFootstep();
      return;
    }
    if (distance > 1e-6) this.stepDir.set(dx / distance, dz / distance);
    // One tile (or a diagonal) per cadence, whatever is left of the previous crossing.
    this.stepNominal = Math.max(1, Math.hypot(target.x - this.stepHome.x, target.z - this.stepHome.z));
    // Reversals and sharp turns start from rest; a straight run keeps cruising.
    const along = Math.max(0, speed * (fromX * this.stepDir.x + fromZ * this.stepDir.y));
    const rate0 = this.stepLength > 1e-6 ? along / this.stepLength : 0;
    this.stepFar = far;
    this.stepCruised = rate0 > 0;
    if (far) this.glide.plan(now, Math.min(700, Math.max(STEP_MS, distance * 70)), 0, rate0, 0);
    else if (this.runActive) this.glide.plan(now, this.stepInterval, 0, rate0, this.cruiseRate());
    else this.glide.plan(now, STEP_MS, 0, rate0, 0);
    this.followMs = this.glide.end() - now;
  }
  /** Progress per ms that crosses one nominal tile per step interval. */
  cruiseRate() {
    return this.stepLength > 1e-6 ? this.stepNominal / Math.max(STEP_MS, this.stepInterval) / this.stepLength : 0;
  }
  /** Input expects another step after `delay` ms: hand over at cruise instead of planting. */
  expectNextStep(delay) {
    const now = performance.now();
    this.runActive = true;
    this.runNextAt = now + delay;
    // Only the crossing this turn just started (in real time) takes the hint.
    if (!this.followLive() || this.stepFar || now - this.stepStartedAt > 40) return;
    const cruise = this.cruiseRate();
    // Hand over a little after the next turn is expected, so a late timer
    // still finds the hero mid-glide instead of planted for a frame.
    const endAt = Math.max(this.followStart + STEP_MS, this.runNextAt + Math.max(20, this.stepLate + 12));
    this.glide.replan(now, endAt, cruise);
    this.followMs = this.glide.end() - this.followStart;
    for (const actor of this.monsters.values())
      if (actor.chained && now - actor.movedAt <= 40 && !actor.glide.done(now))
        actor.glide.replan(now, endAt, actor.nominal / Math.max(STEP_MS, this.stepInterval) / actor.length);
  }
  /** The hold or route ended: ease the current crossing out from its live speed. */
  endRun() {
    this.runActive = false;
    this.runNextAt = 0;
    const now = performance.now();
    for (const actor of this.monsters.values())
      if (actor.glide.endRate > 0 && !actor.glide.done(now))
        actor.glide.replan(now, Math.max(now + 60, actor.movedAt + STEP_MS), 0);
    if (!this.followLive() || this.glide.endRate <= 0) return;
    this.glide.replan(now, Math.max(now + 60, this.followStart + STEP_MS), 0);
    this.followMs = this.glide.end() - this.followStart;
  }
  snapFollow() {
    if (!this.playerTarget) return;
    this.scratchOffset.copy(this.camera.position).sub(this.controls.target);
    this.controls.target.copy(this.playerTarget);
    this.camera.position.copy(this.playerTarget).add(this.scratchOffset);
    this.player.position.copy(this.playerTarget);
    this.followHeld = true;
  }
  rememberPixel(object) {
    if (!object?.parent) return;
    let slot = this.pixelSlots[this.pixelCount];
    if (!slot) {
      slot = { object: null, home: new THREE.Vector3() };
      this.pixelSlots.push(slot);
    }
    this.pixelCount++;
    slot.object = object;
    slot.home.copy(object.position);
    object.getWorldPosition(this.scratchPosition);
    const hold = object.userData.pixelHold || (object.userData.pixelHold = {});
    if (!pixelAlignWorld(this.scratchPosition, this.camera, this.drawSize.x, this.drawSize.y, this.scratchPosition, hold))
      return;
    object.parent.updateWorldMatrix(true, false);
    object.parent.worldToLocal(this.scratchPosition);
    object.position.copy(this.scratchPosition);
  }
  applyPixelGrid() {
    this.pixelCount = 0;
    this.renderer.getDrawingBufferSize(this.drawSize);
    if (this.drawSize.x < 1 || this.drawSize.y < 1) return;
    this.camera.updateMatrixWorld();
    // Only nearest-filtered pixel-art sprites benefit. The 3D hero and the
    // mipmapped item art would jitter against the smoothly scrolling floor.
    for (const { mesh } of this.monsters.values()) {
      const art = mesh.userData.artwork;
      if (art) this.rememberPixel(art);
    }
  }
  restorePixelGrid() {
    for (let i = 0; i < this.pixelCount; i++) {
      const slot = this.pixelSlots[i];
      slot.object.position.copy(slot.home);
    }
    this.pixelCount = 0;
  }
  animate(frameTime) {
    // Motion samples the vsync time so every frame advances by the same step;
    // render cost is still measured from when this callback actually ran.
    const started = performance.now(),
      now = Number.isFinite(frameTime) ? Math.max(this.lastTime, Math.min(frameTime, started)) : started,
      elapsed = Math.max(0, now - this.lastTime) / 1000;
    // invalidate() rewinds the clock by one frame after an idle gap, so waking
    // never spends the gap at once. Long frames still advance in real time
    // (Cinematic idles at 12 FPS) up to a bounded step.
    const dt = Math.min(elapsed, 0.1);
    this.lastTime = now;
    this.frameNow = now;
    if (document.hidden || this.lost) {
      this.animating = false;
      return;
    }
    this.frameMs =
      (this.frameMs || elapsed * 1000) * 0.94 + elapsed * 1000 * 0.06;
    this.tick += dt;
    this.effects.update(dt);
    if (!this.reduced && this.water.visible) this.waterTime.value = this.tick;
    this.animating = true;
    if (this.playerTarget && this.followLive()) {
      const eased = this.glide.progress(now);
      if (this.glide.done(now)) {
        this.snapFollow();
        if (this.yawEase) this.player.rotation.y = this.yawTo;
        this.yawEase = false;
        this.finishStepTiles();
      } else {
        this.scratchPosition.copy(this.followCam).lerp(this.playerTarget, eased);
        this.scratchOffset.copy(this.scratchPosition).sub(this.controls.target);
        this.controls.target.add(this.scratchOffset);
        this.camera.position.add(this.scratchOffset);
        const along = this.followRoute
          ? pointOnRoute(this.followRoute, eased)
          : {
              x: this.followFrom.x + (this.playerTarget.x - this.followFrom.x) * eased,
              z: this.followFrom.z + (this.playerTarget.z - this.followFrom.z) * eased,
            };
        const clear = pushOutOfWalls(along.x, along.z, (x, z) => this.isSolid(x, z));
        this.player.position.set(clear.x, 0, clear.z);
        this.faceStep(eased);
      }
      if (eased>=STEP_CONTACT) this.emitFootstep();
    }
    if (this.playerTarget && this.followLive() && dt > 0) {
      if (this.heroSampling) {
        const speeds = this.heroSpeeds;
        speeds.push(this.player.position.distanceTo(this.heroLast) / dt);
        if (speeds.length > 240) speeds.shift();
      }
      this.heroSampling = true;
      this.heroLast.copy(this.player.position);
    } else this.heroSampling = false;
    const act = this.actionClock.now(now);
    if (this.playerTarget) {
      this.playerLight.position
        .copy(this.player.position)
        .add(this.scratchOffset.set(0, this.state?.level ? CAVE_HERO_LIGHT.height : 1.4, 0.2));
      this.heroLimbLive = this.poseHero(now, act);
      this.heroAnimation.update(act);
      this.heroLimbLive ||= this.heroAnimation.active;
      if (this.collapsedAt == null) this.keepBodyOutOfRock();
    }
    const impactLive = this.impact.update(act);
    const holding = this.actionClock.holding(now);
    if (!this.reduced) {
      this.dust.rotation.y = Math.sin(this.tick * 0.055) * 0.08;
    }
    if (this.burst.visible) {
      this.burstAge = (now - this.burstStartedAt) / 1000;
      for (const p of this.burst.children) {
        p.position.addScaledVector(p.userData.velocity, dt);
        p.position.y -= this.burstAge * dt * 2;
        p.scale.setScalar(Math.max(0, 1 - this.burstAge / 0.55) * 0.035);
      }
      if (this.burstAge > 0.55) this.burst.visible = false;
    }
    // Cinematic: the hero's shadow moves with the hero, every frame of a step.
    if (
      this.cinematicRendering() &&
      this.playerTarget &&
      this.player.position.distanceToSquared(this.playerTarget) > 0.0001
    ) this.markShadowUpdate();
    this.stepCameraTween(now);
    this.stepViewOffset(dt);
    const shaking = this.stepShake(now) | this.stepLens(now);
    this.renderer.info.reset();
    this.scratchCam.copy(this.camera.position);
    // Orbit damping is per frame in three.js; scale it so 120 Hz glides like 60 Hz.
    this.controls.dampingFactor = 1 - Math.pow(1 - 0.075, Math.max(dt, 1 / 240) * 60);
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.hasMotion = this.followLive() || !!this.heroLimbLive;
    if (this.playerTarget && this.player.position.distanceToSquared(this.playerTarget) > 0.0001)
      this.hasMotion = true;
    if (this.camera.position.distanceToSquared(this.scratchCam) > 1e-8) this.hasMotion = true;
    if (this.cameraTween || this.viewEasing) this.hasMotion = true;
    if (impactLive || shaking || holding) this.hasMotion = true;
    const camTurned = !this.lastCamQuatValid || !this.lastCamQuat.equals(this.camera.quaternion);
    if (camTurned) {
      this.lastCamQuat.copy(this.camera.quaternion);
      this.lastCamQuatValid = true;
    }
    for (const actor of this.monsters.values()) {
      const { mesh, target, start, glide } = actor;
      const progress = this.reduced ? 1 : glide.progress(now);
      const moving = progress < 1;
      if (!moving) mesh.position.copy(target);
      else mesh.position.lerpVectors(start, target, progress);
      // Flinch away from a landed blow, or lunge at the hero, then spring back.
      const kick = actor.kick;
      if (kick) {
        const t = act - kick.at, lunge = kick.kind === "lunge", span = lunge ? 240 : 260;
        if (t >= span) actor.kick = null;
        else if (t > 0) {
          const out = lunge ? 90 : 60, reach = lunge ? .2 : .14;
          const k = t < out ? Math.sin(Math.PI * t / out / 2) : Math.cos(Math.PI * (t - out) / (span - out) / 2) ** 2;
          mesh.position.x += kick.x * reach * k;
          mesh.position.z += kick.z * reach * k;
        }
        this.hasMotion = true;
      }
      const body = mesh.userData.body;
      if (body) {
        const base = mesh.userData.hover || 0;
        body.position.y = !this.reduced && moving
          ? base + Math.abs(Math.sin(this.tick * 16 + mesh.id)) * 0.04
          : base;
      }
      if (moving) this.hasMotion = true;
      if (mesh.userData.model) {
        if (animateCreature(mesh, now, moving, this.reduced)) this.hasMotion = true;
      }
      else if (camTurned || mesh.userData.presentation === "model") faceMonster(mesh, null, this.camera);
    }
    if (camTurned) {
      for (const art of this.billboards) faceItem(art, this.camera);
    }
    for (const fountain of this.draining) {
      fountain.userData.drainAge = (now - fountain.userData.drainStartedAt) / 1000;
      const water = fountain.getObjectByName("fountain-water");
      if (water) {
        water.scale.y = Math.max(0, 1 - fountain.userData.drainAge / 0.7);
        water.visible = fountain.userData.drainAge < 0.7;
        if (water.visible) this.hasMotion = true;
      }
    }
    if (this.wallCells.length) this.updateWalls(dt);
    if (this.cinematicRendering() && this.state) this.syncPlayerLight();
    if (this.cinematicRendering() && this.state?.level===0) {
      const lightsMoving = this.lighting.update(dt,this.tick,this.reduced);
      this.hasMotion ||= lightsMoving;
      if(this.playerTarget)stabilizeShadow(this.sun,this.playerTarget);
    }
    if (this.cinematicRendering() && this.state?.level) caveGlowCenter.copy(this.player.position);
    // Cheap transform updates only; does not allocate. Near-camera scurries
    // briefly keep the frame loop alive, then Balanced can idle again.
    this.ambientRatsNear = this.ambientRats?.update(dt, this.camera) || false;
    if (this.ambientRatsNear) this.hasMotion = true;
    if (this.hoverDirty && this.hoverPointer && !this.gesture) {
      const tile=this.pick(this.hoverPointer); this.marker.visible=!!tile;
      if(tile)this.marker.position.set(tile.x,0,tile.y);
      this.onHover(tile,this.hoverPointer); this.hoverDirty=false;
    }
    if (this.state?.level === 0) this.updateCutaways(Math.min(elapsed, .1));
    if (this.qualityPending) this.applyQualityWhenSettled();
    // DOM overlays (damage numbers, nameplates) follow the camera of this frame.
    for (const hook of this.frameHooks) hook(this);
    this.applyPixelGrid();
    try {
      if (this.composer && this.cinematicRendering()) {
        if (this.vignette) this.aimVignette();
        if (this.ao?.enabled) {
          // Framing slides (view offset) change the projection between resizes.
          this.ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix);
          this.ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
        }
        this.composer.render(dt);
      }
      else this.renderer.render(this.scene, this.camera);
    } finally {
      this.restorePixelGrid();
    }
    sample(this.renderSamples, performance.now() - started);
    if (!this.paused && this.state && this.hasMotion) {
      // Animation integration clamps long frames, but Auto must still see
      // actual GPU/main-thread stalls and reduce resolution when overloaded.
      const activeFrameMs=Math.min(100,elapsed*1000);
      sample(this.frameSamples, activeFrameMs);
      if (this.lastInputAt != null) { sample(this.inputSamples, performance.now() - this.lastInputAt); this.lastInputAt=null; }
      this.adaptQuality(now, activeFrameMs);
    }
    this.renderedFrames++;
    this.animating = false;
    this.scheduleFrame();
  }
  buildingObscuresHero(mesh) {
    const dx = mesh.position.x - this.player.position.x, dz = mesh.position.z - this.player.position.z;
    const wasHidden = mesh.userData.obscuresHero;
    if (dx * dx + dz * dz >= (wasHidden ? 18 : 16)) return false;
    mesh.updateWorldMatrix(true, true);
    const right = this.camera.matrixWorld.elements;
    // Trace the torso and head against the actual structure, excluding signs
    // and the foundation. Hidden meshes still participate so they can restore.
    // A small side margin keeps a fading building stable at its silhouette.
    for (let sample = 0; sample < (wasHidden ? 6 : 2); sample++) {
      const margin = sample < 2 ? 0 : sample < 4 ? -.04 : .04;
      this.cutawayTarget.copy(this.player.position);
      this.cutawayTarget.y += sample % 2 ? .95 : .55;
      this.cutawayTarget.x += right[0] * margin;
      this.cutawayTarget.z += right[2] * margin;
      this.cutawayDirection.copy(this.cutawayTarget).sub(this.camera.position);
      const distance = this.cutawayDirection.length();
      if (distance < .03) continue;
      this.cutawayRay.set(this.camera.position, this.cutawayDirection.divideScalar(distance));
      this.cutawayRay.far = distance - .03;
      this.cutawayHits.length = 0;
      this.cutawayRay.intersectObjects(mesh.userData.buildingOccluders, false, this.cutawayHits);
      if (this.cutawayHits.length) return true;
    }
    return false;
  }
  updateCutaways(dt) {
    if (!this.state) return;
    let shadowChanged = false;
    for (const mesh of this.cutawayBuildings || []) {
      const obscures = this.buildingObscuresHero(mesh);
      mesh.userData.obscuresHero = obscures;
      let minimumOpacity = 1;
      for (const object of mesh.userData.buildingParts || []) {
        const material = object.material;
        if (!material.userData.cutaway) continue;
        const target = obscures ? 0 : 1;
        let opacity = material.opacity;
        opacity += (target - opacity) * (this.reduced ? 1 : 1 - Math.exp(-dt * 22));
        if (Math.abs(target - opacity) < .005) opacity = target;
        else this.hasMotion = true;
        const fading = opacity > 0 && opacity < 1;
        if (material.transparent !== fading) {
          material.transparent = fading;
          material.needsUpdate = true;
        }
        material.opacity = opacity;
        material.depthWrite = !fading;
        object.visible = opacity > 0;
        const castsShadow = opacity === 1;
        if (object.castShadow !== castsShadow) {
          object.castShadow = castsShadow;
          shadowChanged = true;
        }
        minimumOpacity = Math.min(minimumOpacity, opacity);
      }
      mesh.userData.opacity = minimumOpacity;
    }
    if (shadowChanged && this.cinematicRendering()) this.markShadowUpdate();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.longTaskObserver?.disconnect();
    this.stopFrames();
    this.events.abort();
    this.controls.dispose();
    this.effects.dispose();
    this.heroAnimation.dispose(); this.staticTiles.clear(); this.grid.clear();
    this.ambientRats?.dispose();
    this.ambientRats = null;
    if (this.aimGrid) {
      this.aimGrid.geometry.dispose();
      this.aimGrid.material.dispose();
      this.aimGrid.removeFromParent();
      this.aimGrid = null;
    }
    this.cooperationAura?.traverse((object) => {
      if (!object.isMesh) return;
      object.material?.dispose();
    });
    this.cooperationAura = null;
    this.releaseLostResources(true);
    destroy(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
