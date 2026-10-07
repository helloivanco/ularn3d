import * as THREE from "three";
import { compact, disposeGeometry } from "./graphics-utils.js";

// Source groups retain tile identity for picking. Only their merged chunks draw.
export class StaticTiles {
  constructor(parent) {
    this.parent = parent; this.chunks = new Map(); this.dirty = new Set();
  }
  chunkKey(tile) { return `${Math.floor(tile.x / 8)},${Math.floor(tile.y / 8)}`; }
  set(key, group) {
    const id = this.chunkKey(group.userData.tile);
    if (!this.chunks.has(id)) this.chunks.set(id, { sources: new Map(), mesh: null, bounds: new THREE.Box3() });
    this.chunks.get(id).sources.set(key, group); this.dirty.add(id);
  }
  remove(key, tile) {
    const id = this.chunkKey(tile), chunk = this.chunks.get(id);
    if (chunk?.sources.delete(key)) this.dirty.add(id);
  }
  flush() {
    for (const id of this.dirty) {
      const chunk = this.chunks.get(id);
      if (chunk.mesh) { chunk.mesh.removeFromParent(); disposeGeometry(chunk.mesh); }
      if (!chunk.sources.size) { this.chunks.delete(id); continue; }
      const group = new THREE.Group();
      chunk.sources.forEach((source) => group.add(source.clone(true)));
      compact(group);
      group.updateMatrixWorld(true);
      chunk.bounds.setFromObject(group);
      chunk.mesh = group; this.parent.add(group);
    }
    this.dirty.clear();
  }
  pickTargets(ray) {
    const targets = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.bounds.isEmpty() || !ray.intersectsBox(chunk.bounds)) continue;
      for (const source of chunk.sources.values()) { source.updateMatrixWorld(true); targets.push(source); }
    }
    return targets;
  }
  clear() {
    for (const chunk of this.chunks.values()) if (chunk.mesh) {
      chunk.mesh.removeFromParent(); disposeGeometry(chunk.mesh);
    }
    this.chunks.clear(); this.dirty.clear();
  }
}
