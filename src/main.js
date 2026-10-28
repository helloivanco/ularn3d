import "./style.css";
import "./hud.css";
import "./entry.css";
import "./feel.css";
import { GameAudio } from "./audio.js";
import { FeedbackDirector } from "./feedback.js";
import { FeedbackHud } from "./feedback-hud.js";
import { loadFeel, saveFeel, feelSettings, motionReduced } from "./feel-settings.js";
import { loadProfile, saveProfile, recordRun, noteSpecies, rememberLastRun, bestiaryCount } from "./profile.js";
import { checkFeats } from "./feats.js";
import { lineKind } from "./journal.js";
import { Bestiary } from "./bestiary.js";
import { spellKind } from "./combat-effects.js";
import { itemArtImage } from "./item-art.js";
import { audioSettings, musicRegion } from "./audio-score.js";
import { createCueReader } from "./expedition-cues.js";
import { World } from "./world.js";
import { preloadHero } from "./hero-skin.js";
import { LANDMARK_NAMES } from "./models.js";
import { HeldMovement, movementKey, findRoute, isHostile, keyOffset, DIRECTIONS, MOVE_INTERVAL } from "./navigation.js";
import { GameMap, STAIR_COLORS, exitDirection } from "./map.js";
import { iconMarkup, mountIcons, setIcon } from "./icons.js";
import { groundHoverInfo } from "./item-tooltips.js";
import { monsterCardInfo } from "./monster-descriptions.js";
import { mountOnlineUi } from "./online/ui.js";
import { tilesInFog } from "./online/spectator.js";
import { auraControl } from "./cooperation-aura.js";
import { nextStep } from "./next-step.js";
import { pointedChoice } from "./terminal-pick.js";
import { mountGamepad } from "./gamepad.js";
mountIcons();
const onlineUi = mountOnlineUi();
window.ularnOnline = onlineUi;
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
  audio,
  readCues = createCueReader(),
  toastTimer,
  damageTimer,
  lastHP = null,
  graphicsLost = false;
const AUDIO_SETTINGS_KEY = "ularn3d.audio.v1";
let audioPreference = audioSettings(), audioStarted = false, lastAudioError = "", audioControlSignature = "";
try { audioPreference = audioSettings(JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY) || "{}")); } catch {}
audio = new GameAudio({ ...audioPreference, enabled: false, onChange: syncAudioControls });
window.ularnAudio = Object.freeze({ metrics: () => audio.metrics() });
function syncAudioControls() {
  if (!$("sound")) return;
  const metrics = audio.metrics(), retry = soundOn && ["blocked", "error"].includes(metrics.status);
  const signature = JSON.stringify([soundOn, metrics.status, metrics.error, metrics.track, audioPreference.music, audioPreference.effects, !!state?.over]);
  if (signature === audioControlSignature) return;
  audioControlSignature = signature;
  const label = retry ? "Resume sound" : soundOn ? "Disable sound" : "Enable sound";
  $("sound").setAttribute("aria-label", label); $("sound").title = label;
  $("sound").setAttribute("aria-pressed", String(soundOn));
  setIcon($("sound").querySelector("[data-icon]"), soundOn ? "soundOn" : "soundOff");
  $("sound").querySelector(".button-label").textContent = retry ? "Resume sound" : soundOn ? "Sound on" : "Sound off";
  $("audio-enabled").checked = soundOn;
  $("music-volume").value = Math.round(audioPreference.music * 100);
  $("effects-volume").value = Math.round(audioPreference.effects * 100);
  $("music-volume-text").textContent = `${Math.round(audioPreference.music * 100)}%`;
  $("effects-volume-text").textContent = `${Math.round(audioPreference.effects * 100)}%`;
  $("audio-track").textContent = state?.over ? "Expedition ended" : metrics.track;
  $("audio-status").textContent = metrics.error || (metrics.status === "loading" ? "Loading music…" : "");
  if (metrics.error && metrics.error !== lastAudioError) toast(metrics.error);
  lastAudioError = metrics.error;
}
function setAudioPreference(changes) {
  audioPreference = audioSettings({ ...audioPreference, ...changes });
  soundOn = audioPreference.enabled; audioStarted = true;
  try { localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(audioPreference)); } catch {}
  audio.configure(audioPreference); if (soundOn) audio.resume(); syncAudioControls();
}
function activateAudio() {
  if (!state) audio.deferMusic = true;
  if (!audioStarted) { audioStarted = true; soundOn = audioPreference.enabled; audio.configure(audioPreference); syncAudioControls(); }
  if (soundOn) audio.resume();
}
syncAudioControls();

let route = [], travelRevision = 0;
const movementAllowed = () => !!state && state.maze && !state.over && !state.prompt && !state.busy && !state.roomBlocked && !graphicsLost && !document.hidden && !document.querySelector("dialog[open]");
// A held direction tells the renderer when the next step is due, so the hero
// cruises across tiles. Walking into a known wall, door or enemy eases out instead.
const stepOpen = (key) => {
  const offset = keyOffset(key);
  if (!state || !offset) return false;
  const x = state.x + offset.x, y = state.y + offset.y;
  const tile = state.tiles.find((cell) => cell.x === x && cell.y === y);
  return !tile || !(tile.wall || tile.closed || isHostile(tile));
};
const held = new HeldMovement((key) => sendCommand(key), movementAllowed, globalThis, (delay, key) => {
  if (delay != null && stepOpen(key)) world?.expectNextStep(delay);
  else world?.endRun();
});
const heldKeys = new Set();
const gameMap = new GameMap({ compact: $("minimap"), expanded: $("expanded-map"), dialog: $("map-dialog"), viewport: $("map-viewport"), travel: (tile) => travel(tile), stop: () => stopTravel(),
  glyph: tile => tile.monster?.symbol || MAP_GLYPHS[tile.id] || tile.symbol || (tile.id ? "?" : "."), color: mapGlyphColor,
  allies: () => engine.party?.() || [], pings: () => window.ularnOnline?.mapPings?.() || [] });
