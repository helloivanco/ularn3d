/* Presentation adapter. The upstream engine remains the authority for all rules. */
ENABLE_RECORDING = false;
ENABLE_RECORDING_REALTIME = false;
isMobile = () => true; // Native contextual buttons are useful on every screen size.
onResize = () => {
  setButtons();
  // Native button labels are not unique DOM IDs ("continue", "save", etc.).
  buttonCache.forEach((button, key) => {
    button.id = `engine-${key}`;
  });
};
setMode = () => {
  amiga_mode = false;
};
initRB = updateRB = initFS = () => {};
// Keep real diagnostics local; informational telemetry is disabled in this fork.
doRollbar = (severity, title, detail) => {
  if (severity === ROLLBAR_ERROR) console.error(title, detail);
  else if (severity === ROLLBAR_WARN) console.warn(title, detail);
};
uploadStyle = () => true;
cloudflareWriteHighScore = async () => {}; // This fork never submits to larn.org.
dbQueryHighScores = async (score, winners, losers) =>
  showLocalScoreBoard(score, winners, losers, 0, "Local expedition records");

// Legacy checkpoint and winner-mail routines must not alter classic saves.
const originalStorageGet3D = localStorageGetObject;
const originalStorageSet3D = localStorageSetObject;
const originalStorageRemove3D = localStorageRemoveItem;
function saveSlot3D(key) {
  return [
    "checkpoint",
    "checkpointbackup",
    logname,
    `${logname}backup`,
  ].includes(key)
    ? `ularn3d.legacy.${key}`
    : key;
}
localStorageGetObject = (key, fallback) =>
  originalStorageGet3D(saveSlot3D(key), fallback);
localStorageSetObject = (key, value) =>
  originalStorageSet3D(saveSlot3D(key), value);
localStorageRemoveItem = (key) => originalStorageRemove3D(saveSlot3D(key));

let graphicsPaused3D = false;
window.addEventListener("ularn:graphics-lost", () => {
  graphicsPaused3D = true;
});
window.addEventListener("ularn:graphics-restored", () => {
  graphicsPaused3D = false;
});
const originalInput3D = mousetrap;
mousetrap = function (event, key) {
  if (
    graphicsPaused3D ||
    document.hidden ||
    document.querySelector("dialog[open]")
  )
    return false;
  if (key === "S" && mazeMode && !blocking_callback && !GAMEOVER) {
    updateLog(
      window.ularn.save()
        ? "Expedition saved on this device."
        : "The expedition could not be saved.",
    );
    paint();
    return false;
  }
  return originalInput3D(event, key);
};

const SAVE_KEY_3D = "ularn3d.expedition.v1";
buttonCache.forEach((button, key) => {
  button.id = `engine-${key}`;
});
let saveTimer3D;
let initialized3D = false;
let saveError3D = "";
const originalPaint3D = paint;
paint = function () {
  originalPaint3D();
  if (!initialized3D) return;
  window.dispatchEvent(new Event("ularn:update"));
  clearTimeout(saveTimer3D);
  if (GAMEOVER) {
    try {
      localStorage.removeItem(SAVE_KEY_3D);
    } catch {
      /* Storage may be disabled. */
    }
  } else if (mazeMode && !blocking_callback && !napping) {
    saveTimer3D = setTimeout(() => window.ularn.save(), 250);
  }
};

