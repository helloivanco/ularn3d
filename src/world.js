import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mat, surface, noise } from "./materials.js";
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
  torch,
  LANDMARK_NAMES,
} from "./models.js";

const UP = new THREE.Vector3(0, 1, 0);
const FLOOR_LIMIT = 67 * 17;
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
function batch(group) {
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
    m.castShadow = true;
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
    this.tick = 0;
    this.lastPlayer = null;
    this.pointers = new Map();
    this.gesture = false;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.lost = false;
    this.wallCells = [];
    this.lamps = [];
    this.lastTime = performance.now();
    this.quality = innerWidth < 700 ? "balanced" : "cinematic";
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
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
    this.scene.add(this.terrain, this.props);
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
    const wallGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.035);
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
    this.scene.add(this.player);
    this.playerLight = new THREE.PointLight(0xffc172, 6, 8, 2);
    this.scene.add(this.playerLight);
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
    this.identityQ = new THREE.Quaternion();
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => {
      this.pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        time: performance.now(),
        moved: e.button !== 0,
      });
      if (this.pointers.size > 1) this.gesture = true;
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) p.moved = true;
      const tile = this.pick(e);
      this.marker.visible = !!tile;
      if (tile) this.marker.position.set(tile.x, 0, tile.y);
      this.onHover(tile, e);
    });
    canvas.addEventListener("pointerup", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p && !p.moved && !this.gesture && performance.now() - p.time < 700) {
        const t = this.pick(e);
        if (t) this.onTile(t);
      }
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) this.gesture = false;
    });
    canvas.addEventListener("pointercancel", (e) => {
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) this.gesture = false;
    });
    canvas.addEventListener("pointerleave", () => {
      this.marker.visible = false;
      this.onHover(null);
    });
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      window.dispatchEvent(new Event("ularn:graphics-lost"));
    });
    canvas.addEventListener("webglcontextrestored", () => {
      const pmrem = new THREE.PMREMGenerator(this.renderer),
        environment = new RoomEnvironment();
      this.environment.dispose();
      this.environment = pmrem.fromScene(environment, 0.04);
      this.scene.environment = this.environment.texture;
      environment.dispose();
      pmrem.dispose();
      this.renderer.shadowMap.needsUpdate = true;
      this.lost = false;
      this.resize();
      window.dispatchEvent(new Event("ularn:graphics-restored"));
    });
    window.addEventListener("resize", () => this.resize());
    this.setQuality(this.quality, false);
    this.preview();
    requestAnimationFrame(() => this.animate());
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
      }),
    });
  }
  setQuality(value, persist = true) {
    this.quality = ["cinematic", "balanced"].includes(value)
      ? value
      : "balanced";
    const cinematic = this.quality === "cinematic";
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, cinematic ? 1.75 : 1.25),
    );
    this.bloom.enabled = cinematic;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
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
    const old = this.state;
    this.state = state;
    this.controls.autoRotate = false;
    const isNew = this.level !== state.level;
    if (isNew) {
      destroy(this.terrain);
      destroy(this.props);
      this.objects.clear();
      this.lamps = [];
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
      this.floor.material = surface("stone", volcano ? 0xa77b62 : 0xc0c8c3);
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
      this.character = state.character;
      this.scene.add(this.player);
    }
    const ids = new Set(),
      matrix = new THREE.Matrix4();
    let floorIndex = 0,
      grassIndex = 0;
    this.wallCells = [];
    this.lamps = [];
    for (const t of state.tiles) {
      const key = `${t.x},${t.y}`;
      ids.add(key);
      const sig = `${t.id}|${t.monster?.id || 0}`;
      const prev = this.objects.get(key);
      const grass = state.level === 0 && !this.paths.has(key);
      const color = new THREE.Color(
        grass
          ? 0xa0af80
          : state.level === 0
            ? 0xb6b49c
            : state.level > 15
              ? 0xc29b81
              : 0xb1c0ba,
      ).multiplyScalar(0.82 + noise(t.x, t.y) * 0.23);
      matrix.makeTranslation(t.x, -0.105, t.y);
      const floor = grass ? this.grassFloor : this.floor,
        index = grass ? grassIndex++ : floorIndex++;
      floor.setMatrixAt(index, matrix);
      floor.setColorAt(index, color);
      if (t.wall) this.wallCells.push(t);
      if (t.store && t.id !== 55)
        this.lamps.push(new THREE.Vector3(t.x - 0.2, 1.25, t.y + 0.75));
      if (t.id === 55) this.lamps.push(new THREE.Vector3(t.x, 0.5, t.y));
      if (t.wall && noise(t.x, t.y) > 0.87)
        this.lamps.push(new THREE.Vector3(t.x, 1.45, t.y));
      if (prev?.sig === sig) continue;
      if (prev) {
        this.props.remove(prev.mesh);
        destroy(prev.mesh);
      }
      const g = new THREE.Group();
      g.position.set(t.x, 0, t.y);
      g.userData.tile = { x: t.x, y: t.y };
      if (t.wall) {
        if (noise(t.x, t.y) > 0.87) torch(g, 0, 1.05, 0, 0.65);
      } else if (t.id !== 0) {
        g.add(itemModel(t));
        if (t.store) {
          g.position.set(0, 0, 0);
          batch(g);
          g.position.set(t.x, 0, t.y);
        }
        if (t.store) {
          const text = label(LANDMARK_NAMES[t.id] || "LANDMARK");
          text.position.y = [10, 16].includes(t.id) ? 3.5 : 2.7;
          g.add(text);
        }
      }
      if (t.monster) {
        const monster = monsterModel(t.monster);
        g.add(monster);
        g.userData.creature = monster;
      }
      this.props.add(g);
      this.objects.set(key, { sig, mesh: g });
    }
    for (const [m, count] of [
      [this.floor, floorIndex],
      [this.grassFloor, grassIndex],
    ]) {
      m.count = count;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
    for (const [key, o] of this.objects)
      if (!ids.has(key)) {
        this.props.remove(o.mesh);
        destroy(o.mesh);
        this.objects.delete(key);
      }
    this.walls.count = this.caps.count = this.wallCells.length;
    this.player.visible = true;
    const target = new THREE.Vector3(state.x, 0, state.y);
    if (!this.lastPlayer) {
      this.player.position.copy(target);
      this.controls.target.copy(target);
      this.camera.position
        .copy(target)
        .add(
          state.level === 0
            ? new THREE.Vector3(8, 11, 13)
            : new THREE.Vector3(4.5, 7, 8),
        );
    } else if (this.lastPlayer.x !== state.x || this.lastPlayer.y !== state.y) {
      this.player.rotation.y =
        Math.atan2(state.x - this.lastPlayer.x, state.y - this.lastPlayer.y) +
        Math.PI;
      this.walkAge = 0;
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
      )
        this.attackAge = 0;
    }
    if (
      old &&
      old.level === state.level &&
      (state.hp < old.hp || state.mana < old.mana)
    ) {
      this.burstAge = 0;
      this.burst.visible = !this.reduced;
      this.burst.position.copy(target);
      this.burst.children.forEach((p) => p.position.set(0, 0.5, 0));
    }
    this.playerTarget = target;
    this.lastPlayer = { x: state.x, y: state.y };
    this.playerLight.color.set(state.level > 15 ? 0xffa466 : 0xffce89);
    this.sun.position.set(state.x - 12, 24, state.y + 8);
    this.sun.target.position.copy(target);
    this.dust.position.set(state.x, 0, state.y);
    this.lamps.sort(
      (a, b) => a.distanceToSquared(target) - b.distanceToSquared(target),
    );
    for (let i = 0; i < this.torchLights.length; i++) {
      const lamp = this.lamps[i],
        light = this.torchLights[i];
      light.intensity = lamp ? 5 : 0;
      if (lamp) light.position.copy(lamp);
    }
    this.wallView = null;
    this.updateWalls();
    this.renderer.shadowMap.needsUpdate = true;
  }
  updateWalls() {
    if (!this.state) return;
    const toward = this.camera.position
      .clone()
      .sub(this.controls.target)
      .setY(0)
      .normalize();
    const viewKey = [
      this.state.x,
      this.state.y,
      Math.round(toward.x * 50),
      Math.round(toward.z * 50),
    ].join(":");
    if (this.wallView === viewKey) return;
    this.wallView = viewKey;
    this.renderer.shadowMap.needsUpdate = true;
    for (let i = 0; i < this.wallCells.length; i++) {
      const t = this.wallCells[i],
        dx = t.x - this.state.x,
        dz = t.y - this.state.y;
      const cut =
        Math.hypot(dx, dz) < 2.8 && dx * toward.x + dz * toward.z > 0.2;
      const h = cut ? 0.36 : 1.15;
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
    for (const mesh of [this.walls, this.caps]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
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
      [...this.props.children, this.walls, this.caps],
      true,
    );
    for (const hit of hits) {
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
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, p)) return null;
    const x = Math.round(p.x),
      y = Math.round(p.z);
    return this.state.tiles.find((t) => t.x === x && t.y === y) || null;
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
      this.controls.target.set(this.state.x, 0, this.state.y);
      this.camera.position
        .copy(this.controls.target)
        .add(
          this.state.level === 0
            ? new THREE.Vector3(8, 11, 13)
            : new THREE.Vector3(4.5, 7, 8),
        );
      this.controls.update();
      this.updateWalls();
    }
  }
  animate() {
    requestAnimationFrame(() => this.animate());
    const now = performance.now(),
      elapsed = (now - this.lastTime) / 1000,
      dt = Math.min(0.05, elapsed);
    this.lastTime = now;
    if (document.hidden || this.lost) return;
    this.frameMs =
      (this.frameMs || elapsed * 1000) * 0.94 + elapsed * 1000 * 0.06;
    this.tick += dt;
    this.waterTime.value = this.reduced ? 0 : this.tick;
    if (this.playerTarget) {
      const alpha = this.reduced ? 1 : 1 - Math.exp(-dt * 11),
        d = this.playerTarget
          .clone()
          .sub(this.controls.target)
          .multiplyScalar(alpha);
      this.controls.target.add(d);
      this.camera.position.add(d);
      this.player.position.lerp(this.playerTarget, alpha);
      this.playerLight.position
        .copy(this.player.position)
        .add(new THREE.Vector3(0, 1.4, 0.2));
      const body = this.player.getObjectByName("body");
      if (body && !this.reduced) {
        this.walkAge = (this.walkAge ?? 1) + dt;
        this.attackAge = (this.attackAge ?? 1) + dt;
        const walk = Math.max(0, 1 - this.walkAge / 0.28);
        body.position.y = Math.abs(Math.sin(this.walkAge * 26)) * 0.045 * walk;
        for (const name of ["left-leg", "right-leg"]) {
          const limb = this.player.getObjectByName(name);
          if (limb)
            limb.rotation.x =
              Math.sin(this.walkAge * 26) *
              (name === "left-leg" ? 1 : -1) *
              0.45 *
              walk;
        }
        const weapon = this.player.getObjectByName("weapon");
        if (weapon)
          weapon.rotation.x =
            this.attackAge < 0.3
              ? -Math.sin((this.attackAge / 0.3) * Math.PI) * 1.4
              : 0;
        const cape = this.player.getObjectByName("cape");
        if (cape) cape.rotation.x = -0.25 + Math.sin(this.tick * 2) * 0.035;
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
      this.burstAge += dt;
      for (const p of this.burst.children) {
        p.position.addScaledVector(p.userData.velocity, dt);
        p.position.y -= this.burstAge * dt * 2;
        p.scale.setScalar(Math.max(0, 1 - this.burstAge / 0.55) * 0.035);
      }
      if (this.burstAge > 0.55) this.burst.visible = false;
    }
    if (
      this.playerTarget &&
      this.player.position.distanceToSquared(this.playerTarget) > 0.0001 &&
      this.tick - (this.shadowTime || 0) > 0.08
    ) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowTime = this.tick;
    }
    this.renderer.info.reset();
    this.controls.update();
    if (this.wallCells.length) this.updateWalls();
    if (this.quality === "cinematic") this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