const systemMotion = matchMedia("(prefers-reduced-motion: reduce)");
let feel = loadFeel(localStorage);
let reduced = motionReduced(feel, systemMotion.matches);
document.body.classList.toggle("reduce-motion", feel.motion === "reduced");
// Cross-run records live apart from the expedition save; rooms never write them.
let profile = loadProfile(localStorage);
let runMemory = { lowHp: false };
let depthRecord = Infinity, recordPassed = false;
const DRAGONS = new Set([25, 48, 49, 53, 54, 56]), DEMONS = new Set([57, 58, 59, 60, 61, 62, 63, 64, 65]);
const RETRY_KEY = "ularn3d.retry";
let endingSequence = false, endingTimer = null, recordedEnding = null, recapDeltas = null;
let director = null, feedbackHud = null, bestiary = null;
const HUD_STATS = ["STR", "INT", "WIS", "CON", "DEX"];
const HERO_NAME_KEY = "ularn3d.heroName";
// Exploring and travel shortcuts run many private steps; a room shares every step.
const ROOM_EXPLORE_NOTE = "Auto explore is off in multiplayer rooms. Click a tile to travel instead.";
const readRememberedHeroName = () => {
  try {
    const dedicated = localStorage.getItem(HERO_NAME_KEY);
    if (dedicated && dedicated.trim()) return dedicated.trim().slice(0, 24);
    /* Classic engine key (ULARN builds append _ularn and JSON-encode). */
    for (const key of ["logname_ularn", "logname"]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string" && parsed.trim())
          return parsed.trim().slice(0, 24);
      } catch {
        const plain = String(raw).replace(/^"|"$/g, "").trim();
        if (plain) return plain.slice(0, 24);
      }
    }
    return null;
  } catch {
    return null;
  }
};
const rememberHeroName = (name) => {
  const clean = String(name || "")
    .trim()
    .slice(0, 24);
  if (!clean) return;
  try {
    localStorage.setItem(HERO_NAME_KEY, clean);
  } catch {
    /* ignore quota */
  }
};
const rememberedName = readRememberedHeroName();
if (rememberedName && $("hero-name")) $("hero-name").value = rememberedName;
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3200);
}
function sound(kind = "step", detail) {
  if (soundOn) audio.play(kind, detail);
}
audio.prefetch();
const syncHeard = (snapshot) => {
  if (!snapshot) return;
  const cues = readCues(snapshot);
  if (!soundOn || snapshot.over) {
    if (snapshot.over) audio.stopMusic();
    return;
  }
  audio.syncBed(snapshot.level);
  for (const cue of cues) if (cue!=="step" || !world) sound(cue);
};
window.addEventListener("ularn:footstep",({detail}) => {
  if (!state || state.over || state.level!==detail.level || state.prompt || document.querySelector("dialog[open]")) return;
  sound("step",{foot:detail.right?"right":"left",surface:detail.level===0 && !world?.paths.has(`${detail.x},${detail.y}`) ? "grass" : detail.level>15 ? "ash" : "stone"});
});
window.addEventListener("ularn:action", ({detail}) => {
  if (!state?.over && detail.level === state?.level && ["loot","potion","read","chest","fountain","altar","throne"].includes(detail.kind)) sound(detail.kind,detail);
  director?.onAction(detail);
});
window.addEventListener("ularn:combat", ({ detail }) => {
  if (state?.over) return;
  if (detail.to && window.ularnGraphics && state) {
    const point = ularnGraphics.projectTile(detail.to.x, detail.to.y, .4);
    const hero = ularnGraphics.projectTile(state.x, state.y, .4);
    detail = { ...detail, pan: Math.max(-.65, Math.min(.65, (point.x - hero.x) / 250)) };
  }
  if (detail.kind === "weapon") sound("weapon", detail);
  else if (detail.kind === "spell" && (!detail.phase || detail.phase === "cast"))
    sound("spell", detail);
  else if (detail.kind === "spell" && detail.phase === "impact")
    sound("spellImpact", { family: spellKind(detail.spell), pan: detail.pan });
  director?.onCombat(detail);
});
// Engine blows are observed here and staged for the next authoritative update.
window.addEventListener("ularn:damage", ({ detail }) => {
  director?.onDamage(detail);
  if (detail.killed && detail.self !== false && detail.known !== false) noteKill(detail.species);
});
window.addEventListener("ularn:hurt", ({ detail }) => director?.onHurt(detail));
let inventoryPinned = innerWidth > 700;
try {
  const saved = localStorage.getItem("ularn3d.inventoryPinned");
  if (saved !== null) inventoryPinned = saved === "true";
} catch {}
let inventorySignature = "", effectsSignature = "";
let hudSignature = "", turnSignature = "";
let hostTurnSeen = null;
let damageFlashTimer = null;
const PERF_ENABLED = (() => {
  try {
    return (
      new URLSearchParams(location.search).has("perf") ||
      localStorage.getItem("ularn3d.perf") === "1"
    );
  } catch {
    return false;
  }
})();
const ularnPerf = {
  enabled: PERF_ENABLED,
  lastUpdateMs: 0,
  moveSamples: [],
  logLines: 0,
  journalNodes: 0,
  logSlices: 0,
  revFastPath: 0,
  heapUsed: null,
  record(ms, extras = {}) {
    this.lastUpdateMs = ms;
    this.moveSamples.push(ms);
    if (this.moveSamples.length > 64) this.moveSamples.shift();
    Object.assign(this, extras);
  },
  mean() {
    const a = this.moveSamples;
    if (!a.length) return 0;
    return a.reduce((x, y) => x + y, 0) / a.length;
  },
  snapshot() {
    return {
      enabled: this.enabled,
      lastUpdateMs: this.lastUpdateMs,
      meanUpdateMs: this.mean(),
      samples: this.moveSamples.length,
      logLines: this.logLines,
      journalNodes: this.journalNodes,
      logSlices: this.logSlices,
      revFastPath: this.revFastPath,
      heapUsed: this.heapUsed,
    };
  },
};
window.ularnPerf = ularnPerf;
window.ularnAudio = audio;
function syncInventoryPin() {
  if (!inventoryPinned) closeItemMenu();
  $("inventory-panel").hidden = !inventoryPinned;
  $("inventory-pin").setAttribute("aria-pressed", String(inventoryPinned));
  updateViewport();
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
// Click a pinned item for what it can do. Each choice sends the classic
// command and that item's letter, the same keys a player would type.
const ITEM_USES = { q: "Quaff", r: "Read", e: "Eat", w: "Wield", W: "Wear", d: "Drop" };
const itemMenu = $("item-menu");
let itemMenuSlot = null;
function closeItemMenu(focusRow = false) {
  if (itemMenuSlot === null) return;
  const row = $("inventory-list").querySelector(`[data-slot="${itemMenuSlot}"]`);
  row?.setAttribute("aria-expanded", "false");
  itemMenu.hidden = true;
  itemMenuSlot = null;
  if (focusRow) row?.focus();
}
function openItemMenu(row, item) {
  closeItemMenu();
  const title = document.createElement("div");
  title.className = "item-menu-title";
  title.textContent = item.name;
  const choices = (item.uses || ["d"]).map((command) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.setAttribute("role", "menuitem");
    choice.dataset.command = command;
    choice.className = command === "d" ? "item-menu-drop" : "";
    const label = document.createElement("span");
    label.textContent = ITEM_USES[command];
    const key = document.createElement("kbd");
    key.textContent = command;
    choice.append(label, key);
    choice.addEventListener("click", () => { closeItemMenu(); usePackItem(command, item.key); });
    return choice;
  });
  itemMenu.replaceChildren(title, ...choices);
  itemMenu.setAttribute("aria-label", `${item.name} actions`);
  itemMenu.hidden = false;
  itemMenuSlot = item.key;
  row.setAttribute("aria-expanded", "true");
  // Beside the panel where there is room, otherwise over the row's right end.
  const rect = row.getBoundingClientRect(), panel = $("inventory-panel").getBoundingClientRect();
  const width = itemMenu.offsetWidth, height = itemMenu.offsetHeight;
  const left = innerWidth - panel.right - 12 >= width ? panel.right + 8 : Math.max(8, rect.right - width);
  itemMenu.style.left = `${left}px`;
  itemMenu.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - height - 8))}px`;
  choices[0].focus();
}
function usePackItem(command, letter) {
  if (window.ularnOnline?.inMatch?.() && !window.ularnOnline.acceptsInput()) return;
  if (!state || !state.maze || state.over || state.busy || graphicsLost) return;
  if (state.prompt) { toast("Finish or cancel the current action first."); return; }
  stopTravel();
  if (world) world.lastInputAt = performance.now();
  engine.usePack(command, letter);
}
itemMenu.addEventListener("keydown", (event) => {
  const choices = [...itemMenu.querySelectorAll("button")], index = choices.indexOf(document.activeElement);
  if (event.key === "Escape") closeItemMenu(true);
  else if (event.key === "ArrowDown" || event.key === "ArrowUp") choices[(index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
  else if (event.key === "Enter" || event.key === " " || event.key === "Tab") return;
  else {
    // The key shown beside a choice picks it; anything else closes the menu and plays on.
    const match = choices.find((choice) => choice.dataset.command === event.key);
    if (!match) { closeItemMenu(); return; }
    match.click();
  }
  event.preventDefault();
  event.stopPropagation();
});
document.addEventListener("pointerdown", (event) => {
  if (itemMenuSlot !== null && !itemMenu.contains(event.target) && !event.target.closest?.(`#inventory-list [data-slot="${itemMenuSlot}"]`)) closeItemMenu();
});
$("inventory-pin").addEventListener("click", toggleInventoryPin);
$("auto-loot").addEventListener("click", toggleAutoLoot);
syncInventoryPin();
function updateInventoryAndEffects() {
  const items = state.inventory.filter(Boolean);
  const signature = items
    .map(
      (item) =>
        `${item.slot}:${item.id}:${item.name}:${(item.equipped || []).join(",")}:${(item.uses || []).join("")}`,
    )
    .join("|");
  if (signature !== inventorySignature) {
    inventorySignature = signature;
    $("inventory-count").textContent = `${items.length} / 26`;
    closeItemMenu();
    $("inventory-list").replaceChildren(...items.map((item) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "inventory-item";
      row.dataset.slot = item.key;
      row.setAttribute("aria-haspopup", "menu");
      row.setAttribute("aria-expanded", "false");
      row.addEventListener("click", () => (itemMenuSlot === item.key ? closeItemMenu(true) : openItemMenu(row, item)));
      const key = document.createElement("kbd");
      key.textContent = item.key;
      const name = document.createElement("span");
      name.textContent = item.name;
      row.append(key, name);
      // Pack items carry their floor (background-stripped) artwork. Art that
      // has not loaded yet, such as starting gear or a continued pack, is
      // fetched and drawn in when it arrives.
      const paintArt = (art) => {
        if (!art || row.querySelector(".item-art")) return;
        const image = document.createElement("canvas");
        image.className = "item-art"; image.width = image.height = 36;
        image.getContext("2d").drawImage(art, 0, 0, 36, 36);
        row.classList.add("with-art");
        key.after(image);
      };
      paintArt(itemArtImage(item.id, item.arg ?? 0, item.known !== false, () =>
        paintArt(itemArtImage(item.id, item.arg ?? 0, item.known !== false))));
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
  const effectsKey = effects
    .map((effect) => `${effect.id}:${effect.turns}`)
    .join("|");
  if (effectsKey !== effectsSignature) {
    effectsSignature = effectsKey;
    requestAnimationFrame(updateViewport);
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
// The title remembers the last calling and difficulty you set out with.
if (classes.some(([name]) => name === profile.lastRun?.character)) character = profile.lastRun.character;
if ([...$("difficulty").options].some((option) => option.value === String(profile.lastRun?.difficulty))) $("difficulty").value = String(profile.lastRun.difficulty);
for (const [name, , description] of classes) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "class-choice";
  button.setAttribute("aria-pressed", String(name === character));
  button.innerHTML = `<img class="class-portrait" src="/art/classes/${name.toLowerCase()}.webp" alt="" width="160" height="192" />${name}`;
  button.addEventListener("click", () => {
    character = name;
    preloadHero(name);
    document
      .querySelectorAll(".class-choice")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    $("class-description").textContent = description;
  });
  $("classes").appendChild(button);
}
$("class-description").textContent = classes.find(([name]) => name === character)[2];
// Fetch the rigged heroes this title can start (chosen calling, saved run, this
// week's challenge) while it waits, so play opens with the hero already dressed.
preloadHero(character);
// Title records: only once there is something to show.
if (profile.runs > 0) {
  const best = profile.best || {}, last = profile.history?.[0];
  $("records-stats").replaceChildren(...[
    ["Best score", Number(best.score || 0).toLocaleString()],
    ["Deepest", profile.deepest > 15 ? `Volcano ${profile.deepest - 15}` : profile.deepest ? `Depth ${profile.deepest}` : "Town"],
    ["Expeditions", String(profile.runs)],
    ["Creatures slain", String(profile.kills || 0)],
  ].map(([label, value]) => { const cell = document.createElement("div"); cell.innerHTML = "<dt></dt><dd></dd>"; cell.querySelector("dt").textContent = label; cell.querySelector("dd").textContent = value; return cell; }));
  $("records-last").textContent = last ? `Last: ${last.character} · ${last.winner ? "returned with the cure" : last.what || "lost"} · ${last.depth > 15 ? `Volcano ${last.depth - 15}` : last.depth ? `Depth ${last.depth}` : "town"}` : "";
  $("records-bestiary-count").textContent = `· ${bestiaryCount(profile)} / 66`;
  $("records").hidden = false;
}
const hasExpedition = engine.hasSave();
$("continue").hidden = !hasExpedition;
$("return-expedition").hidden = !hasExpedition;
$("welcome").classList.toggle("has-save", hasExpedition);
$("save-notice").hidden = !hasExpedition;
if (hasExpedition) {
  $("class-label").textContent = "NEW EXPEDITION · CHOOSE YOUR CALLING";
  $("begin").firstChild.textContent = "Start new expedition ";
  // Continue says who is waiting below, and where.
  const saved = engine.saveSummary?.();
  if (saved) {
    preloadHero(saved.character);
    $("continue-summary").textContent = [
      saved.name && saved.name !== saved.character ? saved.name : "", saved.character,
      saved.level ? (saved.level > 15 ? `Volcano ${saved.level - 15}` : `Depth ${saved.level}`) : "In town",
      `level ${saved.rank}`, `${saved.timeLeft} mobuls left`,
    ].filter(Boolean).join(" · ");
    $("continue-summary").hidden = false;
  }
}
// Enter answers the title at once: Continue when a run is saved, otherwise Begin.
(hasExpedition ? $("continue") : $("begin")).focus({ preventScroll: true });
// Weekly challenge: one dungeon for everyone this ISO week. The first run on
// this browser counts for the weekly board; later runs are practice.
const weekly = engine.weekly();
const closesIn = (closesAt) => {
  const minutes = Math.max(1, Math.round((closesAt - Date.now()) / 60000));
  if (minutes >= 2880) return `${Math.floor(minutes / 1440)} days`;
  if (minutes >= 120) return `${Math.floor(minutes / 60)} hours`;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
};
const plainFate = (fate) => String(fate || "").replace(/<[^>]*>/g, "");
{
  const result = weekly.attempt?.result;
  preloadHero(weekly.character);
  $("weekly").hidden = false;
  $("weekly-title").textContent = `Weekly challenge · Week ${weekly.week}`;
  $("weekly-rules").textContent = `One dungeon for everyone, as a ${weekly.character} on difficulty ${weekly.difficulty}. Closes in ${closesIn(weekly.closesAt)}.`;
  $("weekly-start").textContent = weekly.saved ? (weekly.saved.practice ? "Continue practice" : "Continue") : weekly.attempt ? "Practice" : "Play";
  $("weekly-status").textContent = weekly.saved && !weekly.saved.practice
    ? "Your counted run is in progress."
    : weekly.attempt
      ? `${result ? `Your run: ${result.score.toLocaleString()}, ${result.winner ? "a winner" : `${plainFate(result.fate)} on ${result.level}`}.` : "You have used this week's counted run."} Practice runs are not recorded.`
      : "One counted run per week on this browser.";
  if (weekly.saved && !weekly.saved.practice)
    $("save-notice").textContent = "A new expedition replaces your weekly run, and this week's counted run ends with it.";
}
let weeklyBoardRequest = 0;
async function showWeeklyBoard() {
  const request = ++weeklyBoardRequest;
  const list = $("weekly-board-list");
  $("weekly-board-title").textContent = `Weekly board · Week ${weekly.week}`;
  $("weekly-board-note").textContent = "Loading this week's runs…";
  list.replaceChildren();
  if (!$("weekly-dialog").open) $("weekly-dialog").showModal();
  const board = await window.ularnScoreService?.highscores?.(true, "3d", weekly.label);
  if (request !== weeklyBoardRequest) return;
  if (!board) {
    $("weekly-board-note").textContent = "Could not load the weekly board. Please try again.";
    return;
  }
  const rows = [...board.winners, ...board.visitors];
  const yours = (row) => !!weekly.attempt && row.gameID === weekly.attempt.gameID;
  $("weekly-board-note").textContent = !rows.length
    ? "No runs have finished this week yet."
    : weekly.attempt?.result && !rows.some(yours)
      ? "Your run is not on this list yet. A finished run uploads when you are online."
      : `${weekly.character} · difficulty ${weekly.difficulty}. Winners first by time, then everyone else by score.`;
  for (const row of rows) {
    const item = document.createElement("li");
    if (yours(row)) item.className = "yours";
    item.textContent = `${row.who} · ${Number(row.score).toLocaleString()} · ${row.winner ? `won in ${row.timeused} mobuls` : `${plainFate(row.what)} on ${row.level}`}${yours(row) ? " ← You" : ""}`;
    list.append(item);
  }
}
$("weekly-board").addEventListener("click", showWeeklyBoard);
const showMonsterCard = (card, info, event) => {
  const art = card.querySelector(".monster-card-art");
  const name = card.querySelector(".monster-card-name");
  const body = card.querySelector(".monster-card-desc");
  if (art.getAttribute("src") !== info.art) art.setAttribute("src", info.art);
  name.textContent = info.name;
  body.textContent = info.description;
  card.hidden = false;
  const margin = 8;
  const left = Math.min(
    Math.max(margin, event.clientX + 15),
    Math.max(margin, innerWidth - card.offsetWidth - margin),
  );
  const top = Math.min(
    Math.max(margin, event.clientY + 18),
    Math.max(margin, innerHeight - card.offsetHeight - margin),
  );
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
};
try {
  world = new World(
    $("world"),
    (tile) => travel(tile),
    (tile, event) => {
      const label = $("tile-label");
      const card = $("monster-card");
      const cardInfo = event ? monsterCardInfo(tile?.monster) : null;
      if (cardInfo) {
        showMonsterCard(card, cardInfo, event);
        label.hidden = true;
        return;
      }
      card.hidden = true;
      const info = groundHoverInfo(tile);
      label.hidden = !info;
      label.classList.toggle("tile-label-special", info?.kind === "special");
      label.classList.toggle("tile-label-hazard", info?.kind === "hazard");
      if (!info) return;
      if (info.kind === "special" || info.kind === "hazard") {
        label.replaceChildren();
        const title = document.createElement("strong");
        title.className = "tile-label-title";
        title.textContent = info.title;
        const body = document.createElement("div");
        body.className = "tile-label-body";
        if (info.kind === "special" && info.title === "Eye of Larn")
          body.classList.add("tile-label-mono");
        body.textContent = info.body;
        label.append(title, body);
        if (info.guide) {
          const guide = document.createElement("button");
          guide.type = "button";
          guide.className = "tile-label-guide";
          guide.dataset.guide = info.guide;
          guide.textContent = "Field Guide";
          guide.setAttribute("aria-label", `Open Field Guide: ${info.title}`);
          guide.tabIndex = 0;
          label.append(guide);
        }
        label.style.left =
          Math.min(innerWidth - 360, Math.max(8, event.clientX + 15)) + "px";
        label.style.top =
          Math.min(innerHeight - 200, Math.max(8, event.clientY + 18)) + "px";
        return;
      }
      label.textContent = info.text;
      label.style.left =
        Math.min(innerWidth - 200, event.clientX + 15) + "px";
      label.style.top = Math.min(innerHeight - 50, event.clientY + 18) + "px";
    },
  );
  $("graphics-quality").value = world.quality;
  if (reduced) world.controls.autoRotate = false;
  world.setFeel(feel);
  if (reduced !== world.reduced) world.setReduced(reduced);  $("loading").hidden = true;
} catch (error) {
  console.error(error);
  $("loading").innerHTML =
    '<div style="max-width:440px;padding:30px;text-align:center">3D graphics could not start.<p style="font:14px Arial;line-height:1.7">Enable hardware acceleration in your browser, then reload. You can also play the complete classic edition below.</p><a style="color:#d7bc83;font:14px Arial" href="/engine/larn_local.html?ularn=true">Open classic Ularn →</a></div>';
}
// Game feel: the director decides what an event is worth; world, HUD and
// audio sinks draw and play it. A missing renderer simply drops the 3D half.
const worldSink = new Proxy({}, { get: (_, name) => (...args) => world?.[name]?.(...args) });
feedbackHud = new FeedbackHud({ world, getState: () => state, settings: feel, reduced });
director = new FeedbackDirector({
  sinks: { world: worldSink, hud: feedbackHud, audio: { play: (kind, detail) => sound(kind, detail), heartbeat: (rate) => audio.setHeartbeat?.(rate) } },
  settings: feel, reduced,
});
window.ularnFeel = Object.freeze({
  metrics: () => ({ ...director.metrics(), ...feedbackHud.metrics(), ending: endingSequence, profile: { runs: profile.runs, feats: Object.keys(profile.feats).length, bestiary: bestiaryCount(profile) } }),
});
bestiary = new Bestiary({ dialog: $("bestiary-dialog"), getProfile: () => profile, species: () => engine.species?.() || [] });
const openBestiary = () => { stopTravel(); $("pause-dialog").close(); bestiary.open(); };
$("open-bestiary").addEventListener("click", openBestiary);
$("open-bestiary-recap").addEventListener("click", openBestiary);
$("records-bestiary").addEventListener("click", openBestiary);
const recordsRoom = () => !!window.ularnOnline?.inRoom?.() || !!window.ularnOnline?.spectating?.();
const persistProfile = () => saveProfile(localStorage, profile);
// Feats stack in their own corner, so they never wait behind a level-up banner.
const notifyFeats = (unlocked) => unlocked.forEach((feat, index) => setTimeout(() => {
  feedbackHud.notice({ icon: feat.icon, title: feat.title, line: feat.line });
  sound("feat");
}, 450 + index * 380));
let newCreatureAt = 0;
// First sightings fill the bestiary; a rush of new creatures shares one notice.
function noteSightings(snapshot) {
  if (recordsRoom()) return;
  let changed = false, fresh = [];
  for (const tile of snapshot.tiles) {
    const monster = tile.monster;
    if (!monster?.known) continue;
    const result = noteSpecies(profile, monster.id, { seen: true, at: Date.now() });
    if (result.profile !== profile) { profile = result.profile; changed = true; }
    if (result.firstSeen) fresh.push(monster.name);
  }
  if (!changed) return;
  persistProfile();
  const now = performance.now();
  if (fresh.length && now - newCreatureAt > 2000) {
    newCreatureAt = now;
    feedbackHud.notice({ icon: "book", title: fresh.length > 1 ? `${fresh.length} new creatures` : "New creature", line: fresh.length > 1 ? fresh.join(", ") : `${fresh[0][0].toUpperCase()}${fresh[0].slice(1)} added to your bestiary.` });
  }
  notifyFeats(checkFeatsNow({}));
}
function noteKill(species) {
  if (recordsRoom() || species == null) return;
  profile = noteSpecies(profile, species, { seen: true, killed: true, at: Date.now() }).profile;
  persistProfile();
  notifyFeats(checkFeatsNow({ killedSpecies: species }));
}
function checkFeatsNow(context) {
  if (!state || recordsRoom()) return [];
  const result = checkFeats(profile, runMemory, state, { ...context, dragonIds: DRAGONS, demonIds: DEMONS, now: Date.now(), debug: !!state.ending?.debug });
  if (result.profile !== profile) { profile = result.profile; persistProfile(); }
  return result.unlocked;
}
async function start(resume, weeklyRun = false) {
  if (window.ularnOnline?.inRoom?.()) { window.ularnOnline.openRoom(); return; }
  activateAudio();
  $("begin").disabled = true;
  $("continue").disabled = true;
  $("weekly-start").disabled = true;
  try {
    const heroName = $("hero-name").value;
    rememberHeroName(heroName);
    await engine.start({
      name: heroName,
      character,
      difficulty: $("difficulty").value,
      resume,
      weekly: weeklyRun,
    });
    $("welcome").hidden = true;
    $("hud").hidden = false;
    $("pause").hidden = false;
    document.body.classList.add("playing");
    update();
    world?.beginExpeditionCamera();
    updateViewport();
  } catch (error) {
    $("start-error").textContent = error.message;
    $("begin").disabled = false;
    $("continue").disabled = false;
    $("weekly-start").disabled = false;
  }
}
$("start-form").addEventListener("submit", (e) => {
  e.preventDefault();
  start(false);
});
$("continue").addEventListener("click", () => start(true));
$("weekly-start").addEventListener("click", () => start(!!weekly.saved, true));
let townOptions = "";
// Town destinations read like the signs over their doors ("DND Store", "Bank of Ularn").
const landmarkName = (tile) => {
  const sign = LANDMARK_NAMES[tile.id];
  if (!sign) return tile.name.replace(/^the /, "");
  return sign.toLowerCase().replace(/\b(?!of\b)\w/g, (letter) => letter.toUpperCase()).replace(/^Dnd\b/, "DND");
};
let journalSynced = 0;
let journalLogRev = -1;
/** Hide terminal chrome that classic keys cannot satisfy after death. */
const syncTerminalEndActions = (state) => {
  const footerKeys = document.querySelectorAll(
    "#engine-modal .terminal-footer [data-key]",
  );
  const inertEsc = document.querySelectorAll(
    '#engine-modal .panel-heading [data-key="escape"], #interaction .panel-heading [data-key="escape"]',
  );
  if (!state?.over) {
    footerKeys.forEach((button) => {
      button.hidden = false;
    });
    inertEsc.forEach((button) => {
      button.hidden = false;
    });
    return;
  }
  footerKeys.forEach((button) => {
    const key = button.dataset.key;
    // Enter still opens the scoreboard once; Continue / Return cannot resume a corpse.
    button.hidden = key !== "return" || !state.awaitingScoreboard;
  });
  // Esc close / cancel cannot dismiss a finished expedition.
  inertEsc.forEach((button) => {
    button.hidden = true;
  });
};
const journalNearBottom = (el) =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
// Whether the reader is following the latest lines. A hidden journal (the HUD
// before Continue shows it) cannot scroll, so lines that arrive then are owed
// a scroll, paid before the next measure; otherwise a restored log would open
// at its oldest line and stop following.
let journalFollowing = true, journalOwed = false;
const pinJournal = (el) => {
  el.scrollTop = el.scrollHeight;
  journalOwed = !el.clientHeight;
};
const readJournalPlace = (el) => {
  if (!el.clientHeight) return;
  if (journalOwed && journalFollowing) pinJournal(el);
  journalFollowing = journalNearBottom(el);
};
$("journal-lines").addEventListener("scroll", (event) => readJournalPlace(event.target));
new ResizeObserver(([entry]) => {
  if (journalFollowing) pinJournal(entry.target);
}).observe($("journal-lines"));
let journalRaw = null;
const syncJournal = (rawLog, logRev = null) => {
  // The snapshot reuses its log array until a line changes. Most steps add no
  // line, so they skip the filter and the scroll read (a forced layout).
  if (rawLog === journalRaw && logRev === journalLogRev) return;
  journalRaw = rawLog;
  const lines = rawLog.filter((line) => String(line).trim());
  const el = $("journal-lines");
  readJournalPlace(el);
  // Length shrink OR soft-cap rotation (same length, new logRev) → full rebuild.
  if (
    lines.length < journalSynced ||
    (logRev != null &&
      journalLogRev >= 0 &&
      logRev !== journalLogRev &&
      lines.length <= journalSynced)
  ) {
    el.replaceChildren();
    journalSynced = 0;
  }
  if (logRev != null) journalLogRev = logRev;
  if (journalSynced > 0) {
    const last = el.lastElementChild;
    const latest = lines[journalSynced - 1];
    if (last && latest != null && last.innerHTML !== latest) {
      last.innerHTML = latest;
      last.className = `line-${lineKind(latest)}`;
    }
  }
  if (lines.length > journalSynced) {
    const extra = document.createDocumentFragment();
    for (let i = journalSynced; i < lines.length; i++) {
      const row = document.createElement("div");
      row.innerHTML = lines[i];
      row.className = `line-${lineKind(lines[i])}`;
      extra.appendChild(row);
    }
    el.appendChild(extra);
    journalSynced = lines.length;
  }
  if (journalFollowing) pinJournal(el);
};
function update() {
  const perfStart = ularnPerf.enabled ? performance.now() : 0;
  const next = engine.snapshot();
  if (!next) return;
  const previous = state;
  const previousGold = state?.gold, previousBank = state?.bank;
  const fog = window.ularnOnline?.fogMask?.() ?? null;
  state = fog
    ? { ...next, tiles: tilesInFog(next.tiles, fog), mapRev: `${next.mapRev ?? ""}:${fog.size}` }
    : next;
  // A run measures itself against the deepest floor of every earlier run.
  if (previous?.gameID !== state.gameID) {
    depthRecord = !recordsRoom() && profile.runs > 0 ? profile.deepest : Infinity;
    feedbackHud.recordDepth = depthRecord;
    recordPassed = (state.deepest ?? 0) > depthRecord;
  }
  // Floors change under the veil; slain creatures are marked before the world
  // drops their actors; level-ups and floor cards follow the rebuilt world.
  const veil = director.begin(previous, state);
  if (veil) feedbackHud.veil(veil);
  director.applyEvents(previous, state);
  world?.update(state);
  director.applyDiff(previous, state);
  feedbackHud.sync(state);
  noteWays(state);
  if (previous?.gameID !== state.gameID) runMemory = { lowHp: false };
  if (!previous || previous.actorRev !== state.actorRev || previous.level !== state.level) noteSightings(state);
  if (previous && !state.over && (previous.level !== state.level || previous.rank !== state.rank || previous.gold !== state.gold ||
    previous.hasEye !== state.hasEye || previous.hasCure !== state.hasCure || previous.hp !== state.hp)) notifyFeats(checkFeatsNow({}));
  if (previous?.gameID === state.gameID && !state.over && !recordPassed && state.level > depthRecord && state.deepest > previous.deepest) {
    recordPassed = true;
    const line = depthRecord > 0 ? `Deeper than any expedition before. Your record was ${depthName(depthRecord)}.` : "Deeper than any expedition before.";
    setTimeout(() => { feedbackHud.notice({ icon: "stairs", title: "Deepest yet", line }); sound("feat"); }, reduced ? 0 : 900);
  }
  if (previous && !previous.over && state.over) beginEnding(state);
  if (state.over) recordEnding(state);
  if (window.ularnOnline?.inMatch?.()) {
    document.querySelectorAll('#hud [data-key]').forEach(button => { button.disabled = !!state.roomBlocked; });
    $("explore").disabled = true;
    $("explore").title = ROOM_EXPLORE_NOTE;
    $("auto-loot").disabled = !!state.roomBlocked;
    const auraToggle = document.querySelector('#party-hud .aura-toggle');
    if (auraToggle) auraToggle.disabled = !!state.roomBlocked;
  }
  if (state.moves !== hostTurnSeen) {
    hostTurnSeen = state.moves;
    window.ularnOnline?.hostBeat?.();
  }
  const partyNow = typeof engine.party === "function" ? engine.party() : [];
  const hudKey = [
    state.name,
    state.character,
    state.rank,
    state.hp,
    state.hpMax,
    state.mana,
    state.manaMax,
    state.gold,
    state.ac,
    state.wc,
    state.xp,
    state.xpNext,
    state.title,
    state.level,
    state.stats.STR,
    state.stats.INT,
    state.stats.WIS,
    state.stats.CON,
    state.stats.DEX,
    state.over,
    state.maze,
    state.prompt,
    state.saveError || "",
    partyNow.map((member) => `${member.slot}:${member.name}:${member.hp}:${member.dungeon}`).join(","),
    state.multiplayer ? "mp" : "solo",
    state.aura ? "aura" : "no-aura",
    state.autoLoot,
    state.roomBlocked,
    window.ularnOnline?.spectating?.(),
  ].join("|");
  if (hudKey !== hudSignature) {
    hudSignature = hudKey;
    $("player-name").textContent = state.name;
    $("player-class").textContent = state.character;
    setIcon(
      document.querySelector(".hero-seal"),
      classes.find(([name]) => name === state.character)?.[1] || "swords",
    );
    $("player-rank").textContent = `LV ${state.rank}`;
    $("health-text").textContent = `${Math.max(0, state.hp)} / ${state.hpMax}`;
    const party = partyNow;
    const partyHud = $("party-hud");
    const turnStrip = $("turn-strip");
    const auraNow = partyHud ? auraControl(state) : null;
    if (partyHud && party.length < 2 && !auraNow.control) {
      // Solo play: nothing to draw, so do not rebuild hidden cards.
      partyHud.hidden = true;
      if (partyHud.childElementCount) partyHud.replaceChildren();
    } else if (partyHud) {
      partyHud.hidden = party.length < 2;
      const cards = party.map((member) => {
        const card = document.createElement("article");
        const ratio = member.hpmax ? Math.max(0, Math.min(1, member.hp / member.hpmax)) : 0;
        card.innerHTML = `<strong></strong><div class="meter"><i></i></div><span></span>`;
        card.querySelector("strong").textContent = member.name || "Ally";
        if (window.ularnOnline?.spectating?.()) {
          card.tabIndex = 0;
          card.setAttribute("role", "button");
          card.setAttribute("aria-label", `Follow ${member.name || "ally"}`);
        }
        const handleFollow = () => window.ularnOnline?.followMember?.(member.slot);
        card.addEventListener("click", handleFollow);
        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") handleFollow();
        });
        card.querySelector("i").style.width = `${Math.round(ratio * 100)}%`;
        card.querySelector("span").textContent = `Lv ${member.xl || 1} · D${member.dungeon || 0}`;
        return card;
      });
      if (auraNow.control) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.id = "aura-toggle";
        toggle.className = "aura-toggle";
        toggle.textContent = auraNow.label;
        toggle.setAttribute("aria-pressed", String(auraNow.overlay));
        toggle.disabled = !!state.roomBlocked;
        toggle.addEventListener("click", () => {
          if (window.ularnOnline?.acceptsInput && !window.ularnOnline.acceptsInput()) return;
          window.ularnOnline?.requestAura?.(!auraNow.overlay);
        });
        cards.push(toggle);
      }
      partyHud.replaceChildren(...cards);
    }
    if (turnStrip && typeof engine.groups === "function") {
      const groups = engine.groups().filter((group) => group.length > 1);
      turnStrip.hidden = groups.length === 0;
      turnStrip.replaceChildren(...groups.flatMap((group) => group.map((member, index) => {
        const chip = document.createElement("span");
        chip.textContent = index === 0 ? `${member.name} acts` : member.name;
        if (index === 0) chip.className = "acting";
        return chip;
      })));
    }
    // Meters scale on the compositor; the pale ghost holds, then drains to the new value.
    const hpRatio = Math.max(0, Math.min(1, state.hp / Math.max(1, state.hpMax)));
    $("health-bar").style.transform = `scaleX(${hpRatio})`;
    const ghost = $("health-ghost");
    if (ghost) {
      if (previous && previous.gameID === state.gameID && state.hp < previous.hp && !reduced) ghost.style.transform = `scaleX(${hpRatio})`;
      else { ghost.style.transition = "none"; ghost.style.transform = `scaleX(${hpRatio})`; void ghost.offsetWidth; ghost.style.transition = ""; }
    }
    $("mana-text").textContent = `${state.mana} / ${state.manaMax}`;
    $("mana-bar").style.transform = `scaleX(${Math.max(0, Math.min(1, state.mana / Math.max(1, state.manaMax)))})`;
    // Looted gold counts up on its own once the coins land.
    if (!(previous && state.gold > previous.gold && state.bank === previous.bank && !reduced && !director.catchUp && !state.over)) $("gold").textContent = state.gold.toLocaleString();
    $("armor").textContent = state.ac;
    $("weapon").textContent = state.wc;
    $("spell-count-value").textContent = `${state.mana}/${state.manaMax}`;
    syncStatChips(previous);
    $("xp-count-value").textContent = `${state.xp}/${state.xpNext}`;
    $("xp-title").textContent = state.title || "";
    const xpFloor = state.xpFloor ?? 0;
    $("xp-bar").style.transform = `scaleX(${Math.max(0, Math.min(1, (state.xp - xpFloor) / Math.max(1, state.xpNext - xpFloor)))})`;
    if (previous && previous.gameID === state.gameID && state.rank > previous.rank) {
      $("xp-box").classList.remove("xp-flash"); void $("xp-box").offsetWidth; $("xp-box").classList.add("xp-flash");
    }
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
    $("engine-title").textContent = state.over
      ? state.winner ? "EXPEDITION COMPLETE" : "END OF EXPEDITION"
      : "ULARN";
    if (state.saveError) toast(state.saveError);
  }
  // The death or victory beat plays out in the world before the recap opens.
  $("engine-modal").hidden = (state.maze && !state.over) || endingSequence;
  $("new-after-death").hidden = !state.over || endingSequence;
  syncRecap(state);
  syncRunClock(state);
  // The turn and time readouts change every step; the rest of the HUD rarely does.
  const turnKey = `${state.moves}|${Math.ceil(state.timeLeft)}`;
  if (turnKey !== turnSignature) {
    turnSignature = turnKey;
    $("turn-count").textContent = `TURN ${state.moves}`;
    $("time-left").textContent = Math.ceil(state.timeLeft);
  }
  audio.deferMusic = false;
  if (!movementAllowed() || (previous && previous.level !== state.level)) stopTravel();
  if (!state.over) {
    const danger = state.tiles.filter(tile => isHostile(tile) && Math.max(Math.abs(tile.x-state.x), Math.abs(tile.y-state.y)) <= 6).length;
    audio.scene(musicRegion(state.level), Math.min(1,danger/3));
  }
  if (previous && !previous.over && state.over) audio.finish(state.winner ? "victory" : "death");
  $("scoreboard-controls").hidden = !state.scoreboard;
  $("global-scores").setAttribute("aria-pressed", String(!state.localScores));
  $("global-scores").textContent = state.weekly ? "Weekly board" : "Global scores";
  $("local-scores").setAttribute("aria-pressed", String(state.localScores));
  $("score-details").hidden = !state.scoreboard;
  if (state.scoreboard) $("score-details").textContent = $("STATS").textContent;
  $("score-sync-status").hidden = !state.scoreboard;
  if (state.scoreboard) {
    const sync=state.scoreSync;
    $("score-sync-status").textContent = state.weekly?.practice ? "Practice runs are not recorded." : !sync.configured ? "Global records are not configured." : sync.pending ? `${sync.pending} completed score${sync.pending===1?"":"s"} saved locally, waiting to sync.` : sync.latestSyncedGame===state.gameID ? "This expedition’s score is saved globally." : sync.state==="error" && sync.error ? sync.error : "Completed expeditions are shared automatically when online.";
  }
  if (previousGold != null && state.gold > previousGold && state.bank === previousBank && !state.over) sound("coins");
  syncTerminalEndActions(state);
  updateInventoryAndEffects();
  syncJournal(state.log, state.logRev);
  // While the engine asks "In what direction?" its own row still lists the pack
  // commands, so offer the eight directions in their place.
  const promptKind = state.prompt && state.maze && !state.over ? engine.promptKind?.() : null;
  const aiming = promptKind === "direction";
  $("direction-pick").hidden = !aiming;
  $("ACTIONS").hidden = $("KEYBOARD").hidden = aiming;
  $("interaction-title").textContent = aiming ? "CHOOSE A DIRECTION" : promptKind === "spell" ? "CAST A SPELL" : "CHOOSE AN ACTION";
  const hasActions =
    aiming || $("ACTIONS").children.length > 0 || $("KEYBOARD").children.length > 0;
  $("interaction").hidden =
    !hasActions || (state.roomBlocked && !state.over) || (!state.prompt && state.maze && !state.over);
  // Keep native command buttons inside the scrollable game panel.
  // After death the expedition modal owns the tray even while mazeMode is still true.
  const trayParent =
    state.maze && !state.over
      ? $("app") || document.body
      : document.querySelector(".terminal-card");
  if ($("interaction").parentElement !== trayParent)
    trayParent.appendChild($("interaction"));
  $("interaction").classList.toggle("in-modal", !state.maze || state.over);
  if (lastHP !== null && state.hp < lastHP) {
    sound("hurt");
    document.body.classList.remove("damage");
    requestAnimationFrame(() => document.body.classList.add("damage"));
    if (damageFlashTimer) clearTimeout(damageFlashTimer);
    damageFlashTimer = setTimeout(() => {
      document.body.classList.remove("damage");
      damageFlashTimer = null;
    }, 450);
  }
  lastHP = state.hp;
  $("town-travel").hidden = state.level !== 0;
  if (state.level === 0) {
    const landmarks = state.tiles.filter((t) => t.store);
    const signature = landmarks.map((t) => `${t.id}:${t.x},${t.y}`).join("|");
    if (signature !== townOptions) {
      townOptions = signature;
      $("destination").replaceChildren(
        new Option("Choose a destination…", ""),
        ...landmarks.map(
          (t) => new Option(landmarkName(t), `${t.x},${t.y}`),
        ),
      );
    }
  }
  syncNextStep();
  drawMap();
  syncHeard(next);
  if (ularnPerf.enabled) {
    const bridge = engine.perfStats?.() || {};
    const metrics = window.ularnGraphics?.metrics?.() || {};
    ularnPerf.record(performance.now() - perfStart, {
      logLines: bridge.logLines ?? state.log?.length ?? 0,
      journalNodes: $("journal-lines")?.children.length ?? 0,
      logSlices: bridge.logSlices ?? 0,
      revFastPath: metrics.revFastPath ?? 0,
      heapUsed: performance.memory?.usedJSHeapSize ?? null,
    });
  }
}
const STAT_NAMES = { STR: "Strength", INT: "Intelligence", WIS: "Wisdom", CON: "Constitution", DEX: "Dexterity" };
function syncStatChips(previous) {
  const box = $("attributes");
  if (box.childElementCount !== HUD_STATS.length) {
    box.replaceChildren(...HUD_STATS.map((stat) => {
      const chip = document.createElement("span");
      chip.className = "stat-chip";
      chip.dataset.stat = stat;
      chip.innerHTML = `<abbr title="${STAT_NAMES[stat]}">${stat}</abbr> <b></b>`;
      return chip;
    }));
  }
  for (const chip of box.children) {
    const stat = chip.dataset.stat, value = state.stats[stat];
    chip.querySelector("b").textContent = value;
    const before = previous?.gameID === state.gameID ? previous.stats?.[stat] : value;
    if (before != null && value !== before) {
      chip.classList.remove("up", "down");
      void chip.offsetWidth;
      chip.classList.add(value > before ? "up" : "down");
      clearTimeout(chip.fadeTimer);
      chip.fadeTimer = setTimeout(() => chip.classList.remove("up", "down"), 1600);
    }
  }
}
function syncRunClock(snapshot) {
  const clock = document.querySelector(".run-clock"), left = Math.ceil(snapshot.timeLeft);
  clock?.classList.toggle("critical", !snapshot.over && left < 20);
  clock?.classList.toggle("low", !snapshot.over && left >= 20 && left < 50);
}

// ---------- The next step: what this tile allows, else where the run goes ----------
let stepSignature = "", stepActions = [];
// Direction keys read as the arrows most players press.
const STEP_GLYPHS = { y: "↖", k: "↑", u: "↗", h: "←", l: "→", b: "↙", j: "↓", n: "↘" };
const enginePref = (name) => typeof window.getPref !== "function" || window.getPref(name) !== false;
// The engine's own contextual buttons for this tile, with the keys they press.
const engineContext = () => [...$("CONTEXT").querySelectorAll("input")].map((button) => ({
  id: button.id.replace(/^engine-/, ""), key: button.key, label: button.value, disabled: button.disabled,
}));
function syncNextStep() {
  const room = !!window.ularnOnline?.inMatch?.();
  const step = endingSequence || state.roomBlocked || window.ularnOnline?.spectating?.() ? null
    : nextStep(state, engineContext(), { room, travelKeys: enginePref("explore_stairs"), explore: enginePref("explore_toggle") });
  const pad = document.body.classList.contains("pad-active");
  const signature = step ? JSON.stringify([step.kind, pad, step.actions.map((a) => [a.key, a.label, a.detail, a.target?.x, a.target?.y])]) : "";
  if (signature === stepSignature) return;
  const arrived = !!step && step.kind !== "goal" && !stepSignature.startsWith(`["${step.kind}"`);
  stepSignature = signature;
  stepActions = step?.actions || [];
  const box = $("next-step");
  box.hidden = !step;
  if (!step) { box.replaceChildren(); return; }
  box.classList.toggle("on-tile", step.kind === "tile");
  box.classList.toggle("on-foe", step.kind === "foe");
  box.replaceChildren(...step.actions.map((action, index) => {
    const live = !!(action.key || action.target);
    const el = document.createElement(live ? "button" : "div");
    el.className = `step-action${live ? "" : " is-hint"}`;
    if (live) { el.type = "button"; el.dataset.step = String(index); }
    const key = pad && index === 0 && live ? "A" : STEP_GLYPHS[action.key] || action.key;
    if (key) { const kbd = document.createElement("kbd"); kbd.textContent = key; el.append(kbd); }
    else if (live) { const icon = document.createElement("span"); icon.className = "step-icon"; icon.innerHTML = iconMarkup("compass"); el.append(icon); }
    const verb = document.createElement("strong"); verb.textContent = action.label; el.append(verb);
    if (action.detail) { const detail = document.createElement("span"); detail.className = "step-detail"; detail.textContent = action.detail; el.append(detail); }
    if (live) el.title = action.key ? `${action.label} (${action.key})` : action.label;
    return el;
  }));
  if (arrived && !reduced) box.animate([{ scale: ".94", opacity: .4 }, { scale: "1", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
}
// Clicking, tapping or pad A presses the same ordinary key, or walks the known route.
function runStep(index = 0) {
  const action = stepActions[index];
  if (!action || !state) return false;
  // A shut door beside the hero opens toward it, without asking which way.
  if (action.target?.closed) travel(action.target);
  else if (action.key) command(action.key);
  else if (action.target) travel(action.target);
  else return false;
  return true;
}
$("next-step").addEventListener("click", (event) => {
  const button = event.target.closest(".step-action[data-step]");
  if (button) runStep(Number(button.dataset.step));
});

// ---------- Ending: the fall or the triumph, then the recap ----------
function beginEnding(snapshot) {
  clearTimeout(endingTimer);
  endingSequence = true;
  if (world) world.keepFeel = true;
  director.reset();
  feedbackHud.clear();
  if (snapshot.winner) { world?.victory(); feedbackHud.notice({ icon: "crown", title: "The cure is home", line: "Your daughter will live." }); }
  else { world?.collapse(true); feedbackHud.deathVeil(true); }
  endingTimer = setTimeout(finishEnding, reduced ? 0 : snapshot.winner ? 1800 : 1300);
}
function finishEnding() {
  if (!endingSequence) return;
  clearTimeout(endingTimer);
  endingSequence = false;
  if (world) world.keepFeel = false;
  syncRenderPause();
  update();
}
// Every finished solo run is recorded once, by game ID, with its personal-best deltas.
function recordEnding(snapshot) {
  const ending = snapshot.ending;
  if (!ending || recordedEnding === ending.gameID) return;
  recordedEnding = ending.gameID;
  if (recordsRoom()) return;
  const result = recordRun(profile, { ...ending, kills: snapshot.kills ?? ending.kills, deepest: Math.max(ending.deepest ?? 0, snapshot.deepest ?? 0) },
    { name: snapshot.name, difficulty: snapshot.difficulty ?? ending.hardlev });
  recapDeltas = result.deltas;
  profile = rememberLastRun(result.profile, { name: snapshot.name, character: snapshot.character, difficulty: String(snapshot.difficulty ?? ending.hardlev ?? 0) });
  persistProfile();
  notifyFeats(checkFeatsNow({}));
}
const depthName = (level) => !level ? "the town" : level > 15 ? `Volcano ${level - 15}` : `Depth ${level}`;
const recapStat = (label, value, note = "") => {
  const cell = document.createElement("div");
  cell.innerHTML = "<dt></dt><dd></dd>";
  cell.querySelector("dt").textContent = label;
  cell.querySelector("dd").textContent = value;
  if (note) { const small = document.createElement("small"); small.textContent = note; cell.querySelector("dd").append(small); }
  return cell;
};
let recapActive = false;
function syncRecap(snapshot) {
  // Walking never touches the end-of-run chrome.
  if (!snapshot.over && !recapActive) return;
  recapActive = !!snapshot.over;
  const recap = $("run-recap"), card = document.querySelector(".terminal-card");
  const showing = !!snapshot.over && !endingSequence && !!snapshot.ending;
  const solo = !window.ularnOnline?.inRoom?.();
  recap.hidden = !showing;
  card.classList.toggle("recap-showing", showing && snapshot.awaitingScoreboard);
  card.classList.toggle("recap-strip", showing && !snapshot.awaitingScoreboard);
  card.classList.toggle("winner", !!snapshot.winner);
  $("try-again").hidden = !snapshot.over || endingSequence || !solo;
  $("open-bestiary-recap").hidden = !showing || !solo;
  const returnButton = document.querySelector('.terminal-footer [data-key="return"]');
  if (returnButton) returnButton.textContent = showing && snapshot.awaitingScoreboard ? "Scoreboard ↵" : "Enter ↵";
  if (!showing || recap.dataset.game === `${snapshot.ending.gameID}|${!!recapDeltas}`) return;
  recap.dataset.game = `${snapshot.ending.gameID}|${!!recapDeltas}`;
  const ending = snapshot.ending, what = ending.what || "";
  $("recap-portrait").src = `/art/classes/${String(snapshot.character || "adventurer").toLowerCase()}.webp`;
  $("recap-eyebrow").textContent = snapshot.winner ? "VICTORY" : "YOU HAVE FALLEN";
  $("recap-title").textContent = snapshot.winner ? "The cure is home" : what ? `${what[0].toUpperCase()}${what.slice(1)}` : "Your expedition ended";
  // A hero named after their calling is not introduced twice.
  $("recap-line").textContent = [`${snapshot.name}, ${snapshot.title || "adventurer"}`, snapshot.name !== snapshot.character ? snapshot.character : "", `level ${snapshot.rank}`].filter(Boolean).join(" · ");
  const deepest = Math.max(snapshot.deepest ?? 0, ending.deepest ?? 0);
  $("recap-stats").replaceChildren(
    recapStat("Score", Number(ending.score || 0).toLocaleString()),
    recapStat("Deepest", depthName(deepest), deepest !== snapshot.level ? `ended at ${depthName(snapshot.level)}` : ""),
    recapStat("Creatures slain", String(snapshot.kills ?? 0)),
    recapStat("Turns", Number(snapshot.moves || 0).toLocaleString(), `${ending.timeused ?? 0} ${(ending.timeused ?? 0) === 1 ? "mobul" : "mobuls"}`),
  );
  // A first run beats nothing yet; the rank line already says so.
  const chips = [], best = recapDeltas?.of > 1 ? recapDeltas.newBest : null;
  if (best?.score && ending.score > 0) chips.push("New best score!");
  if (best?.depth && deepest > 0) chips.push("Deepest descent yet");
  if (best?.kills && (snapshot.kills ?? 0) > 0) chips.push("Most kills yet");
  if (best && recapDeltas.callingBest && !chips.length && ending.score > 0) chips.push(`Best ${snapshot.character} run`);
  $("recap-chips").replaceChildren(...chips.map((text) => { const chip = document.createElement("span"); chip.textContent = text; return chip; }));
  $("recap-rank").textContent = recapDeltas?.of > 1 ? `#${recapDeltas.rank} of your ${recapDeltas.of} recorded expeditions` : recapDeltas ? "Your first recorded expedition" : "";
  // Focus lands on the recap, so Tab reaches Try again first; R, C and Enter keep their keys.
  if (!recap.contains(document.activeElement)) recap.focus({ preventScroll: true });
}
// One key back into the caves: same name, calling and difficulty.
function tryAgain() {
  if (!state?.over || window.ularnOnline?.inRoom?.()) return;
  try { sessionStorage.setItem(RETRY_KEY, JSON.stringify({ name: state.name, character: state.character, difficulty: String(state.difficulty ?? 0) })); } catch {}
  location.reload();
}
$("try-again").addEventListener("click", tryAgain);
$("new-after-death").addEventListener("click", () => location.reload());

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

// Ways up are green and ways down red, as the stair compass points to them.
function mapGlyphColor(tile) {
  if (tile.monster) return "#ffa590";
  const exit = exitDirection(tile);
  if (exit) return STAIR_COLORS[exit];
  if (tile.store) return "#c4d7ab";
  return "#f0d7a0";
}

function drawMap() { gameMap.update(state); }

// The first time a way up or down is charted on a floor, say so and light the
// map, whose arrow points to it. Ways already known on arriving are not news.
let chartedWays = { floor: "", ways: new Set() };
function noteWays(state) {
  const ways = new Set(state.tiles.filter((tile) => exitDirection(tile) && !tile.stair?.blocked).map(exitDirection));
  const floor = `${state.gameID}:${state.level}`;
  if (chartedWays.floor !== floor) { chartedWays = { floor, ways }; return; }
  for (const way of ways) {
    if (chartedWays.ways.has(way)) continue;
    chartedWays.ways.add(way);
    feedbackHud.notice({ icon: "stairs", title: way === "up" ? "A way up found" : "A way down found",
      line: `The ${way === "up" ? "green" : "red"} arrow on your map points to it` });
    const panel = document.querySelector(".map-panel");
    if (!panel || reduced) continue;
    panel.classList.remove("way-found", "up", "down");
    void panel.offsetWidth;
    panel.classList.add("way-found", way);
  }
}
document.querySelector(".map-panel")?.addEventListener("animationend", (event) => event.currentTarget.classList.remove("way-found", "up", "down"));

function setRoute(points=[]) { route=points; world?.setRoute(points); }
function stopTravel() {
  travelRevision++;
  held.stop();
  if (route.length) setRoute();
  engine.interruptTravel();
  if (walking) {
    clearTimeout(walking);
    walking = null;
  }
  world?.endRun();
}
function command(key, shift=false) { stopTravel(); sendCommand(key,shift); }
function sendCommand(key, shift = false) {
  if (world) world.lastInputAt=performance.now();
  if (document.activeElement?.id === "chat-input") return;
  if (window.ularnOnline?.inMatch?.()) {
    if (window.ularnOnline.acceptsInput?.() === false && !state?.over) return;
    const input = shift && key.length === 1 ? key.toUpperCase() : key;
    if (["X", "G", "{", "}"].includes(input) && !state?.prompt) { toast(ROOM_EXPLORE_NOTE); return; }
    return window.ularnOnline.sendInput?.(input);
  }
  if (!state || graphicsLost) return;
  engine.key(key, shift);
}
document.querySelectorAll("[data-key]").forEach((button) => {
  let pointerClick = false;
  const key = button.dataset.key;
  if (button.closest(".dpad") && movementKey(key)) {
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !movementAllowed()) return;
      event.preventDefault(); pointerClick = true; button.setPointerCapture(event.pointerId);
      stopTravel(); held.start(key, event.pointerId);
    });
    button.addEventListener("pointerup", (event) => held.release(event.pointerId));
    button.addEventListener("pointercancel", (event) => held.release(event.pointerId));
    button.addEventListener("lostpointercapture", (event) => held.release(event.pointerId));
  }
  button.addEventListener("click", (event) => {
    if (pointerClick && event.detail !== 0) { pointerClick = false; return; }
    pointerClick = false; command(key);
  });
});
window.addEventListener("keyup", (event) => { const source = event.code || event.key; held.release(source); heldKeys.delete(source); });
window.addEventListener("blur", stopTravel);
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
  if (event.target?.id === "chat-input") return;
  if (window.ularnOnline?.blocksGameKeys?.()) return;
  if (event.key === "Tab" && window.ularnOnline?.spectating?.() && !event.target.closest('input,textarea,select,button,a,[role="button"]') && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    window.ularnOnline.cycleFollow();
    return;
  }
  if (window.ularnOnline?.acceptsInput?.() === false && !state?.over && !event.target.closest("input, textarea, select, button, a") && event.key !== "Escape") {
    event.preventDefault();
    return;
  }
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
  // Any key skips the fall; afterwards R tries again and C picks a new calling.
  if (state.over && endingSequence) { event.preventDefault(); finishEnding(); return; }
  if (state.over && !window.ularnOnline?.inRoom?.() && !event.repeat && (event.key === "r" || event.key === "R")) { event.preventDefault(); tryAgain(); return; }
  if (state.over && !window.ularnOnline?.inRoom?.() && !event.repeat && (event.key === "c" || event.key === "C")) { event.preventDefault(); location.reload(); return; }
  if (event.key.length === 1 && !event.repeat) {
    const echo = document.querySelector(`.actionbar [data-key="${CSS.escape(event.key)}"]`);
    if (echo) { echo.classList.add("key-echo"); setTimeout(() => echo.classList.remove("key-echo"), 140); }
  }
  if (event.key.length === 1 || keyMap[event.key]) {
    event.preventDefault();
    const key = keyMap[event.key] || event.key;
    const source = event.code || event.key;
    if (event.repeat && heldKeys.has(source)) return;
    if (!event.shiftKey && movementKey(key) && movementAllowed()) {
      if (!event.repeat) { stopTravel(); heldKeys.add(source); held.start(key, source); }
    } else command(key, event.shiftKey);
  }
});
const dirs = DIRECTIONS;
function travel(tile) {
  if (window.ularnOnline?.inMatch?.() && !window.ularnOnline.acceptsInput()) return;
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
  const path = findRoute(state, tile);
  if (!path) { toast("No explored route. Move closer to discover the way."); return; }
  const token = travelRevision;
  setRoute([{ x: state.x, y: state.y }, ...path]);
  const initialLevel = state.level;
  let hp = state.hp;
  const step = async () => {
    walking = null;
    if (
      token !== travelRevision ||
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
    // Melee range matches the attack check: Chebyshev distance 1, diagonals included.
    // A creature two or more tiles away, around a corner, or only on screen does not stop travel.
    if (
      state.tiles.some(
        (t) =>
          isHostile(t) &&
          Math.max(Math.abs(t.x - state.x), Math.abs(t.y - state.y)) <= 1,
      )
    ) {
      toast("A creature is near. Travel stopped.");
      stopTravel(); return;
    }
    const next = path[0];
    const cell = state.tiles.find((cell) => cell.x === next.x && cell.y === next.y);
    if (!cell || cell.wall || cell.closed || isHostile(cell) || (cell.hazard && (cell.x !== tile.x || cell.y !== tile.y))) { stopTravel(); return; }
    const before = `${state.x},${state.y}`;
    await sendCommand(path.shift().key);
    if (token !== travelRevision) return;
    if (before === `${state.x},${state.y}`) { stopTravel(); return; }
    if (state.x !== next.x || state.y !== next.y) { toast("Your route changed. Travel stopped."); stopTravel(); return; }
    if (state.hp < hp) {
      toast("You were hurt. Travel stopped.");
      stopTravel(); return;
    }
    hp = state.hp;
    if (path.length) { setRoute([{ x: state.x, y: state.y }, ...path]); walking = setTimeout(step, MOVE_INTERVAL); world?.expectNextStep(MOVE_INTERVAL); }
    else stopTravel();
  };
  step();
}
$("map-expand").addEventListener("click", () => gameMap.open());
$("map-zoom-in").addEventListener("click", () => gameMap.setZoom(gameMap.zoom * 1.35));
$("map-zoom-out").addEventListener("click", () => gameMap.setZoom(gameMap.zoom / 1.35));
$("map-fit").addEventListener("click", () => gameMap.setZoom(1));
$("map-center").addEventListener("click", () => gameMap.center());
$("sound").addEventListener("click", () => {
  if (soundOn && ["blocked", "error"].includes(audio.metrics().status)) audio.resume();
  else setAudioPreference({ enabled: !soundOn });
  if (soundOn) sound("open");
});
// A soft tick under the pointer; the mixer rate-limits it and never lets it crowd out a fight.
document.addEventListener("pointerover", (event) => {
  if (event.pointerType !== "mouse" || !state) return;
  const control = event.target.closest?.(".actionbar button, .dpad button, .terminal-footer button, .bestiary-tabs button, .beast, .inventory-item, .item-menu button");
  if (control && !control.contains(event.relatedTarget)) sound("hover");
});
// Feel & accessibility: shake, flashing, numbers, wound bars and motion apply at once.
function syncFeelControls() {
  $("feel-shake").value = Math.round(feel.shake * 100);
  $("feel-shake-text").textContent = `${Math.round(feel.shake * 100)}%`;
  $("feel-numbers").checked = feel.numbers;
  $("feel-health").checked = feel.healthBars;
  $("feel-flashes").checked = !feel.flashes;
  $("feel-motion").value = feel.motion;
}
function setFeel(changes) {
  feel = feelSettings({ ...feel, ...changes });
  saveFeel(localStorage, feel);
  reduced = motionReduced(feel, systemMotion.matches);
  document.body.classList.toggle("reduce-motion", feel.motion === "reduced");
  director.setSettings(feel); director.setReduced(reduced);
  feedbackHud.setSettings(feel); feedbackHud.setReduced(reduced);
  world?.setFeel(feel);
  if (world && world.reduced !== reduced) world.setReduced(reduced);
  syncFeelControls();
}
syncFeelControls();
$("feel-shake").addEventListener("input", (event) => setFeel({ shake: Number(event.target.value) / 100 }));
$("feel-numbers").addEventListener("change", (event) => setFeel({ numbers: event.target.checked }));
$("feel-health").addEventListener("change", (event) => setFeel({ healthBars: event.target.checked }));
$("feel-flashes").addEventListener("change", (event) => setFeel({ flashes: !event.target.checked }));
$("feel-motion").addEventListener("change", (event) => setFeel({ motion: event.target.value }));
systemMotion.addEventListener?.("change", () => setFeel({}));
$("audio-enabled").addEventListener("change", (event) => setAudioPreference({ enabled: event.target.checked }));
$("music-volume").addEventListener("input", (event) => setAudioPreference({ music: Number(event.target.value) / 100 }));
$("effects-volume").addEventListener("input", (event) => setAudioPreference({ effects: Number(event.target.value) / 100 }));
const openFieldGuide = (sectionId) => {
  stopTravel();
  const dialog = $("guide-dialog");
  dialog.showModal();
  if (!sectionId) return;
  const section = dialog.querySelector(`#${sectionId}`);
  if (section) section.scrollIntoView({ block: "nearest", behavior: "smooth" });
};
$("guide").addEventListener("click", () => openFieldGuide());
$("tile-label").addEventListener("click", (event) => {
  const button = event.target.closest("[data-guide]");
  if (!button) return;
  event.preventDefault();
  openFieldGuide(button.getAttribute("data-guide"));
});
$("tile-label").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const button = event.target.closest("[data-guide]");
  if (!button) return;
  event.preventDefault();
  openFieldGuide(button.getAttribute("data-guide"));
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
  if (window.ularnOnline?.inRoom?.()) { window.ularnOnline.leave(); return; }
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
$("view-scores").addEventListener("click", () => {
  $("pause-dialog").close();
  stopTravel();
  engine.showScoreboard();
});
$("global-scores").addEventListener("click", () => engine.showScoreboard());
$("local-scores").addEventListener("click", () => engine.showScoreboard(true));
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
  } else if (soundOn) audio.resume();
});

