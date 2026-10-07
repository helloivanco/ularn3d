import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mat, matBasic, surface, surfaceLambert, surfaceBasic, noise, shiftedTexture, stoneTint, releaseMaterialResources } from "./materials.js";
import { pixelAlignWorld } from "./pixel-align.js";
import { monsterSprite, faceMonster, monsterArtMetrics, releaseMonsterArtResources } from "./monster-art.js";
import { createCreatureModel } from "./creature-models.js";
import { itemSprite, faceItem, itemArtMetrics, releaseItemArtResources } from "./item-art.js";
import { CombatEffects } from "./combat-effects.js";
import { StaticTiles } from "./static-world.js";
import { TerrainGrid, ChunkedTerrainMesh } from "./terrain-grid.js";
import { creature, faceCreature, animateCreature, creatureMetrics, releaseCreatureResources } from "./creatures.js";
import { compact, percentile, sample, releaseCompactMaterials } from "./graphics-utils.js";
import { HeroAnimation, WALK_SETTLE_MS, walkProgress } from "./hero-animation.js";
import { TorchLighting, stabilizeShadow } from "./lighting.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { wallHeight, wallLip } from "./wall-cut.js";
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
  castPose,
  dampStep,
  LEG_Y,
  pointOnRoute,
  pushOutOfWalls,
  STEP_MS,
  stepEase,
  stepPose,
  stepRoute,
  SWING_MS,
} from "./hero-motion.js";

