import * as THREE from "three";
import { box, orb, cone, cylinder, mat } from "./models.js";
import { compact } from "./graphics-utils.js";

// Exact Ularn IDs, including its lemming, bitbug and lama nobe variants.
// Family rigs share topology; species have their own proportions and features.
const definitions = [
  ["lemming", "beast", 0xa68b65, .65, "ears"],
  ["gnome", "folk", 0x819b68, .8, "cap"],
  ["hobgoblin", "folk", 0xbb8753, 1, "helmet"],
  ["jackal", "beast", 0xc3a168, 1, "ears"],
  ["kobold", "folk", 0x9e765d, .77, "horns"],
  ["orc", "folk", 0x7d9258, 1.1, "tusks"],
  ["snake", "serpent", 0x879d53, .75, "hood"],
  ["giant-centipede", "insect", 0xaf7249, 1, "manylegs"],
  ["jaculi", "serpent", 0xc5a467, .9, "crest"],
  ["troglodyte", "folk", 0x6c9a83, 1.1, "crest"],
  ["giant-ant", "insect", 0x9b684b, .9, "antennae"],
  ["floating-eye", "eye", 0xa9bcc1, .85, "eye"],
  ["leprechaun", "folk", 0x77a164, .72, "cap"],
  ["nymph", "folk", 0x93c9ae, .98, "crown"],
  ["quasit", "demon", 0xa793ba, .72, "wings"],
  ["rust-monster", "insect", 0xbf804d, 1.1, "antennae"],
  ["zombie", "folk", 0x819080, 1, "wounds"],
  ["assassin-bug", "insect", 0x654756, 1, "spikes"],
  ["bitbug", "insect", 0x7189b2, .9, "spikes"],
  ["hell-hound", "beast", 0x9f5340, 1.1, "flame"],
  ["ice-lizard", "beast", 0x98c7ce, 1, "crest"],
  ["centaur", "centaur", 0xba9771, 1.15, "spear"],
  ["troll", "folk", 0x688d68, 1.25, "tusks"],
  ["yeti", "folk", 0xd4ddd1, 1.25, "fur"],
  ["white-dragon", "dragon", 0xd6e7df, 1.2, "ice"],
  ["elf", "folk", 0x8eae73, 1, "ears"],
  ["gelatinous-cube", "cube", 0x84bdad, 1.1, "bones"],
  ["metamorph", "elemental", 0xaf86b1, 1, "spikes"],
  ["vortex", "elemental", 0x99b9cc, 1.1, "swirl"],
  ["ziller", "beast", 0x9b8abc, 1.05, "wings"],
  ["violet-fungus", "plant", 0xa28db6, 1, "mushroom"],
  ["wraith", "spirit", 0x8baab4, 1.05, "hood"],
  ["forvalaka", "beast", 0x66647c, 1.15, "fangs"],
  ["lama-nobe", "folk", 0xc6a676, 1.1, "cap"],
  ["osequip", "beast", 0x73a58b, 1.15, "horns"],
  ["rothe", "beast", 0x9e8670, 1.2, "horns"],
  ["xorn", "elemental", 0xba9868, 1.2, "threeeyes"],
  ["vampire", "folk", 0xb49aa7, 1.05, "cape"],
  ["invisible-stalker", "spirit", 0x9cb8b6, 1.15, "swirl"],
  ["poltergeist", "spirit", 0xc5c3db, .9, "chains"],
  ["disenchantress", "folk", 0x9973b2, 1.05, "crown"],
  ["shambling-mound", "plant", 0x6f8860, 1.3, "vines"],
  ["yellow-mold", "plant", 0xc6b768, .75, "mold"],
  ["umber-hulk", "insect", 0x997a52, 1.35, "mandibles"],
  ["gnome-king", "folk", 0xaa8066, 1, "crown"],
  ["mimic", "cube", 0xa68557, 1, "chest"],
  ["water-lord", "elemental", 0x72bfc6, 1.3, "crown"],
  ["bronze-dragon", "dragon", 0xc29658, 1.25, "metal"],
  ["green-dragon", "dragon", 0x749b59, 1.25, "spines"],
  ["purple-worm", "serpent", 0x9d779e, 1.4, "fangs"],
  ["xvart", "folk", 0x809db9, .85, "helmet"],
  ["spirit-naga", "serpent", 0xa992c6, 1.2, "crown"],
  ["silver-dragon", "dragon", 0xb8cbd0, 1.3, "metal"],
  ["platinum-dragon", "dragon", 0xe0d5b3, 1.4, "crown"],
  ["green-urchin", "elemental", 0x78a873, .9, "spikes"],
  ["red-dragon", "dragon", 0xb36550, 1.35, "flame"],
  ["demon-lord-I", "demon", 0x9c8064, 1.25, "horns"],
  ["demon-lord-II", "demon", 0x747ca3, 1.3, "wings"],
  ["demon-lord-III", "demon", 0x877fa8, 1.35, "crown"],
  ["demon-lord-IV", "demon", 0x9a655b, 1.4, "spikes"],
  ["demon-lord-V", "demon", 0x9a995e, 1.45, "tusks"],
  ["demon-lord-VI", "demon", 0x809a8a, 1.5, "wings"],
  ["demon-lord-VII", "demon", 0xac6e85, 1.55, "crown"],
  ["demon-prince", "demon", 0x925c5b, 1.6, "wings"],
  ["god-of-hellfire", "demon", 0xd29352, 1.7, "flame"],
];
export const CREATURES = Object.freeze(definitions.map(([model, family, color, scale, feature], i) =>
  Object.freeze({ id: i + 1, model, family, color, scale, feature })));
