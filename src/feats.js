/** Feats: once-only milestones stored on the profile. Pure; the caller persists. */
import { bestiaryCount } from "./profile.js";

export const CALLINGS = Object.freeze([
  "Adventurer", "Wizard", "Rogue", "Elf", "Dwarf", "Ogre", "Klingon", "Rambo",
]);

const feat = (id, title, line, icon) => Object.freeze({ id, title, line, icon });

export const FEATS = Object.freeze([
  feat("first-blood", "First blood", "Your first kill in the caves.", "sword"),
  feat("depth-1", "Into the dark", "Left the daylight for the caves.", "stairs"),
  feat("depth-5", "Deeper still", "Reached cave level 5.", "stairs"),
  feat("depth-10", "The long descent", "Reached cave level 10.", "stairs"),
  feat("depth-15", "Floor of the world", "Stood in the deepest cave, level 15.", "stairs"),
  feat("volcano-1", "Into the fire", "Crossed into the volcano.", "stairs"),
  feat("volcano-5", "Heart of the volcano", "Reached the volcano's deepest vent.", "stairs"),
  feat("eye", "The Eye opens", "Carried the Eye of Larn.", "eye"),
  feat("cure", "A cure in hand", "Held the potion of cure dianthroritis.", "potion"),
  feat("victory", "Daughter saved", "Brought the cure home in time.", "crown"),
  feat("level-5", "Seasoned", "Reached character level 5.", "star"),
  feat("level-10", "Veteran of the deep", "Reached character level 10.", "star"),
  feat("level-20", "Living legend", "Reached character level 20.", "star"),
  feat("bestiary-10", "Field notes", "Met 10 kinds of creature.", "book"),
  feat("bestiary-25", "Naturalist", "Met 25 kinds of creature.", "book"),
  feat("bestiary-50", "Monster scholar", "Met 50 kinds of creature.", "book"),
  feat("bestiary-66", "The full bestiary", "Met 66 kinds of creature.", "book"),
  feat("dragon-slayer", "Dragon slayer", "Felled a dragon.", "skull"),
  feat("demon-lord", "Demonbane", "Destroyed a demon lord.", "skull"),
  feat("gold-1k", "Heavy purse", "Held 1,000 gold at once.", "coin"),
  feat("gold-10k", "Dragon's hoard", "Held 10,000 gold at once.", "coin"),
  feat("second-wind", "Second wind", "Clawed back from a tenth of your life to half.", "heart"),
  feat("every-calling", "Every calling", "Played all eight callings.", "crown"),
]);

const n = (value) => Number(value) || 0;

const holds = (ids, id) => {
  if (id == null || ids == null) return false;
  const key = String(id);
  for (const value of ids) if (String(value) === key) return true;
  return false;
};

const TESTS = {
  "first-blood": ({ snap, context }) => n(snap.kills) >= 1 || context.killedSpecies != null,
  "depth-1": ({ depth }) => depth >= 1,
  "depth-5": ({ depth }) => depth >= 5,
  "depth-10": ({ depth }) => depth >= 10,
  "depth-15": ({ depth }) => depth >= 15,
  "volcano-1": ({ depth }) => depth >= 16,
  "volcano-5": ({ depth }) => depth >= 20,
  eye: ({ snap }) => !!snap.hasEye,
  cure: ({ snap }) => !!snap.hasCure,
  victory: ({ snap }) => !!snap.winner,
  "level-5": ({ snap }) => n(snap.rank) >= 5,
  "level-10": ({ snap }) => n(snap.rank) >= 10,
  "level-20": ({ snap }) => n(snap.rank) >= 20,
  "bestiary-10": ({ seen }) => seen >= 10,
  "bestiary-25": ({ seen }) => seen >= 25,
  "bestiary-50": ({ seen }) => seen >= 50,
  "bestiary-66": ({ seen }) => seen >= 66,
  "dragon-slayer": ({ context }) => holds(context.dragonIds, context.killedSpecies),
  "demon-lord": ({ context }) => holds(context.demonIds, context.killedSpecies),
  "gold-1k": ({ snap }) => n(snap.gold) >= 1000,
  "gold-10k": ({ snap }) => n(snap.gold) >= 10000,
  "second-wind": ({ run, snap }) => !!run.lowHp && n(snap.hpMax) > 0 && n(snap.hp) >= n(snap.hpMax) * .5,
  "every-calling": ({ profile }) => CALLINGS.every((name) => n(profile.callings?.[name]?.runs) > 0),
};

/**
 * Unlocks any feats this snapshot earns. `run` is the caller's per-run memory
 * (second-wind sets run.lowHp). A new profile comes back only when something unlocked.
 */
export const checkFeats = (profile, run = {}, snap = {}, context = {}) => {
  const hp = n(snap.hp), hpMax = n(snap.hpMax);
  if (run && hpMax > 0 && hp > 0 && hp <= hpMax * .1) run.lowHp = true;
  if (context.debug) return { profile, unlocked: [] };

  const owned = profile?.feats || {};
  const facts = {
    profile, run: run || {}, snap, context,
    depth: Math.max(n(snap.level), n(snap.deepest)),
    seen: bestiaryCount(profile),
  };
  const unlocked = FEATS.filter((entry) => owned[entry.id] == null && TESTS[entry.id](facts));
  if (!unlocked.length) return { profile, unlocked };

  const at = context.now ?? Date.now();
  const feats = { ...owned };
  for (const entry of unlocked) feats[entry.id] = at;
  return { profile: { ...profile, feats }, unlocked };
};
