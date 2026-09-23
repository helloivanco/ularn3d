import "./style.css";
import "./hud.css";
import { GameAudio } from "./audio.js";
import { World } from "./world.js";
import { iconMarkup, mountIcons, setIcon } from "./icons.js";
mountIcons();
const $ = (id) => document.getElementById(id),
  engine = window.ularn;
const classes = [
  [
    "Adventurer",
    "swords",
    "A balanced traveler. Capable with steel and spells.",
  ],
  [
    "Wizard",
    "wand",
    "A brilliant spellcaster. Powerful magic, fragile defenses.",
  ],
  ["Rogue", "dagger", "Nimble and clever. Dexterity is your greatest weapon."],
  ["Elf", "leaf", "A versatile spellcaster with a light touch in combat."],
  ["Dwarf", "axe", "Sturdy and strong. Built to endure the depths."],
  ["Ogre", "club", "Exceptional strength. Little patience for magic."],
  ["Klingon", "blades", "A formidable fighter. Strong, fierce, and unwise."],
  ["Rambo", "spear", "Terrible attributes. One extraordinary Lance of Death."],
];
let character = "Adventurer",
  state = null,
  world,
  walking = null,
  soundOn = false,
  audio = new GameAudio(),
  toastTimer,
  lastHP = null,
  graphicsLost = false;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const HUD_STATS = ["STR", "INT", "WIS", "CON", "DEX"];
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3200);
}
function sound(kind = "step", detail) {
  if (soundOn) audio.play(kind, detail);
}
window.addEventListener("ularn:combat", ({ detail }) => {
  if (detail.kind === "weapon") sound("weapon", detail);
  else if (detail.kind === "spell" && (!detail.phase || detail.phase === "cast"))
    sound("spell", detail);
});
let inventoryPinned = innerWidth > 700;
try {
  const saved = localStorage.getItem("ularn3d.inventoryPinned");
  if (saved !== null) inventoryPinned = saved === "true";
} catch {}
let inventorySignature = "", effectsSignature = "";
function syncInventoryPin() {
  $("inventory-panel").hidden = !inventoryPinned;
  $("inventory-pin").setAttribute("aria-pressed", String(inventoryPinned));
}
function toggleInventoryPin() {
  inventoryPinned = !inventoryPinned;
  try { localStorage.setItem("ularn3d.inventoryPinned", String(inventoryPinned)); } catch {}
  syncInventoryPin();
}
function toggleAutoLoot() {
  if (!state) return;
  engine.setAutoLoot(!state.autoLoot);
  toast(
    state.autoLoot
      ? "Auto-loot enabled."
      : "Auto-loot disabled. Gold is still collected.",
  );
}
$("inventory-pin").addEventListener("click", toggleInventoryPin);
$("auto-loot").addEventListener("click", toggleAutoLoot);
syncInventoryPin();
function updateInventoryAndEffects() {
  const items = state.inventory.filter(Boolean);
  const signature = JSON.stringify(items);
  if (signature !== inventorySignature) {
    inventorySignature = signature;
    $("inventory-count").textContent = `${items.length} / 26`;
    $("inventory-list").replaceChildren(...items.map((item) => {
      const row = document.createElement("div");
      row.className = "inventory-item";
      const key = document.createElement("kbd");
      key.textContent = item.key;
      const name = document.createElement("span");
      name.textContent = item.name;
      row.append(key, name);
      if (item.equipped?.length) {
        row.classList.add("equipped");
        const tag = document.createElement("small");
        tag.textContent = item.equipped.includes("WIELD") ? "wielded" : "worn";
        row.append(tag);
      }
      return row;
    }));
    if (!items.length) $("inventory-list").textContent = "Your pack is empty.";
  }
  const effects = state.effectDetails || state.effects.map((id) => ({ id, name: id, turns: "" }));
  const effectsKey = JSON.stringify(effects);
  if (effectsKey !== effectsSignature) {
    effectsSignature = effectsKey;
    $("effects-panel").hidden = effects.length === 0;
    $("effects").replaceChildren(...effects.map((effect) => {
      const row = document.createElement("div");
      row.className = "effect-badge";
      row.classList.toggle("harmful", ["BLINDCOUNT", "CONFUSE", "POISON", "ITCHING", "CLUMSINESS", "HALFDAM", "AGGRAVATE", "HASTEMONST"].includes(effect.id));
      row.title = `${effect.name}: ${effect.turns} turns remaining`;
      const name = document.createElement("span");
      name.textContent = effect.name;
      const turns = document.createElement("b");
      turns.textContent = effect.turns;
      row.append(name, turns);
      return row;
    }));
  }
  $("auto-loot").setAttribute("aria-pressed", String(state.autoLoot));
  $("auto-loot").querySelector(".button-label").textContent = `Auto-loot ${state.autoLoot ? "on" : "off"}`;
}
for (const [name, icon, description] of classes) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "class-choice";
  button.setAttribute("aria-pressed", String(name === character));
  button.innerHTML = `<span class="class-emblem" aria-hidden="true">${iconMarkup(icon)}</span>${name}`;
  button.addEventListener("click", () => {
    character = name;
    document
      .querySelectorAll(".class-choice")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    $("class-description").textContent = description;
    sound("open");
  });
  $("classes").appendChild(button);
}
$("class-description").textContent = classes[0][2];
$("continue").hidden = !engine.hasSave();
$("save-notice").hidden = !engine.hasSave();
try {
  world = new World(
    $("world"),
    (tile) => travel(tile),
    (tile, event) => {
      const label = $("tile-label");
      label.hidden = !tile;
      if (tile) {
        label.textContent = tile.monster ? tile.monster.name : tile.name;
        label.style.left =
          Math.min(innerWidth - 200, event.clientX + 15) + "px";
        label.style.top = Math.min(innerHeight - 50, event.clientY + 18) + "px";
      }
    },
  );
  $("graphics-quality").value = world.quality;
  if (reduced) world.controls.autoRotate = false;
  $("loading").hidden = true;
} catch (error) {
  console.error(error);
  $("loading").innerHTML =
    '<div style="max-width:440px;padding:30px;text-align:center">3D graphics could not start.<p style="font:14px Arial;line-height:1.7">Enable hardware acceleration in your browser, then reload. You can also play the complete classic edition below.</p><a style="color:#d7bc83;font:14px Arial" href="/engine/larn_local.html?ularn=true">Open classic Ularn →</a></div>';
}
async function start(resume) {
  $("begin").disabled = true;
  $("continue").disabled = true;
  try {
    await engine.start({
      name: $("hero-name").value,
      character,
      difficulty: $("difficulty").value,
      resume,
    });
    $("welcome").hidden = true;
    $("scene-caption").hidden = true;
    $("hud").hidden = false;
    $("pause").hidden = false;
    document.body.classList.add("playing");
    update();
    sound("open");
  } catch (error) {
    $("start-error").textContent = error.message;
    $("begin").disabled = false;
    $("continue").disabled = false;
  }
}
$("start-form").addEventListener("submit", (e) => {
  e.preventDefault();
  start(false);
});
$("continue").addEventListener("click", () => start(true));
let townOptions = "";
let journalSynced = 0;
const journalNearBottom = (el) =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
const syncJournal = (rawLog) => {
  const lines = rawLog.filter((line) => String(line).trim());
  const el = $("journal-lines");
  const stickToBottom = journalNearBottom(el);
  if (lines.length < journalSynced) {
    el.replaceChildren();
    journalSynced = 0;
  }
  if (journalSynced > 0) {
    const last = el.lastElementChild;
    const latest = lines[journalSynced - 1];
    if (last && latest != null && last.innerHTML !== latest)
      last.innerHTML = latest;
  }
  if (lines.length > journalSynced) {
    const extra = document.createDocumentFragment();
    for (let i = journalSynced; i < lines.length; i++) {
      const row = document.createElement("div");
      row.innerHTML = lines[i];
      extra.appendChild(row);
    }
    el.appendChild(extra);
    journalSynced = lines.length;
  }
  if (stickToBottom) el.scrollTop = el.scrollHeight;
};
function update() {
  const next = engine.snapshot();
  if (!next) return;
  state = next;
  world?.update(state);
  $("player-name").textContent = state.name;
  $("player-class").textContent = state.character;
  setIcon(
    document.querySelector(".hero-seal"),
    classes.find(([name]) => name === state.character)?.[1] || "swords",
  );
  $("player-rank").textContent = `LV ${state.rank}`;
  $("health-text").textContent = `${Math.max(0, state.hp)} / ${state.hpMax}`;
  $("health-bar").style.width =
    `${Math.max(0, Math.min(100, (state.hp / state.hpMax) * 100))}%`;
  $("mana-text").textContent = `${state.mana} / ${state.manaMax}`;
  $("mana-bar").style.width =
    `${Math.max(0, Math.min(100, (state.mana / Math.max(1, state.manaMax)) * 100))}%`;
  $("gold").textContent = state.gold.toLocaleString();
  $("armor").textContent = state.ac;
  $("weapon").textContent = state.wc;
  $("spell-count-value").textContent = `${state.mana}/${state.manaMax}`;
  $("attributes").innerHTML = HUD_STATS.map(
    (stat) => `<span>${stat}=<b>${state.stats[stat]}</b></span>`,
  ).join(" ");
  updateInventoryAndEffects();
  const location =
    state.level === 0
      ? "THE TOWN OF ULARN"
      : state.level <= 15
        ? `THE CAVES · DEPTH ${state.level}`
        : `THE VOLCANO · DEPTH ${state.level - 15}`;
  $("location-name").textContent = location;
  $("map-depth").textContent =
    state.level === 0
      ? "SURFACE"
      : `FLOOR ${state.level > 15 ? "V" + (state.level - 15) : state.level}`;
  $("turn-count").textContent = `TURN ${state.moves}`;
  $("time-left").textContent = Math.ceil(state.timeLeft);
  syncJournal(state.log);
  $("engine-modal").hidden = state.maze && !state.over;
  $("engine-title").textContent = state.over
    ? "EXPEDITION ENDED"
    : "ULARN";
  $("new-after-death").hidden = !state.over;
  const hasActions =
    $("ACTIONS").children.length > 0 || $("KEYBOARD").children.length > 0;
  $("interaction").hidden =
    !hasActions || (!state.prompt && state.maze && !state.over);
  // Keep native command buttons inside the scrollable game panel.
  const trayParent = state.maze
    ? $("app") || document.body
    : document.querySelector(".terminal-card");
  if ($("interaction").parentElement !== trayParent)
    trayParent.appendChild($("interaction"));
  $("interaction").classList.toggle("in-modal", !state.maze);
  if (lastHP !== null && state.hp < lastHP) {
    sound("hurt");
    document.body.classList.remove("damage");
    requestAnimationFrame(() => document.body.classList.add("damage"));
    setTimeout(() => document.body.classList.remove("damage"), 450);
  }
  lastHP = state.hp;
  if (state.saveError) toast(state.saveError);
  $("town-travel").hidden = state.level !== 0;
  if (state.level === 0) {
    const landmarks = state.tiles.filter((t) => t.store);
    const signature = landmarks.map((t) => `${t.id}:${t.x},${t.y}`).join("|");
    if (signature !== townOptions) {
      townOptions = signature;
      $("destination").replaceChildren(
        new Option("Choose a destination…", ""),
        ...landmarks.map(
          (t) => new Option(t.name.replace(/^the /, ""), `${t.x},${t.y}`),
        ),
      );
    }
  }
  drawMap();
}
window.addEventListener("ularn:update", update);
window.addEventListener("resize", () => {
  if (state) drawMap();
  const panel = document.querySelector(".map-panel");
  if (panel) {
    document.body.style.setProperty(
      "--map-bottom",
      `${Math.ceil(panel.getBoundingClientRect().bottom)}px`,
    );
  }
});
const MAP_GLYPHS = {
  5: "<",
  13: ">",
  54: "E",
  55: "V",
  56: "V",
  93: "<",
};

