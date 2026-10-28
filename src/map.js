const CELL = 16;
const symbol = (tile) => tile.monster?.symbol || ({ 5: "<", 13: ">" })[tile.id] || tile.symbol || (tile.wall ? "#" : ".");

/*
 * The ways up and down that < and > travel to (stairsTravel3D in bridge.js):
 * stairs, the home exit on Depth 1, the shaft up on Volcano 1 and the dungeon
 * entrance in town. Map glyphs and the stair compass share these colors.
 */
export const STAIR_COLORS = Object.freeze({ up: "#6ecf7a", down: "#e07070" });
const UP_EXITS = new Set([5, 56, 93]), DOWN_EXITS = new Set([13, 54]);
export const exitDirection = (tile) => UP_EXITS.has(tile?.id) ? "up" : DOWN_EXITS.has(tile?.id) ? "down" : null;

/**
 * The stair compass: for each way, the nearest one the player has charted
 * (the snapshot holds only seen tiles), as a bearing from the player in map
 * space (0 east, π/2 south). Dead ends lead nowhere and are skipped; standing
 * on a way leaves nothing to point to. Presentation only: < and > still go
 * where the engine sends them.
 */
export function stairCompass(state) {
  const nearest = {};
  for (const tile of state?.tiles || []) {
    const direction = exitDirection(tile);
    if (!direction || tile.stair?.blocked) continue;
    const dx = tile.x - state.x, dy = tile.y - state.y, distance = Math.hypot(dx, dy);
    if (!nearest[direction] || distance < nearest[direction].distance)
      nearest[direction] = { direction, x: tile.x, y: tile.y, distance, angle: Math.atan2(dy, dx) };
  }
  return ["up", "down"].map((direction) => nearest[direction]).filter((bearing) => bearing?.distance > 0);
}

// A compass arrow in CSS pixels: a gap off the marker, a shaft and a triangular head.
// Two arrows closer than `apart` radians are set side by side.
const ARROW = Object.freeze({ gap: 2, length: 15, head: 7, half: 5, shaft: 3, outline: 2.5, apart: 0.6 });
const OUTLINE = "#071113";

