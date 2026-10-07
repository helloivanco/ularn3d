import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mat, surface, noise, releaseMaterialResources } from "./materials.js";
import { creature, faceCreature, animateCreature, creatureMetrics, releaseCreatureResources } from "./creatures.js";
import { compact, percentile, sample, releaseCompactMaterials } from "./graphics-utils.js";
import { StaticTiles } from "./static-world.js";
import { TerrainGrid } from "./terrain-grid.js";
import { CombatEffects } from "./combat-effects.js";
import { HeroAnimation, WALK_SETTLE_MS, walkProgress } from "./hero-animation.js";
import { TorchLighting, stabilizeShadow } from "./lighting.js";
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
  torch,
  LANDMARK_NAMES,
} from "./models.js";

const UP = new THREE.Vector3(0, 1, 0);
const FLOOR_LIMIT = 67 * 17;
const GAME_CAMERA = new THREE.Vector3(2.8, 15.5, 8.5);
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
function batch(group) { compact(group); }

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
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(this.renderer),
      environment = new RoomEnvironment();
    this.environment = pmrem.fromScene(environment, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.24;
    environment.dispose();
    pmrem.dispose();
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
    this.sun.shadow.mapSize.set(2048, 2048);
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
    const floorGeo = new THREE.BoxGeometry(0.993, 0.18, 0.993);
    const wallGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.035);
    floorGeo.userData.shared = wallGeo.userData.shared = true;
    this.floorGeometry = floorGeo; this.wallGeometry = wallGeo;
    this.grid = new TerrainGrid(this.scene, floorGeo, wallGeo);
    this.player = hero();
    this.heroAnimation = new HeroAnimation(this.scene, this.player);
    this.player.visible = false;
    this.scene.add(this.player);
    this.playerLight = new THREE.PointLight(0xffc172, 6, 8, 2);
    this.scene.add(this.playerLight);
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
      new THREE.PlaneGeometry(250, 250, 90, 90),
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
    this.ao = new SSAOPass(this.scene, this.camera, innerWidth / 2, innerHeight / 2);
    this.ao.kernelRadius = 8; this.ao.minDistance = .001; this.ao.maxDistance = .12;
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      0.18,
      0.55,
      1.5,
    );
    this.composer.addPass(this.bloom);
    this.antialias = new SMAAPass();
    this.composer.addPass(this.antialias);
    this.composer.addPass(new OutputPass());
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.ground = new THREE.Plane(UP, 0);
    this.scratchPosition = new THREE.Vector3();
    const canvas = this.renderer.domElement;
    const listen = (target, name, handler) => target.addEventListener(name, handler, { signal: this.events.signal });
    listen(canvas, "pointerdown", (e) => {
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
      this.hoverPointer = { clientX: e.clientX, clientY: e.clientY }; this.hoverDirty = true;
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
      const pmrem = new THREE.PMREMGenerator(this.renderer),
        environment = new RoomEnvironment();
      this.environment = pmrem.fromScene(environment, 0.04);
      this.scene.environment = this.environment.texture;
      environment.dispose();
      pmrem.dispose();
      this.renderer.shadowMap.needsUpdate = true;
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
      const cast = this.effects.event(detail, this.reduced) && detail.phase === "cast";
      if ((detail.kind === "weapon" || detail.phase === "cast") && detail.to && detail.from &&
        (detail.to.x !== detail.from.x || detail.to.y !== detail.from.y))
        this.player.rotation.y = Math.atan2(detail.to.x - detail.from.x, detail.to.y - detail.from.y) + Math.PI;
      if (detail.kind === "weapon" || cast) {
        const visibleTarget = !!detail.to && this.state.tiles.some((tile) => tile.x === detail.to.x && tile.y === detail.to.y && tile.monster);
        this.heroAnimation.start(detail, performance.now(), this.reduced, visibleTarget);
      }
      this.invalidate();
    });
    this.controls.addEventListener("change", () => { this.hoverDirty = true; this.invalidate(); });
    this.controls.addEventListener("start", () => this.invalidate());
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
        contextLost: this.lost,
        frameMs: this.frameMs || 0,
        renderedFrames: this.renderedFrames,
        frameLimit: 60,
        effectiveQuality: ["low", "balanced", "high"][this.effectiveTier],
        pixelRatio: this.renderer.getPixelRatio(),
        activeFrameP95: percentile(this.frameSamples),
        renderP95: percentile(this.renderSamples),
        inputLatencyP95: percentile(this.inputSamples),
        updateP95: percentile(this.updateSamples),
        terrainRebuilds: this.grid.rebuilds,
        staticChunks: this.staticTiles.chunks.size,
        routePoints: this.routePointCount,
        routeVisible: false,
        heroPosition: this.player.position.toArray(),
        heroScreen: this.project(this.player.position),
        viewport: this.viewportRect,
        ...window.ularnPersistence?.metrics(),
        idle: performance.now() > this.activeUntil,
        suspended: document.hidden || this.paused || this.lost,
        cameraElevation: Math.atan2(this.camera.position.y - this.controls.target.y,
          Math.hypot(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z)) * 180 / Math.PI,
        shadowUpdates: this.shadowUpdates || 0,
        shadowTexelSize: (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / this.sun.shadow.mapSize.x,
        torchReassignments: this.lighting.reassignments,
        antialiasing: this.effectiveTier === 2 ? "SMAA" : "MSAA",
        monsterActors: this.monsters.size,
        ...creatureMetrics(),
        ...this.effects.metrics(),
        ...this.heroAnimation.metrics(),
      }),
      creatures: () => [...this.monsters.values()].map(({ mesh, species }) => ({
        uid: mesh.userData.uid, species, tile: { ...mesh.userData.tile },
        facing: { ...mesh.userData.facing }, model: mesh.userData.model, family: mesh.userData.family,
        position: mesh.position.toArray(),
      })),
      projectTile: (x, y, height = 0) => this.project(new THREE.Vector3(x, height, y)),
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
  stopFrames() {
    clearTimeout(this.frameTimer);
    cancelAnimationFrame(this.frameRequest);
    this.frameTimer = this.frameRequest = null;
  }
  scheduleFrame() {
    if (this.disposed || document.hidden || this.lost || this.frameTimer != null || this.frameRequest != null) return;
    const idle = performance.now() > this.activeUntil;
    if (idle && !this.hasMotion && !this.effects.slots.some((slot) => slot.active) &&
      (this.quality !== "cinematic" || this.reduced || this.paused) && this.state) return;
    this.frameRequest = requestAnimationFrame((now) => {
      this.frameRequest = null;
      const fps = this.paused ? 4 : !this.state || idle ? 12 : 60;
      const interval = 1000 / fps;
      if (now + .5 < (this.nextFrameTime || 0)) { this.scheduleFrame(); return; }
      this.nextFrameTime = now + interval - Math.max(0, now - (this.nextFrameTime || now)) % interval;
      this.animate();
    });
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
    const geometries = new Set([this.floorGeometry, this.wallGeometry]),
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
    this.sun.shadow.dispose();
    this.composer.passes.forEach((pass) => pass.dispose());
    this.composer.dispose();
    this.environment?.dispose();
    this.environment = null;
    this.scene.environment = null;
  }
  setQuality(value, persist = true) {
    this.quality = ["auto", "cinematic", "balanced"].includes(value)
      ? value
      : "auto";
    this.autoTier = 1; this.qualityChangedAt = performance.now(); this.frameSamples.length = 0;
    this.overBudgetMs = this.headroomMs = 0;
    if (persist)
      try {
        localStorage.setItem("ularn3d.quality", this.quality);
      } catch {}
    this.applyQuality();
  }
  applyQuality() {
    this.effectiveTier = this.quality === "auto" ? this.autoTier : this.quality === "cinematic" ? 2 : 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality === "cinematic" ? 1.75 : [.75, 1.25, 1.5][this.effectiveTier]));
    this.bloom.enabled = this.ao.enabled = this.antialias.enabled = this.effectiveTier === 2;
    const shadow = [512, 1024, 2048][this.effectiveTier];
    if (this.sun.shadow.mapSize.x !== shadow) {
      this.sun.shadow.mapSize.set(shadow, shadow);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.torchLights.forEach((light, i) => { light.visible = i < [2, 4, 6][this.effectiveTier]; });
    if (this.playerTarget) this.lighting.assign(this.lamps, this.playerTarget, [2, 4, 6][this.effectiveTier]);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
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
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.ao.setSize(Math.round(innerWidth * this.renderer.getPixelRatio() / 2), Math.round(innerHeight * this.renderer.getPixelRatio() / 2));
    this.bloom.setSize(Math.round(innerWidth * this.renderer.getPixelRatio() / 2), Math.round(innerHeight * this.renderer.getPixelRatio() / 2));
    if (this.viewportRect) this.setViewportRect(this.viewportRect);
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
    batch(this.terrain);
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
      y: 8,
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
  update(state) {
    const updateStarted = performance.now();
    const old = this.state;
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
      this.heroAnimation.clear();
      this.lighting.clear();
      Object.assign(this.sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
      this.sun.shadow.camera.updateProjectionMatrix();
      this.renderer.shadowMap.needsUpdate = true;
      this.lamps = [];
      this.level = state.level;
      this.lastPlayer = null;
      this.walkPhase = 0; this.walkStartedAt = undefined;
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
      this.water.visible = town;
      this.paths = this.townPaths(state.tiles);
      if (!town)
        box(
          this.terrain,
          volcano ? 0x22191a : 0x101d24,
          (state.width - 1) / 2,
          -0.4,
          (state.height - 1) / 2,
          state.width,
          0.45,
          state.height,
        );
      else {
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
        for (let i = 0; i < 180; i++) {
          const x = noise(i, 63) * (state.width + 6) - 3,
            z =
              i % 2
                ? -1.7 - noise(i, 61) * 5
                : state.height + 0.6 + noise(i, 62) * 5;
          const t = tree(0.55 + noise(i, 69));
          t.position.set(x, -0.1, z);
          this.terrain.add(t);
        }
        for (let i = 0; i < 90; i++) {
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
        batch(this.terrain);
      }
    }
    if (this.character !== state.character) {
      this.scene.remove(this.player);
      destroy(this.player);
      this.player = hero(state.character);
      this.heroAnimation.bind(this.player);
      this.character = state.character;
      this.scene.add(this.player);
    }
    const previousWeapon = this.heroAnimation.weapon.userData.weaponModel;
    equipHero(this.player, state.weapon);
    if (state.over || previousWeapon !== this.heroAnimation.weapon.userData.weaponModel) this.heroAnimation.clear();
    const geometrySignature = state.tiles.map((t) => `${t.x},${t.y}:${t.id}:${t.wall}:${t.stair?.blocked}`).join("|");
    const geometryChanged = this.tileGeometrySignature !== geometrySignature;
    if (geometryChanged) {
    this.tileGeometrySignature = geometrySignature;
    this.grid.update(state, this.paths);
    const ids = new Set();
    this.wallCells = []; this.lamps = [];
    for (const t of state.tiles) {
      const key = `${t.x},${t.y}`;
      ids.add(key);
      const sig = `${t.id}${t.stair?.blocked ? ":blocked" : ""}`;
      const prev = this.objects.get(key);
      if (t.wall) this.wallCells.push(t);
      if (t.store && t.id !== 55)
        this.lamps.push(new THREE.Vector3(t.x - 0.2, 1.25, t.y + 0.75));
      if (t.id === 55) this.lamps.push(new THREE.Vector3(t.x, 0.5, t.y));
      if (t.wall && noise(t.x, t.y) > 0.87)
        this.lamps.push(new THREE.Vector3(t.x, 1.45, t.y));
      if (prev?.sig === sig) continue;
      if (prev) {
        this.staticTiles.remove(key, t);
        this.props.remove(prev.mesh);
        destroy(prev.mesh);
      }
      const g = new THREE.Group();
      g.position.set(t.x, 0, t.y);
      g.userData.tile = { x: t.x, y: t.y };
      if (t.wall) {
        if (noise(t.x, t.y) > 0.87) torch(g, 0, 1.05, 0, 0.65);
      } else if (t.id === 0 && noise(t.x + 31, t.y) > .88) {
        const grass = state.level === 0 && !this.paths.has(key);
        if (grass) {
          for (let i = 0; i < 4; i++) {
            const blade = cone(g, i % 2 ? 0x63835e : 0x91a36b, -.32 + i * .06, .07, .28, .025, .18 + noise(t.x, i) * .08, 3);
            blade.rotation.z = (i - 1.5) * .15;
          }
        } else {
          const pebble = orb(g, state.level > 15 ? 0x79665b : 0x7d8980, .35, .035, .3, .06);
          pebble.scale.y *= .45;
          if (state.level > 15) box(g, 0xb3835e, .35, .02, .26, .16, .015, .024, { emissive: 0x934f2d, emissiveIntensity: .4 });
        }
      } else if (t.id !== 0) {
        const model = itemModel({ ...t, draining: t.id === 17 && prev?.sig === "7" && !this.reduced });
        g.add(model);
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
        if (t.store) {
          g.userData.landmarkLabel = t.id === 56 ? "SURFACE SHAFT" : LANDMARK_NAMES[t.id] || "LANDMARK";
          const text = label(g.userData.landmarkLabel);
          text.position.y = t.id === 56 ? 1.2 : [10, 16].includes(t.id) ? 3.5 : 2.7;
          g.add(text);
        }
      }
      const dynamic = t.store || [7, 17, 5, 13, 56, 93].includes(t.id);
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
    for (const [key, object] of this.objects) if (!ids.has(key)) {
      this.staticTiles.remove(key, object.mesh.userData.tile);
      object.mesh.removeFromParent(); destroy(object.mesh); this.objects.delete(key);
    }
    this.staticTiles.flush();
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
        const mesh = creature(monster);
        mesh.position.set(tile.x, 0, tile.y);
        actor = { mesh, species: monster.id, target: new THREE.Vector3(tile.x, 0, tile.y), start: mesh.position.clone(), movedAt: performance.now() };
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
      faceCreature(actor.mesh, monster.facing);
    }
    for (const [uid, actor] of this.monsters) if (!creatures.has(uid)) {
      actor.mesh.removeFromParent();
      destroy(actor.mesh);
      this.monsters.delete(uid);
    }
    this.player.visible = true;
    const target = new THREE.Vector3(state.x, 0, state.y);
    if (!this.lastPlayer) {
      this.player.position.copy(target);
      this.controls.target.copy(target);
      this.camera.position
        .copy(target)
        .add(
          GAME_CAMERA,
        );
      this.moveStart = target.clone(); this.moveStartedAt = performance.now() - WALK_SETTLE_MS;
      this.controls.update();
    } else if (this.lastPlayer.x !== state.x || this.lastPlayer.y !== state.y) {
      this.moveStart = this.player.position.clone(); this.moveStartedAt = performance.now();
      if (Math.max(Math.abs(this.lastPlayer.x - state.x), Math.abs(this.lastPlayer.y - state.y)) > 1) {
        const delta = target.clone().sub(this.player.position);
        this.player.position.copy(target); this.controls.target.add(delta); this.camera.position.add(delta);
        this.moveStart.copy(target); this.moveStartedAt -= WALK_SETTLE_MS;
      }
      this.player.rotation.y =
        Math.atan2(state.x - this.lastPlayer.x, state.y - this.lastPlayer.y) +
        Math.PI;
      this.walkAge = 0;
      this.walkStartedAt = performance.now();
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
    this.playerTarget = target;
    this.lastPlayer = { x: state.x, y: state.y };
    this.playerLight.color.set(state.level > 15 ? 0xffa466 : 0xffce89);
    this.dust.position.set(state.x, 0, state.y);
    this.lighting.assign(this.lamps, target, [2, 4, 6][this.effectiveTier]);
    if (geometryChanged) this.wallView = null;
    this.updateWalls();
    if (geometryChanged || !old || old.x !== state.x || old.y !== state.y || old.tiles.some((tile) => tile.monster) || state.tiles.some((tile) => tile.monster))
      this.shadowDirty = true;
    if (!isNew) sample(this.updateSamples, performance.now() - updateStarted);
    this.invalidate();
  }
  updateWalls(dt = 0) {
    if (!this.state) return;
    const toward = this.camera.position
      .clone()
      .sub(this.controls.target)
      .setY(0)
      .normalize();
    const position = { x: this.player.position.x, y: this.player.position.z };
    if (this.grid.walls(position, toward, dt, this.reduced)) this.shadowDirty = true;
  }

  pick(e) {
    if (!this.state || !this.state.maze || this.state.over || this.lost)
      return null;
    this.mouse.set(
      (e.clientX / innerWidth) * 2 - 1,
      (-e.clientY / innerHeight) * 2 + 1,
    );
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObjects(
      [...this.actors.children, ...this.props.children.filter((group) => group.userData.tile), ...this.staticTiles.pickTargets(this.ray.ray), ...this.grid.pickMeshes()],
      true,
    );
    for (const hit of hits) {
      if (hit.object.isSprite) continue;
      if (hit.object.userData.wallCells) return hit.object.userData.wallCells[hit.instanceId] || null;
      let o = hit.object;
      while (o && !o.userData.tile) o = o.parent;
      if (o?.userData.tile) {
        const { x, y } = o.userData.tile;
        return this.tileIndex.get(y * this.state.width + x) || null;
      }
    }
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, p)) return null;
    const x = Math.round(p.x),
      y = Math.round(p.z);
    return this.tileIndex.get(y * this.state.width + x) || null;
  }
  rotate(direction) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(UP, (direction * Math.PI) / 4);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.updateWalls();
  }
  zoom(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.multiplyScalar(factor).clampLength(5, 46);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }
  reset() {
    if (this.state) {
      this.controls.target.copy(this.player.position);
      this.camera.position
        .copy(this.controls.target)
        .add(
          GAME_CAMERA,
        );
      this.controls.update();
      this.updateWalls();
    }
  }
  animate() {
    const now = performance.now(),
      elapsed = (now - this.lastTime) / 1000,
      dt = Math.min(0.1, elapsed);
    this.lastTime = now;
    if (document.hidden || this.lost) return;
    const active = this.state && !this.paused && now <= this.activeUntil;
    if (active && this.lastFrameActive && elapsed > .001) {
      sample(this.frameSamples, elapsed * 1000);
      this.frameMs = this.frameSamples.reduce((sum, value) => sum + value, 0) / this.frameSamples.length;
    }
    this.lastFrameActive = active;
    const frameStarted = performance.now();
    this.tick += dt;
    this.effects.update(dt);
    this.waterTime.value = this.reduced ? 0 : this.tick;
    if (this.playerTarget) {
      const eased = this.reduced ? 1 : walkProgress(now - (this.moveStartedAt || 0));
      this.scratchPosition.copy(this.player.position);
      this.player.position.lerpVectors(this.moveStart || this.playerTarget, this.playerTarget, eased);
      this.scratchPosition.sub(this.player.position).negate();
      this.walkPhase = ((this.walkPhase || 0) + this.scratchPosition.length() * Math.PI) % (Math.PI * 2);
      this.controls.target.add(this.scratchPosition);
      this.camera.position.add(this.scratchPosition);
      this.playerLight.position.copy(this.player.position); this.playerLight.position.y += 1.4;
      const body = this.player.getObjectByName("body");
      if (body && !this.reduced) {
        this.walkAge = this.walkStartedAt === undefined ? 1 : (now - this.walkStartedAt) / 1000;
        const walk = Math.max(0, 1 - this.walkAge / 0.28);
        body.position.y = Math.abs(Math.sin(this.walkPhase * 2)) * .018 * walk;
        for (const name of ["left-leg", "right-leg"]) {
          const limb = this.player.getObjectByName(name);
          if (limb)
            limb.rotation.x =
              Math.sin(this.walkPhase) *
              (name === "left-leg" ? 1 : -1) *
              .28 *
              walk;
        }
        if (!this.heroAnimation.active)
          this.heroAnimation.arm.rotation.x = .12 - Math.sin(this.walkPhase) * .05 * walk;
        const cape = this.player.getObjectByName("cape");
        if (cape) cape.rotation.x = -0.25 + Math.sin(this.tick * 2) * 0.035;
      }
      this.heroAnimation.update(now);
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
    this.renderer.info.reset();
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.hasMotion = this.heroAnimation.active || (!!this.playerTarget && this.player.position.distanceToSquared(this.playerTarget) > 0.0001);
    for (const { mesh, target, start, movedAt } of this.monsters.values()) {
      const progress = this.reduced ? 1 : Math.min(1, (now - movedAt) / 100);
      mesh.position.lerpVectors(start, target, progress * progress * (3 - 2 * progress));
      const walking = mesh.position.distanceToSquared(target) > .0001;
      if (walking) this.hasMotion = true;
      animateCreature(mesh, now, walking, this.reduced);
    }
    this.updateCutaways(dt);
    if (this.lighting.update(dt, this.tick, this.reduced)) this.hasMotion = true;
    if (this.hoverPointer && this.hoverDirty && !this.pointers.size) {
      const event = this.hoverPointer; this.hoverDirty = false;
      const tile = this.pick(event); this.marker.visible = !!tile;
      if (tile) this.marker.position.set(tile.x, 0, tile.y);
      this.onHover(tile, event);
    }
    for (const { mesh } of this.objects.values()) {
      const fountain = mesh.children.find((child) => child.userData.drainAge !== undefined);
      if (!fountain) continue;
      fountain.userData.drainAge = (now - fountain.userData.drainStartedAt) / 1000;
      const water = fountain.getObjectByName("fountain-water");
      if (water) {
        water.scale.y = Math.max(0, 1 - fountain.userData.drainAge / 0.7);
        water.visible = fountain.userData.drainAge < 0.7;
        if (water.visible) this.hasMotion = true;
      }
    }
    if (this.wallCells.length) this.updateWalls(dt);
    this.hasMotion ||= this.grid.animating;
    const shadowCamera = this.sun.shadow.camera, requiredSpan = this.camera.position.distanceTo(this.controls.target) * 1.3;
    let span = shadowCamera.right - shadowCamera.left;
    while (requiredSpan > span) span += 8;
    while (span > 24 && requiredSpan < span - 10) span -= 8;
    if (span !== shadowCamera.right - shadowCamera.left) {
      Object.assign(shadowCamera, { left: -span / 2, right: span / 2, top: span / 2, bottom: -span / 2 });
      shadowCamera.updateProjectionMatrix(); this.renderer.shadowMap.needsUpdate = true;
    }
    const shadowInterval = this.effectiveTier === 2 ? 1 / 60 : 1 / 30;
    if ((this.shadowDirty || this.hasMotion) && this.tick - (this.shadowTime || 0) >= shadowInterval - .001)
      this.renderer.shadowMap.needsUpdate = true;
    if (this.renderer.shadowMap.needsUpdate) {
      stabilizeShadow(this.sun, this.playerTarget ? this.player.position : this.controls.target);
      this.shadowTime = this.tick; this.shadowDirty = false; this.shadowUpdates = (this.shadowUpdates || 0) + 1;
    }
    if (this.effectiveTier === 2) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.renderedFrames++;
    if (active) {
      sample(this.renderSamples, performance.now() - frameStarted);
      if (this.lastInputAt != null) { sample(this.inputSamples, performance.now() - this.lastInputAt); this.lastInputAt = null; }
      this.adaptQuality(now, elapsed * 1000);
    }
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
    this.heroAnimation.dispose();
    this.staticTiles.clear(); this.grid.clear();
    this.objects.forEach(({ mesh }) => { if (!mesh.parent) destroy(mesh); });
    this.releaseLostResources(true);
    destroy(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
