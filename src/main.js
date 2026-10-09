import "./style.css";
import "./hud.css";
import "./entry.css";
import { GameAudio } from "./audio.js";
import { audioSettings } from "./audio-score.js";
import { createCueReader } from "./expedition-cues.js";
import { World } from "./world.js";
import { HeldMovement, movementKey, findRoute, isHostile, DIRECTIONS, MOVE_INTERVAL } from "./navigation.js";
import { GameMap } from "./map.js";
import { iconMarkup, mountIcons, setIcon } from "./icons.js";
import { groundHoverInfo } from "./item-tooltips.js";
import { monsterCardInfo } from "./monster-descriptions.js";
import { mountOnlineUi } from "./online/ui.js";
import { tilesInFog } from "./online/spectator.js";
import { auraControl } from "./cooperation-aura.js";
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
const movementAllowed = () => !!state && state.maze && !state.over && !state.prompt && !state.busy && !graphicsLost && !document.hidden && !document.querySelector("dialog[open]");
const held = new HeldMovement((key) => sendCommand(key), movementAllowed);
const heldKeys = new Set();
const gameMap = new GameMap({ compact: $("minimap"), expanded: $("expanded-map"), dialog: $("map-dialog"), viewport: $("map-viewport"), travel: (tile) => travel(tile), stop: () => stopTravel(),
  glyph: tile => tile.monster?.symbol || MAP_GLYPHS[tile.id] || tile.symbol || (tile.id ? "?" : "."), color: mapGlyphColor,
  allies: () => engine.party?.() || [], pings: () => window.ularnOnline?.mapPings?.() || [] });
