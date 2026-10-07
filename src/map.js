const CELL = 16;
const symbol = (tile) => tile.monster?.symbol || ({ 5: "<", 13: ">" })[tile.id] || tile.symbol || (tile.wall ? "#" : ".");

export class GameMap {
  constructor({ compact, expanded, dialog, viewport, travel, stop }) {
    Object.assign(this, { compact, expanded, dialog, viewport, travel, stop });
    this.layer = document.createElement("canvas"); this.tiles = new Map();
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
    const known = new Set(); let changed = reset;
    for (const tile of state.tiles) {
      const id = tile.y * state.width + tile.x; known.add(id);
      const signature = `${tile.id}:${tile.wall}:${tile.store}:${symbol(tile)}:${!!tile.monster}`;
      if (this.tiles.get(id) === signature) continue;
      this.tiles.set(id, signature); changed = true;
      this.drawTile(ctx, tile);
    }
    for (const id of this.tiles.keys()) if (!known.has(id)) {
      this.tiles.delete(id); changed = true;
      ctx.fillStyle = "#09191e"; ctx.fillRect(id % state.width * CELL, Math.floor(id / state.width) * CELL, CELL, CELL);
    }
    const signature = `${state.x},${state.y}`;
    if (!changed && signature === this.renderSignature) return;
    this.renderSignature = signature;
    this.drawCompact(); if (this.dialog.open) this.drawExpanded();
  }
  drawTile(ctx, tile) {
    const x = tile.x * CELL, y = tile.y * CELL;
    ctx.fillStyle = tile.wall ? "#3a514e" : "#142d30"; ctx.fillRect(x, y, CELL, CELL);
    if (!tile.wall) {
      ctx.fillStyle = tile.monster ? "#ffac8f" : tile.store ? "#b7d9b3" : "#e0cba2";
      ctx.font = "12px ui-monospace, SFMono-Regular, Consolas, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const glyph = symbol(tile);
      if (glyph && glyph !== "." && glyph !== " ") ctx.fillText(glyph, x + CELL / 2, y + CELL / 2);
      else { ctx.fillStyle = "#53736a"; ctx.fillRect(x + 7, y + 7, 2, 2); }
    }
  }
  overlay(ctx, originX = 0, originY = 0) {
    ctx.fillStyle = "#f4d692";
    ctx.fillRect((this.state.x - originX) * CELL, (this.state.y - originY) * CELL, CELL, CELL);
    ctx.fillStyle = "#18272a"; ctx.font = "bold 14px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("@", (this.state.x - originX + .5) * CELL, (this.state.y - originY + .5) * CELL);
  }
  drawCompact() {
    const cols = Math.min(27, this.state.width), rows = Math.min(innerHeight < 600 ? 7 : 13, this.state.height);
    const x = Math.max(0, Math.min(this.state.width - cols, this.state.x - Math.floor(cols / 2)));
    const y = Math.max(0, Math.min(this.state.height - rows, this.state.y - Math.floor(rows / 2)));
    const canvas = this.compact;
    if (canvas.width !== cols * CELL || canvas.height !== rows * CELL) { canvas.width = cols * CELL; canvas.height = rows * CELL; }
    Object.assign(canvas.dataset, { originX: String(x), originY: String(y), columns: String(cols), rows: String(rows) });
    const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.layer, x * CELL, y * CELL, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    this.overlay(ctx, x, y);
  }
  drawExpanded() {
    const canvas = this.expanded;
    if (canvas.width !== this.layer.width || canvas.height !== this.layer.height) { canvas.width = this.layer.width; canvas.height = this.layer.height; }
    Object.assign(canvas.dataset, { originX: "0", originY: "0", columns: String(this.state.width), rows: String(this.state.height) });
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
  resize() { if (this.state) { this.drawCompact(); if (this.dialog.open) this.drawExpanded(); } }
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