const UP = new THREE.Vector3(0, 1, 0);
const FLOOR_LIMIT = 40 * 32;
/* North-aligned default: pure +Z offset looks toward game north (−Z / −map Y). */
const GAME_CAMERA_Y = 15.5;
const GAME_CAMERA_DIST = Math.hypot(2.8, 8.5);
/* One stride crosses the tile. The turn is still one action; only the view and body move. */
const FOLLOW_MS = STEP_MS;
const GAME_CAMERA = new THREE.Vector3(0, GAME_CAMERA_Y, GAME_CAMERA_DIST);
const CAMERA_PREF_KEY = "ularn3d.camera";
const northCameraOffset = (radius = GAME_CAMERA_DIST, elevationY = GAME_CAMERA_Y) => {
  const horiz = Math.max(5, Math.min(46, radius));
  const y = Math.max(4, Math.min(40, elevationY));
  return new THREE.Vector3(0, y, horiz);
};
const readCameraPrefs = () => {
  try {
    const raw = localStorage.getItem(CAMERA_PREF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const radius = Number(parsed.radius);
    const elevation = Number(parsed.elevation);
    if (!Number.isFinite(radius) || !Number.isFinite(elevation)) return null;
    return { radius, elevation };
  } catch {
    return null;
  }
};
const writeCameraPrefs = (offset) => {
  try {
    const radius = Math.hypot(offset.x, offset.z);
    localStorage.setItem(
      CAMERA_PREF_KEY,
      JSON.stringify({ radius, elevation: offset.y }),
    );
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
    const key = o.material.uuid;
    if (!sets.has(key)) sets.set(key, { material: o.material, geometries: [] });
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
  for (const { material, geometries } of sets.values()) {
    const merged = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    const m = new THREE.Mesh(merged, material);
    m.castShadow = castShadow;
    m.receiveShadow = true;
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
    this.autoTier = 1; this.qualityChangedAt = performance.now();
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
    this.renderer = new THREE.WebGLRenderer({
      // MSAA is a context-creation flag. Balanced skips it: fill-rate on the
      // web is the hitch, and Cinematic's higher pixel ratio plus bloom covers edges.
      antialias: this.quality === "cinematic",
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
    // 0.993 left a gap between cells. A close view looks through that gap onto
    // the dark dungeon slab, which reads as a black seam. Tiles overlap a little
    // so the seam stays covered. Tops are coplanar, so the overlap does not flicker.
    // The stone map is unchanged.
    const floorGeo = new THREE.BoxGeometry(1.02, 0.18, 1.02);
    this.floor = new ChunkedTerrainMesh(
      floorGeo,
      surface("stone", 0xffffff),
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
      matBasic(0xff7a3c, { toneMapped: false }),
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
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
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
    this.stepHome = null;
    this.stepDest = null;
    this.solidTiles = new Set();
    this.heroBounds = new THREE.Box3();
    this.boundsCorner = new THREE.Vector3();
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
      if (document.hidden) { this.heroAnimation.clear(); this.stopFrames(); }
      else { this.lastTime = performance.now(); this.effects.clear(); this.invalidate(); }
    });
    listen(window, "ularn:combat", (event) => {
      const detail = event.detail;
      if (!this.state || detail?.level !== this.level || document.hidden) return;
      if (detail.kind === "weapon") {
        this.attackAge = 0;
        this.attackStartedAt = performance.now();
        this.attackStyle = attackStyle(detail.weapon);
        const visible = !!detail.to && this.state.tiles.some(tile => tile.x === detail.to.x && tile.y === detail.to.y && tile.monster);
        this.heroAnimation.start(detail, performance.now(), this.reduced, visible);
      }
      if (this.effects.event(detail, this.reduced) && detail.phase === "cast") { this.castAge = 0; this.castStartedAt = performance.now(); }
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
        antialias: this.quality === "cinematic",
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
        effectiveQuality: ["low", "balanced", "high"][this.effectiveTier],
        activeFrameP95: percentile(this.frameSamples), renderP95: percentile(this.renderSamples),
        inputLatencyP95: percentile(this.inputSamples), updateP95: percentile(this.updateSamples),
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
        antialiasing:this.effectiveTier===2 ? "SMAA" : "MSAA",
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
        const swing = this.attackStartedAt == null ? 1 : (now - this.attackStartedAt) / SWING_MS;
        const step = this.followLive() ? (now - this.followStart) / this.followMs : 1;
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
        };
      },
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
      this.frameRequest = requestAnimationFrame(() => {
        this.frameRequest = null;
        this.animate();
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
    if (this.paused) this.heroAnimation.clear();
    this.nextFrameTime = 0;
    this.invalidate();
  }
  releaseLostResources(clearArtCache = false) {
    // Remove disposal listeners tied to the lost GL context before restoration.
    // Keep the CPU-side artwork: Three.js uploads it again on the next render.
    // Otherwise later level/quality changes try to delete stale WebKit handles.
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
    releaseModelResources(); releaseMaterialResources(); releaseCompactMaterials();
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
      node = node.parent;
    }
    return false;
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
    this.setArm(this.heroLeftArm, pose.leftArm, 0, 0);
    this.setArm(this.heroRightArm, pose.rightArm, 0, 0);
    this.setForearm(this.heroLeftForearm, pose.forearmX);
    this.setForearm(this.heroRightForearm, pose.forearmX);
    if (this.heroCape) this.heroCape.rotation.x = pose.capeX;
    this.setWeaponGrip(0);
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
  poseHero(now) {
    const body = this.heroBody;
    if (!body || this.reduced) return false;
    const swingT = this.attackStartedAt == null ? 1 : (now - this.attackStartedAt) / SWING_MS;
    const castT = this.castStartedAt == null ? 1 : (now - this.castStartedAt) / CAST_MS;
    const stepping = this.followLive();
    const swinging = swingT >= 0 && swingT < 1;
    const casting = castT >= 0 && castT < 1;
    const rawStep = stepPose(stepping ? Math.min(1, (now - this.followStart) / this.followMs) : 1, !!this.stepLeadRight);
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
    return stepping || swinging || casting;
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
    this.ao.kernelRadius=8; this.ao.minDistance=.001; this.ao.maxDistance=.12;
    this.composer.addPass(this.ao);
    this.composer.addPass(this.bloom);
    this.antialias=new SMAAPass(); this.composer.addPass(this.antialias);
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
      /* Constant dungeon light: ambient only, no directional/point, no fog dimming. */
      this.ambient.intensity = cinematic ? 1.85 : 1.7;
      this.sun.intensity = 0;
      this.fill.intensity = 0;
      this.sun.visible = false;
      this.fill.visible = false;
      if (this.scene.fog) this.scene.fog.density = 0;
    }
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
  cinematicRendering() { return this.effectiveTier === 2; }
  applyGpuQuality() {
    const cinematic = this.cinematicRendering();
    // Balanced caps below native DPR: 1440×1000 fill already dominates web frame time.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, cinematic ? 1.5 : 0.75));
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
  floorSurface(kind, color, extra) {
    const dungeon = this.state && this.state.level !== 0;
    // Flat caves: MeshBasic (constant light, no torch/zoom dim) WITH stone/grass
    // maps. Do not strip map/texture unless Ivan explicitly asks for texture changes.
    if (dungeon) return surfaceBasic(kind, color, extra);
    return this.cinematicRendering()
      ? surface(kind, color, extra)
      : surfaceLambert(kind, color, extra);
  }
  applyFloorMaterials() {
    const tint = stoneTint(this.state?.level ?? 0);
    const courses = shiftedTexture("stone", "courses", 0.37, 0.19);
    this.floor.material = this.floorSurface("stone", tint.floor);
    this.grassFloor.material = this.floorSurface("grass", 0xffffff);
    this.walls.material = this.floorSurface("stone", tint.wall, { map: courses });
    this.caps.material = this.floorSurface("stone", tint.cap, { map: courses });
  }
  floorVariation(level, grass, x, y) {
    const n = noise(x, y);
    const n2 = noise(x + 11, y + 4);
    if (grass) {
      this.scratchColor.setRGB(0.52 + n * 0.22, 0.58 + n2 * 0.16, 0.36 + n * 0.08);
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
    const enabled=this.effectiveTier===2 && this.state?.level===0;
    if (!enabled) { this.disablePointLights(); return; }
    this.playerLight.visible=true; this.playerLight.intensity=3.5;
    this.torchLights.forEach((light,index)=>{light.visible=index<4;});
    if(this.playerTarget)this.lighting.assign(this.lamps,this.playerTarget,4);
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
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, [.65, .75, 1.5][this.effectiveTier]));
    const cinematic=this.effectiveTier===2;
    if (cinematic) this.ensureComposer(); else this.disposeComposer();
    if (this.composer) {
      this.bloom.enabled=this.ao.enabled=this.antialias.enabled=cinematic;
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
    }
    this.resize();
  }
  adaptQuality(now, frameMs) {
    if (this.quality !== "auto" || this.frameSamples.length < 20) return;
    const p95 = percentile(this.frameSamples);
    this.overBudgetMs = p95 > 20 ? (this.overBudgetMs || 0) + frameMs : 0;
    this.headroomMs = p95 < 18 ? (this.headroomMs || 0) + frameMs : 0;
    if (this.overBudgetMs > 2000 && this.autoTier > 0) this.autoTier--;
    else if (this.headroomMs > 10000 && this.autoTier < 2) this.autoTier++;
    else return;
    this.qualityChangedAt = now; this.overBudgetMs = this.headroomMs = 0;
    this.frameSamples.length = 0; this.applyQuality();
  }
  project(position) {
    this.camera.updateMatrixWorld();
    const point = position.clone().project(this.camera);
    return { x: (point.x + 1) * innerWidth / 2, y: (1 - point.y) * innerHeight / 2 };
  }
  setViewportRect(rect) {
    this.viewportRect = { ...rect };
    this.camera.setViewOffset(innerWidth, innerHeight,
      innerWidth / 2 - (rect.left + rect.right) / 2,
      innerHeight / 2 - (rect.top + rect.bottom) / 2, innerWidth, innerHeight);
    this.invalidate();
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
    block(this.terrain, "stone", 0x66756b, 2, -0.35, 0, 21, 0.55, 16);
    block(this.terrain, "grass", 0x9eaa77, 2, -0.07, 0, 20.9, 0.06, 15.9);
    for (let x = -8; x < 13; x++)
      for (let y = -7; y < 8; y++)
        if (y === 1 || x === 4)
          block(
            this.terrain,
            "stone",
            0xc7bda0,
            x,
            0.003,
            y,
            0.99,
            0.025,
            0.99,
          );
    for (const [id, x, z, s] of [
      [69, -2, 4, 1.4],
      [12, 1, 0, 1.25],
      [10, 6, -3, 1.65],
      [16, 8, 3, 1.3],
      [77, 1, -4, 1.3],
      [54, 8, -6, 1.5],
    ]) {
      const b = building(id);
      batch(b);
      b.position.set(x, 0, z);
      b.scale.setScalar(s);
      this.props.add(b);
    }
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
    writeCameraPrefs(this.heldCameraOffset);
    return this.heldCameraOffset;
  }
  applyHeldCamera(target) {
    const offset =
      this.heldCameraOffset && this.heldCameraOffset.lengthSq() > 1
        ? this.heldCameraOffset.clone()
        : GAME_CAMERA.clone();
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
    const prefs = readCameraPrefs();
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
    const updateStarted = performance.now();
    const old = this.state;
    if (old && this.level != null) this.captureCamera();
    this.state = state;
    this.hoverDirty = true;
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
      this.ambientRats?.clear();
      this.lamps = [];
      this.wallHeightAt.length = 0;
      this.wallView = null;
      this.wallLayoutKey = null;
      this.structureKey = null;
      this.level = state.level;
      this.lastPlayer = null;
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
      this.dust.visible = town;
      this.paths = this.townPaths(state.tiles);
      this.staticKey = null;
      this.structureKey = null;
      this.lastStructureRev = null;
      this.lastActorRev = null;
      if (!town) {
        const slab = box(
          this.terrain,
          volcano ? 0x22191a : 0x101d24,
          (state.width - 1) / 2,
          -0.4,
          (state.height - 1) / 2,
          state.width,
          0.45,
          state.height,
        );
        // Town terrain is merged with castShadow off. The dungeon slab used to
        // recast a 57×20 box into the shadow map on every cutaway step.
        slab.castShadow = false;
        slab.receiveShadow = false;
      } else {
        block(
          this.terrain,
          "stone",
          0x70806e,
          (state.width - 1) / 2,
          -0.39,
          (state.height - 1) / 2,
          state.width,
          0.65,
          state.height,
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
    this.lamps.length = 0;
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
        this.scratchPosition.set(t.x, -0.105, t.y);
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
      if (dynamic) {
        this.props.add(g);
        if (t.store && ![54, 55, 56].includes(t.id)) {
          g.userData.building = true;
          g.traverse((object) => {
            if (!object.isMesh) return;
            object.material = object.material.clone();
            object.material.transparent = true;
            object.material.depthWrite = false;
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
    for (const { mesh } of this.objects.values()) {
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
          start: new THREE.Vector3(tile.x, 0, tile.y), movedAt: performance.now() - 100,
        };
        this.monsters.set(uid, actor);
        this.actors.add(mesh);
      }
      if (actor.target.x !== tile.x || actor.target.z !== tile.y) {
        actor.start.copy(actor.mesh.position); actor.movedAt = performance.now();
        if (Math.max(Math.abs(actor.target.x - tile.x), Math.abs(actor.target.z - tile.y)) > 1) {
          actor.start.set(tile.x, 0, tile.y); actor.mesh.position.copy(actor.start); actor.movedAt -= 100;
        }
        actor.target.set(tile.x, 0, tile.y);
      }
      actor.mesh.userData.uid = uid;
      actor.mesh.userData.tile = { x: tile.x, y: tile.y };
      if (actor.mesh.userData.model) faceCreature(actor.mesh, monster.facing);
      else faceMonster(actor.mesh, monster.facing, this.camera);
    }
    for (const [uid, actor] of this.monsters)
      if (!creatures.has(uid)) {
        actor.mesh.removeFromParent();
        destroy(actor.mesh);
        this.monsters.delete(uid);
      }
  }
  syncMovers(state, old) {
    this.player.visible = true;
    if (!this.playerTarget) this.playerTarget = new THREE.Vector3();
    const target = this.playerTarget.set(state.x, 0, state.y);
    if (!this.lastPlayer) {
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
      this.startFollow(target);
    }
    if (
      old &&
      old.level === state.level &&
      (state.hp < old.hp || state.mana < old.mana)
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
    this.disablePointLights();
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
      this.scratchPosition.set(t.x, h / 2 - 0.01, t.y);
      this.scratchScale.set(0.985, h, 0.985);
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
  rotate(direction) {
    const offset = this.scratchOffset.copy(this.camera.position).sub(this.controls.target);
    offset.applyAxisAngle(UP, (direction * Math.PI) / 4);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.captureCamera();
    this.updateWalls();
    this.invalidate();
  }
  zoom(factor) {
    const offset = this.scratchOffset.copy(this.camera.position).sub(this.controls.target);
    offset.multiplyScalar(factor).clampLength(5, 46);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.captureCamera();
    this.invalidate();
  }
  reset() {
    if (this.state) {
      const prefs = readCameraPrefs();
      this.heldCameraOffset = northCameraOffset(
        prefs?.radius ?? GAME_CAMERA_DIST,
        prefs?.elevation ?? GAME_CAMERA_Y,
      );
      this.controls.target.set(this.state.x, 0, this.state.y);
      this.camera.position
        .copy(this.controls.target)
        .add(this.heldCameraOffset);
      if (this.playerTarget) this.player.position.copy(this.playerTarget);
      this.followHeld = true;
      this.finishStepTiles();
      this.yawEase = false;
      this.controls.update();
      writeCameraPrefs(this.heldCameraOffset);
      this.updateWalls();
      this.invalidate();
    }
  }
  startFollow(target) {
    this.followFrom.copy(this.player.position);
    this.followCam.copy(this.controls.target);
    this.followStart = performance.now();
    const moving =
      this.followFrom.distanceToSquared(target) > 1e-8 ||
      this.followCam.distanceToSquared(target) > 1e-8;
    this.followMs = this.reduced || !moving ? 0 : FOLLOW_MS;
    this.followHeld = this.followMs === 0;
    this.hasMotion = this.followMs > 0;
    if (this.followMs) this.stepLeadRight = !this.stepLeadRight;
    this.stepHome = { x: Math.round(this.followFrom.x), z: Math.round(this.followFrom.z) };
    this.stepDest = { x: Math.round(target.x), z: Math.round(target.z) };
    this.ensureSolid();
    if (!this.followMs) {
      this.snapFollow();
      this.finishStepTiles();
      return;
    }
    this.followRoute = stepRoute(
      { x: this.followFrom.x, z: this.followFrom.z },
      { x: target.x, z: target.z },
      (x, z) => this.isSolid(x, z),
    );
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
    if (this.player?.visible) this.rememberPixel(this.player);
    for (const { mesh } of this.monsters.values()) {
      const art = mesh.userData.artwork;
      if (art) this.rememberPixel(art);
    }
    for (const art of this.billboards) this.rememberPixel(art);
  }
  restorePixelGrid() {
    for (let i = 0; i < this.pixelCount; i++) {
      const slot = this.pixelSlots[i];
      slot.object.position.copy(slot.home);
    }
    this.pixelCount = 0;
  }
  animate() {
    const now = performance.now(),
      elapsed = (now - this.lastTime) / 1000;
    // A turn wakes the loop after it has been idle. Spending that gap as one
    // step makes the camera and hero pop. Clock-based follow ignores it;
    // everything else takes a single frame.
    const dt = elapsed > 0.08 ? 1 / 60 : elapsed;
    this.lastTime = now;
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
      const t = Math.min(1, (now - this.followStart) / this.followMs);
      const eased = stepEase(t);
      if (t >= 1) {
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
    }
    if (this.playerTarget) {
      this.playerLight.position
        .copy(this.player.position)
        .add(this.scratchOffset.set(0, 1.4, 0.2));
      this.heroLimbLive = this.poseHero(now);
      this.heroAnimation.update(now);
      this.heroLimbLive ||= this.heroAnimation.active;
      this.keepBodyOutOfRock();
    }
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
    if (
      this.cinematicRendering() &&
      this.playerTarget &&
      this.player.position.distanceToSquared(this.playerTarget) > 0.0001 &&
      this.tick - (this.shadowTime || 0) > 0.08
    ) {
      this.markShadowUpdate();
      this.shadowTime = this.tick;
    }
    this.renderer.info.reset();
    this.scratchCam.copy(this.camera.position);
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.hasMotion = this.followLive() || !!this.heroLimbLive;
    if (this.playerTarget && this.player.position.distanceToSquared(this.playerTarget) > 0.0001)
      this.hasMotion = true;
    if (this.camera.position.distanceToSquared(this.scratchCam) > 1e-8) this.hasMotion = true;
    const camTurned = !this.lastCamQuatValid || !this.lastCamQuat.equals(this.camera.quaternion);
    if (camTurned) {
      this.lastCamQuat.copy(this.camera.quaternion);
      this.lastCamQuatValid = true;
    }
    for (const { mesh, target, start, movedAt } of this.monsters.values()) {
      const moving = mesh.position.distanceToSquared(target) > 0.0004;
      if (!moving) mesh.position.copy(target);
      else mesh.position.lerpVectors(start,target,this.reduced ? 1 : Math.min(1,(now-movedAt)/100));
      const body = mesh.userData.body;
      if (body) {
        const base = mesh.userData.hover || 0;
        body.position.y = !this.reduced && moving
          ? base + Math.abs(Math.sin(this.tick * 16 + mesh.id)) * 0.04
          : base;
      }
      if (moving) this.hasMotion = true;
      if (mesh.userData.model) animateCreature(mesh, now, moving, this.reduced);
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
    if (this.effectiveTier===2 && this.state?.level===0) {
      this.syncPlayerLight();
      const lightsMoving = this.lighting.update(dt,this.tick,this.reduced);
      this.hasMotion ||= lightsMoving;
      if(this.playerTarget)stabilizeShadow(this.sun,this.playerTarget);
    }
    // Cheap transform updates only; does not allocate. Near-camera scurries
    // briefly keep the frame loop alive, then Balanced can idle again.
    this.ambientRatsNear = this.ambientRats?.update(dt, this.camera) || false;
    if (this.ambientRatsNear) this.hasMotion = true;
    if (this.hoverDirty && this.hoverPointer && !this.gesture) {
      const tile=this.pick(this.hoverPointer); this.marker.visible=!!tile;
      if(tile)this.marker.position.set(tile.x,0,tile.y);
      this.onHover(tile,this.hoverPointer); this.hoverDirty=false;
    }
    this.applyPixelGrid();
    try {
      if (this.composer && this.effectiveTier === 2) this.composer.render(dt);
      else this.renderer.render(this.scene, this.camera);
    } finally {
      this.restorePixelGrid();
    }
    sample(this.renderSamples, performance.now() - now);
    if (!this.paused && this.state && this.hasMotion) {
      sample(this.frameSamples, Math.min(100, dt * 1000));
      if (this.lastInputAt != null) { sample(this.inputSamples, performance.now() - this.lastInputAt); this.lastInputAt=null; }
      this.adaptQuality(now, dt*1000);
    }
    this.renderedFrames++;
    this.animating = false;
    this.scheduleFrame();
  }
  updateCutaways(dt) {
    if (!this.state) return;
    const toward = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
    const heroPoint = this.project(this.player.position.clone().add(new THREE.Vector3(0, .6, 0)));
    for (const { mesh } of this.objects.values()) {
      if (!mesh.userData.building) continue;
      const dx = mesh.position.x - this.player.position.x, dz = mesh.position.z - this.player.position.z;
      let obscures = false;
      const wasHidden = mesh.userData.obscuresHero;
      if (dx * dx + dz * dz < (wasHidden ? 18 : 16) && dx * toward.x + dz * toward.z > -.6) {
        const bounds = mesh.userData.bounds || (mesh.userData.bounds = new THREE.Box3().setFromObject(mesh));
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const point = this.project(new THREE.Vector3(x, y, z));
          left = Math.min(left, point.x); right = Math.max(right, point.x);
          top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
        }
        const margin = wasHidden ? 6 : 0;
        obscures = heroPoint.x > left - margin && heroPoint.x < right + margin && heroPoint.y > top - margin && heroPoint.y < bottom + margin;
      }
      mesh.userData.obscuresHero = obscures;
      const target = obscures ? .2 : 1;
      let opacity = mesh.userData.opacity ?? 1;
      opacity += (target - opacity) * (this.reduced ? 1 : 1 - Math.exp(-dt * 14));
      if (Math.abs(target - opacity) < .005) opacity = target;
      else this.hasMotion = true;
      mesh.userData.opacity = opacity;
      mesh.traverse((object) => {
        if (!object.material?.userData.cutaway) return;
        object.material.opacity = opacity;
        object.material.depthWrite = opacity >= .995;
      });
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
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
