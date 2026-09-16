import "./style.css";
import { World } from "./world.js";
import { iconMarkup, mountIcons, setIcon } from "./icons.js";
mountIcons();
const $ = (id) => document.getElementById(id),
  engine = window.ularn;
const classes = [
  ["Adventurer", "swords", "A balanced traveler. Capable with steel and spells."],
  ["Wizard", "wand", "A brilliant spellcaster. Powerful magic, fragile defenses."],
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
  audio,
  toastTimer,
  lastHP = null,
  graphicsLost = false;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3200);
}
function sound(kind = "step") {
  if (!soundOn) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume();
    const o = audio.createOscillator(),
      g = audio.createGain();
    o.connect(g);
    g.connect(audio.destination);
    const t = audio.currentTime;
    const freq =
      kind === "hurt"
        ? 85
        : kind === "spell"
          ? 640
          : kind === "open"
            ? 320
            : 165;
    o.type = kind === "hurt" ? "sawtooth" : "sine";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.12);
    g.gain.setValueAtTime(kind === "hurt" ? 0.045 : 0.028, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.start(t);
    o.stop(t + 0.16);
  } catch {
    /* Sound is optional. */
  }
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
function update() {
  const next = engine.snapshot();
  if (!next) return;
  state = next;
  world?.update(state);
  $("player-name").textContent = state.name;
  $("player-class").textContent = state.character;
  setIcon(document.querySelector(".hero-seal"), classes.find(([name]) => name === state.character)?.[1] || "swords");
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
  $("attributes").innerHTML = Object.entries(state.stats)
    .map(([k, v]) => `<span>${k}<b>${v}</b></span>`)
    .join("");
  $("effects").textContent = state.effects
    .map(
      (e) =>
        ({
          BLINDCOUNT: "Blinded",
          CONFUSE: "Confused",
          INVISIBILITY: "Invisible",
          HASTESELF: "Hasted",
          FIRERESISTANCE: "Fire resistance",
          WTW: "Walk through walls",
          HOLDMONST: "Hold monster",
          TIMESTOP: "Time stop",
        })[e] || e,
    )
    .join(" · ");
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
  $("quest-title").textContent = state.hasCure
    ? "Bring the cure home"
    : state.hasEye
      ? "Into the volcano"
      : "A cure for your child";
  $("quest-text").textContent = state.hasCure
    ? "You have the cure. Return to your home on the surface before time runs out."
    : state.hasEye
      ? "The Eye reveals the demons. Find the cure on the fifth volcanic floor."
      : "Seek the Eye of Larn in the deepest dungeon. Then brave the volcano for the cure.";
  const log = state.log.filter((line) => line.trim());
  $("journal-lines").innerHTML = log
    .map((line) => `<div>${line}</div>`)
    .join("");
  $("journal-lines").scrollTop = $("journal-lines").scrollHeight;
  $("engine-modal").hidden = state.maze && !state.over;
  $("engine-title").textContent = state.over
    ? "THE END OF AN EXPEDITION"
    : "ULARN · YOUR EXPEDITION";
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
function drawMap() {
  const canvas = $("minimap"),
    ctx = canvas.getContext("2d");
  const sx = canvas.width / state.width,
    sy = canvas.height / state.height;
  ctx.fillStyle = "#0a171c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const t of state.tiles) {
    ctx.fillStyle = t.wall
      ? "#50655d"
      : t.monster
        ? "#d9856b"
        : t.id > 0
          ? "#b4b486"
          : "#263f3c";
    ctx.fillRect(
      t.x * sx,
      t.y * sy,
      Math.max(1, sx - 0.8),
      Math.max(1, sy - 0.8),
    );
  }
  ctx.fillStyle = "#f6db98";
  ctx.fillRect(state.x * sx - 1, state.y * sy - 1, sx + 2, sy + 2);
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
  engine.key(key, shift);
  sound(key === "c" ? "spell" : "step");
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
    event.key === "Tab" ||
    event.target.matches("input:not([type=button]),select,textarea") ||
    document.querySelector("dialog[open]")
  )
    return;
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
    command("return");
    return;
  }
  const dx = tile.x - state.x,
    dy = tile.y - state.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) {
    const dir = dirs.find((d) => d[0] === dx && d[1] === dy);
    if (tile.closed) {
      command("o");
      setTimeout(() => engine.key(dir[2]), 30);
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
  const r = event.currentTarget.getBoundingClientRect(),
    x = Math.floor(((event.clientX - r.left) / r.width) * state.width),
    y = Math.floor(((event.clientY - r.top) / r.height) * state.height);
  const t = state.tiles.find((t) => t.x === x && t.y === y);
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
  setIcon($("sound").querySelector("[data-icon]"), soundOn ? "soundOn" : "soundOff");
  $("sound").querySelector(".button-label").textContent = soundOn
    ? "Sound on"
    : "Sound off";
  sound("open");
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
