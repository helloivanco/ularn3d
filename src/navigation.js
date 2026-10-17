export const DIRECTIONS = [
  [-1, -1, "y"], [0, -1, "k"], [1, -1, "u"], [-1, 0, "h"],
  [1, 0, "l"], [-1, 1, "b"], [0, 1, "j"], [1, 1, "n"],
];
export const MOVE_DELAY = 220;
export const MOVE_INTERVAL = 140;
const NAMED = { up: "k", down: "j", left: "h", right: "l", home: "y", pageup: "u", end: "b", pagedown: "n" };
/** Tile offset of a movement key, or null. */
export const keyOffset = (key) => {
  const letter = NAMED[key] || String(key).toLowerCase();
  const direction = DIRECTIONS.find((d) => d[2] === letter);
  return direction ? { x: direction[0], y: direction[1] } : null;
};
export const movementKey = (key) => ["up", "down", "left", "right", "home", "end", "pageup", "pagedown", ...DIRECTIONS.map((d) => d[2])].includes(key);
// Missing metadata is conservative: only explicitly harmless visible creatures
// are passable. A mimic wearing a lemming silhouette is still a threat.
export const isHostile = (tile) => !!tile?.monster && tile.monster.harmless !== true;

// One timer, one action per deadline. A stalled frame never creates a burst of turns.
// Repeats keep to the ideal cadence, so engine time does not stretch every step;
// a stall resets the timeline instead of catching up. onCadence reports when the
// next step is due (null when the hold ends) so the glide can carry its speed.
export class HeldMovement {
  constructor(send, allowed, timers = globalThis, onCadence = null) {
    this.send = send; this.allowed = allowed; this.timers = timers; this.onCadence = onCadence;
    this.current = null; this.timer = null; this.due = 0;
  }
  now() { return this.timers.now ? this.timers.now() : performance.now(); }
  start(key, source) {
    this.stop();
    if (!this.allowed()) return;
    this.current = { key, source };
    this.send(key);
    if (!this.current || !this.allowed()) { this.stop(); return; }
    this.schedule(MOVE_DELAY);
  }
  repeat() {
    this.timer = null;
    if (!this.current || !this.allowed()) { this.stop(); return; }
    this.send(this.current.key);
    if (!this.current || !this.allowed()) { this.stop(); return; }
    const remaining = this.due + MOVE_INTERVAL - this.now();
    this.schedule(remaining >= MOVE_INTERVAL / 2 ? Math.min(MOVE_INTERVAL, remaining) : MOVE_INTERVAL);
  }
  schedule(delay) {
    this.due = this.now() + delay;
    this.timer = this.timers.setTimeout(() => this.repeat(), delay);
    this.onCadence?.(delay, this.current.key);
  }
  release(source) { if (this.current?.source === source) this.stop(); }
  stop() {
    const holding = !!this.current;
    this.timers.clearTimeout(this.timer);
    this.timer = null; this.current = null;
    if (holding) this.onCadence?.(null);
  }
}

export function findRoute(state, destination) {
  const cells = new Map(state.tiles.filter((tile) => !tile.wall && !tile.closed && !isHostile(tile) &&
    (!tile.hazard || (tile.x === destination.x && tile.y === destination.y)))
    .map((tile) => [tile.y * state.width + tile.x, tile]));
  const start = state.y * state.width + state.x, goal = destination.y * state.width + destination.x;
  const queue = [{ x: state.x, y: state.y }], previous = new Map([[start, null]]);
  for (let i = 0; i < queue.length && !previous.has(goal); i++) {
    const { x, y } = queue[i];
    const directions = [...DIRECTIONS].sort(([ax, ay], [bx, by]) =>
      (x + ax - destination.x) ** 2 + (y + ay - destination.y) ** 2 -
      (x + bx - destination.x) ** 2 - (y + by - destination.y) ** 2);
    for (const [dx, dy, key] of directions) {
      const nx = x + dx, ny = y + dy, id = ny * state.width + nx;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height || !cells.has(id) || previous.has(id)) continue;
      previous.set(id, { from: y * state.width + x, key, x: nx, y: ny });
      queue.push({ x: nx, y: ny });
    }
  }
  if (!previous.has(goal)) return null;
  const route = [];
  for (let id = goal; id !== start;) {
    const step = previous.get(id); route.push({ key: step.key, x: step.x, y: step.y }); id = step.from;
  }
  return route.reverse();
}