export class GameMap {
  constructor({ compact, expanded, dialog, viewport, travel, stop, glyph = symbol,
    color = tile => tile.monster ? "#ffac8f" : tile.store ? "#b7d9b3" : "#e0cba2",
    allies = () => [], pings = () => [] }) {
    Object.assign(this, { compact, expanded, dialog, viewport, travel, stop });
    Object.assign(this, { glyph, color, allies, pings });
    // Two rasters of the same charted tiles: glyphs for the expanded map, and
    // the whole floor at the compact map's own resolution.
    this.layer = document.createElement("canvas"); this.overview = document.createElement("canvas");
    this.tiles = new Map(); this.compass = [];
    this.zoom = 1;
    compact.addEventListener("click", (event) => this.select(event, compact));
    expanded.addEventListener("pointerdown", (event) => {
      this.drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false };
      expanded.setPointerCapture(event.pointerId);
    });
    expanded.addEventListener("pointermove", (event) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 6) this.drag.moved = true;
      if (this.drag.moved) { viewport.scrollLeft = this.drag.left - dx; viewport.scrollTop = this.drag.top - dy; }
    });
    expanded.addEventListener("pointerup", (event) => {
      const drag = this.drag; this.drag = null;
      if (drag && !drag.moved) this.select(event, expanded);
    });
    expanded.addEventListener("pointercancel", () => { this.drag = null; });
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault(); this.setZoom(this.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event);
    }, { passive: false });
    dialog.addEventListener("close", () => document.getElementById("map-expand").setAttribute("aria-expanded", "false"));
  }
  update(state) {
    if (!state) return;
    const reset = this.state?.level !== state.level;
    this.state = state;
    const ctx = this.layer.getContext("2d");
    if (reset) {
      this.layer.width = state.width * CELL; this.layer.height = state.height * CELL;
      ctx.fillStyle = "#09191e"; ctx.fillRect(0, 0, this.layer.width, this.layer.height);
      this.tiles.clear(); this.renderSignature = "";
    }
    // A new panel size repaints the whole overview; otherwise only changed tiles.
    const resized = this.sizeOverview();
    const overview = this.overview.getContext("2d");
    const known = new Set(); let changed = reset || resized;
    for (const tile of state.tiles) {
      const id = tile.y * state.width + tile.x; known.add(id);
      const signature = `${tile.id}:${tile.wall}:${tile.store}:${this.glyph(tile)}:${!!tile.monster}:${!!tile.stair?.blocked}`;
      if (this.tiles.get(id) === signature && !resized) continue;
      if (this.tiles.get(id) !== signature) { this.tiles.set(id, signature); this.drawTile(ctx, tile); }
      changed = true;
      this.drawOverviewTile(overview, tile);
    }
    for (const id of this.tiles.keys()) if (!known.has(id)) {
      this.tiles.delete(id); changed = true;
      ctx.fillStyle = "#09191e"; ctx.fillRect(id % state.width * CELL, Math.floor(id / state.width) * CELL, CELL, CELL);
      this.clearOverviewTile(overview, id % state.width, Math.floor(id / state.width));
    }
    this.party = this.allies().filter(ally => ally.alive && ally.dungeon === state.level);
    this.markers = this.pings();
    this.compass = stairCompass(state);
    const signature = JSON.stringify([state.x, state.y,
      this.party.map(ally => [ally.x, ally.y, ally.name]), this.markers.map(ping => [ping.x, ping.y])]);
    if (!changed && signature === this.renderSignature) return;
    this.renderSignature = signature;
    this.drawCompact(); if (this.dialog.open) this.drawExpanded();
  }
  drawTile(ctx, tile) {
    const x = tile.x * CELL, y = tile.y * CELL;
    ctx.fillStyle = tile.wall ? "#3a514e" : "#142d30"; ctx.fillRect(x, y, CELL, CELL);
    if (!tile.wall) {
      ctx.fillStyle = this.color(tile);
      ctx.font = "12px ui-monospace, SFMono-Regular, Consolas, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const glyph = this.glyph(tile);
      if (glyph && glyph !== "." && glyph !== " ") ctx.fillText(glyph, x + CELL / 2, y + CELL / 2);
      else { ctx.fillStyle = "#53736a"; ctx.fillRect(x + 7, y + 7, 2, 2); }
    }
  }
  /** The overview matches the compact canvas pixel for pixel: the whole floor across the panel. */
  sizeOverview() {
    const { width, height } = this.state, canvas = this.compact;
    const css = canvas.clientWidth || canvas.getBoundingClientRect().width;
    const pixels = Math.max(width * 2, Math.round((css || width * 6) * Math.min(2, devicePixelRatio || 1)));
    const rows = Math.round(pixels * height / width);
    // A pixel or two of rounding (a height-driven width on short screens) is not a new size.
    if (Math.abs(this.overview.width - pixels) <= 2 && this.overviewFloor === this.state.level) return false;
    this.overview.width = canvas.width = pixels; this.overview.height = canvas.height = rows;
    this.overviewFloor = this.state.level;
    const ctx = this.overview.getContext("2d");
    ctx.fillStyle = "#09191e"; ctx.fillRect(0, 0, pixels, rows);
    return true;
  }
  /** One tile's edges on the overview, rounded so neighbours meet without seams. */
  overviewCell(x, y) {
    const sx = this.overview.width / this.state.width, sy = this.overview.height / this.state.height;
    const x0 = Math.round(x * sx), y0 = Math.round(y * sy);
    return [x0, y0, Math.round((x + 1) * sx) - x0, Math.round((y + 1) * sy) - y0];
  }
  drawOverviewTile(ctx, tile) {
    const [x, y, w, h] = this.overviewCell(tile.x, tile.y);
    ctx.fillStyle = tile.wall ? "#3a514e" : "#142d30"; ctx.fillRect(x, y, w, h);
    if (tile.wall || (!tile.id && !tile.monster)) return;
    // Too small for letters: a way up or down fills its tile, anything else is a dot in its glyph color.
    ctx.fillStyle = this.color(tile);
    const inset = exitDirection(tile) && !tile.monster ? 0 : Math.max(1, Math.round(w * .22));
    ctx.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  }
  clearOverviewTile(ctx, x, y) {
    const [x0, y0, w, h] = this.overviewCell(x, y);
    ctx.fillStyle = "#09191e"; ctx.fillRect(x0, y0, w, h);
  }
  overlay(ctx, originX = 0, originY = 0) {
    this.drawCompass(ctx, (this.state.x - originX + .5) * CELL, (this.state.y - originY + .5) * CELL, CELL * .75, CELL / 6);
    ctx.fillStyle = "#f4d692";
    ctx.fillRect((this.state.x - originX) * CELL, (this.state.y - originY) * CELL, CELL, CELL);
    ctx.fillStyle = "#18272a"; ctx.font = "bold 14px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("@", (this.state.x - originX + .5) * CELL, (this.state.y - originY + .5) * CELL);
    for (const ally of this.party || []) {
      if (ally.x === this.state.x && ally.y === this.state.y) continue;
      const x = (ally.x - originX) * CELL, y = (ally.y - originY) * CELL;
      ctx.fillStyle = "#9fd7c8"; ctx.fillRect(x, y, CELL, CELL);
      ctx.fillStyle = "#132325";
      ctx.fillText(String(ally.name || "A").slice(0, 1), x + CELL / 2, y + CELL / 2);
    }
    ctx.strokeStyle = "#f3d48a";
    for (const ping of this.markers || [])
      ctx.strokeRect((ping.x - originX) * CELL + 1, (ping.y - originY) * CELL + 1, CELL - 2, CELL - 2);
  }
  /**
   * Green toward the nearest charted way up, red toward the way down, from the
   * player. Near the map's edge an arrow shortens to stay inside it: the head
   * keeps its size and the shaft gives way, under the marker if it must.
   */
  drawCompass(ctx, x, y, from, unit) {
    if (!this.compass?.length) return;
    const { width, height } = ctx.canvas;
    // Arrows pointing nearly the same way sit side by side, still aimed true,
    // instead of one hiding the other. The farther-clockwise one takes its right.
    const [first, second] = this.compass;
    const turn = second ? Math.atan2(Math.sin(second.angle - first.angle), Math.cos(second.angle - first.angle)) : 0;
    const spread = (Math.sign(turn) || 1) * Math.max(0, 1 - Math.abs(turn) / ARROW.apart) * (ARROW.half + ARROW.outline / 2) * unit;
    for (const bearing of this.compass) {
      const { direction, angle } = bearing, side = !second ? 0 : bearing === second ? spread : -spread;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const edge = Math.min(cos > 0 ? (width - x) / cos : cos < 0 ? -x / cos : Infinity,
        sin > 0 ? (height - y) / sin : sin < 0 ? -y / sin : Infinity) - ARROW.outline * unit / 2;
      const tip = Math.min(from + (ARROW.gap + ARROW.length) * unit, edge), neck = tip - ARROW.head * unit;
      const start = Math.min(from + ARROW.gap * unit, neck - unit);
      const half = ARROW.half * unit, shaft = ARROW.shaft * unit / 2;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(angle); ctx.translate(0, side);
      ctx.beginPath();
      ctx.moveTo(start, -shaft); ctx.lineTo(neck, -shaft); ctx.lineTo(neck, -half); ctx.lineTo(tip, 0);
      ctx.lineTo(neck, half); ctx.lineTo(neck, shaft); ctx.lineTo(start, shaft); ctx.closePath();
      ctx.lineJoin = "round"; ctx.lineWidth = ARROW.outline * unit; ctx.strokeStyle = OUTLINE; ctx.stroke();
      ctx.fillStyle = STAIR_COLORS[direction]; ctx.fill();
      ctx.restore();
    }
  }
  /** The whole floor at once. The map never scrolls; the player's marker moves across it. */
  drawCompact() {
    const { width, height } = this.state, canvas = this.compact;
    Object.assign(canvas.dataset, { originX: "0", originY: "0", columns: String(width), rows: String(height), cols: String(width), x0: "0", y0: "0",
      compass: JSON.stringify(this.compass.map(({ direction, x, y, angle }) => ({ direction, x, y, angle: Math.round(angle * 180 / Math.PI) }))) });
    const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.overview, 0, 0);
    const cell = canvas.width / width, unit = Math.min(2, devicePixelRatio || 1);
    const at = (x, y) => [(x + .5) * cell, (y + .5) * canvas.height / height];
    ctx.lineWidth = Math.max(1, unit); ctx.strokeStyle = "#f3d48a";
    for (const ping of this.markers || []) { const [x, y, w, h] = this.overviewCell(ping.x, ping.y); ctx.strokeRect(x - unit, y - unit, w + unit * 2, h + unit * 2); }
    // The marker outgrows its tile so the player is found at a glance.
    const [px, py] = at(this.state.x, this.state.y), radius = Math.max(cell * .85, 3.5 * unit);
    this.drawCompass(ctx, px, py, radius, unit);
    ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#f4d692"; ctx.fill(); ctx.lineWidth = 1.5 * unit; ctx.strokeStyle = OUTLINE; ctx.stroke();
    for (const ally of this.party || []) {
      if (ally.x === this.state.x && ally.y === this.state.y) continue;
      const [x, y, w, h] = this.overviewCell(ally.x, ally.y), grow = Math.round(unit);
      ctx.fillStyle = "#9fd7c8"; ctx.fillRect(x - grow, y - grow, w + grow * 2, h + grow * 2);
    }
  }
  drawExpanded() {
    const canvas = this.expanded;
    if (canvas.width !== this.layer.width || canvas.height !== this.layer.height) { canvas.width = this.layer.width; canvas.height = this.layer.height; }
    Object.assign(canvas.dataset, { originX: "0", originY: "0", columns: String(this.state.width), rows: String(this.state.height), cols: String(this.state.width), x0: "0", y0: "0" });
    const ctx = canvas.getContext("2d"); ctx.drawImage(this.layer, 0, 0); this.overlay(ctx);
    this.sizeExpanded();
  }
  open() {
    if (!this.state) return;
    this.stop(); this.dialog.showModal();
    document.getElementById("map-expand").setAttribute("aria-expanded", "true");
    this.zoom = innerWidth <= 700 ? 2 : 1;
    this.drawExpanded(); this.center();
  }
  sizeExpanded() {
    const fit = Math.min((this.viewport.clientWidth - 24) / this.layer.width, (this.viewport.clientHeight - 24) / this.layer.height);
    this.scale = Math.max(.1, fit) * this.zoom;
    this.expanded.style.width = `${this.layer.width * this.scale}px`;
    this.expanded.style.height = `${this.layer.height * this.scale}px`;
  }
  setZoom(value, event) {
    if (!this.state) return;
    const bounds = this.viewport.getBoundingClientRect();
    const x = event ? event.clientX - bounds.left : this.viewport.clientWidth / 2;
    const y = event ? event.clientY - bounds.top : this.viewport.clientHeight / 2;
    const old = this.zoom; this.zoom = Math.max(1, Math.min(6, value)); this.sizeExpanded();
    this.viewport.scrollLeft = (this.viewport.scrollLeft + x) * this.zoom / old - x;
    this.viewport.scrollTop = (this.viewport.scrollTop + y) * this.zoom / old - y;
  }
  center() {
    this.viewport.scrollLeft = (this.state.x + .5) * CELL * this.scale - this.viewport.clientWidth / 2;
    this.viewport.scrollTop = (this.state.y + .5) * CELL * this.scale - this.viewport.clientHeight / 2;
  }
  resize() { if (this.state) { this.renderSignature = ""; this.update(this.state); } }
  select(event, canvas) {
    if (!this.state) return;
    const bounds = canvas.getBoundingClientRect();
    const x = Number(canvas.dataset.originX) + Math.floor((event.clientX - bounds.left) / bounds.width * Number(canvas.dataset.columns));
    const y = Number(canvas.dataset.originY) + Math.floor((event.clientY - bounds.top) / bounds.height * Number(canvas.dataset.rows));
    const tile = this.state.tiles.find((tile) => tile.x === x && tile.y === y);
    if (!tile) return;
    if (canvas === this.expanded) this.dialog.close();
    this.travel(tile);
  }
}