const STAIR_UP_IDS = new Set([5, 93]);
const STAIR_DOWN_IDS = new Set([13]);

function mapGlyphColor(tile) {
  if (tile.monster) return "#ffa590";
  if (STAIR_DOWN_IDS.has(tile.id)) return "#e07070";
  if (STAIR_UP_IDS.has(tile.id)) return "#6ecf7a";
  if (tile.store) return "#c4d7ab";
  return "#f0d7a0";
}

function mapExtent() {
  if (state.level === 0 && typeof townBounds === "function") {
    const b = townBounds();
    const x0 = Math.max(0, b.x0 - 1);
    const y0 = Math.max(0, b.y0 - 1);
    return {
      x0,
      y0,
      cols: Math.min(state.width - x0, b.x1 - x0 + 2),
      rows: Math.min(state.height - y0, b.y1 - y0 + 2),
    };
  }
  return { x0: 0, y0: 0, cols: state.width, rows: state.height };
}

function mapCellSize(cols, rows) {
  const short = innerHeight <= 500 && innerWidth > innerHeight;
  const compact = innerWidth <= 700 || short;
  const maxW = compact
    ? Math.min(
        innerWidth - 28,
        short ? Math.floor(innerWidth * 0.62) : innerWidth - 28,
      )
    : Math.min(Math.floor(innerWidth * 0.56), 684);
  /* Leave room for the top chrome, town destination, and bottom dock. */
  const reserved = short ? 198 : compact ? 412 : 250;
  const maxH = compact
    ? Math.max(24, Math.min(Math.floor(innerHeight * 0.34), innerHeight - reserved))
    : Math.min(innerHeight - 250, 280);
  const cell = Math.max(
    1,
    Math.min(Math.floor(maxW / cols), Math.floor(maxH / rows)),
  );
  return { cell, short, compact };
}