const templates = new Map();
const shadowGeometry = new THREE.CircleGeometry(.37, 24);
shadowGeometry.userData.shared = true;
const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x061316, transparent: true, opacity: .28, depthWrite: false });

function pivot(parent, name, x, y, z) {
  const group = new THREE.Group(); group.name = name; group.position.set(x, y, z); parent.add(group); return group;
}
function eyes(group, y, z, color = 0xf4c07b, spread = .09) {
  for (const x of [-spread, spread]) {
    orb(group, 0x1e292c, x, y, z, .045);
    orb(group, color, x, y, z - .03, .026, { emissive: color, emissiveIntensity: .65 });
  }
}
function build(definition) {
  const { id, model, family, color: colorHex, scale, feature } = definition;
  const color = new THREE.Color(colorHex), dark = color.clone().multiplyScalar(.58), bone = 0xe4d5ad;
  const root = new THREE.Group(), body = pivot(root, "creature-body", 0, 0, 0);
  const core = pivot(body, "core", 0, 0, 0), parts = [core];
  const moving = (name, x, y, z) => { const group = pivot(body, name, x, y, z); parts.push(group); return group; };
  const legs = (count = 4, insect = false) => {
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1, z = Math.floor(i / 2) * (insect ? .19 : .4) - .2;
      const leg = moving(`leg-${i}`, side * (insect ? .22 : .19), insect ? .24 : .31, z);
      box(leg, dark, side * (insect ? .09 : 0), -.11, 0, insect ? .23 : .11, insect ? .08 : .24, .12);
      if (insect) { const foot = box(leg, color, side * .22, -.15, 0, .08, .22, .07); foot.rotation.z = side * .5; }
      else box(leg, dark, 0, -.24, -.035, .13, .1, .18);
    }
  };
  const wings = () => {
    for (const side of [-1, 1]) {
      const wing = moving(`wing-${side}`, side * .23, family === "beast" ? .45 : .7, .12);
      const membrane = cone(wing, dark, side * .27, .06, 0, .47, .07, 3);
      membrane.rotation.z = side * .3;
      cylinder(wing, bone, side * .15, .08, -.1, .02, .5, 6).rotation.z = side * 1.1;
    }
  };
  let headY = .84, headZ = -.16;
  if (["folk", "demon", "spirit"].includes(family)) {
    cone(core, dark, 0, .49, .03, family === "spirit" ? .32 : .27, .57, 8);
    orb(core, color, 0, headY, headZ, .19);
    for (const side of [-1, 1]) {
      const arm = moving(`arm-${side}`, side * .24, .67, .02);
      box(arm, color, side * .04, -.16, 0, .13, .34, .13);
      orb(arm, color, side * .05, -.34, -.01, .08);
    }
    if (family !== "spirit") { legs(2); box(core, 0x887047, 0, .36, 0, .45, .07, .29); }
    else {
      for (let i = 0; i < 3; i++) cone(core, color, (i - 1) * .15, .22, .02, .12, .35, 5).rotation.z = (i - 1) * .2;
    }
    if (family === "demon") {
      for (const side of [-1, 1]) cone(core, bone, side * .15, 1.11, -.12, .075, .4, 6).rotation.z = -side * .25;
      wings();
    }
  } else if (["beast", "dragon", "centaur"].includes(family)) {
    const torso = orb(core, color, 0, .38, .05, .29); torso.scale.multiply(new THREE.Vector3(1, .86, 1.6));
    headY = family === "dragon" ? .66 : .48; headZ = -.4;
    orb(core, color, 0, headY, headZ, .2);
    const snout = orb(core, dark, 0, headY - .04, headZ - .16, .12); snout.scale.z *= 1.35;
    legs();
    if (id !== 1) {
      const tail = moving("tail", 0, .34, family === "beast" ? .3 : .42);
      const tip = cone(tail, color, 0, -.015, family === "beast" ? .13 : .22, .11, family === "beast" ? .38 : .56, 7); tip.rotation.x = Math.PI / 2;
    }
    if (family === "dragon" || feature === "wings") wings();
    if (family === "centaur") {
      box(core, dark, 0, .7, -.2, .3, .45, .24);
      headY = 1.04; headZ = -.23; orb(core, color, 0, headY, headZ, .16);
      cylinder(core, 0xad9b70, .31, .69, -.24, .025, 1.2); cone(core, bone, .31, 1.32, -.24, .07, .19, 4);
    }
  } else if (family === "serpent") {
    for (let i = 0; i < 7; i++) {
      const segment = orb(core, i % 2 ? dark : color, Math.sin(i * .85) * .2, .16 + i * .035, .45 - i * .13, .14 + i * .011);
      segment.scale.y = .85;
    }
    headY = .43; headZ = -.38; orb(core, color, 0, headY, headZ, .21);
    if (feature === "hood") { const hood = orb(core, dark, 0, .35, -.31, .25); hood.scale.multiply(new THREE.Vector3(1.5, 1, .4)); }
  } else if (family === "insect") {
    for (let i = 0; i < 3; i++) orb(core, i === 1 ? color : dark, 0, .33, .26 - i * .24, .19 + (i === 0 ? .05 : 0));
    legs(feature === "manylegs" ? 10 : 6, true);
    headY = .37; headZ = -.39;
    for (const side of [-1, 1]) cone(core, bone, side * .12, .23, -.51, .035, .23, 5).rotation.x = 1.1;
  } else if (family === "eye") {
    orb(core, color, 0, .63, 0, .32);
    orb(core, bone, 0, .65, -.24, .22); orb(core, 0x345b65, 0, .65, -.42, .12);
    orb(core, 0x142f35, 0, .65, -.51, .055); headY = 0;
    for (let i = 0; i < 5; i++) cone(core, dark, Math.cos(i * 1.25) * .2, .32, Math.sin(i * 1.25) * .2, .03, .25, 5);
  } else if (family === "plant") {
    for (let i = 0; i < (feature === "mold" ? 7 : 5); i++) {
      const x = Math.sin(i * 2.4) * .28, z = Math.cos(i * 2.4) * .24;
      cylinder(core, dark, x, .23, z, .055, .4);
      const cap = orb(core, i % 2 ? color : dark, x, .43 + i * .015, z, .2); cap.scale.y *= .4;
      if (feature === "vines") cone(core, color, x, .52, z, .15, .6, 6);
    }
    headY = 0;
  } else if (family === "cube") {
    if (feature === "chest") {
      box(core, dark, 0, .3, 0, .67, .5, .52);
      for (const x of [-.26, .26]) box(core, 0xb7a470, x, .33, -.27, .055, .55, .055, { metalness: .55 });
      box(core, 0x192b2a, 0, .32, -.29, .48, .1, .025);
      for (let i = 0; i < 6; i++) cone(core, bone, -.22 + i * .085, .3, -.32, .028, .11, 4);
    } else {
      box(core, color, 0, .4, 0, .72, .78, .72, { transparent: true, opacity: .67, roughness: .2 });
      for (let i = 0; i < 3; i++) cylinder(core, bone, (i - 1) * .13, .24 + i * .1, 0, .025, .3).rotation.z = i + .5;
    }
    headY = 0;
  } else {
    for (let i = 0; i < 5; i++) {
      const lobe = orb(core, i % 2 ? color : dark, Math.sin(i * 1.9) * .16, .22 + i * .13, Math.cos(i * 1.9) * .14, .23);
      if (feature === "swirl") lobe.scale.multiply(new THREE.Vector3(1.6 - i * .17, .42, 1.6 - i * .17));
    }
    headY = .64; headZ = -.24;
  }
  if (headY) eyes(core, headY + .04, headZ - .16, feature === "ice" ? 0x96e6fa : 0xf2bf79);
  if (["ears", "horns", "tusks", "fangs", "fur"].includes(feature)) {
    for (const side of [-1, 1]) {
      const horn = cone(core, feature === "ears" || feature === "fur" ? color : bone,
        side * .16, headY + (feature === "tusks" || feature === "fangs" ? -.08 : .22), headZ, feature === "ears" ? .08 : .045, feature === "horns" ? .32 : .18, 5);
      horn.rotation.z = -side * .3;
    }
  }
  if (["crest", "spines", "spikes", "flame", "ice"].includes(feature)) {
    for (let i = 0; i < 5; i++) cone(core, feature === "flame" ? 0xe8a052 : color,
      family === "elemental" ? Math.sin(i * 1.2) * .3 : 0, .56 + (i === 0 ? .15 : 0), -.3 + i * .17, .06, .22 + i * .02, 5);
  }
  if (["cap", "helmet", "crown", "hood"].includes(feature) && family !== "serpent") {
    cone(core, feature === "crown" ? 0xd4b475 : dark, 0, headY + .22, headZ, .23, feature === "cap" ? .32 : .16, feature === "crown" ? 5 : 8);
    if (feature === "crown") for (let i = 0; i < 5; i++) cone(core, bone, Math.sin(i * 1.26) * .17, headY + .35, headZ + Math.cos(i * 1.26) * .17, .04, .16, 4);
  }
  if (feature === "antennae") for (const side of [-1, 1]) cylinder(core, dark, side * .13, .52, -.45, .015, .36, 5).rotation.z = side * .45;
  if (["cape", "chains", "wounds", "threeeyes", "mandibles"].includes(feature)) {
    if (feature === "cape") cone(core, 0x543940, 0, .5, .18, .35, .7, 6).scale.z = .3;
    else for (let i = 0; i < 3; i++) orb(core, feature === "wounds" ? 0x775453 : bone, (i - 1) * .15, .6, -.27, .05);
  }
  root.scale.setScalar(scale);
  root.userData = { species: id, model, family, feature };
  parts.forEach((part) => compact(part, true));
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial); shadow.rotation.x = -Math.PI / 2; shadow.position.y = .016; root.add(shadow);
  return root;
}

