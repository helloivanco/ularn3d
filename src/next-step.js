/* The next step: what the tile underfoot allows, otherwise where the
   expedition goes next. Pure. It reads the snapshot and the engine's own
   contextual buttons and only ever suggests ordinary engine commands. */
import { DIRECTIONS, isHostile } from "./navigation.js";

// Engine tile ids (see MAP_GLYPHS in main.js and stairs.js).
export const TILE = { STAIRS_UP: 5, STAIRS_DOWN: 13, ENTRANCE: 54, SHAFT_DOWN: 55, SHAFT_UP: 56, HOME: 69, HOME_EXIT: 93 };
const CAVE_BOTTOM = 15, VOLCANO_TOP = 16, VOLCANO_BOTTOM = 20;

// Contextual buttons that are about the pack, not this tile.
const GENERIC = new Set(["BUTTON_DROP", "BUTTON_INVENTORY_FULL", "BUTTON_PACKWEIGHT", "BUTTON_TELEPORT"]);

export const depthName = (level) => !level ? "town" : level > CAVE_BOTTOM ? `Volcano ${level - CAVE_BOTTOM}` : `Depth ${level}`;
const sentence = (text) => { const value = String(text || "").trim(); return value ? value[0].toUpperCase() + value.slice(1) : ""; };
const place = (name) => String(name || "").replace(/^(a|an|the)\s+/i, "").replace(/\s*\(dead end\)$/, "");
const tileAt = (state, x, y) => state.tiles.find((tile) => tile.x === x && tile.y === y) || null;

/** Underfoot and adjacent actions, in the engine's own order, at most two. */
export function tileActions(state, buttons = []) {
  const under = tileAt(state, state.x, state.y);
  const actions = [];
  for (const button of buttons) {
    if (!button?.key || button.disabled || GENERIC.has(button.id)) continue;
    actions.push(describe(button, state, under));
    if (actions.length === 2) break;
  }
  return actions;
}

function describe(button, state, under) {
  const { id, key } = button, level = state.level, name = place(under?.name);
  switch (id) {
    case "BUTTON_ENTER_BUILDING":
      if (under?.id === TILE.ENTRANCE) return { key, label: "Enter the caves", detail: "to Depth 1" };
      if (under?.id === TILE.HOME) return { key, label: state.hasCure ? "Bring the cure home" : "Go home", detail: "" };
      return { key, label: "Go inside", detail: name };
    case "BUTTON_DOWNSTAIRS":
      return { key, label: "Go down", detail: under?.stair?.blocked ? "a dead end" : `to ${depthName(level + 1)}` };
    case "BUTTON_UPSTAIRS":
      return { key, label: "Go up", detail: under?.stair?.blocked ? "a dead end" : `to ${depthName(level - 1)}` };
    case "BUTTON_DOWNVOL":
      return { key, label: "Climb down", detail: level === 0 ? "into the volcano" : name };
    case "BUTTON_UPVOL":
      return { key, label: "Climb up", detail: level === VOLCANO_TOP ? "to town" : name };
    case "BUTTON_TAKE":
      return { key, label: "Take", detail: name };
    case "BUTTON_OPEN":
      return { key, label: "Open", detail: "beside you" };
    case "BUTTON_CLOSE":
      return { key, label: "Close the door", detail: "" };
    case "BUTTON_IDTRAPS":
      return { key, label: "Look for traps", detail: "something is near" };
    default:
      return { key, label: sentence(button.label), detail: "" };
  }
}

const known = (state, test) => state.tiles.find(test) || null;
const stairs = (direction) => (tile) => tile.stair?.direction === direction && !tile.stair.blocked;

/**
 * Where the expedition goes next when the tile offers nothing. `travelKeys`
 * says whether > and < walk to known stairs (the engine's own preference);
 * rooms share every step, so they only travel by clicking.
 */
export function goalStep(state, { room = false, travelKeys = true, explore = true } = {}) {
  const level = state.level, walk = !room && travelKeys, scout = !room && explore ? "X" : null;
  const go = (label, detail, target, key = null) => ({ label, detail, target, key: target && key && walk ? key : null });
  const search = (label, detail) => ({ label, detail, target: null, key: scout });
  if (state.hasCure) {
    if (level === 0) return go("Bring the cure home", "your daughter is waiting", known(state, (tile) => tile.id === TILE.HOME));
    const exit = level === 1 ? known(state, (tile) => tile.id === TILE.HOME_EXIT)
      : level === VOLCANO_TOP ? known(state, (tile) => tile.id === TILE.SHAFT_UP)
        : known(state, stairs("up"));
    return exit ? go("Carry the cure home", `up to ${depthName(level === VOLCANO_TOP ? 0 : level - 1)}`, exit, level === VOLCANO_TOP ? null : "<")
      : search("Find the way up", "carry the cure home");
  }
  if (level === 0) {
    if ((state.deepest ?? 0) >= CAVE_BOTTOM)
      return go("Enter the volcano", "the cure lies in Volcano 5", known(state, (tile) => tile.id === TILE.SHAFT_DOWN));
    return go("Head into the caves", "the dungeon entrance", known(state, (tile) => tile.id === TILE.ENTRANCE), ">");
  }
  const down = known(state, stairs("down"));
  if (down) return go("Walk to the stairs down", `to ${depthName(level + 1)}`, down, ">");
  const shaft = level >= VOLCANO_TOP ? known(state, (tile) => tile.id === TILE.SHAFT_DOWN) : null;
  if (shaft) return go("Walk to the shaft down", "deeper into the volcano", shaft);
  if (level === VOLCANO_BOTTOM) return search("Find the cure", "it lies on this floor");
  if (level === CAVE_BOTTOM)
    return state.hasEye ? { label: "The caves end here", detail: "the volcano is reached from town", target: null, key: null }
      : search("Find the Eye of Larn", "it lies on this floor");
  return search("Explore", "find the stairs down");
}

/** A creature in reach comes before everything else; moving into it attacks. */
export function foeStep(state) {
  let foe = null, best = DIRECTIONS.length;
  for (const tile of state.tiles) {
    if (!tile.monster || Math.abs(tile.x - state.x) > 1 || Math.abs(tile.y - state.y) > 1 || !isHostile(tile)) continue;
    const index = DIRECTIONS.findIndex(([dx, dy]) => tile.x - state.x === dx && tile.y - state.y === dy);
    if (index >= 0 && index < best) { best = index; foe = tile; }
  }
  return foe ? { key: DIRECTIONS[best][2], label: "Attack", detail: place(foe.monster.name) } : null;
}

/** The whole prompt, or null while a prompt, menu or ending owns the screen. */
export function nextStep(state, buttons = [], options = {}) {
  if (!state || !state.maze || state.over || state.prompt || state.busy) return null;
  const foe = foeStep(state);
  if (foe) return { kind: "foe", actions: [foe] };
  const actions = tileActions(state, buttons);
  if (actions.length) return { kind: "tile", actions };
  const goal = goalStep(state, options);
  return { kind: "goal", actions: [goal] };
}