function drawMap() {
  const canvas = $("minimap"),
    ctx = canvas.getContext("2d");
  const { x0, y0, cols, rows } = mapExtent();
  const { cell } = mapCellSize(cols, rows);
  const dpr = Math.min(1.25, window.devicePixelRatio || 1);
  const cssW = cols * cell;
  const cssH = rows * cell;
  const nextWidth = Math.round(cssW * dpr);
  const nextHeight = Math.round(cssH * dpr);
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.dataset.x0 = String(x0);
  canvas.dataset.y0 = String(y0);
  canvas.dataset.cols = String(cols);
  canvas.dataset.rows = String(rows);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  let contentHash =
    (state.level * 9973) ^
    (state.tiles.length * 131) ^
    ((x0 + 1) * 17 + (y0 + 1) * 19 + cols * 23 + rows * 29 + cell);
  for (const t of state.tiles) {
    contentHash =
      (Math.imul(contentHash, 16777619) ^
        ((t.x + 1) * 73471 +
          (t.y + 1) * 19349663 +
          (t.wall ? 3 : 0) +
          t.id * 997 +
          (t.arg ?? 0) * 13 +
          (t.monster?.id ?? 0) * 47)) |
      0;
  }
  const contentKey = `${contentHash}:${cssW}x${cssH}`;
  const playerKey = `${state.x},${state.y}`;
  if (canvas.dataset.contentKey === contentKey && canvas.dataset.playerKey === playerKey)
    return;
  // Walking only moves @. Redraw the old and new cell instead of 57×20 fillRects.
  if (
    canvas.dataset.contentKey === contentKey &&
    canvas.dataset.playerKey &&
    canvas.dataset.playerKey !== playerKey
  ) {
    const [ox, oy] = canvas.dataset.playerKey.split(",").map(Number);
    const paintCell = (x, y, isPlayer) => {
      if (x < x0 || y < y0 || x >= x0 + cols || y >= y0 + rows) return;
      const px = (x - x0) * cell,
        py = (y - y0) * cell;
      if (isPlayer) {
        ctx.fillStyle = "#f8dea0";
        ctx.fillRect(px, py, cell, cell);
        ctx.fillStyle = "#132325";
        const fontPx = Math.max(6, Math.round(cell * 0.8));
        ctx.font = `700 ${fontPx}px ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("@", px + cell / 2, py + cell / 2);
        return;
      }
      const t = state.tiles.find((tile) => tile.x === x && tile.y === y);
      ctx.fillStyle = t?.wall ? "#3a4d4a" : "#173236";
      ctx.fillRect(px, py, cell, cell);
      if (!t || t.wall) return;
      const cx = px + cell / 2,
        cy = py + cell / 2;
      const symbol =
        t.monster?.symbol ||
        MAP_GLYPHS[t.id] ||
        t.symbol ||
        (t.id ? "?" : ".");
      const notable =
        t.monster ||
        MAP_GLYPHS[t.id] ||
        (t.id > 0 && symbol !== "." && symbol !== " " && symbol !== "·");
      if (notable) {
        const fontPx = Math.max(6, Math.round(cell * 0.8));
        ctx.font = `700 ${fontPx}px ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = mapGlyphColor(t);
        ctx.fillText(symbol, cx, cy);
      } else {
        const mark = Math.max(1, Math.round(cell * 0.14));
        ctx.fillStyle = "#6d8a82";
        ctx.fillRect(cx - mark / 2, cy - mark / 2, mark, mark);
      }
    };
    paintCell(ox, oy, false);
    paintCell(state.x, state.y, true);
    canvas.dataset.playerKey = playerKey;
    return;
  }
  ctx.fillStyle = "#0a1214";
  ctx.fillRect(0, 0, cssW, cssH);
  const fontPx = Math.max(6, Math.round(cell * 0.8));
  ctx.font = `700 ${fontPx}px ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const mark = Math.max(1, Math.round(cell * 0.14));
  for (const t of state.tiles) {
    const col = t.x - x0,
      row = t.y - y0;
    if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
    const px = col * cell,
      py = row * cell;
    ctx.fillStyle = t.wall ? "#3a4d4a" : "#173236";
    ctx.fillRect(px, py, cell, cell);
    if (t.wall || (t.x === state.x && t.y === state.y)) continue;
    const cx = px + cell / 2,
      cy = py + cell / 2;
    const symbol =
      t.monster?.symbol ||
      MAP_GLYPHS[t.id] ||
      t.symbol ||
      (t.id ? "?" : ".");
    const notable =
      t.monster ||
      MAP_GLYPHS[t.id] ||
      (t.id > 0 && symbol !== "." && symbol !== " " && symbol !== "·");
    if (notable) {
      ctx.fillStyle = mapGlyphColor(t);
      ctx.fillText(symbol, cx, cy);
    } else {
      ctx.fillStyle = "#6d8a82";
      ctx.fillRect(cx - mark / 2, cy - mark / 2, mark, mark);
    }
  }
  if (
    state.x >= x0 &&
    state.x < x0 + cols &&
    state.y >= y0 &&
    state.y < y0 + rows
  ) {
    const px = (state.x - x0) * cell,
      py = (state.y - y0) * cell;
    ctx.fillStyle = "#f8dea0";
    ctx.fillRect(px, py, cell, cell);
    ctx.fillStyle = "#132325";
    ctx.fillText("@", px + cell / 2, py + cell / 2);
  }
  canvas.dataset.contentKey = contentKey;
  canvas.dataset.playerKey = playerKey;
  const sizeKey = `${nextWidth}x${nextHeight}:${cssW}x${cssH}`;
  if (canvas.dataset.sizeKey !== sizeKey) {
    canvas.dataset.sizeKey = sizeKey;
    const panel = canvas.closest(".map-panel");
    if (panel) {
      document.body.style.setProperty(
        "--map-bottom",
        `${Math.ceil(panel.getBoundingClientRect().bottom)}px`,
      );
    }
  }
}
function stopTravel() {
  engine.interruptTravel();
  if (walking) {
    clearTimeout(walking);
    walking = null;
  }
}
function command(key, shift = false) {
  stopTravel();
  if (!state || graphicsLost) return;
  const before = `${state.level}:${state.x},${state.y}`;
  engine.key(key, shift);
  if (before !== `${state.level}:${state.x},${state.y}`) sound("step");
}
document
  .querySelectorAll("[data-key]")
  .forEach((button) =>
    button.addEventListener("click", () => command(button.dataset.key)),
  );
const keyMap = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "return",
  Escape: "escape",
  Backspace: "backspace",
  " ": "space",
  PageUp: "pageup",
  PageDown: "pagedown",
  Home: "home",
  End: "end",
};
window.addEventListener("keydown", (event) => {
  if (
    !state ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.defaultPrevented ||
    event.key === "Tab" ||
    event.target.matches("input:not([type=button]),select,textarea") ||
    document.querySelector("dialog[open]")
  )
    return;
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.target.closest("button, a[href], input[type=button]")
  )
    return; // Keep native keyboard activation of focused interface controls.
  if (event.key === "F2" || event.key === "F3") {
    event.preventDefault();
    if (!event.repeat) event.key === "F2" ? toggleAutoLoot() : toggleInventoryPin();
    return;
  }
  if (event.key === "Escape" && state.maze && !state.prompt && !state.over) {
    event.preventDefault();
    stopTravel();
    $("pause-dialog").showModal();
    return;
  }
  if (event.key.length === 1 || keyMap[event.key]) {
    event.preventDefault();
    command(keyMap[event.key] || event.key, event.shiftKey);
  }
});
const dirs = [
  [-1, -1, "y"],
  [0, -1, "k"],
  [1, -1, "u"],
  [-1, 0, "h"],
  [1, 0, "l"],
  [-1, 1, "b"],
  [0, 1, "j"],
  [1, 1, "n"],
];
function travel(tile) {
  stopTravel();
  if (
    !state ||
    !state.maze ||
    state.over ||
    state.busy ||
    graphicsLost ||
    document.querySelector("dialog[open]")
  )
    return;
  if (state.prompt) {
    toast("Finish or cancel the current action first.");
    return;
  }
  if (tile.x === state.x && tile.y === state.y) {
    command(tile.id === 5 ? "<" : tile.id === 13 ? ">" : "return");
    return;
  }
  const dx = tile.x - state.x,
    dy = tile.y - state.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) {
    const dir = dirs.find((d) => d[0] === dx && d[1] === dy);
    if (tile.closed) {
      engine.openToward(dir[2]);
      sound("open");
    } else command(dir[2]);
    return;
  }
  if (tile.wall || tile.closed) {
    toast("Choose a reachable floor tile.");
    return;
  }
  if (state.effects.some((e) => ["CONFUSE", "BLINDCOUNT"].includes(e))) {
    toast("Move one step at a time while confused or blinded.");
    return;
  }
  const cells = new Map(
    state.tiles
      .filter(
        (t) =>
          !t.wall &&
          !t.closed &&
          !t.monster &&
          (!t.hazard || (t.x === tile.x && t.y === tile.y)),
      )
      .map((t) => [`${t.x},${t.y}`, t]),
  );
  const startKey = `${state.x},${state.y}`,
    goal = `${tile.x},${tile.y}`;
  const q = [[state.x, state.y]],
    prev = new Map([[startKey, null]]);
  let qi = 0;
  while (qi < q.length && !prev.has(goal)) {
    const [x, y] = q[qi++];
    for (const [a, b, key] of dirs) {
      const nx = x + a,
        ny = y + b,
        k = `${nx},${ny}`;
      if (cells.has(k) && !prev.has(k)) {
        prev.set(k, { from: `${x},${y}`, key });
        q.push([nx, ny]);
      }
    }
  }
  if (!prev.has(goal)) {
    toast("No explored route. Move closer to discover the way.");
    return;
  }
  const path = [];
  let cursor = goal;
  while (cursor !== startKey) {
    const p = prev.get(cursor);
    path.unshift(p.key);
    cursor = p.from;
  }
  const initialLevel = state.level;
  let hp = state.hp;
  const step = () => {
    walking = null;
    if (
      !path.length ||
      state.over ||
      state.busy ||
      graphicsLost ||
      state.effects.some((e) => ["CONFUSE", "BLINDCOUNT"].includes(e)) ||
      !state.maze ||
      state.prompt ||
      state.level !== initialLevel ||
      state.hp < hp ||
      document.querySelector("dialog[open]")
    )
      return;
    if (
      state.tiles.some(
        (t) =>
          t.monster &&
          Math.max(Math.abs(t.x - state.x), Math.abs(t.y - state.y)) <= 6,
      )
    ) {
      toast("A creature is near. Travel stopped.");
      return;
    }
    const before = `${state.x},${state.y}`;
    engine.key(path.shift());
    if (before === `${state.x},${state.y}`) return;
    if (state.hp < hp) {
      toast("You were hurt. Travel stopped.");
      return;
    }
    hp = state.hp;
    if (path.length) walking = setTimeout(step, 110);
  };
  step();
}
$("minimap").addEventListener("click", (event) => {
  if (!state) return;
  const canvas = event.currentTarget;
  const r = canvas.getBoundingClientRect(),
    cols = Number(canvas.dataset.cols) || state.width,
    rows = Number(canvas.dataset.rows) || state.height,
    x0 = Number(canvas.dataset.x0) || 0,
    y0 = Number(canvas.dataset.y0) || 0,
    x = x0 + Math.floor(((event.clientX - r.left) / r.width) * cols),
    y = y0 + Math.floor(((event.clientY - r.top) / r.height) * rows);
  const t = state.tiles.find((tile) => tile.x === x && tile.y === y);
  if (t) travel(t);
});
$("sound").addEventListener("click", () => {
  soundOn = !soundOn;
  $("sound").setAttribute(
    "aria-label",
    soundOn ? "Disable sound" : "Enable sound",
  );
  $("sound").title = soundOn ? "Disable sound" : "Enable sound";
  $("sound").setAttribute("aria-pressed", String(soundOn));
  setIcon(
    $("sound").querySelector("[data-icon]"),
    soundOn ? "soundOn" : "soundOff",
  );
  $("sound").querySelector(".button-label").textContent = soundOn
    ? "Sound on"
    : "Sound off";
  if (soundOn) sound("open");
  else audio.suspend();
});
$("guide").addEventListener("click", () => {
  stopTravel();
  $("guide-dialog").showModal();
});
$("pause").addEventListener("click", () => {
  stopTravel();
  $("pause-dialog").showModal();
});
for (const b of document.querySelectorAll(".close-dialog"))
  b.addEventListener("click", () => b.closest("dialog").close());
$("resume-game").addEventListener("click", () => $("pause-dialog").close());
$("save").addEventListener("click", () =>
  toast(
    engine.save()
      ? "Expedition saved on this device."
      : engine.snapshot()?.saveError ||
          "Finish the current action before saving.",
  ),
);
$("save-exit").addEventListener("click", () => {
  if (engine.save()) location.reload();
  else
    $("pause-status").textContent =
      engine.snapshot()?.saveError ||
      "Finish or cancel the current action, then save.";
});
$("original-help").addEventListener("click", () => {
  $("pause-dialog").close();
  command("?");
});
$("new-after-death").addEventListener("click", () => location.reload());
$("rotate-left").addEventListener("click", () => world.rotate(-1));
$("rotate-right").addEventListener("click", () => world.rotate(1));
$("camera-reset").addEventListener("click", () => world.reset());
$("zoom-in").addEventListener("click", () => world.zoom(0.82));
$("zoom-out").addEventListener("click", () => world.zoom(1.22));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopTravel();
    engine.save();
    audio.suspend();
  }
});

$("destination").addEventListener("change", (event) => {
  const [x, y] = event.target.value.split(",").map(Number);
  const t = state?.tiles.find((t) => t.x === x && t.y === y);
  if (t) travel(t);
  event.target.value = "";
});

$("graphics-quality").addEventListener("change", (event) =>
  world?.setQuality(event.target.value),
);
window.addEventListener("ularn:storage", (event) => {
  if (event.detail) toast(event.detail);
});
window.addEventListener("ularn:graphics-lost", () => {
  graphicsLost = true;
  stopTravel();
  engine.save();
  $("graphics-status").hidden = false;
});
window.addEventListener("ularn:graphics-restored", () => {
  graphicsLost = false;
  $("graphics-status").hidden = true;
  update();
  toast("Graphics restored. Your expedition is ready.");
});

// Menus and background tabs need no continuous scene rendering.
function syncRenderPause() {
  world?.setPaused?.(document.hidden || !!document.querySelector("dialog[open]"));
}
const dialogObserver = new MutationObserver(syncRenderPause);
for (const dialog of document.querySelectorAll("dialog"))
  dialogObserver.observe(dialog, { attributes: true, attributeFilter: ["open"] });
document.addEventListener("visibilitychange", syncRenderPause);

const mapObserver = new ResizeObserver(() => {
  const bounds = document.querySelector(".map-panel").getBoundingClientRect();
  document.body.style.setProperty("--map-bottom", `${Math.ceil(bounds.bottom)}px`);
});
mapObserver.observe(document.querySelector(".map-panel"));
