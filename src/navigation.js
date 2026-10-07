export const DIRECTIONS = [
  [-1, -1, "y"], [0, -1, "k"], [1, -1, "u"], [-1, 0, "h"],
  [1, 0, "l"], [-1, 1, "b"], [0, 1, "j"], [1, 1, "n"],
];
export const MOVE_DELAY = 220;
export const MOVE_INTERVAL = 140;
export const movementKey = (key) => ["up", "down", "left", "right", "home", "end", "pageup", "pagedown", ...DIRECTIONS.map((d) => d[2])].includes(key);
// Missing metadata is conservative: only explicitly harmless visible creatures
// are passable. A mimic wearing a lemming silhouette is still a threat.
export const isHostile = (tile) => !!tile?.monster && tile.monster.harmless !== true;

// One timer, one action per deadline. A stalled frame never creates a burst of turns.
export class HeldMovement {
  constructor(send, allowed, timers = globalThis) {
    this.send = send; this.allowed = allowed; this.timers = timers;
    this.current = null; this.timer = null;
  }
  start(key, source) {
    this.stop();
    if (!this.allowed()) return;
    this.current = { key, source };
    this.send(key);
    if (!this.current || !this.allowed()) { this.stop(); return; }
    this.timer = this.timers.setTimeout(() => this.repeat(), MOVE_DELAY);
  }
  repeat() {
    this.timer = null;
    if (!this.current || !this.allowed()) { this.stop(); return; }
    this.send(this.current.key);
    if (!this.current || !this.allowed()) { this.stop(); return; }
    this.timer = this.timers.setTimeout(() => this.repeat(), MOVE_INTERVAL);
  }
  release(source) { if (this.current?.source === source) this.stop(); }
  stop() {
    this.timers.clearTimeout(this.timer);
    this.timer = null; this.current = null;
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
