import * as THREE from "three";
import { noise, surface } from "./materials.js";

const SIZE = 8, matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
export class TerrainGrid {
  constructor(scene, floorGeometry, wallGeometry) {
    this.scene = scene; this.floorGeometry = floorGeometry; this.wallGeometry = wallGeometry;
    this.chunks = new Map(); this.rebuilds = 0;
  }
  update(state, paths) {
    const chunks = new Map();
    for (const tile of state.tiles) {
      const id = `${Math.floor(tile.x / SIZE)},${Math.floor(tile.y / SIZE)}`;
      if (!chunks.has(id)) chunks.set(id, []);
      chunks.get(id).push(tile);
    }
    for (const [id, tiles] of chunks) {
      const signature = `${state.level}|` + tiles.map((tile) => `${tile.x},${tile.y}:${tile.wall ? 1 : 0}:${paths.has(`${tile.x},${tile.y}`) ? 1 : 0}`).join("|");
      let chunk = this.chunks.get(id);
      if (chunk?.signature === signature) continue;
      if (!chunk) {
        const make = (geometry, material, shadow = false) => {
          const mesh = new THREE.InstancedMesh(geometry, material, SIZE * SIZE);
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0;
          mesh.castShadow = shadow; mesh.receiveShadow = true; this.scene.add(mesh); return mesh;
        };
        chunk = { floor: make(this.floorGeometry, surface("stone", 0xffffff)),
          grass: make(this.floorGeometry, surface("grass", 0xffffff)),
          walls: make(this.wallGeometry, surface("stone", 0x99aba7), true),
          caps: make(this.wallGeometry, surface("stone", 0xb2bbad), true) };
        this.chunks.set(id, chunk);
      }
      const previous = new Map((chunk.wallCells || []).map((tile, i) => [`${tile.x},${tile.y}`, [chunk.heights?.[i], chunk.targets?.[i]]]));
      chunk.signature = signature; chunk.wallView = null;
      chunk.wallCells = tiles.filter((tile) => tile.wall);
      chunk.heights = new Float32Array(chunk.wallCells.map((tile) => previous.get(`${tile.x},${tile.y}`)?.[0] ?? NaN));
      chunk.targets = new Float32Array(chunk.wallCells.map((tile) => previous.get(`${tile.x},${tile.y}`)?.[1] ?? 1.15));
      chunk.dirtyWalls = true;
      chunk.floor.material = surface(state.level > 15 ? "volcanic" : "stone", 0xffffff);
      chunk.walls.material = surface(state.level > 15 ? "volcanic" : "stone", state.level > 15 ? 0x957c6b : 0x99aba7);
      chunk.caps.material = surface(state.level > 15 ? "volcanic" : "stone", state.level > 15 ? 0xa48b77 : 0xb2bbad);
      let stone = 0, grass = 0;
      for (const tile of tiles) {
        const grassy = state.level === 0 && !paths.has(`${tile.x},${tile.y}`);
        const mesh = grassy ? chunk.grass : chunk.floor, index = grassy ? grass++ : stone++;
        const color = new THREE.Color(grassy ? 0xa0af80 : state.level === 0 ? 0xb6b49c : state.level > 15 ? 0xb39382 : 0xb1c0ba);
        color.multiplyScalar(.82 + noise(tile.x, tile.y) * .23);
        matrix.makeTranslation(tile.x, -.105, tile.y);
        mesh.setMatrixAt(index, matrix); mesh.setColorAt(index, color);
      }
      chunk.floor.count = stone; chunk.grass.count = grass;
      chunk.walls.count = chunk.caps.count = chunk.wallCells.length;
      chunk.walls.userData.wallCells = chunk.caps.userData.wallCells = chunk.wallCells;
      for (const mesh of [chunk.floor, chunk.grass]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      this.rebuilds++;
    }
    for (const [id, chunk] of this.chunks) if (!chunks.has(id)) { this.remove(chunk); this.chunks.delete(id); }
  }
  walls(player, toward, dt = 0, reduced = false) {
    const key = `${Math.round(player.x * 40)}:${Math.round(player.y * 40)}:${Math.round(toward.x * 50)}:${Math.round(toward.z * 50)}`;
    let changed = false;
    this.animating = false;
    for (const chunk of this.chunks.values()) {
      if (chunk.wallView === key && !chunk.animating && !chunk.dirtyWalls) continue;
      // Distant chunks never participate in the hero's cutaway.
      const nearby = chunk.wallCells.some((tile) => Math.abs(tile.x - player.x) < 4 && Math.abs(tile.y - player.y) < 4);
      if (chunk.wallView !== null && !nearby && !chunk.cutaway && !chunk.animating && !chunk.dirtyWalls) { chunk.wallView = key; continue; }
      chunk.wallView = key; chunk.cutaway = nearby;
      let dirty = chunk.dirtyWalls;
      chunk.animating = false;
      for (let i = 0; i < chunk.wallCells.length; i++) {
        const tile = chunk.wallCells[i], dx = tile.x - player.x, dz = tile.y - player.y;
        const wasCut = chunk.targets[i] < 1;
        const cut = Math.hypot(dx, dz) < (wasCut ? 3 : 2.8) && dx * toward.x + dz * toward.z > (wasCut ? .1 : .2);
        const target = cut ? .36 : 1.15, previous = chunk.heights[i];
        chunk.targets[i] = target;
        let height = Number.isFinite(previous) && !reduced ? previous + (target - previous) * (1 - Math.exp(-dt * 18)) : target;
        if (Math.abs(target - height) < .002) height = target;
        else chunk.animating = true;
        if (!Number.isFinite(previous) || Math.abs(height - previous) > .0001) dirty = true;
        chunk.heights[i] = height;
        position.set(tile.x, height / 2 - .01, tile.y); scale.set(.985, height, .985);
        matrix.compose(position, rotation, scale); chunk.walls.setMatrixAt(i, matrix);
        // Neighboring caps must never overlap on the same horizontal plane.
        position.y = height + .025; scale.set(.982, .08, .982);
        matrix.compose(position, rotation, scale); chunk.caps.setMatrixAt(i, matrix);
      }
      this.animating ||= chunk.animating;
      if (dirty) {
        for (const mesh of [chunk.walls, chunk.caps]) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }
        changed = true;
      }
      chunk.dirtyWalls = false;
    }
    return changed;
  }
  pickMeshes() { return [...this.chunks.values()].flatMap((chunk) => [chunk.walls, chunk.caps]); }
  remove(chunk) { for (const mesh of [chunk.floor, chunk.grass, chunk.walls, chunk.caps]) { mesh.removeFromParent(); mesh.dispose(); } }
  clear() { this.chunks.forEach((chunk) => this.remove(chunk)); this.chunks.clear(); }
}
