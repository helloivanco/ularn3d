#!/usr/bin/env node
/**
 * Trims the KayKit character and dungeon packs (CC0, Kay Lousberg,
 * www.kaylousberg.com) into the small glTF binaries under public/models/.
 *
 *   node scripts/build-models.mjs <kaykit-dir>
 *
 * <kaykit-dir> holds the untouched downloads, laid out as:
 *   adventurers/{Barbarian,Knight,Mage,Rogue,Rogue_Hooded}.glb
 *     github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
 *     @672074b73ba276876a19e8816ecdc5241817ab47 addons/.../Characters/gltf/
 *   skeletons/Skeleton_{Warrior,Mage,Rogue,Minion}.glb
 *     github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0
 *     @15b62b9bad122f72926c10fb14d622c73819fa54 addons/.../Characters/gltf/
 *   dungeon/<prop>.gltf.glb or <prop>.glb, for each prop in src/set-dressing.js
 *     github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0
 *     @b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07 addons/.../Assets/gltf/
 *
 * Every character shares one rig, so the clips ship once in rig-clips.glb and
 * the bodies ship without animation. Pack weapons and shields are dropped: the
 * game keeps its own wielded weapons. No dependencies: GLB is a JSON chunk and
 * one binary chunk, and pruning only renumbers accessors and buffer views.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROPS } from "../src/set-dressing.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public/models");

// Clips the hero and creatures play. Names are KayKit's.
export const CLIPS = [
  "Idle", "Walking_A", "Running_A", "1H_Melee_Attack_Chop", "1H_Melee_Attack_Stab",
  "2H_Melee_Attack_Chop", "Unarmed_Melee_Attack_Punch_A", "Spellcast_Shoot", "Hit_A", "Death_A",
];
const CHARACTERS = {
  adventurers: ["Barbarian", "Knight", "Mage", "Rogue", "Rogue_Hooded"],
  skeletons: ["Skeleton_Warrior", "Skeleton_Mage", "Skeleton_Rogue", "Skeleton_Minion"],
};
// Held props in the character files. Hats, helmets, hoods and capes stay.
const HELD = /(sword|axe|shield|crossbow|knife|throwable|spellbook|wand|staff|mug|blade|quiver|arrow)/i;

export function readGlb(buffer) {
  if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("not a GLB");
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
  const binStart = 20 + jsonLength;
  const bin = binStart < buffer.length ? buffer.subarray(binStart + 8, binStart + 8 + buffer.readUInt32LE(binStart)) : Buffer.alloc(0);
  return { json, bin };
}

export function writeGlb(json, bin) {
  const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const text = pad(Buffer.from(JSON.stringify(json)), 0x20), data = pad(bin, 0);
  const header = Buffer.alloc(12), jsonHead = Buffer.alloc(8), binHead = Buffer.alloc(8);
  header.write("glTF", 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + (data.length ? 8 + data.length : 0), 8);
  jsonHead.writeUInt32LE(text.length, 0); jsonHead.write("JSON", 4);
  binHead.writeUInt32LE(data.length, 0); binHead.write("BIN\0", 4);
  return Buffer.concat(data.length ? [header, jsonHead, text, binHead, data] : [header, jsonHead, text]);
}

/** Drop animations and mesh nodes, then keep only the data still referenced. */
export function trim({ json, bin }, { clips = [], keepMesh = () => true } = {}) {
  json = structuredClone(json);
  json.animations = (json.animations || []).filter((clip) => clips.includes(clip.name));
  for (const node of json.nodes) {
    if (node.mesh != null && !keepMesh(node.name)) { delete node.mesh; delete node.skin; }
  }
  const meshMap = new Map(), meshes = [];
  for (const node of json.nodes) {
    if (node.mesh == null) continue;
    if (!meshMap.has(node.mesh)) { meshMap.set(node.mesh, meshes.length); meshes.push(json.meshes[node.mesh]); }
    node.mesh = meshMap.get(node.mesh);
  }
  json.meshes = meshes;
  if (!meshes.length) {
    for (const node of json.nodes) delete node.skin;
    for (const key of ["meshes", "skins", "materials", "textures", "images", "samplers"]) delete json[key];
  }
  const accessorMap = new Map(), accessors = [];
  const use = (index) => {
    if (index == null) return index;
    if (!accessorMap.has(index)) { accessorMap.set(index, accessors.length); accessors.push(json.accessors[index]); }
    return accessorMap.get(index);
  };
  for (const mesh of json.meshes || []) for (const primitive of mesh.primitives) {
    for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = use(primitive.attributes[key]);
    if (primitive.indices != null) primitive.indices = use(primitive.indices);
    for (const target of primitive.targets || []) for (const key of Object.keys(target)) target[key] = use(target[key]);
  }
  for (const skin of json.skins || []) if (skin.inverseBindMatrices != null) skin.inverseBindMatrices = use(skin.inverseBindMatrices);
  for (const clip of json.animations) for (const sampler of clip.samplers) {
    sampler.input = use(sampler.input); sampler.output = use(sampler.output);
  }
  json.accessors = accessors;
  if (!json.animations.length) delete json.animations;
  const viewMap = new Map(), views = [], chunks = [];
  let offset = 0;
  const keepView = (index) => {
    if (!viewMap.has(index)) {
      const view = { ...json.bufferViews[index] };
      const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      const gap = (8 - (offset % 8)) % 8;
      if (gap) chunks.push(Buffer.alloc(gap));
      offset += gap; view.byteOffset = offset; view.buffer = 0;
      chunks.push(bytes); offset += bytes.length;
      viewMap.set(index, views.length); views.push(view);
    }
    return viewMap.get(index);
  };
  for (const accessor of accessors) if (accessor.bufferView != null) accessor.bufferView = keepView(accessor.bufferView);
  for (const image of json.images || []) if (image.bufferView != null) image.bufferView = keepView(image.bufferView);
  json.bufferViews = views;
  const out = Buffer.concat(chunks);
  json.buffers = [{ byteLength: out.length }];
  return { json, bin: out };
}

function build(source) {
  const sizes = [];
  const save = (path, glb) => {
    mkdirSync(dirname(path), { recursive: true });
    const bytes = writeGlb(glb.json, glb.bin);
    writeFileSync(path, bytes);
    sizes.push(`${(bytes.length / 1024).toFixed(0).padStart(5)} KB  ${path.slice(root.length + 1)}`);
  };
  const knight = readGlb(readFileSync(join(source, "adventurers/Knight.glb")));
  save(join(OUT, "rig-clips.glb"), trim(knight, { clips: CLIPS, keepMesh: () => false }));
  for (const [pack, names] of Object.entries(CHARACTERS)) for (const name of names) {
    const glb = readGlb(readFileSync(join(source, pack, `${name}.glb`)));
    save(join(OUT, "characters", `${name.toLowerCase()}.glb`), trim(glb, { keepMesh: (node) => !HELD.test(node) }));
  }
  // Props are generated output: only the ones set dressing places ship.
  rmSync(join(OUT, "props"), { recursive: true, force: true });
  for (const name of Object.keys(PROPS)) {
    const file = [`${name}.gltf.glb`, `${name}.glb`].map((f) => join(source, "dungeon", f)).find((f) => { try { readFileSync(f); return true; } catch { return false; } });
    if (!file) throw new Error(`missing dungeon/${name}.glb`);
    save(join(OUT, "props", `${name}.glb`), trim(readGlb(readFileSync(file)), { clips: [] }));
  }
  console.log(sizes.join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error("usage: node scripts/build-models.mjs <kaykit-dir>"); process.exit(1); }
  build(process.argv[2]);
}
