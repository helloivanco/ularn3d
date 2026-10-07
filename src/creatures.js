import * as THREE from "three";
import { box, orb, cone, cylinder, tapered, mat } from "./models.js";
import { matBasic } from "./materials.js";
import { compact, featherContact } from "./graphics-utils.js";

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
  ["loot-goblin", "folk", 0x89a782, .8, "sack"],
];
export const CREATURES = Object.freeze(definitions.map(([model, family, color, scale, feature], i) =>
  Object.freeze({ id: i + 1, model, family, color, scale, feature })));
const templates = new Map();
const shadowGeometry = featherContact(new THREE.CircleGeometry(.37, 24));
shadowGeometry.userData.shared = true;
const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x061316, transparent: true, opacity: .38, depthWrite: false, vertexColors:true });

function pivot(parent, name, x, y, z) {
  const group = new THREE.Group(); group.name = name; group.position.set(x, y, z); parent.add(group); return group;
}
const shapes = new Map();
const shape = (key, create) => {
  if (!shapes.has(key)) { const geometry = create(); geometry.userData.shared = true; shapes.set(key, geometry); }
  return shapes.get(key);
};
const ellipsoid = (group, color, x, y, z, radius, sx = 1, sy = 1, sz = 1) => {
  const part = orb(group, color, x, y, z, radius);
  part.scale.multiply(new THREE.Vector3(sx, sy, sz));
  return part;
};
const rod = (group, color, from, to, width = .035) => {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
  const part = box(group, color, ...a.add(b).multiplyScalar(.5).toArray(), width, direction.length(), width);
  part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return part;
};
const flat = (group, geometry, color, x, y, z, extra = {}) => {
  const part = new THREE.Mesh(geometry, matBasic(color, { side: THREE.DoubleSide, toneMapped: false, ...extra }));
  part.position.set(x, y, z); part.castShadow = part.receiveShadow = false; group.add(part); return part;
};
const circle = shape("iris", () => new THREE.CircleGeometry(1, 16));
function eyePair(group, y, z, spread = .075, iris = 0xd7cba3) {
  for (const side of [-1, 1]) {
    const white = box(group, 0x172326, side * spread, y, z, .06, .045, .027);
    white.material = matBasic(0x172326, { toneMapped: false }); white.castShadow = false;
    const pupil = box(group, iris, side * spread, y + .004, z - .016, .023, .026, .013);
    pupil.material = matBasic(iris, { toneMapped: false }); pupil.castShadow = false;
  }
}
function build(definition) {
  const { id, model, family, color: colorHex, scale, feature } = definition;
  const color = new THREE.Color(colorHex), dark = color.clone().multiplyScalar(.52);
  const light = color.clone().lerp(new THREE.Color(0xe1d2ac), .38), bone = 0xe2d3ac;
  const root = new THREE.Group(), body = pivot(root, "creature-body", 0, 0, 0);
  const core = pivot(body, "core", 0, 0, 0), parts = [core];
  const moving = (name, x, y, z, kind, phase = 0) => {
    const part = pivot(body, name, x, y, z); part.userData.motion = kind; part.userData.phase = phase; parts.push(part); return part;
  };
  const headAt = (y, z, radius = .17, skin = color, proportions = [1, 1, .85], gaze = true) => {
    const head = moving("head", 0, y, z);
    ellipsoid(head, skin, 0, 0, 0, radius, ...proportions);
    if (gaze) eyePair(head, .025, -radius * proportions[2], radius * .44, family === "demon" ? 0xffbf71 : 0xc9d6b6);
    return head;
  };
  const pairedLegs = (count, height = .28, width = .17, spread = .17, gap = .34, hoof = false) => {
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1, z = count === 2 ? 0 : (Math.floor(i / 2) - (count / 2 - 1) / 2) * gap;
      const leg = moving(`leg-${i}`, side * spread, height, z, "leg", (i % 2) * Math.PI + Math.floor(i / 2) * .65);
      box(leg, dark, 0, -height * .43, 0, width * .65, height * .85, width * .68);
      box(leg, hoof ? 0x43372d : dark, 0, -height + .055, -.04, width, .11, width * 1.25);
    }
  };
  const arms = (height = .7, spread = .26, length = .3, skin = color, claw = false) => {
    for (const side of [-1, 1]) {
      const arm = moving(`arm-${side}`, side * spread, height, -.005, "arm", side < 0 ? 0 : Math.PI);
      ellipsoid(arm, skin, 0, -.1, 0, .1, .9, length * 4.4, .85);
      ellipsoid(arm, skin, side * .035, -length, -.04, claw ? .1 : .075, 1, .8, 1);
      if (claw) for (let i = 0; i < 3; i++) {
        const nail = cone(arm, bone, side * .035 + (i - 1) * .045, -length - .075, -.075, .024, .14, 4);
        nail.rotation.x = -.4; nail.rotation.z = Math.PI;
      }
    }
  };
  const earPair = (head, skin = color, long = false) => {
    for (const side of [-1, 1]) {
      const ear = cone(head, skin, side * (long ? .17 : .12), long ? .035 : .15, 0, long ? .043 : .058, long ? .19 : .15, 4);
      ear.rotation.z = -side * (long ? 1.1 : .3);
    }
  };
  const crown = (head, royal = false) => {
    cylinder(head, 0xb59c65, 0, .14, 0, .18, .065, 6);
    for (let i = 0; i < (royal ? 6 : 4); i++) {
      const angle = i * Math.PI * 2 / (royal ? 6 : 4);
      cone(head, bone, Math.sin(angle) * .155, .245, Math.cos(angle) * .14, .035, royal ? .2 : .14, 4);
    }
    const gem = orb(head, royal ? 0x6ab5c4 : 0xd57b63, 0, .162, -.182, .035); gem.material = matBasic(royal ? 0x6ab5c4 : 0xd57b63);
  };
  const horns = (head, height = .28, reach = .16, swept = false) => {
    for (const side of [-1, 1]) {
      const base = cone(head, dark, side * .13, .15, .03, .065, height * .6, 5);
      base.rotation.z = -side * .55;
      const tip = cone(head, bone, side * reach, .23, swept ? .12 : .01, .035, height * .65, 4);
      tip.rotation.z = -side * .35; tip.rotation.x = swept ? .5 : 0;
    }
  };
  const wings = (height = .68, reach = .85, sweep = .18, tint = dark) => {
    for (const side of [-1, 1]) {
      // Mirroring vertices before triangulation preserves winding/normals.
      // A negative mesh scale baked into a batch lit the right wing from below.
      const wingGeometry = shape(`wing:${side}`, () => new THREE.ShapeGeometry(new THREE.Shape(
        [[0,0],[.2,.12],[.75,-.02],[.61,-.43],[.4,-.31],[.13,-.16]].map(([x,y]) => new THREE.Vector2(x * side,y)),
      )));
      const wing = moving(`wing-${side}`, side * .23, height, .12, "wing", side < 0 ? 0 : Math.PI);
      wing.rotation.z = side * sweep;
      const membrane = new THREE.Mesh(wingGeometry, mat(tint, { side: THREE.DoubleSide }));
      membrane.rotation.x = -Math.PI / 2; membrane.scale.setScalar(reach);
      membrane.castShadow = membrane.receiveShadow = true; wing.add(membrane);
      for (const point of [[.2, -.12], [.75, .02], [.61, .43]])
        rod(wing, light, [0, .015, 0], [side * point[0] * reach, .025, point[1] * reach], .023);
      cone(wing, bone, side * .18 * reach, .055, -.095, .025, .12, 4).rotation.z = -side * .5;
    }
  };
  const tail = (length = .45, radius = .09, z = .35, tint = color, club = false) => {
    const part = moving("tail", 0, .3, z, "tail");
    rod(part, tint, [0, 0, 0], [.065, .055, length * .5], radius * 1.5);
    rod(part, tint, [.065, .055, length * .5], [.12, .1, length], radius * .8);
    if (club) ellipsoid(part, light, .12, .1, length, radius, 1.1, .8, 1.2);
    return part;
  };
  const chestTrim = (width = .4) => {
    box(core, 0x675036, 0, .41, .005, width, .065, .28);
    box(core, 0xc3aa70, 0, .415, -.152, .067, .065, .03);
  };
  const tusks = (head, length = .13) => {
    for (const side of [-1, 1]) {
      const tooth = cone(head, bone, side * .085, -.105, -.17, .028, length, 4); tooth.rotation.x = -.3;
    }
  };

  if (family === "folk") {
    const brute = [3, 6, 10, 23, 24, 34].includes(id), slim = [14, 26, 38, 41].includes(id);
    const torsoWidth = brute ? .29 : slim ? .205 : .235, height = id === 23 ? .61 : .46;
    tapered(core, dark, 0, .52, .015, torsoWidth, height, brute ? 1.12 : .85, .78);
    box(core, color, 0, .62, -.07, torsoWidth * 1.45, .25, .16);
    pairedLegs(2, .29, brute ? .18 : .145, brute ? .17 : .12);
    arms(id === 23 ? .77 : .7, brute ? .29 : .245, id === 23 ? .4 : .3, color, id === 24);
    chestTrim(torsoWidth * 1.8);
    const skin = ({2:0xc4ad86,13:0xcfaa7f,14:0xccdac2,26:0xd8c19c,38:0xc9b9be,41:0xb7a1bc,45:0xc4ad86})[id] || color;
    const head = headAt(id === 23 ? .96 : .88, brute ? -.08 : -.055, brute ? .195 : .17, skin, [brute ? 1.08 : 1, 1, .86]);
    if ([2, 45].includes(id)) {
      box(head, 0x8e7652, 0, -.09, -.15, .15, .13, .06);
      if (id === 45) { crown(head, true); tapered(core, 0x683b32, 0, .48, .18, .3, .58, .75, .24); }
      else { cylinder(head, 0x8c483b, 0, .15, 0, .2, .05, 6); const cap = cone(head, 0xa45b44, -.035, .27, .015, .155, .25, 6); cap.rotation.z = -.22; }
    } else if (id === 13) {
      cylinder(head, 0x244c39, 0, .15, 0, .21, .045, 8); cylinder(head, color, 0, .245, 0, .15, .18, 6);
      box(head, 0xb59c65, 0, .205, -.151, .065, .045, .024);
      ellipsoid(core, 0x604931, -.24, .43, .1, .13, .85, 1, .7);
    } else if ([14, 26, 41].includes(id)) {
      ellipsoid(head, id === 26 ? 0x7a5c38 : dark, 0, .08, .065, .19, 1, .75, .8);
      earPair(head, skin, true);
      if (id === 26) { tapered(core, 0x355d3c, 0, .46, .15, .28, .58, .62, .3); box(core, light, -.12, .69, -.15, .035, .13, .025).rotation.z = -.45; }
      else { crown(head); tapered(core, id === 41 ? 0x594071 : 0x678b76, 0, .43, .025, .3, .56, .62, .72); }
      if (id === 41) rod(core, 0xb89d6d, [.32, .1, -.16], [.32, 1.03, -.16], .035);
    } else if (id === 38) {
      ellipsoid(head, 0x433241, 0, .08, .05, .185, 1, .68, .78); tusks(head, .09);
      tapered(core, 0x532c39, 0, .49, .17, .36, .66, .66, .27);
      for (const side of [-1, 1]) box(core, 0xa86b72, side * .15, .73, .04, .1, .18, .16).rotation.z = -side * .45;
    } else if (id === 66) {
      earPair(head, skin, true);
      ellipsoid(head, dark, 0, .13, .03, .19, 1.13, .62, .9);
      ellipsoid(core, 0x947248, 0, .52, .26, .28, .95, 1.15, .83);
      for (const side of [-1, 1]) rod(core, 0xc0a16b, [side * .17, .73, .05], [side * .17, .39, .17], .032);
      for (const x of [-.07, .03, .09]) box(core, 0xd8b565, x, .82, .23, .05, .035, .05);
    } else if (id === 5) {
      earPair(head, color, true); box(head, light, 0, -.055, -.17, .12, .075, .13);
      horns(head, .15, .13); tail(.26, .055, .17);
    } else if ([3, 51].includes(id)) {
      ellipsoid(head, dark, 0, .12, .035, .19, 1.08, .65, .95);
      box(head, light, 0, .14, -.04, .055, .13, .24);
      for (const side of [-1, 1]) box(core, light, side * .26, .74, 0, id === 3 ? .2 : .13, .13, .22);
    } else if (id === 6 || id === 23) {
      tusks(head, id === 23 ? .2 : .15); earPair(head, color, true);
      box(head, dark, 0, .07, -.16, .23, .055, .07);
      if (id === 6) for (const side of [-1, 1]) box(core, 0x665a43, side * .22, .71, -.03, .17, .13, .22);
    } else if (id === 24) {
      for (const x of [-.24, 0, .24]) ellipsoid(core, light, x, .7, .035, .17, 1, .68, .95);
      box(head, dark, 0, -.04, -.17, .15, .09, .07); tusks(head, .08);
    } else if (id === 10) {
      box(head, light, 0, -.06, -.17, .2, .095, .12);
      for (let i = 0; i < 4; i++) cone(core, dark, 0, .89 - i * .12, .15 + i * .02, .055, .15, 4).rotation.x = .55;
    } else if (id === 17) {
      box(head, dark, -.075, -.025, -.15, .1, .09, .03);
      box(head, bone, .045, -.07, -.15, .07, .08, .035);
      for (const x of [-.08, .06]) box(core, 0x775048, x, .63, -.16, .055, .14, .025).rotation.z = -.2;
      body.rotation.x = .08;
    } else if (id === 34) {
      box(head, light, 0, -.07, -.17, .14, .13, .12); earPair(head, color);
      tapered(core, 0x715b3d, 0, .4, .14, .32, .48, .9, .55);
      for (const side of [-1, 1]) cone(head, dark, side * .09, .15, .04, .065, .19, 5).rotation.z = -side * .4;
    }
    if ([3,6,26,51].includes(id)) {
      const hand = body.getObjectByName("arm-1");
      rod(hand,0x796342,[.035,-.27,-.035],[.035,-.27,-.14],.035);
      const blade=box(hand,id===26?0xb6c9b4:0xa5b8ba,.035,-.19,-.275,.042,.028,.3);
      blade.rotation.x=-.22;
      box(hand,0xb29b67,.035,-.265,-.155,.13,.025,.028);
    }
  } else if (["beast", "dragon", "centaur"].includes(family)) {
    const rodent = id === 1, lizard = id === 21, cat = id === 33, bull = id === 36;
    const height = rodent ? .23 : lizard ? .26 : bull ? .43 : .35;
    const radius = rodent ? .21 : bull ? .3 : family === "dragon" ? .27 : .245;
    ellipsoid(core, color, 0, height, .04, radius, cat ? .8 : lizard ? 1.08 : 1, rodent ? .83 : .8, bull ? 1.32 : 1.5);
    ellipsoid(core, light, 0, height + .08, -.03, radius * .7, .78, .62, 1.3);
    pairedLegs(id === 30 ? 2 : id === 35 ? 6 : 4, rodent ? .13 : lizard ? .17 : bull ? .32 : .25,
      rodent ? .11 : lizard ? .135 : .15, rodent ? .155 : lizard ? .23 : .185, rodent ? .24 : .39, bull || family === "centaur");
    const headY = rodent ? .29 : lizard ? .32 : family === "dragon" ? .64 : bull ? .52 : .46;
    const headZ = rodent ? -.25 : family === "dragon" ? -.4 : -.35;
    const head = family === "centaur" ? null : headAt(headY, headZ, rodent ? .145 : .17, color, [bull ? 1.22 : .98, cat ? .8 : 1, .92]);
    const snout = rodent ? .09 : cat ? .11 : id === 4 ? .14 : family === "dragon" ? .17 : .13;
    if (head) {
      ellipsoid(head, rodent ? 0xc9ad85 : light, 0, -.055, -.17, snout, .8, .65, id === 4 || family === "dragon" ? 1.2 : .86);
      box(head, dark, 0, -.035, -.17 - snout * .9, .06, .045, .035);
    }
    if (rodent) {
      for (const side of [-1, 1]) ellipsoid(head, dark, side * .1, .11, .01, .053, .8, 1, .55);
      box(core, dark, 0, .398, .045, .075, .023, .3);
      tail(.15, .026, .23);
    } else if (family === "dragon") {
      rod(core,color,[0,.4,-.19],[0,.65,-.36],.2);
      ellipsoid(core,light,0,.49,-.27,.1,.8,1.35,.7);
      const reach = ({25:.75,48:.93,49:.85,53:.83,54:1,56:.96})[id];
      wings(.6, reach, id === 49 ? .26 : .1, id === 25 ? 0x779b9d : dark);
      horns(head, id === 54 ? .26 : .19, .16, [48,53,56].includes(id));
      const tailPart = tail(.47, .09, .38, color, id === 48);
      for (let i = 0; i < 4; i++) {
        const ridge = cone(core, id === 56 ? 0xc98547 : light, 0, .67 - i * .055, -.05 + i * .18, .055, id === 49 ? .19 : .13, 4);
        ridge.rotation.x = -.3;
      }
      if (id === 54) crown(head, true);
      if (id === 53) for (const side of [-1, 1]) cone(head, light, side * .19, .035, .015, .055, .18, 4).rotation.z = -side * 1.1;
      if (id === 56) { box(head, 0xeeac61, 0, -.12, -.18, .08, .055, .035); cone(tailPart, 0xe4a36d, .12, .18, .47, .07, .2, 4); }
      if (id === 25) for (const side of [-1, 1]) cone(head, bone, side * .12, -.11, -.18, .025, .13, 4).rotation.z = Math.PI;
    } else if (family === "centaur") {
      tapered(core, dark, 0, .77, -.23, .2, .48, 1.15, .8);
      const rider = headAt(1.08, -.23, .16, light); earPair(rider, light);
      for (const side of [-1, 1]) rod(core, color, [side * .18, .9, -.23], [side * .3, .6, -.32], .1);
      rod(core, 0x89754a, [.32, .3, -.29], [.32, 1.24, -.29], .035); cone(core, bone, .32, 1.33, -.29, .055, .2, 4);
      tail(.3, .065, .4);
    } else {
      if (!lizard && id !== 35) earPair(head, color, cat);
      const tailPart = tail(cat ? .45 : lizard ? .42 : .29, cat ? .043 : .075, .35, color, lizard);
      if (id === 20) {
        for (let i = 0; i < 4; i++) cone(core, 0xc88b47, 0, .56, -.16 + i * .16, .065, .2 - i * .025, 4);
        for (const side of [-1, 1]) box(core, 0xdda266, side * .2, .37, -.09, .025, .14, .16);
        tusks(head, .1);
      } else if (lizard) {
        for (let i = 0; i < 5; i++) cone(core, light, 0, .47, -.25 + i * .15, .07, .17 - i * .013, 4);
        cone(tailPart, light, .12, .19, .42, .07, .16, 4);
      } else if (cat) tusks(head, .16);
      else if (bull) {
        horns(head, .17, .2, true);
        for (const x of [-.14, 0, .14]) cone(core, dark, x, .23, -.23, .08, .22, 5).rotation.z = Math.PI;
        ellipsoid(head, dark, 0, .12, .01, .16, 1.2, .55, .9);
      } else if (id === 35) {
        cone(head, bone, 0, .22, -.11, .065, .25, 5).rotation.x = -.4;
        for (const x of [-.15, .15]) box(core, dark, x, .55, .045, .15, .08, .33);
      } else if (id === 30) {
        wings(.48, .9, .2, 0x62517e);
        for (const side of [-1, 1]) rod(core, 0xc5b8d4, [side * .13, .55, -.2], [side * .2, .75, -.09], .026);
        box(head, 0xe1d4a5, 0, -.05, -.17, .09, .075, .14);
      }
    }
  } else if (family === "serpent") {
    const worm = id === 50, naga = id === 52;
    const segments = worm ? 8 : 10;
    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1), radius = (worm ? .15 : .065) + t * (worm ? .1 : .075);
      const bend = Math.sin(i * (worm ? .82 : .6)) * (worm ? .17 : .18 * Math.min(1,(i+2)/5));
      ellipsoid(core, i % 2 ? dark : color, bend, .1 + t * (naga ? .3 : .15), .51 - t * .88,
        radius, 1, .78, 1.15);
    }
    const head = worm ? moving("head",0,.38,-.4) : headAt(naga ? .65 : .3, -.4, naga ? .16 : .145, naga ? light : color);
    if (worm) {
      const direction = new THREE.Vector3(0,.55,-.835).normalize(), center = direction.clone().multiplyScalar(.105);
      const maw=new THREE.Mesh(shape("worm-maw",()=>new THREE.CylinderGeometry(.8,1,1,12,1,true)),mat(color,{side:THREE.DoubleSide}));
      maw.scale.set(.24,.2,.24);maw.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);maw.castShadow=maw.receiveShadow=true;head.add(maw);
      const lip=new THREE.Mesh(shape("worm-lip",()=>new THREE.TorusGeometry(1,.09,3,12)),mat(light));
      lip.position.copy(center);lip.scale.setScalar(.2);lip.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);head.add(lip);
      const mouth = flat(head,circle,0x241b30,...direction.clone().multiplyScalar(.085).toArray());mouth.scale.setScalar(.18);mouth.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4, radial = new THREE.Vector3(Math.sin(angle), Math.cos(angle) * .835, Math.cos(angle) * .55);
        const at = center.clone().addScaledVector(radial,.165).addScaledVector(direction,.012);
        const tooth = cone(head,bone,...at.toArray(),.026,.1,4);
        tooth.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),radial.negate());
      }
    } else if (naga) {
      tapered(core, dark, 0, .49, -.34, .18, .3, .65, .65); crown(head);
      for (const side of [-1, 1]) cone(head, light, side * .19, .02, .02, .045, .17, 4).rotation.z = -side * 1;
    } else {
      if (id === 7) ellipsoid(head, dark, 0, -.05, .055, .17, 1.65, 1, .32);
      else for (const side of [-1, 1]) cone(head, bone, side * .09, .19, .02, .035, .16, 4).rotation.z = -side * .45;
      for (const side of [-1, 1]) rod(head, 0xa7595b, [0, -.06, -.15], [side * .04, -.065, -.23], .014);
    }
  } else if (family === "insect") {
    const centipede = id === 8, mantis = id === 18, hulk = id === 44, rust = id === 16;
    if (hulk) {
      ellipsoid(core, color, 0, .61, .045, .33, 1.2, 1.3, .86);
      box(core, dark, 0, .51, -.19, .39, .35, .12);
      pairedLegs(2, .3, .22, .21); arms(.8, .36, .38, color, true);
      const head = headAt(.99, -.055, .21, color, [1.16, .8, .9]);
      eyePair(head, .11, -.145, .053, 0xe0b678);
      for (const side of [-1, 1]) {
        const jaw = cone(head, bone, side * .125, -.1, -.2, .055, .2, 4); jaw.rotation.z = side * 1.1;
        box(core, light, side * .23, .84, .03, .18, .12, .24);
      }
    } else {
      const count = centipede ? 7 : 3, length = centipede ? 1.05 : .65;
      for (let i = 0; i < count; i++) {
        const radius = centipede ? .145 : i === 0 ? rust ? .27 : .235 : i === 1 ? .12 : .165;
        ellipsoid(core, i % 2 ? dark : color, 0, mantis ? .35 + i * .06 : .25, length / 2 - i * length / (count - 1), radius,
          rust ? 1.2 : 1, id === 19 ? .95 : .72, centipede ? .95 : 1.06);
        if (id === 19) box(core, light, 0, .405, length / 2 - i * length / 2, .21, .035, .13);
      }
      const legCount = centipede ? 14 : rust || mantis ? 4 : 6;
      for (let i = 0; i < legCount; i++) {
        const side = i % 2 ? 1 : -1, z = (Math.floor(i / 2) / Math.max(1,legCount / 2 - 1) - .5) * (centipede ? .9 : .5);
        const leg = moving(`leg-${i}`, side * .13, .25, z, "insect", i * .65);
        rod(leg, dark, [0,0,0], [side * .19,-.08,.025], .052);
        rod(leg, color, [side * .19,-.08,.025], [side * .29,-.22,.065], .042);
      }
      const head = headAt(mantis ? .54 : .28, -length / 2 - .03, centipede ? .13 : .16, dark, [1.05,.75,.8]);
      for (const side of [-1, 1]) {
        const jaw = cone(head, bone, side * .08, -.09, -.13, .025, .16, 4); jaw.rotation.z = side * .65; jaw.rotation.x = .8;
        if (id === 11 || rust) {
          rod(head, light, [side * .09,.08,-.02], [side * .17,.19,-.19], .018);
          rod(head, dark, [side * .17,.19,-.19], [side * (rust ? .3 : .2),.2,rust ? -.41 : -.26], .018);
        }
      }
      if (rust) for (const side of [-1, 1]) ellipsoid(core, light, side * .12, .27, .48, .15, 1.2,.23,1.05);
      if (mantis) for (const side of [-1, 1]) {
        const claw = moving(`arm-${side}`, side * .15, .48, -.28, "arm", side < 0 ? 0 : Math.PI);
        rod(claw,color,[0,0,0],[side * .1,.06,-.16],.065);
        rod(claw,bone,[side * .1,.06,-.16],[side * .075,-.11,-.31],.045);
      }
    }
  } else if (family === "eye") {
    const center = new THREE.Vector3(0,.62,0), direction = new THREE.Vector3(0,.68,-.733).normalize();
    ellipsoid(core, 0xe0dfca, ...center.toArray(), .29);
    for (const [radius,distance,tint] of [[.165,.287,0x719bab],[.078,.292,0x14292d],[.022,.297,0xf5edcd]]) {
      const at = center.clone().addScaledVector(direction,distance); if(radius<.03)at.x=-.028;
      const iris = flat(core,circle,tint,...at.toArray()); iris.scale.setScalar(radius); iris.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);
    }
    for(const side of[-1,1])rod(core,dark,[side*.2,.52,.04],[side*.33,.45,.06],.035);
    for(let i=0;i<3;i++)cone(core,color,(i-1)*.11,.29,.05,.023,.25,4).rotation.z=(i-1)*.2;
  } else if (family === "plant") {
    if(id===42){
      ellipsoid(core,dark,0,.45,.035,.36,1.08,1.1,1);
      for(const side of[-1,1]){ellipsoid(core,color,side*.22,.68,.02,.23,.85,.8,1);}
      pairedLegs(2,.22,.2,.18);arms(.64,.33,.35,color);
      for(let i=0;i<9;i++){const angle=i*2.4;cone(core,i%2?light:color,Math.sin(angle)*.3,.45+(i%3)*.12,Math.cos(angle)*.26,.095,.2,4).rotation.z=Math.sin(angle)*.5;}
      eyePair(core,.7,-.27,.09,0xc3bc76);
    }else{
      const count=id===43?9:4;
      for(let i=0;i<count;i++){
        const angle=i*2.4,x=Math.sin(angle)*(id===43?.3:.22),z=Math.cos(angle)*.25;
        if(id===43)ellipsoid(core,i%2?dark:color,x,.09+(i%3)*.015,z,.15,1.15,.48,1.1);
        else{const height=i===0?.58:.36; cylinder(core,0x9588a2,x,height/2,z,.045,height,5);ellipsoid(core,i%2?color:light,x,height,z,i===0?.25:.18,1,.42,1);}
      }
      if(id===31)for(const side of[-1,1]){
        const tendril=moving(`tendril-${side}`,side*.18,.34,-.04,"tendril",side);
        rod(tendril,dark,[0,0,0],[side*.17,.08,-.06],.045);rod(tendril,color,[side*.17,.08,-.06],[side*.25,.21,-.1],.035);
      }
    }
  } else if(family==="spirit"){
    const ghost={transparent:true,opacity:id===39?.5:.78,depthWrite:false,roughness:.9};
    tapered(core,color,0,.59,.02,.27,.48,.63,.55,ghost);
    for(const side of[-1,1]){
      const sleeve=moving(`arm-${side}`,side*.22,.69,.02,"tendril",side);
      tapered(sleeve,color,side*.035,-.13,0,.085,.29,.65,.65,ghost);
      ellipsoid(sleeve,bone,side*.05,-.28,-.025,.055);
    }
    for(let i=0;i<3;i++){const hem=cone(core,color,(i-1)*.12,.25,.035,.12,.3,5);hem.rotation.z=Math.PI+(i-1)*.16;hem.material=mat(color,ghost);}
    if(id===32){
      ellipsoid(core,dark,0,.88,-.045,.19,1,1.06,.8);const face=box(core,0x17292e,0,.875,-.19,.14,.15,.025);face.material=matBasic(0x17292e);
      eyePair(core,.9,-.21,.045,0x9ebfc1);
    }else if(id===39){
      ellipsoid(core,color,0,.9,-.045,.145,1,1.1,.8).material=mat(color,ghost);
      eyePair(core,.925,-.175,.047,0xc6e4dc);
      for(let i=0;i<3;i++)box(core,light,(i-1)*.11,.63,-.14,.025,.18,.022).rotation.z=(i-1)*.3;
    }else{
      ellipsoid(core,color,0,.81,.02,.17,1.2,.57,1).material=mat(color,ghost);
      for(const side of[-1,1]){
        const chain=moving(`chain-${side}`,side*.25,.44,-.07,"tendril",side);
        for(let i=0;i<3;i++){
          rod(chain,bone,[-.035,-i*.07,0],[.035,-i*.07,0],.018);
          rod(chain,bone,[side*.035,-i*.07,0],[side*.035,-i*.07-.08,.018],.018);
        }
      }
      eyePair(core,.795,-.12,.057,0xb8cbdc);
    }
  } else if(family==="cube"){
    if(id===46){
      box(core,0x6d4d32,0,.25,.01,.64,.4,.47);box(core,0x26302b,0,.46,-.025,.52,.055,.4);
      const lid=moving("jaw",0,.48,.21,"jaw");box(lid,color,0,.055,-.21,.67,.12,.5);lid.rotation.x=-.11;
      for(const side of[-1,1]){box(core,0xb6a16c,side*.245,.27,-.238,.047,.37,.025);box(lid,0xb6a16c,side*.245,.123,-.21,.047,.023,.48);}
      for(let i=0;i<6;i++){const tooth=cone(core,bone,-.21+i*.084,.43,-.237,.025,.12,4);tooth.rotation.z=Math.PI;}
      eyePair(core,.455,-.241,.11,0xe1b05e);
    }else{
      box(core,color,0,.4,0,.73,.76,.73,{transparent:true,opacity:.38,roughness:.25,depthWrite:false});
      for(const x of[-.29,.29])rod(core,light,[x,.75,-.29],[x,.75,.29],.025);
      for(const z of[-.29,.29])rod(core,light,[-.29,.75,z],[.29,.75,z],.025);
      for(let i=0;i<3;i++)rod(core,bone,[-.12+i*.1,.25+i*.1,-.09],[.12-i*.05,.34+i*.09,.11],.033);
      ellipsoid(core,bone,.12,.4,.06,.075,1,.85,.8);
    }
  } else if(family==="demon"){
    const rank=Math.max(0,id-57), brute=[57,60,61,65].includes(id), regal=[59,63,64].includes(id);
    tapered(core,dark,0,.56,.015,brute?.29:.235,.57,1.18,.82);
    ellipsoid(core,color,0,.68,-.06,brute?.25:.21,1.23,.8,.75);
    pairedLegs(2,.31,.18,.165);arms(.76,brute?.3:.26,brute?.36:.31,color,true);
    const head=headAt(.97,-.075,brute?.19:.17,color,[1.05,1,.9]);
    for (const side of [-1,1]) {
      const brow=box(head,dark,side*.073,.068,-.176,.1,.03,.033);brow.rotation.z=side*.26;
      const fang=cone(head,bone,side*.058,-.13,-.16,.023,.095,4);fang.rotation.z=Math.PI;
    }
    box(head,dark,0,-.09,-.15,.16,.035,.055);
    horns(head, id===15?.16:regal?.25:.32,regal?.17:.19,[57,60].includes(id));
    wings(.73,id===15?.55:id===58?1.02:regal?.87:.78,id===62?.43:.25,dark);
    if(regal)crown(head,id!==59);
    if([57,60,61].includes(id))for(const side of[-1,1]){
      box(core,light,side*.24,.77,.02,.17,.14,.24);
      if(id===60)for(let i=0;i<2;i++)cone(core,bone,side*(.22+i*.07),.91,.025,.045,.19,4).rotation.z=-side*.4;
    }
    if(id===61)tusks(head,.2);
    if(id===62)for(const side of[-1,1])cone(core,light,side*.2,.79,.22,.1,.28,4).rotation.x=.5;
    if(id===64)for(const side of[-1,1])cone(head,bone,side*.09,.26,.11,.04,.29,4).rotation.x=.32;
    if(id===65){
      for(let i=0;i<7;i++){const flame=cone(core,0xe4a05a,Math.sin(i*1.9)*.24,.79+(i%3)*.1,.05+Math.cos(i*1.9)*.14,.075,.3+(i%2)*.12,4);flame.material=matBasic(0xe4a05a);}
      for(const side of[-1,1]){const fissure=box(core,0xf1bc73,side*.085,.655,-.238,.025,.18,.025);fissure.rotation.z=side*.22;fissure.material=matBasic(0xf1bc73);}
    }
    tail(.28+rank*.008,.065,.14,color,true);
  } else {
    if(id===29){
      cone(core,dark,0,.16,0,.13,.28,6);
      const whirl=moving("whirl",0,.15,0,"whirl");
      for(let i=0;i<4;i++){
        const radius=.16+i*.072,ring=new THREE.Mesh(shape("whirl-ring",()=>new THREE.TorusGeometry(1,.07,3,16)),mat(i%2?color:light,{transparent:true,opacity:.8,depthWrite:false}));
        ring.rotation.x=-Math.PI/2;ring.position.set(Math.sin(i*1.5)*.03,.12+i*.16,Math.cos(i*1.5)*.03);ring.scale.setScalar(radius);whirl.add(ring);
      }
    }else if(id===55){
      ellipsoid(core,color,0,.35,0,.28);
      for(let i=0;i<18;i++){
        const y=1-2*(i+.5)/18,angle=i*2.39996,r=Math.sqrt(1-y*y),normal=new THREE.Vector3(Math.cos(angle)*r,y,Math.sin(angle)*r);
        const spike=cone(core,i%3?dark:light,...normal.clone().multiplyScalar(.32).add(new THREE.Vector3(0,.35,0)).toArray(),.034,.22,4);
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),normal);
      }
    }else if(id===37){
      ellipsoid(core,color,0,.48,0,.32,1.05,1.18,1.05);
      for(let i=0;i<3;i++){
        const angle=i*Math.PI*2/3,side=[Math.sin(angle),Math.cos(angle)];
        const leg=moving(`leg-${i}`,side[0]*.22,.24,side[1]*.22,"leg",i*Math.PI*.67);
        rod(leg,dark,[0,0,0],[side[0]*.12,-.19,side[1]*.12],.14);box(leg,dark,side[0]*.12,-.2,side[1]*.12,.18,.08,.18);
        ellipsoid(core,dark,side[0]*.2,.64,side[1]*.2,.12,1,.7,1);
        const eye=flat(core,circle,0xe0c68b,side[0]*.295,.59,side[1]*.295);eye.scale.setScalar(.055);eye.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(side[0],.25,side[1]).normalize());
      }
      const mouth=flat(core,circle,0x252e29,0,.865,0);mouth.rotation.x=-Math.PI/2;mouth.scale.setScalar(.13);
    }else if(id===47){
      tapered(core,color,0,.37,0,.34,.65,.35,.8,{transparent:true,opacity:.82,depthWrite:false});
      ellipsoid(core,light,0,.69,-.015,.23,1.1,.8,.9);
      arms(.72,.25,.3,color);
      const head=headAt(.94,-.04,.16,light);crown(head);
      for(const side of[-1,1])rod(core,0xa7d4ce,[side*.15,.25,.07],[side*.26,.48,.04],.065);
    }else{
      ellipsoid(core,dark,0,.34,.04,.3,1.15,.88,1);
      for(let i=0;i<4;i++)ellipsoid(core,i%2?color:light,Math.sin(i*2.1)*.2,.47+(i%2)*.19,Math.cos(i*2.1)*.16,.18,1,1.1,.85);
      arms(.57,.23,.27,color);pairedLegs(2,.18,.15,.15);eyePair(core,.61,-.26,.07,0xe4bbab);
      for(const side of[-1,1])cone(core,color,side*.16,.73,-.025,.065,.22,4).rotation.z=-side*.45;
    }
  }
  root.scale.setScalar(scale);
  root.userData = { species: id, model, modelKey:model, presentation:"model", artPath:null, family, feature, facing:{x:0,y:1} };
  for(const part of parts){part.userData.restRotation=part.rotation.toArray().slice(0,3);compact(part,true);}
  const shadow=new THREE.Mesh(shadowGeometry,shadowMaterial);shadow.name="contact-disc";shadow.rotation.x=-Math.PI/2;shadow.position.y=.016;root.add(shadow);
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
  const elapsed = Math.max(0, Math.min(50, now - (group.userData.animationAt ?? now)));
  group.userData.animationAt = now;
  const target = walking && !reduced ? 1 : 0;
  let stride = group.userData.stride || 0;
  stride += (target - stride) * (1 - Math.exp(-elapsed / (walking ? 35 : 55)));
  if (reduced || (!target && stride < .003)) stride = 0;
  group.userData.stride = stride;
  const phase = now * .008 + (group.userData.uid || group.userData.species) * .7;
  const angle = group.userData.targetAngle ?? group.rotation.y;
  let difference = (angle - group.rotation.y + Math.PI) % (Math.PI * 2);
  if (difference < 0) difference += Math.PI * 2;
  group.rotation.y += (difference - Math.PI) * (reduced ? 1 : .35);
  body.position.y = reduced ? 0 : Math.sin(phase) * (.006 + stride * .01);
  for (const part of body.children) {
    const rest = part.userData.restRotation;
    if (!rest) continue;
    const motion = part.userData.motion, wave = Math.sin(phase + (part.userData.phase || 0));
    part.rotation.set(...rest);
    if (reduced) continue;
    if (["leg", "arm", "insect"].includes(motion))
      part.rotation.x += wave * stride * (motion === "insect" ? .12 : motion === "arm" ? .15 : .22);
    if (motion === "wing") part.rotation.z += Math.sin(phase * .6) * .09;
    if (motion === "tail") part.rotation.y += Math.sin(phase * .5) * .12;
    if (motion === "tendril") part.rotation.z += wave * .08;
    if (motion === "whirl") part.rotation.y += (now * .00035) % (Math.PI * 2);
    if (motion === "jaw") part.rotation.x -= Math.abs(wave) * stride * .04;
  }
  return stride > .003;
}

export function creatureMetrics() { return { creatureTemplates: templates.size, monsterTextures: 0, monsterMaterials: 0 }; }
export function releaseCreatureResources(clear = false) {
  const geometries = new Set();
  templates.forEach((group) => group.traverse((object) => { if (object.geometry) geometries.add(object.geometry); }));
  geometries.forEach((geometry) => geometry.dispose()); shadowMaterial.dispose();
  if (clear) templates.clear();
}
