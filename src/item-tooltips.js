// Ground-item hover blurbs for unique artifacts. Scrolls, potions, armor, and
// normal weapons stay quiet; only this set opens the info box.

export const SPECIAL_ITEM_TOOLTIPS = Object.freeze({
  22: Object.freeze({
    title: "Eye of Larn",
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
    body: "The sword of slashing is quite strong and light, and is impervious to rust.",
  }),
  27: Object.freeze({
    title: "Bessman's Flailing Hammer",
    body: "The Hammer is the strongest weapon in the game.",
  }),
  3: Object.freeze({
    title: "Orb of Enlightenment",
    body: "Carrying the Orb gives permanent expanded awareness.",
  }),
  46: Object.freeze({
    title: "Orb of Dragon Slaying",
    body: "Causes attacks against dragons to be much more effective.",
  }),
  47: Object.freeze({
    title: "Scarab of Negate Spirit",
    body: "Spirit Nagas and Poltergeists damage is halved if you have the scarab of negate spirit.",
  }),
  45: Object.freeze({
    title: "Amulet of Invisibility",
    body: "Causes the 'inv' spell to last much longer.",
  }),
  48: Object.freeze({
    title: "Cube of Undead Control",
    body:
      "Vampires, Wraiths, and Zombies damage is halved if you have the cube of undead control. In addition, they can perform no special attacks upon you, like draining your experience level.",
  }),
  49: Object.freeze({
    title: "Device of Theft Prevention",
    body: "If you have this, leprechauns, Nymphs and Disenchantresses cannot steal anything from you.",
  }),
  86: Object.freeze({
    title: "Hand of Fear",
    body: "Emits the Scare Monster spell at all times.",
  }),
  87: Object.freeze({
    title: "Talisman of the Sphere",
    body:
      "Normally, demons can dispel spheres of annihilation, disenchantresses can cancel them, and if you have the spell 'cancel' cast, that may cancel the sphere too. You can also die by touching the sphere.\n" +
      "Carrying the talisman revokes all of the above.",
  }),
  88: Object.freeze({
    title: "Wand of Wonder",
    body: "You will not fall down any pits or trap doors if you are carrying the wand of wonder.",
  }),
  89: Object.freeze({
    title: "Staff of Power",
    body: "Carrying the staff of power will cancel any attack by a demonlord, demonprince, wraith, or vampire 75% of the time.",
  }),
  91: Object.freeze({
    title: "Slayer",
    body:
      "Demonlords and demonprinces attacks are halved if you are carrying the sword Slayer. Slayer essentially acts as a lance of death, but only against demons. It is otherwise a good strong weapon against other monsters. You will only find Slayer somewhere below dungeon level 10, or in the volcano.",
  }),
  92: Object.freeze({
    title: "Elven Chain",
    body: "Strong and light, impervious to rust.",
  }),
  85: Object.freeze({
    title: "Brass Lamp",
    body:
      "A genie lives in the brass lamp. If you are lucky, by rubbing the lamp, the genie will grant you a spell. Be warned though, the genie does not usually like to be disturbed, and may react unpleasantly. If the genie disappears (along with the lamp) without granting you a wish, it is still possible to find him again. But if you are granted a wish, the genie will not wish to be disturbed again (you only get one wish).",
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
  if (special) return { kind: "special", title: special.title, body: special.body };
  if (QUIET_GROUND_ITEM_IDS.has(tile.id)) return null;
  if (!tile.name) return null;
  return { kind: "name", text: tile.name };
};
