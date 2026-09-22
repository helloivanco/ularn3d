import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mat, surface, surfaceLambert, noise } from "./materials.js";
import { monsterSprite, faceMonster, monsterArtMetrics, releaseMonsterArtResources } from "./monster-art.js";
import { itemSprite, faceItem, itemArtMetrics, releaseItemArtResources } from "./item-art.js";
import { CombatEffects } from "./combat-effects.js";
import { wallHeight } from "./wall-cut.js";
import {
  box,
  block,
  orb,
  tree,
  hero,
  cone,
  building,
  itemModel,
  monsterModel,
  ring,
  LANDMARK_NAMES,
} from "./models.js";

const UP = new THREE.Vector3(0, 1, 0);
const FLOOR_LIMIT = 40 * 32;
const GAME_CAMERA = new THREE.Vector3(2.8, 15.5, 8.5);
function destroy(group) {
  group.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
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
    this.quality = "balanced";
    try {
      this.quality = localStorage.getItem("ularn3d.quality") || this.quality;
    } catch {}
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x112c32);
    this.scene.fog = new THREE.FogExp2(0x112c32, 0.022);
    this.camera = new THREE.PerspectiveCamera(
      37,
      innerWidth / innerHeight,
      0.1,
      240,
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);
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
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.quality === "cinematic" ? 2048 : 1024, this.quality === "cinematic" ? 2048 : 1024);
    Object.assign(this.sun.shadow.camera, {
      left: -20,
      right: 20,
      top: 20,
      bottom: -20,
      near: 1,
      far: 80,
    });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0x78b9cf, 1.1);
    this.fill.position.set(10, 10, -10);
    this.scene.add(this.fill);
    this.terrain = new THREE.Group();
    this.props = new THREE.Group();
    this.actors = new THREE.Group();
    this.scene.add(this.terrain, this.props, this.actors);
    this.effects = new CombatEffects(this.scene);
    const floorGeo = new THREE.BoxGeometry(0.993, 0.18, 0.993);
    this.floor = new THREE.InstancedMesh(
      floorGeo,
      surface("stone", 0xffffff),
      FLOOR_LIMIT,
    );
    this.floor.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.floor.count = 0;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.grassFloor = new THREE.InstancedMesh(
      floorGeo,
      surface("grass", 0xffffff),
      FLOOR_LIMIT,
    );
    this.grassFloor.count = 0;
    this.grassFloor.receiveShadow = true;
    this.scene.add(this.grassFloor);
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    this.walls = new THREE.InstancedMesh(
      wallGeo,
      surface("stone", 0x99aba7),
      FLOOR_LIMIT,
    );
    this.caps = new THREE.InstancedMesh(
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
    this.player = hero();
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
    this.shadowUpdates = 0;
    this.torchLights = Array.from({ length: 6 }, () => {
      const l = new THREE.PointLight(0xffa64c, 0, 6, 2);
      this.scene.add(l);
      return l;
    });
    this.marker = new THREE.Group();
    ring(this.marker, 0xf0d491, 0.46, 0.018);
    this.marker.visible = false;
    this.scene.add(this.marker);
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
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      0.18,
      0.55,
      1.5,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
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
    this.heldCameraOffset = null;
    this.pickHits = [];
    this.cameraLive = false;
    this.lampPool = [];
    this.billboards = [];
    this.draining = [];
    this.torchBudget = 2;
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
      const tile = this.pick(e);
      this.marker.visible = !!tile;
      if (tile) this.marker.position.set(tile.x, 0, tile.y);
      this.onHover(tile, e);
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
      this.marker.visible = false;
      this.onHover(null);
      this.invalidate();
    });
    listen(canvas, "webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
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
      if (document.hidden) this.stopFrames();
      else { this.lastTime = performance.now(); this.effects.clear(); this.invalidate(); }
    });
    listen(window, "ularn:combat", (event) => {
      const detail = event.detail;
      if (!this.state || detail?.level !== this.level || document.hidden) return;
      if (detail.kind === "weapon") { this.attackAge = 0; this.attackStartedAt = performance.now(); }
      if (this.effects.event(detail, this.reduced) && detail.phase === "cast") { this.castAge = 0; this.castStartedAt = performance.now(); }
      if ((detail.kind === "weapon" || detail.phase === "cast") && detail.to && detail.from &&
        (detail.to.x !== detail.from.x || detail.to.y !== detail.from.y))
        this.player.rotation.y = Math.atan2(detail.to.x - detail.from.x, detail.to.y - detail.from.y) + Math.PI;
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
        contextLost: this.lost,
        frameMs: this.frameMs || 0,
        renderedFrames: this.renderedFrames,
        frameLimit: this.frameLimit(),
        idle: performance.now() > this.activeUntil,
        suspended: document.hidden || this.paused || this.lost,
        cameraElevation: Math.atan2(this.camera.position.y - this.controls.target.y,
          Math.hypot(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z)) * 180 / Math.PI,
        cameraOffset: [
          this.camera.position.x - this.controls.target.x,
          this.camera.position.y - this.controls.target.y,
          this.camera.position.z - this.controls.target.z,
        ],
        monsterActors: this.monsters.size,
        propGroups: this.objects.size,
        floorInstances: this.floor.count + this.grassFloor.count,
        wallInstances: this.walls.count,
        shadowUpdates: this.shadowUpdates,
        wallCastShadow: this.walls.castShadow,
        floorReceiveShadow: this.floor.receiveShadow,
        floorMaterial: this.floor.material?.type || null,
        pixelRatio: this.renderer.getPixelRatio(),
        ...monsterArtMetrics(),
        ...itemArtMetrics(),
        ...this.effects.metrics(),
      }),
      creatures: () => [...this.monsters.values()].map(({ mesh, species }) => ({
        uid: mesh.userData.uid, species, tile: { ...mesh.userData.tile },
        facing: { ...mesh.userData.facing }, art: mesh.userData.artPath,
        mirrored: mesh.userData.artwork?.scale.x < 0,
      })),
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
        .filter((child) => child.userData.fountain || child.userData.stairDirection)
        .map((child) => ({
          tile: { ...mesh.userData.tile },
          fountain: child.userData.fountain,
          waterVisible: !!child.getObjectByName("fountain-water")?.visible,
          stairDirection: child.userData.stairDirection,
          stairBlocked: child.userData.stairBlocked,
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
    });
  }
  invalidate() {
    if (this.disposed) return;
    this.activeUntil = performance.now() + 1100;
    this.scheduleFrame();
  }
  frameLimit() {
    if (this.paused) return 4;
    const idle = performance.now() > this.activeUntil;
    if (idle && this.state && this.quality === "balanced" && !this.hasMotion && !this.cameraLive)
      return 0;
    if (this.state && (this.cameraLive || this.hasMotion || !idle)) return 60;
    return 12;
  }
  stopFrames() {
    clearTimeout(this.frameTimer);
    cancelAnimationFrame(this.frameRequest);
    this.frameTimer = this.frameRequest = null;
  }
  scheduleFrame() {
    if (this.disposed || document.hidden || this.lost || this.frameTimer != null || this.frameRequest != null) return;
    const idle = performance.now() > this.activeUntil;
    const effectsActive = this.effects.slots.some((slot) => slot.active);
    if (idle && !this.hasMotion && !this.cameraLive && !effectsActive &&
      (this.quality === "balanced" || this.reduced || this.paused) && this.state) return;
    const live = !this.paused && !!this.state && (this.cameraLive || this.hasMotion || effectsActive || !idle);
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
    this.paused = !!paused;
    this.invalidate();
  }
  releaseLostResources(clearArtCache = false) {
    // Remove disposal listeners tied to the lost GL context before restoration.
    // Keep the CPU-side artwork: Three.js uploads it again on the next render.
    // Otherwise later level/quality changes try to delete stale WebKit handles.
    const geometries = new Set(),
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
    releaseMonsterArtResources(clearArtCache);
    releaseItemArtResources(clearArtCache);
    this.sun.shadow.dispose();
    this.composer.passes.forEach((pass) => pass.dispose());
    this.composer.dispose();
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
  }
  buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer),
      environment = new RoomEnvironment();
    this.environment?.dispose();
    this.environment = pmrem.fromScene(environment, 0.04);
    environment.dispose();
    pmrem.dispose();
  }
  applyGpuQuality() {
    const cinematic = this.quality === "cinematic";
    // Balanced caps below native DPR: 1440×1000 fill already dominates web frame time.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, cinematic ? 1.5 : 0.85));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = cinematic ? THREE.PCFShadowMap : THREE.BasicShadowMap;
    this.sun.shadow.mapSize.set(cinematic ? 2048 : 512, cinematic ? 2048 : 512);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.bloom.enabled = cinematic;
    this.torchBudget = cinematic ? this.torchLights.length : 2;
    this.torchLights.forEach((light, i) => {
      if (i >= this.torchBudget) {
        light.visible = false;
        light.intensity = 0;
      } else light.visible = true;
    });
    if (cinematic) {
      if (!this.environment) this.buildEnvironment();
      this.scene.environment = this.environment.texture;
      this.scene.environmentIntensity = 0.24;
    } else {
      this.scene.environment = null;
      this.scene.environmentIntensity = 0;
    }
    // Walls and floors filled the shadow pass on every walk frame. Balanced keeps
    // the hero silhouette only; cinematic restores full contact shadows.
    this.walls.castShadow = cinematic;
    this.caps.castShadow = cinematic;
    this.floor.receiveShadow = cinematic;
    this.grassFloor.receiveShadow = cinematic;
    this.walls.receiveShadow = cinematic;
    this.caps.receiveShadow = cinematic;
    this.applyFloorMaterials();
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.syncPlayerLight();
    this.markShadowUpdate();
  }
  floorSurface(kind, color) {
    return this.quality === "cinematic"
      ? surface(kind, color)
      : surfaceLambert(kind, color);
  }
  applyFloorMaterials() {
    if (!this.state) {
      this.floor.material = this.floorSurface("stone", 0xffffff);
      this.grassFloor.material = this.floorSurface("grass", 0xffffff);
      this.walls.material = this.floorSurface("stone", 0x99aba7);
      this.caps.material = this.floorSurface("stone", 0xb2bbad);
      return;
    }
    const volcano = this.state.level > 15;
    this.floor.material = this.floorSurface(
      "stone",
      this.state.level === 0 ? 0xffffff : volcano ? 0xa77b62 : 0xc0c8c3,
    );
    this.grassFloor.material = this.floorSurface("grass", 0xffffff);
    this.walls.material = this.floorSurface("stone", 0x99aba7);
    this.caps.material = this.floorSurface("stone", 0xb2bbad);
  }
  markShadowUpdate() {
    this.renderer.shadowMap.needsUpdate = true;
    this.shadowUpdates++;
  }
  syncPlayerLight() {
    // Balanced already dropped the hero point light in town. Dungeon paid it
    // on the whole InstancedMesh floor, which is most of the screen.
    const lantern = this.quality === "cinematic" && this.state && this.state.level !== 0;
    this.playerLight.visible = lantern;
    this.playerLight.intensity = lantern ? 6 : 0;
    if (lantern)
      this.playerLight.color.set(this.state.level > 15 ? 0xffa466 : 0xffce89);
  }
  setQuality(value, persist = true) {
    this.quality = ["cinematic", "balanced"].includes(value)
      ? value
      : "balanced";
    this.applyGpuQuality();
    if (persist)
      try {
        localStorage.setItem("ularn3d.quality", this.quality);
      } catch {}
    this.resize();
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
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
  }
  update(state) {
    const old = this.state;
    if (old && this.level != null) this.captureCamera();
    this.state = state;
    this.controls.autoRotate = false;
    const isNew = this.level !== state.level;
    if (isNew) {
      destroy(this.terrain);
      destroy(this.props);
      this.objects.clear();
      destroy(this.actors);
      this.monsters.clear();
      this.effects.clear();
      this.lamps = [];
      this.wallHeightAt.length = 0;
      this.wallView = null;
      this.wallLayoutKey = null;
      this.structureKey = null;
      this.level = state.level;
      this.lastPlayer = null;
      const town = state.level === 0,
        volcano = state.level > 15;
      this.scene.background.set(
        town ? 0x112c32 : volcano ? 0x261b1a : 0x0b1821,
      );
      this.scene.fog.color.copy(this.scene.background);
      this.scene.fog.density = town ? 0.022 : 0.044;
      this.ambient.intensity = town ? 1.65 : 0.72;
      this.sun.intensity = town ? 3.9 : 0.85;
      this.fill.intensity = town ? 1.1 : 0.5;
      this.fill.color.set(volcano ? 0xb54c35 : 0x659bbf);
      this.floor.material = this.floorSurface("stone", volcano ? 0xa77b62 : 0xc0c8c3);
      this.water.visible = town;
      this.paths = this.townPaths(state.tiles);
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
    const structureKey = `${floorHash}|${this.wallLayout}|${propHash}|${monsterHash}|${state.tiles.length}`;
    // Walking across an already-known floor only moves the hero. Skip rebuilding
    // every wall cell list, floor instance, and empty-tile skip path.
    if (
      !isNew &&
      this.structureKey === structureKey &&
      this.wallCells.length === wallCount
    ) {
      this.floorHash = floorHash;
      this.syncMovers(state, old);
      this.invalidate();
      return;
    }
    this.structureKey = structureKey;
    this.wallCells = [];
    this.lamps.length = 0;
    const rebuildFloors = isNew || this.floorHash !== floorHash;
    this.floorHash = floorHash;
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
      const sig = `${t.id}:${t.arg ?? 0}${t.stair?.blocked ? ":blocked" : ""}`;
      const prev = this.objects.get(key);
      const grass = state.level === 0 && !this.paths.has(key);
      if (rebuildFloors) {
        const color = this.scratchColor
          .set(
            grass
              ? 0xa0af80
              : state.level === 0
                ? 0xb6b49c
                : state.level > 15
                  ? 0xc29b81
                  : 0xb1c0ba,
          )
          .multiplyScalar(0.82 + noise(t.x, t.y) * 0.23);
        matrix.makeTranslation(t.x, -0.105, t.y);
        const floor = grass ? this.grassFloor : this.floor,
          index = grass ? grassIndex++ : floorIndex++;
        floor.setMatrixAt(index, matrix);
        floor.setColorAt(index, color);
      }
      if (t.wall) this.wallCells.push(t);
      if (t.store && t.id !== 55) takeLamp(t.x - 0.2, 1.25, t.y + 0.75);
      if (t.id === 55) takeLamp(t.x, 0.5, t.y);
      if (t.wall && noise(t.x, t.y) > 0.87) takeLamp(t.x, 1.45, t.y);
      // Empty floors and walls are already InstancedMeshes. A Group per
      // HAVESEEN tile made large dungeon rooms walk like molasses.
      if (t.wall || t.id === 0) {
        if (prev) {
          this.props.remove(prev.mesh);
          destroy(prev.mesh);
          this.objects.delete(key);
        }
        continue;
      }
      if (prev?.sig === sig) continue;
      if (prev) {
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
      this.props.add(g);
      this.objects.set(key, { sig, mesh: g });
    }
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
          monsterSprite(monster, () => this.invalidate()) ||
          monsterModel(monster);
        mesh.position.set(tile.x, 0, tile.y);
        actor = {
          mesh,
          species: monster.id,
          target: new THREE.Vector3(tile.x, 0, tile.y),
        };
        this.monsters.set(uid, actor);
        this.actors.add(mesh);
      }
      actor.target.set(tile.x, 0, tile.y);
      actor.mesh.userData.uid = uid;
      actor.mesh.userData.tile = { x: tile.x, y: tile.y };
      faceMonster(actor.mesh, monster.facing, this.camera);
    }
    for (const [uid, actor] of this.monsters)
      if (!creatures.has(uid)) {
        actor.mesh.removeFromParent();
        destroy(actor.mesh);
        this.monsters.delete(uid);
      }
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
    }
    for (const [key, o] of this.objects)
      if (!ids.has(key)) {
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
    this.syncMovers(state, old);
    if (isNew) this.markShadowUpdate();
    this.invalidate();
  }
  syncMovers(state, old) {
    this.player.visible = true;
    if (!this.playerTarget) this.playerTarget = new THREE.Vector3();
    const target = this.playerTarget.set(state.x, 0, state.y);
    if (!this.lastPlayer) {
      this.player.position.copy(target);
      this.applyHeldCamera(target);
    } else if (this.lastPlayer.x !== state.x || this.lastPlayer.y !== state.y) {
      this.player.rotation.y =
        Math.atan2(state.x - this.lastPlayer.x, state.y - this.lastPlayer.y) +
        Math.PI;
      this.walkAge = 0;
      this.walkStartedAt = performance.now();
    }
    if (
      old &&
      old.moves !== state.moves &&
      state.x === old.x &&
      state.y === old.y &&
      state.maze
    ) {
      if (
        old.tiles.some(
          (t) =>
            t.monster &&
            Math.max(Math.abs(t.x - state.x), Math.abs(t.y - state.y)) <= 1,
        )
      ) {
        this.attackAge = 0;
        this.attackStartedAt = performance.now();
      }
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
    this.syncPlayerLight();
    // Balanced keeps the sun over the map center so the shadow map does not
    // chase the hero every step. Cinematic still follows the player.
    if (this.quality === "cinematic") {
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
    this.dust.position.set(state.x, 0, state.y);
    this.lamps.sort(
      (a, b) => a.distanceToSquared(target) - b.distanceToSquared(target),
    );
    for (let i = 0; i < this.torchLights.length; i++) {
      const lamp = i < this.torchBudget ? this.lamps[i] : null,
        light = this.torchLights[i];
      light.visible = !!lamp;
      light.intensity = lamp ? 5 : 0;
      if (lamp) light.position.copy(lamp);
    }
    this.updateWalls();
  }
  updateWalls() {
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
      this.scratchMatrix.compose(
        this.scratchPosition,
        this.identityQ,
        this.scratchScale,
      );
      this.walls.setMatrixAt(i, this.scratchMatrix);
      this.scratchPosition.y = h + 0.025;
      this.scratchScale.set(1.015, 0.08, 1.015);
      this.scratchMatrix.compose(
        this.scratchPosition,
        this.identityQ,
        this.scratchScale,
      );
      this.caps.setMatrixAt(i, this.scratchMatrix);
    }
    if (!changed) return;
    for (const mesh of [this.walls, this.caps]) {
      mesh.instanceMatrix.needsUpdate = true;
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
    this.ray.intersectObject(this.walls, false, this.pickHits);
    this.ray.intersectObject(this.caps, false, this.pickHits);
    for (const hit of this.pickHits) {
      if (hit.object.isSprite) continue;
      if (hit.object === this.walls || hit.object === this.caps)
        return this.wallCells[hit.instanceId] || null;
      let o = hit.object;
      while (o && !o.userData.tile) o = o.parent;
      if (o?.userData.tile) {
        const { x, y } = o.userData.tile;
        return this.state.tiles.find((t) => t.x === x && t.y === y) || null;
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
      this.heldCameraOffset = GAME_CAMERA.clone();
      this.controls.target.set(this.state.x, 0, this.state.y);
      this.camera.position
        .copy(this.controls.target)
        .add(GAME_CAMERA);
      this.controls.update();
      this.updateWalls();
      this.invalidate();
    }
  }
  animate() {
    const now = performance.now(),
      elapsed = (now - this.lastTime) / 1000,
      dt = Math.min(0.1, elapsed);
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
    if (this.playerTarget) {
      const remain = this.playerTarget.distanceToSquared(this.controls.target);
      if (remain < 0.0004) {
        this.scratchOffset.copy(this.camera.position).sub(this.controls.target);
        this.controls.target.copy(this.playerTarget);
        this.camera.position.copy(this.playerTarget).add(this.scratchOffset);
        this.player.position.copy(this.playerTarget);
      } else {
        const alpha = this.reduced ? 1 : 1 - Math.exp(-dt * 11);
        this.scratchOffset
          .copy(this.playerTarget)
          .sub(this.controls.target)
          .multiplyScalar(alpha);
        this.controls.target.add(this.scratchOffset);
        this.camera.position.add(this.scratchOffset);
        this.player.position.lerp(this.playerTarget, alpha);
      }
      this.playerLight.position
        .copy(this.player.position)
        .add(this.scratchOffset.set(0, 1.4, 0.2));
      const body = this.heroBody;
      if (body && !this.reduced) {
        this.walkAge = this.walkStartedAt === undefined ? 1 : (now - this.walkStartedAt) / 1000;
        this.attackAge = this.attackStartedAt === undefined ? 1 : (now - this.attackStartedAt) / 1000;
        this.castAge = this.castStartedAt === undefined ? 1 : (now - this.castStartedAt) / 1000;
        const walk = Math.max(0, 1 - this.walkAge / 0.28);
        body.position.y = Math.abs(Math.sin(this.walkAge * 26)) * 0.045 * walk;
        if (this.heroLeftLeg)
          this.heroLeftLeg.rotation.x = Math.sin(this.walkAge * 26) * 0.45 * walk;
        if (this.heroRightLeg)
          this.heroRightLeg.rotation.x = Math.sin(this.walkAge * 26) * -0.45 * walk;
        const weapon = this.heroWeapon;
        if (weapon)
          weapon.rotation.x =
            this.castAge < 0.65
              ? -Math.sin(this.castAge / 0.65 * Math.PI) * 1.9
              : this.attackAge < 0.3
              ? -Math.sin((this.attackAge / 0.3) * Math.PI) * 1.4
              : 0;
        if (this.heroCape) this.heroCape.rotation.x = -0.25 + Math.sin(this.tick * 2) * 0.035;
      }
    }
    if (!this.reduced) {
      this.dust.rotation.y = Math.sin(this.tick * 0.055) * 0.08;
      this.torchLights.forEach((l, i) => {
        if (l.intensity)
          l.intensity =
            4.5 +
            Math.sin(this.tick * 5 + i) * 0.4 +
            Math.sin(this.tick * 11 + i) * 0.15;
      });
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
      this.quality === "cinematic" &&
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
    this.hasMotion =
      !!this.playerTarget &&
      this.player.position.distanceToSquared(this.playerTarget) > 0.0001;
    if (this.camera.position.distanceToSquared(this.scratchCam) > 1e-8) this.hasMotion = true;
    const camTurned = !this.lastCamQuatValid || !this.lastCamQuat.equals(this.camera.quaternion);
    if (camTurned) {
      this.lastCamQuat.copy(this.camera.quaternion);
      this.lastCamQuatValid = true;
    }
    for (const { mesh, target } of this.monsters.values()) {
      if (mesh.position.distanceToSquared(target) < 0.0004) mesh.position.copy(target);
      else mesh.position.lerp(target, this.reduced ? 1 : 1 - Math.exp(-dt * 13));
      if (mesh.position.distanceToSquared(target) > 0.0001) this.hasMotion = true;
      if (camTurned) faceMonster(mesh, null, this.camera);
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
    if (this.wallCells.length) this.updateWalls();
    if (this.quality === "cinematic") this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.renderedFrames++;
    this.animating = false;
    this.scheduleFrame();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopFrames();
    this.events.abort();
    this.controls.dispose();
    this.effects.dispose();
    this.releaseLostResources(true);
    destroy(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