window.ularn = {
  interruptTravel() {
    if (activeExplorer) {
      activeExplorer = null;
      playerInputCount++;
    }
  },
  hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY_3D);
    } catch {
      return false;
    }
  },
  async start({
    name = "Adventurer",
    character = "Adventurer",
    difficulty = 0,
    resume = false,
  } = {}) {
    if (initialized3D) return;
    ULARN = true;
    GOTW = false;
    PARAMS = { ularn: "true" };
    playerID = "local";
    setGameConfig();
    loadPreferences();
    overridePref("no_intro", true);
    overridePref("side_inventory", false);
    overridePref("auto_pickup", true);
    initHelpPages();
    initialized3D = true;
    if (resume) {
      try {
        const raw = localStorage.getItem(SAVE_KEY_3D);
        const data = JSON.parse(LZString.decompressFromUTF16(raw));
        if (
          data.version !== 1 ||
          !data.state?.player ||
          data.state.GAMEOVER ||
          data.state.LEVELS?.length !== 21
        )
          throw new Error("Invalid save");
        const saved = data.state;
        if (
          !Number.isInteger(saved.level) ||
          saved.level < 0 ||
          saved.level > 20 ||
          !saved.LEVELS[saved.level] ||
          !Number.isInteger(saved.player.x) ||
          saved.player.x < 0 ||
          saved.player.x >= MAXX ||
          !Number.isInteger(saved.player.y) ||
          saved.player.y < 0 ||
          saved.player.y >= MAXY ||
          !Array.isArray(saved.player.inventory) ||
          saved.player.inventory.length !== 26 ||
          !Number.isFinite(saved.player.HP) ||
          saved.player.HP <= 0 ||
          !Array.isArray(saved.LOG)
        )
          throw new Error("Invalid save");
        for (const floor of saved.LEVELS.filter(Boolean)) {
          for (const grid of [floor.items, floor.monsters, floor.know]) {
            if (
              !Array.isArray(grid) ||
              grid.length !== MAXX ||
              grid.some(
                (column) => !Array.isArray(column) || column.length !== MAXY,
              )
            )
              throw new Error("Invalid floor");
          }
        }
        loadState(saved);
        game_started = true;
        onResize();
        overridePref("side_inventory", false);
        blocking_callback = null;
        keyboard_input_callback = null;
        napping = false;
        setMazeMode(true);
        paint();
        return;
      } catch (error) {
        initialized3D = false;
        throw new Error(
          "This expedition could not be restored. Start a new expedition to play.",
        );
      }
    }
    logname =
      name
        .replace(/[^\p{L}\p{N} _'-]/gu, "")
        .trim()
        .slice(0, 24) || "Adventurer";
    player = new Player();
    setGameDifficulty(Math.max(0, Math.min(128, Number(difficulty) || 0)));
    setclass(
      [
        "Adventurer",
        "Ogre",
        "Wizard",
        "Klingon",
        "Elf",
        "Rogue",
        "Dwarf",
        "Rambo",
      ].includes(character)
        ? character
        : "Adventurer",
    );
    paint();
    this.save();
  },
  key(key, shift = false) {
    if (!initialized3D) return;
    mousetrap({ shift, preventDefault() {} }, key);
  },
  save() {
    if (!initialized3D || GAMEOVER || !mazeMode || blocking_callback || napping)
      return false;
    try {
      const data = { version: 1, state: new GameState(true) };
      localStorage.setItem(
        SAVE_KEY_3D,
        LZString.compressToUTF16(JSON.stringify(data)),
      );
      if (saveError3D)
        window.dispatchEvent(new CustomEvent("ularn:storage", { detail: "" }));
      saveError3D = "";
      return true;
    } catch {
      const wasError = saveError3D;
      saveError3D = "Saving unavailable. Check browser storage.";
      if (!wasError)
        window.dispatchEvent(
          new CustomEvent("ularn:storage", { detail: saveError3D }),
        );
      return false;
    }
  },
  snapshot() {
    if (!initialized3D || !player || !LEVELS[level]) return null;
    const tiles = [];
    for (let y = 0; y < MAXY; y++)
      for (let x = 0; x < MAXX; x++) {
        const know = getKnow(x, y);
        if (!(know & HAVESEEN)) continue;
        const item = itemAt(x, y);
        const monster = monsterAt(x, y);
        const seenMonster =
          monster &&
          know & KNOWHERE &&
          !player.BLINDCOUNT &&
          monster.isVisible();
        const mimic = seenMonster && monster.arg === MIMIC && monster.mimicarg;
        const masked =
          item.isInvisibleTrap() ||
          (monster && know & KNOWHERE && !seenMonster);
        tiles.push({
          x,
          y,
          id: masked ? 0 : item.id,
          name: masked ? "The floor" : item.shortName(),
          wall: !masked && item.matches(OWALL),
          hazard: !masked && !!item.isTrap(),
          closed: !masked && item.matches(OCLOSEDDOOR),
          store: !masked && item.isStore(),
          monster: seenMonster
            ? {
                id: mimic || monster.arg,
                name: mimic ? monsterlist[mimic].desc : monster.desc,
                hp: monster.hitpoints,
                color: monsterlist[mimic || monster.arg].color,
              }
            : null,
        });
      }
    return {
      tiles,
      width: MAXX,
      height: MAXY,
      level,
      dungeonFloors: DBOTTOM,
      volcanoFloors: MAXVLEVEL,
      maze: mazeMode,
      over: GAMEOVER,
      busy: napping,
      prompt: !!blocking_callback,
      name: logname,
      character: player.char_picked,
      x: player.x,
      y: player.y,
      hp: player.HP,
      hpMax: player.HPMAX,
      mana: player.SPELLS,
      manaMax: player.SPELLMAX,
      xp: player.EXPERIENCE,
      rank: player.LEVEL,
      gold: player.GOLD,
      bank: player.BANKACCOUNT,
      ac: player.AC,
      wc: player.WCLASS,
      moves: player.MOVESMADE,
      timeLeft: Math.max(0, (TIMELIMIT - gtime) / 100),
      log: LOG.slice(-7),
      stats: {
        STR: player.STRENGTH + player.STREXTRA,
        INT: player.INTELLIGENCE,
        WIS: player.WISDOM,
        CON: player.CONSTITUTION,
        DEX: player.DEXTERITY,
        CHA: player.CHARISMA,
      },
      inventory: player.inventory
        .map((item, index) =>
          item
            ? {
                key: getCharFromIndex(index),
                name: item.toString(),
                id: item.id,
              }
            : null,
        )
        .filter(Boolean),
      effects: [
        "BLINDCOUNT",
        "CONFUSE",
        "INVISIBILITY",
        "HASTESELF",
        "FIRERESISTANCE",
        "POISON",
        "WTW",
        "HOLDMONST",
        "TIMESTOP",
      ].filter((k) => player[k] > 0),
      hasEye: !!isCarrying(OLARNEYE),
      hasCure: !!isCarrying(createObject(OPOTION, 21)),
      saveError: saveError3D,
    };
  },
};
window.addEventListener("pagehide", () => window.ularn.save());