export function creature(monster) {
  const definition = CREATURES[monster.id - 1];
  if (!definition) return null;
  if (!templates.has(definition.id)) templates.set(definition.id, build(definition));
  const group = templates.get(definition.id).clone(true);
  group.userData.facing = { x: 0, y: 1 };
  return group;
}
export function faceCreature(group, facing) {
  if (facing && (facing.x || facing.y)) {
    group.userData.facing = { ...facing };
    group.userData.targetAngle = Math.atan2(-facing.x, -facing.y);
  }
}
export function animateCreature(group, now, walking, reduced) {
  const body = group.getObjectByName("creature-body");
  if (!body) return;
  const phase = now * .008 + (group.userData.uid || group.userData.species) * .7;
  const angle = group.userData.targetAngle ?? group.rotation.y;
  let difference = (angle - group.rotation.y + Math.PI) % (Math.PI * 2);
  if (difference < 0) difference += Math.PI * 2;
  group.rotation.y += (difference - Math.PI) * (reduced ? 1 : .35);
  body.position.y = reduced ? 0 : Math.sin(phase) * (walking ? .025 : .008);
  for (const part of body.children) {
    if (part.name.startsWith("leg-") || part.name.startsWith("arm-"))
      part.rotation.x = reduced || !walking ? 0 : Math.sin(phase + (part.name.endsWith("1") || part.name.endsWith("3") ? Math.PI : 0)) * .32;
    if (part.name.startsWith("wing-")) part.rotation.z = reduced ? 0 : Math.sin(phase * .6) * .16;
    if (part.name === "tail") part.rotation.y = reduced ? 0 : Math.sin(phase * .5) * .16;
  }
}
export function creatureMetrics() { return { creatureTemplates: templates.size, monsterTextures: 0, monsterMaterials: 0 }; }
export function releaseCreatureResources(clear = false) {
  const geometries = new Set();
  templates.forEach((group) => group.traverse((object) => { if (object.geometry) geometries.add(object.geometry); }));
  geometries.forEach((geometry) => geometry.dispose()); shadowMaterial.dispose();
  if (clear) templates.clear();
}
