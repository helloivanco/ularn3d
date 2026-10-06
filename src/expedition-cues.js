/** Stairs, shafts, elevators, the cave mouth, and the way home. */
const STAIR_TILES = new Set([5, 6, 13, 14, 54, 55, 56, 93]);

export const bedForLevel = (level) => {
  const depth = Number(level) || 0;
  if (depth <= 0) return "town";
  if (depth > 15) return "volcano";
  return "cave";
};

const doorId = (id) => (id === 19 || id === 20 ? id : 0);

const doorsOf = (state) => {
  const doors = new Map();
  for (const tile of state.tiles || []) {
    const id = doorId(tile?.id);
    if (id) doors.set(`${tile.x},${tile.y}`, id);
  }
  return doors;
};

const tileAt = (state, x, y) =>
  state.tiles?.find((tile) => tile.x === x && tile.y === y);

const doorMoved = (before, after) => {
  for (const [key, id] of after) {
    const previous = before.get(key);
    if (previous && previous !== id) return true;
  }
  return false;
};

/** One cue per authoritative change. The first snapshot only sets a baseline. */
export const createCueReader = () => {
  let prev = null;
  return (state) => {
    if (!state) return [];
    const doors = doorsOf(state);
    const under = tileAt(state, state.x, state.y)?.id ?? null;
    const next = { level: state.level, x: state.x, y: state.y, under, doors };
    if (!prev) {
      prev = next;
      return [];
    }
    const cues = [];
    if (state.level !== prev.level) {
      if (STAIR_TILES.has(prev.under)) cues.push("stairs");
    } else if (state.x !== prev.x || state.y !== prev.y) {
      cues.push("step");
    }
    if (state.level === prev.level && doorMoved(prev.doors, doors)) cues.push("door");
    prev = next;
    return cues;
  };
};
