// Ground-item hover blurbs for unique artifacts and known hazards.
// Scrolls, potions, armor, and normal weapons stay quiet.

export const SPECIAL_ITEM_TOOLTIPS = Object.freeze({
  22: Object.freeze({
    title: "Eye of Larn",
    guide: "guide-relics",
    body:
      "The Eye now has a very beneficial magic property. If you are carrying the Eye, demonlords, demon princes, and the God of Hellfire are visible to you. Otherwise, they are invisible. They will show as follows:\n\n" +
      "Monster              Character on screen\n" +
      "-------              -------------------\n" +
      "Type I Demon Lord         1\n" +
      "Type II DemonLord         2\n" +
      "Type III DemonLord        3\n" +
      "Type IV DemonLord         4\n" +
      "V DemonLord               5\n" +
      "VI DemonLord              6\n" +
      "VII DemonLord             7\n" +
      "Demon Prince              9\n" +
      "God of Hellfire           0",
  }),
  26: Object.freeze({
    title: "Sword of Slashing",
    guide: "guide-relics",
    body: "The sword of slashing is quite strong and light, and is impervious to rust.",
  }),
  27: Object.freeze({
    title: "Bessman's Flailing Hammer",
    guide: "guide-relics",
    body: "The Hammer is the strongest weapon in the game.",
  }),
  3: Object.freeze({
    title: "Orb of Enlightenment",
    guide: "guide-relics",
    body: "Carrying the Orb gives permanent expanded awareness.",
  }),
  46: Object.freeze({
    title: "Orb of Dragon Slaying",
    guide: "guide-relics",
    body: "Causes attacks against dragons to be much more effective.",
  }),
  47: Object.freeze({
    title: "Scarab of Negate Spirit",
    guide: "guide-relics",
    body: "Spirit Nagas and Poltergeists damage is halved if you have the scarab of negate spirit.",
  }),
  45: Object.freeze({
    title: "Amulet of Invisibility",
    guide: "guide-relics",
    body: "Causes the 'inv' spell to last much longer.",
  }),
  48: Object.freeze({
    title: "Cube of Undead Control",
    guide: "guide-relics",
    body:
      "Vampires, Wraiths, and Zombies damage is halved if you have the cube of undead control. In addition, they can perform no special attacks upon you, like draining your experience level.",
  }),
  49: Object.freeze({
    title: "Device of Theft Prevention",
    guide: "guide-relics",
    body: "If you have this, leprechauns, Nymphs and Disenchantresses cannot steal anything from you.",
  }),
  86: Object.freeze({
    title: "Hand of Fear",
    guide: "guide-relics",
    body: "Emits the Scare Monster spell at all times.",
  }),
  87: Object.freeze({
    title: "Talisman of the Sphere",
    guide: "guide-relics",
    body:
      "Normally, demons can dispel spheres of annihilation, disenchantresses can cancel them, and if you have the spell 'cancel' cast, that may cancel the sphere too. You can also die by touching the sphere.\n" +
      "Carrying the talisman revokes all of the above.",
  }),
  88: Object.freeze({
    title: "Wand of Wonder",
    guide: "guide-relics",
    body: "You will not fall down any pits or trap doors if you are carrying the wand of wonder.",
  }),
  89: Object.freeze({
    title: "Staff of Power",
    guide: "guide-relics",
    body: "Carrying the staff of power will cancel any attack by a demonlord, demonprince, wraith, or vampire 75% of the time.",
  }),
  91: Object.freeze({
    title: "Slayer",
    guide: "guide-relics",
    body:
      "Demonlords and demonprinces attacks are halved if you are carrying the sword Slayer. Slayer essentially acts as a lance of death, but only against demons. It is otherwise a good strong weapon against other monsters. You will only find Slayer somewhere below dungeon level 10, or in the volcano.",
  }),
  92: Object.freeze({
    title: "Elven Chain",
    guide: "guide-relics",
    body: "Strong and light, impervious to rust.",
  }),
  85: Object.freeze({
    title: "Brass Lamp",
    guide: "guide-relics",
    body:
      "A genie lives in the brass lamp. If you are lucky, by rubbing the lamp, the genie will grant you a spell. Be warned though, the genie does not usually like to be disturbed, and may react unpleasantly. If the genie disappears (along with the lamp) without granting you a wish, it is still possible to find him again. But if you are granted a wish, the genie will not wish to be disturbed again (you only get one wish).",
  }),
});

// Known, visible hazards only — invisible traps stay masked as floor.
export const HAZARD_TOOLTIPS = Object.freeze({
  4: Object.freeze({
    title: "Pit",
    guide: "guide-hazards",
    body: "A dark shaft opens underfoot. Mind your footing — a wand of wonder lets you float across.",
  }),
  74: Object.freeze({
    title: "Dart trap",
    guide: "guide-hazards",
    body: "Poisoned darts wait beneath the plate. Stepping here can wound you and sap your strength.",
  }),
  6: Object.freeze({
    title: "Express elevator (up)",
    guide: "guide-hazards",
    body: "An express elevator going up. It may carry you toward daylight — or leave you nowhere useful.",
  }),
  14: Object.freeze({
    title: "Express elevator (down)",
    guide: "guide-hazards",
    body: "An express elevator going down. Swift passage deeper — sometimes toward Hell itself.",
  }),
});

// Scrolls, potions, armor, and normal weapons — no ground info box.
const QUIET_GROUND_ITEM_IDS = Object.freeze(
  new Set([
    41, // scroll
    42, // potion
    23, 24, 25, 60, 61, 62, 63, 64, 68, // armor (not elven chain)
    28, 29, 30, 31, 40, 57, 58, 59, 65, 90, // normal / non-listed weapons
  ]),
);

export const groundHoverInfo = (tile) => {
  if (!tile) return null;
  if (tile.monster) return { kind: "name", text: tile.monster.name };
  const special = SPECIAL_ITEM_TOOLTIPS[tile.id];
  if (special)
    return {
      kind: "special",
      title: special.title,
      body: special.body,
      guide: special.guide,
    };
  const hazard = HAZARD_TOOLTIPS[tile.id];
  if (hazard)
    return {
      kind: "hazard",
      title: hazard.title,
      body: hazard.body,
      guide: hazard.guide,
    };
  if (QUIET_GROUND_ITEM_IDS.has(tile.id)) return null;
  if (!tile.name) return null;
  return { kind: "name", text: tile.name };
};