$("destination").addEventListener("change", (event) => {
  const [x, y] = event.target.value.split(",").map(Number);
  const t = state?.tiles.find((t) => t.x === x && t.y === y);
  event.target.value = "";
  // Hand the keys back to the hero; a focused list would take the next arrow press.
  event.target.blur();
  if (t) travel(t);
});

// Stores, the bank, the college and the trading post list choices as "a) item".
// Pointing at one lights it, and clicking presses its letter.
const terminalText = $("LARN");
const terminalPick = typeof Highlight === "function" && CSS.highlights ? new Highlight() : null;
if (terminalPick) CSS.highlights.set("terminal-pick", terminalPick);
const pickAt = (event) => (state && !state.over ? pointedChoice(terminalText, event.clientX, event.clientY) : null);
terminalText.addEventListener("pointermove", (event) => {
  const choice = pickAt(event);
  terminalText.classList.toggle("picking", !!choice);
  terminalPick?.clear();
  if (choice) terminalPick?.add(choice.range);
});
terminalText.addEventListener("pointerleave", () => {
  terminalText.classList.remove("picking");
  terminalPick?.clear();
});
terminalText.addEventListener("click", (event) => {
  if (getSelection()?.toString()) return; // Selecting text to read or copy, not choosing.
  const choice = pickAt(event);
  if (!choice) return;
  terminalPick?.clear();
  command(choice.key);
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
  if (document.hidden || document.querySelector("dialog[open]")) stopTravel();
  world?.setPaused?.(document.hidden || !!document.querySelector("dialog[open]") || !!state && (!state.maze || (state.over && !endingSequence)));
  audio.setMenu(!!document.querySelector("dialog[open]") || !!state && !state.maze);
}
const dialogObserver = new MutationObserver(syncRenderPause);
for (const dialog of document.querySelectorAll("dialog"))
  dialogObserver.observe(dialog, { attributes: true, attributeFilter: ["open"] });
document.addEventListener("visibilitychange", syncRenderPause);

const mapObserver = new ResizeObserver(() => {
  const bounds = document.querySelector(".map-panel").getBoundingClientRect();
  document.body.style.setProperty("--map-bottom", `${Math.ceil(bounds.bottom)}px`);
  updateViewport();
});
mapObserver.observe(document.querySelector(".map-panel"));

function updateViewport() {
  if (!world || !document.body.classList.contains("playing")) return;
  const dock = document.querySelector(".adventure-bar").getBoundingClientRect();
  const map = document.querySelector(".map-panel").getBoundingClientRect();
  const topbar = document.querySelector(".topbar").getBoundingClientRect();
  const effects = $("effects-panel").getBoundingClientRect();
  const portrait = innerWidth <= 700 && innerWidth < innerHeight * 4 / 3;
  const inventory = $("inventory-panel").getBoundingClientRect();
  const tools = document.querySelector(".camera-tools").getBoundingClientRect();
  const left = portrait ? inventory.width && !$("inventory-panel").hidden ? inventory.right + 16 : 12 : Math.max(map.right + 24, 270);
  const right = portrait ? innerWidth - 12 : effects.width && !$("effects-panel").hidden ? effects.left - 18 : innerWidth - 30;
  const top = portrait ? Math.max(map.bottom, tools.bottom) + 12 : topbar.bottom + 34;
  const bottom = Math.max(top + 40, dock.top - 16);
  world.setViewportRect({ left: Math.min(left, right - 80), right, top, bottom });
  // The next-step prompt centres under the hero, not the window.
  document.body.style.setProperty("--view-center", `${Math.round((Math.min(left, right - 80) + right) / 2)}px`);
}
const viewportObserver = new ResizeObserver(updateViewport);
viewportObserver.observe(document.querySelector(".adventure-bar"));
viewportObserver.observe($("inventory-panel"));
viewportObserver.observe(document.querySelector(".camera-tools"));
window.addEventListener("resize", () => { gameMap.resize(); updateViewport(); });

window.addEventListener("pagehide", () => audio.suspend());

// ---------- Controller: every screen answers a pad ----------
const shown = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
const titleChoice = () => (shown($("continue")) ? $("continue") : $("begin"));
const PAD_ACTIONS = {
  step: () => runStep(0), cancel: () => stopTravel(), explore: () => command("X"), inventory: () => command("i"),
  "rotate-left": () => world?.rotate(-1), "rotate-right": () => world?.rotate(1),
  "zoom-out": () => world?.zoom(1.22), "zoom-in": () => world?.zoom(0.82), center: () => world?.reset(),
  map: () => { stopTravel(); gameMap.open(); }, menu: () => { stopTravel(); $("pause-dialog").showModal(); }, wait: () => command("."),
};
mountGamepad({
  surface() {
    const dialog = document.querySelector("dialog[open]");
    if (dialog) return { kind: "menu", root: dialog, preferred: dialog.querySelector(".button.primary, [aria-selected=true], .close-dialog") };
    if (!state || !document.body.classList.contains("playing")) {
      if ($("welcome").hidden) return { kind: "menu", root: document.body };
      return { kind: "menu", root: document.querySelector(".entry-layout"), preferred: titleChoice(), start: () => titleChoice().click() };
    }
    if (endingSequence) return { kind: "menu", root: $("fx-layer"), start: finishEnding };
    if (!$("engine-modal").hidden) return { kind: "menu", root: document.querySelector(".terminal-card"), preferred: shown($("try-again")) ? $("try-again") : null };
    if (state.prompt) return engine.promptKind?.() === "direction" ? { kind: "direction" } : { kind: "menu", root: $("interaction") };
    return state.maze && !state.over ? { kind: "play" } : null;
  },
  move(key) { if (movementAllowed()) { stopTravel(); held.start(key, "pad"); } },
  release() { held.release("pad"); },
  press: (key) => command(key),
  act: (name) => PAD_ACTIONS[name]?.(),
  back() {
    const dialog = document.querySelector("dialog[open]");
    if (dialog) dialog.close();
    else if (endingSequence) finishEnding();
    else if (state) command("escape");
  },
  connected: () => toast("Controller ready. A takes the next step and Menu pauses."),
  activeChanged: () => { stepSignature = ""; if (state) syncNextStep(); },
});

// Try again: the previous page stored the hero; start straight back in the caves.
(() => {
  let retry = null;
  try { retry = JSON.parse(sessionStorage.getItem(RETRY_KEY) || "null"); sessionStorage.removeItem(RETRY_KEY); } catch {}
  if (!retry || !world || new URL(location.href).searchParams.has("room") || window.ularnOnline?.inRoom?.()) return;
  if (classes.some(([name]) => name === retry.character)) {
    character = retry.character;
    document.querySelectorAll(".class-choice").forEach((button) => button.setAttribute("aria-pressed", String(button.textContent.trim() === character)));
  }
  if (retry.name) $("hero-name").value = String(retry.name).slice(0, 24);
  if ([...$("difficulty").options].some((option) => option.value === String(retry.difficulty))) $("difficulty").value = String(retry.difficulty);
  start(false);
})();