let journalSignature = "", statsSignature = "";
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const HUD_STATS = ["STR", "INT", "WIS", "CON", "DEX"];
const HERO_NAME_KEY = "ularn3d.heroName";
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
  if (!state?.over && detail.level === state?.level && ["loot","potion","read","chest"].includes(detail.kind)) sound(detail.kind,detail);
});
window.addEventListener("ularn:combat", ({ detail }) => {
  if (state?.over) return;
  if (detail.to && window.ularnGraphics) {
    const point = ularnGraphics.projectTile(detail.to.x, detail.to.y, .4);
    detail = { ...detail, pan: Math.max(-.65, Math.min(.65, (point.x - ularnGraphics.metrics().heroScreen.x) / 250)) };
  }
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
let hudSignature = "";
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
$("inventory-pin").addEventListener("click", toggleInventoryPin);
$("auto-loot").addEventListener("click", toggleAutoLoot);
syncInventoryPin();
function updateInventoryAndEffects() {
  const items = state.inventory.filter(Boolean);
  const signature = items
    .map(
      (item) =>
        `${item.slot}:${item.id}:${item.name}:${(item.equipped || []).join(",")}`,
    )
    .join("|");
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
for (const [name, , description] of classes) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "class-choice";
  button.setAttribute("aria-pressed", String(name === character));
  button.innerHTML = `<img class="class-portrait" src="/art/classes/${name.toLowerCase()}.webp" alt="" width="160" height="192" />${name}`;
  button.addEventListener("click", () => {
    character = name;
    document
      .querySelectorAll(".class-choice")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    $("class-description").textContent = description;
  });
  $("classes").appendChild(button);
}
$("class-description").textContent = classes[0][2];
const hasExpedition = engine.hasSave();
$("continue").hidden = !hasExpedition;
$("return-expedition").hidden = !hasExpedition;
$("welcome").classList.toggle("has-save", hasExpedition);
$("save-notice").hidden = !hasExpedition;
if (hasExpedition) {
  $("class-label").textContent = "NEW EXPEDITION · CHOOSE YOUR CALLING";
  $("begin").firstChild.textContent = "Start new expedition ";
}
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
  $("loading").hidden = true;
} catch (error) {
  console.error(error);
  $("loading").innerHTML =
    '<div style="max-width:440px;padding:30px;text-align:center">3D graphics could not start.<p style="font:14px Arial;line-height:1.7">Enable hardware acceleration in your browser, then reload. You can also play the complete classic edition below.</p><a style="color:#d7bc83;font:14px Arial" href="/engine/larn_local.html?ularn=true">Open classic Ularn →</a></div>';
}
async function start(resume) {
  activateAudio();
  $("begin").disabled = true;
  $("continue").disabled = true;
  try {
    const heroName = $("hero-name").value;
    rememberHeroName(heroName);
    await engine.start({
      name: heroName,
      character,
      difficulty: $("difficulty").value,
      resume,
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
  }
}
$("start-form").addEventListener("submit", (e) => {
  e.preventDefault();
  start(false);
});
$("continue").addEventListener("click", () => start(true));
let townOptions = "";
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
const syncJournal = (rawLog, logRev = null) => {
  const lines = rawLog.filter((line) => String(line).trim());
  const el = $("journal-lines");
  const stickToBottom = journalNearBottom(el);
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
  const perfStart = ularnPerf.enabled ? performance.now() : 0;
  const next = engine.snapshot();
  if (!next) return;
  const previous = state;
  const previousGold = state?.gold, previousBank = state?.bank;
  const fog = window.ularnOnline?.fogMask?.() ?? null;
  state = fog
    ? { ...next, tiles: tilesInFog(next.tiles, fog), mapRev: `${next.mapRev ?? ""}:${fog.size}` }
    : next;
  world?.update(state);
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
    state.moves,
    state.timeLeft,
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
    if (partyHud) {
      const auraNow = auraControl(state);
      partyHud.hidden = party.length < 2;
      const cards = party.map((member) => {
        const card = document.createElement("article");
        const ratio = member.hpmax ? Math.max(0, Math.min(1, member.hp / member.hpmax)) : 0;
        card.innerHTML = `<strong></strong><div class="meter"><i></i></div><span></span>`;
        card.querySelector("strong").textContent = member.name || "Ally";
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", `Follow ${member.name || "ally"}`);
        const handleFollow = () => window.ularnOnline?.follow?.(member.name);
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
    $("xp-count-value").textContent = `${state.xp}/${state.xpNext}`;
    $("xp-title").textContent = state.title || "";
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
    $("engine-modal").hidden = state.maze && !state.over;
    $("engine-title").textContent = state.over
      ? "EXPEDITION ENDED"
      : "ULARN";
    $("new-after-death").hidden = !state.over;
    if (state.saveError) toast(state.saveError);
  }
  audio.deferMusic = false;
  if (!movementAllowed() || (previous && previous.level !== state.level)) stopTravel();
  if (!state.over) {
    const danger = state.tiles.filter(tile => isHostile(tile) && Math.max(Math.abs(tile.x-state.x), Math.abs(tile.y-state.y)) <= 6).length;
    audio.scene(state.level === 0 ? "town" : state.level > 15 ? "volcano" : "caves", Math.min(1,danger/3));
  }
  if (previous && !previous.over && state.over) audio.finish(state.winner ? "victory" : "death");
  $("scoreboard-controls").hidden = !state.scoreboard;
  $("global-scores").setAttribute("aria-pressed", String(!state.localScores));
  $("local-scores").setAttribute("aria-pressed", String(state.localScores));
  $("score-details").hidden = !state.scoreboard;
  if (state.scoreboard) $("score-details").textContent = $("STATS").textContent;
  $("score-sync-status").hidden = !state.scoreboard;
  if (state.scoreboard) {
    const sync=state.scoreSync;
    $("score-sync-status").textContent = !sync.configured ? "Global records are not configured." : sync.pending ? `${sync.pending} completed score${sync.pending===1?"":"s"} saved locally, waiting to sync.` : sync.latestSyncedGame===state.gameID ? "This expedition’s score is saved globally." : "Completed expeditions are shared automatically when online.";
  }
  if (previousGold != null && state.gold > previousGold && state.bank === previousBank && !state.over) sound("coins");
  syncTerminalEndActions(state);
  updateInventoryAndEffects();
  syncJournal(state.log, state.logRev);
  const hasActions =
    $("ACTIONS").children.length > 0 || $("KEYBOARD").children.length > 0;
  $("interaction").hidden =
    !hasActions || (!state.prompt && state.maze && !state.over);
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
          (t) => new Option(t.name.replace(/^the /, ""), `${t.x},${t.y}`),
        ),
      );
    }
  }
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

function drawMap() { gameMap.update(state); }

function setRoute(points=[]) { route=points; gameMap.setRoute?.(points); world?.setRoute(points); }
function stopTravel() {
  travelRevision++;
  held.stop();
  if (route.length) setRoute();
  engine.interruptTravel();
  if (walking) {
    clearTimeout(walking);
    walking = null;
  }
}
function command(key, shift=false) { stopTravel(); sendCommand(key,shift); }
function sendCommand(key, shift = false) {
  if (world) world.lastInputAt=performance.now();
  if (document.activeElement?.id === "chat-input") return;
  if (window.ularnOnline?.inMatch?.()) {
    if (window.ularnOnline.acceptsInput?.() === false) return;
    window.ularnOnline.sendInput?.(shift && key.length === 1 ? key.toUpperCase() : key);
    return;
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
  if (event.key === "Tab" && window.ularnOnline?.spectating?.()) {
    event.preventDefault();
    window.ularnOnline.cycleFollow();
    return;
  }
  if (window.ularnOnline?.acceptsInput?.() === false && !event.target.matches("input, textarea")) {
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
  const step = () => {
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
    sendCommand(path.shift().key);
    if (token !== travelRevision) return;
    if (before === `${state.x},${state.y}`) { stopTravel(); return; }
    if (state.x !== next.x || state.y !== next.y) { toast("Your route changed. Travel stopped."); stopTravel(); return; }
    if (state.hp < hp) {
      toast("You were hurt. Travel stopped.");
      stopTravel(); return;
    }
    hp = state.hp;
    if (path.length) { setRoute([{ x: state.x, y: state.y }, ...path]); walking = setTimeout(step, MOVE_INTERVAL); }
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
  } else if (soundOn) audio.resume();
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
  if (document.hidden || document.querySelector("dialog[open]")) stopTravel();
  world?.setPaused?.(document.hidden || !!document.querySelector("dialog[open]") || !!state && (!state.maze || state.over));
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
}
const viewportObserver = new ResizeObserver(updateViewport);
viewportObserver.observe(document.querySelector(".adventure-bar"));
viewportObserver.observe($("inventory-panel"));
viewportObserver.observe(document.querySelector(".camera-tools"));
window.addEventListener("resize", () => { gameMap.resize(); updateViewport(); });

window.addEventListener("pagehide", () => audio.suspend());
