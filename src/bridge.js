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
  if (key === "@" && mazeMode && !blocking_callback && !GAMEOVER) {
    const enabled = window.ularn.setAutoLoot(!getPref("auto_pickup"));
    updateLog(`Auto-loot: ${enabled ? "on" : "off"}`);
    paint();
    return false;
  }
  return originalInput3D(event, key);
};

const SAVE_KEY_3D = "ularn3d.expedition.v1";
const AUTO_LOOT_KEY_3D = "ularn3d.autoLoot";
function readAutoLoot3D() {
  try {
    return localStorage.getItem(AUTO_LOOT_KEY_3D) !== "false";
  } catch {
    return true;
  }
}

// Presentation identity belongs outside the saved rule objects. Weak references
// also let dead monsters and discarded levels be collected normally.
const monsterPresentation3D = new WeakMap();
let nextMonsterID3D = 1;
function monsterView3D(monster) {
  if (!monsterPresentation3D.has(monster))
    monsterPresentation3D.set(monster, {
      uid: nextMonsterID3D++,
      facing: { x: 0, y: 1 },
    });
  return monsterPresentation3D.get(monster);
}
const originalMonsterMove3D = mmove;
mmove = function (sx, sy, dx, dy) {
  const monster = monsterAt(sx, sy);
  if (monster)
    monsterView3D(monster).facing = {
      x: Math.sign(dx - sx),
      y: Math.sign(dy - sy),
    };
  return originalMonsterMove3D(sx, sy, dx, dy);
};

function plainText3D(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;?/g, "<")
    .replace(/&gt;?/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Match stairs.js without changing its rules. Only known, unmasked stair tiles
// receive this presentation metadata; shafts and the home exit are separate.
function stairView3D(id) {
  if (id === OSTAIRSUP.id)
    return {
      direction: "up",
      blocked: level <= 1 || level === MAXLEVEL || (ULARN && level === DBOTTOM),
    };
  if (id === OSTAIRSDOWN.id)
    return {
      direction: "down",
      blocked: level === 0 || level === DBOTTOM || level === VBOTTOM ||
        (ULARN && level >= VBOTTOM - 2),
    };
  return null;
}

/* Door slab blocks corridor travel. Keep in sync with src/door-facing.js.
 * Default mesh (0): thin along Z → blocks N↔S. π/2 → blocks E↔W. */
function doorPassageFacing3D(x, y) {
  const openFloor = (xx, yy) => {
    if (!inBounds(xx, yy)) return false;
    const it = itemAt(xx, yy);
    return (
      it &&
      !it.matches(OWALL) &&
      !it.matches(OCLOSEDDOOR) &&
      !it.matches(OOPENDOOR)
    );
  };
  const north = openFloor(x, y - 1);
  const south = openFloor(x, y + 1);
  const east = openFloor(x + 1, y);
  const west = openFloor(x - 1, y);
  if (north && south && !(east && west)) return 0;
  if (east && west && !(north && south)) return Math.PI / 2;
  if (!east && !west && (north || south)) return 0;
  if (!north && !south && (east || west)) return Math.PI / 2;
  return 0;
}

function weaponView3D(item = player.WIELD) {
  const name = item ? plainText3D(item.shortName()) : "bare hands";
  let type = "unarmed";
  if (item) {
    if (item.matches(OBATTLEAXE)) type = "axe";
    else if (item.matches(OSPEAR)) type = "spear";
    else if (item.matches(OLANCE)) type = "lance";
    else if (item.matches(ODAGGER)) type = "dagger";
    else if (item.matches(OFLAIL)) type = "flail";
    else if (item.matches(OHAMMER)) type = "hammer";
    else if (item.matches(OPSTAFF)) type = "staff";
    else if ([OSWORD, O2SWORD, OLONGSWORD, OSWORDofSLASHING, OVORPAL, OSLAYER].some((weapon) => item.matches(weapon))) type = "sword";
    else type = "blunt";
  }
  return { id: item?.id ?? null, name, type };
}

const effectNames3D = {
  PROTECTIONTIME: "Protection +2", ALTPRO: "Protection +5",
  DEXCOUNT: "Dexterity", STRCOUNT: "Strength", GIANTSTR: "Giant strength",
  CHARMCOUNT: "Charm", INVISIBILITY: "Invisibility", CANCELLATION: "Cancellation",
  HASTESELF: "Haste", GLOBE: "Invulnerability", SCAREMONST: "Scare monsters",
  HOLDMONST: "Hold monsters", TIMESTOP: "Time stop", WTW: "Walk through walls",
  FIRERESISTANCE: "Fire resistance", STEALTH: "Stealth", AWARENESS: "Awareness",
  SEEINVISIBLE: "See invisible", SPIRITPRO: "Spirit protection", UNDEADPRO: "Undead protection",
  HERO: "Heroism", COKED: "Stimulation", BLINDCOUNT: "Blindness", CONFUSE: "Confusion",
  AGGRAVATE: "Aggravate monsters", HASTEMONST: "Hasted monsters", HALFDAM: "Weakened attacks",
  ITCHING: "Itching", CLUMSINESS: "Clumsiness",
};

function emitCombat3D(detail) {
  window.dispatchEvent(new CustomEvent("ularn:combat", { detail }));
}
const originalHitMonster3D = hitmonster;
hitmonster = function (x, y) {
  const monster = monsterAt(x, y);
  if (!monster || player.TIMESTOP) return originalHitMonster3D(x, y);
  const weapon = weaponView3D();
  const from = { x: player.x, y: player.y };
  const beforeHP = monster.hitpoints;
  const combatLevel = level;
  const result = originalHitMonster3D(x, y);
  emitCombat3D({
    kind: "weapon", phase: "impact", level: combatLevel,
    name: weapon.name, weapon, from, to: { x, y }, path: [from, { x, y }],
    hit: monster.hitpoints < beforeHP || monsterAt(x, y) !== monster,
  });
  return result;
};

// The engine calls the acceptance hook only after its level/intelligence checks.
// Direction prompts do not animate a cast until an actual direction is selected.
let acceptedSpell3D = null;
let projectileSpell3D = null;
let nextCastID3D = 1;
let spellAimAssist3D = false;
function clearSpellAimAssist3D() {
  spellAimAssist3D = false;
}
function spellAccepted3D(id) {
  acceptedSpell3D = {
    kind: "spell", level, castId: nextCastID3D++,
    name: spelname[id], spell: { id, code: spelcode[id], name: spelname[id] },
    from: { x: player.x, y: player.y },
  };
}
function emitSpellCast3D(spell, direction) {
  const from = spell.from;
  const to = direction && !projectileSpell3D
    ? { x: from.x + diroffx[direction], y: from.y + diroffy[direction] }
    : from;
  const visibleTo = inBounds(to.x, to.y) && (!direction || (!player.BLINDCOUNT && (getKnow(to.x, to.y) & KNOWHERE))) ? to : from;
  emitCombat3D({ ...spell, phase: "cast", to: visibleTo, path: [from, ...(visibleTo === from ? [] : [visibleTo])] });
}
const originalSpellDamage3D = speldamage;
speldamage = function (id) {
  acceptedSpell3D = null;
  spellAimAssist3D = false;
  const result = originalSpellDamage3D(id);
  const spell = acceptedSpell3D;
  acceptedSpell3D = null;
  if (!spell) return result;
  if (blocking_callback === getdirectioninput && keyboard_input_callback) {
    spellAimAssist3D = true;
    const resolveDirection = keyboard_input_callback;
    keyboard_input_callback = function (direction) {
      const confused = !!player.CONFUSE;
      const value = resolveDirection(direction);
      spellAimAssist3D = false;
      if (projectileSpell3D) projectileSpell3D.castId = spell.castId;
      if (!confused) emitSpellCast3D(spell, direction);
      return value;
    };
  } else {
    emitSpellCast3D(spell);
  }
  return result;
};
const originalSetupProjectile3D = setup_godirect;
setup_godirect = function (delay, id, ...args) {
  projectileSpell3D = player.CONFUSE ? null : {
    kind: "spell", level,
    name: spelname[id], spell: { id, code: spelcode[id], name: spelname[id] },
    from: { x: player.x, y: player.y }, lastVisible: { x: player.x, y: player.y },
  };
  return originalSetupProjectile3D(delay, id, ...args);
};
const originalProjectileStep3D = godirect;
godirect = function (id, x, y, dx, dy, ...args) {
  const spell = projectileSpell3D;
  const to = { x: x + dx, y: y + dy };
  if (spell && !player.CONFUSE && !player.BLINDCOUNT && inBounds(to.x, to.y) && (getKnow(to.x, to.y) & KNOWHERE)) {
    const from = { x, y };
    const path = (getKnow(x, y) & KNOWHERE) ? [from, to] : [to];
    spell.lastVisible = to;
    emitCombat3D({ ...spell, phase: "projectile", from: path[0], to, path });
  }
  return originalProjectileStep3D(id, x, y, dx, dy, ...args);
};
const originalExitSpell3D = exitspell;
exitspell = function () {
  const spell = projectileSpell3D;
  projectileSpell3D = null;
  if (spell) emitCombat3D({ ...spell, phase: "impact", to: spell.lastVisible, path: [spell.lastVisible] });
  return originalExitSpell3D();
};

// The upstream difficulty routine mutates these templates. Start every attempt
// from the original values, then apply difficulty exactly once, including resume.
const baseMonsterStats3D = ULARN_monsterlist.map((monster) => ({
  hitpoints: monster.hitpoints,
  damage: monster.damage,
  gold: monster.gold,
  armorclass: monster.armorclass,
  experience: monster.experience,
}));
buttonCache.forEach((button, key) => {
  button.id = `engine-${key}`;
});
let initialized3D = false;
let saveError3D = "";
/** Live expedition is the in-memory snapshot; disk only on ask / exit / unload. */
let saveDirty3D = false;
let diskWriteCount3D = 0;
/** Reused across paints so a known 57×20 floor does not allocate ~1k objects/step. */
const snapshotTiles3D = [];
const originalPaint3D = paint;
paint = function () {
  originalPaint3D();
  if (!initialized3D) return;
  window.dispatchEvent(new Event("ularn:update"));
  if (GAMEOVER) {
    saveDirty3D = false;
    try {
      localStorage.removeItem(SAVE_KEY_3D);
      diskWriteCount3D++;
    } catch {
      /* Storage may be disabled. */
    }
  } else if (mazeMode && !blocking_callback && !napping) {
    // Mark dirty only — do not compress or hit localStorage every step.
    // Persist via ularn.save() on Save, Save & Exit, pagehide, or tab hide.
    saveDirty3D = true;
  }
};

window.ularn = {
  setAutoLoot(enabled) {
    const value = !!enabled;
    overridePref("auto_pickup", value);
    try {
      localStorage.setItem(AUTO_LOOT_KEY_3D, String(value));
    } catch {
      /* Keep the control usable when storage is unavailable. */
    }
    window.dispatchEvent(new Event("ularn:update"));
    return value;
  },
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
    ULARN_monsterlist.forEach((monster, index) =>
      Object.assign(monster, baseMonsterStats3D[index]),
    );
    setGameConfig();
    loadPreferences();
    overridePref("no_intro", true);
    overridePref("side_inventory", false);
    const autoLoot = readAutoLoot3D();
    overridePref("auto_pickup", autoLoot);
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
        if (data.equipment) {
          for (const field of ["WIELD", "WEAR", "SHIELD"]) {
            const index = data.equipment[field];
            const equipped = saved.player[field];
            if (index === null && !equipped) continue;
            const item = saved.player.inventory[index];
            if (
              !Number.isInteger(index) ||
              index < 0 ||
              index >= 26 ||
              !item ||
              item.id !== equipped?.id ||
              item.arg !== equipped?.arg
            )
              throw new Error("Invalid equipment slot");
          }
        }
        loadState(saved);
        if (data.equipment) {
          for (const field of ["WIELD", "WEAR", "SHIELD"])
            player[field] =
              data.equipment[field] === null
                ? null
                : player.inventory[data.equipment[field]];
        }
        setGameDifficulty(getDifficulty());
        game_started = true;
        onResize();
        overridePref("side_inventory", false);
        overridePref("auto_pickup", autoLoot);
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
    try {
      localStorageSetObject("logname", logname);
    } catch {
      /* ignore quota — name still applies to this session */
    }
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
  openToward(direction) {
    this.key("o");
    // A confused hero or a chest underfoot can resolve Open without asking for
    // a direction. Never turn the follow-up into an unrelated movement command.
    if (
      blocking_callback === getdirectioninput &&
      keyboard_input_callback === open_something
    )
      this.key(direction);
  },
  save() {
    if (!initialized3D || GAMEOVER || !mazeMode || blocking_callback || napping)
      return false;
    try {
      // Equal-looking items can occupy different slots. Preserve their identity,
      // since the original loader matches equipment only by item ID and bonus.
      const equipment = Object.fromEntries(
        ["WIELD", "WEAR", "SHIELD"].map((field) => [
          field,
          player[field] ? player.inventory.indexOf(player[field]) : null,
        ]),
      );
      const data = { version: 1, state: new GameState(true), equipment };
      localStorage.setItem(
        SAVE_KEY_3D,
        LZString.compressToUTF16(JSON.stringify(data)),
      );
      diskWriteCount3D++;
      saveDirty3D = false;
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
  /** Diagnostics: dirty means moves pending; diskWrites count localStorage persists. */
  saveStats() {
    return { dirty: saveDirty3D, diskWrites: diskWriteCount3D };
  },
  snapshot() {
    if (!initialized3D || !player || !LEVELS[level]) return null;
    let n = 0;
    let structureRev = (level * 9973) ^ (MAXX * 131) ^ (MAXY * 17);
    let actorRev = 0;
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
        const stair = masked ? null : stairView3D(item.id);
        const knownConsumable = masked
          ? true
          : item.matches(OPOTION)
            ? isKnownPotion(item)
            : item.matches(OSCROLL)
              ? isKnownScroll(item)
              : true;
        const isDoor =
          !masked && (item.matches(OCLOSEDDOOR) || item.matches(OOPENDOOR));
        const tile = snapshotTiles3D[n] || (snapshotTiles3D[n] = {});
        n++;
        tile.x = x;
        tile.y = y;
        tile.id = masked ? 0 : item.id;
        tile.arg = masked ? 0 : item.arg ?? 0;
        tile.known = knownConsumable;
        tile.name =
          masked
            ? "The floor"
            : plainText3D(item.shortName()) +
              (stair?.blocked ? " (dead end)" : "");
        tile.stair = stair;
        tile.doorFacing = isDoor ? doorPassageFacing3D(x, y) : null;
        tile.symbol = masked
          ? plainText3D(itemlist[0].ularnchar)
          : item.matches(OHOMEENTRANCE)
            ? "<"
            : item.matches(OSTAIRSUP)
              ? "<"
              : item.matches(OSTAIRSDOWN)
                ? ">"
                : plainText3D(itemlist[item.id].ularnchar);
        tile.wall = !masked && item.matches(OWALL);
        tile.hazard = !masked && !!item.isTrap();
        tile.closed = !masked && item.matches(OCLOSEDDOOR);
        tile.store = !masked && item.isStore();
        if (seenMonster) {
          const mid = mimic || monster.arg;
          const view = monsterView3D(monster);
          const mon = tile.monster || (tile.monster = {});
          mon.id = mid;
          Object.assign(mon, view);
          mon.name = mimic ? monsterlist[mimic].desc : monster.desc;
          mon.symbol = plainText3D(monsterlist[mid].char);
          mon.hp = monster.hitpoints;
          mon.color = monsterlist[mid].color;
          tile.monster = mon;
          actorRev =
            (Math.imul(actorRev, 16777619) ^
              ((x + 1) * 131 +
                (y + 1) * 17 +
                mid * 997 +
                String(mon.uid ?? `${x},${y}`).length * 13)) |
            0;
        } else tile.monster = null;
        structureRev =
          (Math.imul(structureRev, 16777619) ^
            ((x + 1) * 73471 +
              (y + 1) * 19349663 +
              (tile.wall ? 3 : 0) +
              tile.id * 997 +
              (tile.arg ?? 0) * 13 +
              (know & KNOWALL))) |
          0;
      }
    snapshotTiles3D.length = n;
    const tiles = snapshotTiles3D;
    return {
      tiles,
      structureRev: structureRev ^ n,
      actorRev,
      mapRev: (structureRev ^ n) ^ actorRev,
      width: MAXX,
      height: MAXY,
      level,
      dungeonFloors: DBOTTOM,
      volcanoFloors: MAXVLEVEL,
      maze: mazeMode,
      over: GAMEOVER,
      busy: napping,
      prompt: !!blocking_callback,
      aimAssist: (() => {
        const active =
          !!spellAimAssist3D && blocking_callback === getdirectioninput;
        if (spellAimAssist3D && blocking_callback !== getdirectioninput)
          spellAimAssist3D = false;
        return active;
      })(),
      name: logname,
      character: player.char_picked,
      x: player.x,
      y: player.y,
      hp: player.HP,
      hpMax: player.HPMAX,
      mana: player.SPELLS,
      manaMax: player.SPELLMAX,
      xp: player.EXPERIENCE,
      xpNext: SKILL[Math.min(player.LEVEL, MAXPLEVEL)],
      title: CLASSES[Math.max(0, Math.min(CLASSES.length, player.LEVEL) - 1)] || "",
      rank: player.LEVEL,
      gold: player.GOLD,
      bank: player.BANKACCOUNT,
      ac: player.AC,
      wc: player.WCLASS,
      weapon: weaponView3D(),
      autoLoot: !!getPref("auto_pickup"),
      moves: player.MOVESMADE,
      timeLeft: Math.max(0, (TIMELIMIT - gtime) / 100),
      log: LOG.slice(),
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
                slot: index,
                name: plainText3D(item.shortName()),
                id: item.id,
                equipped: ["WIELD", "WEAR", "SHIELD"].filter((field) => player[field] === item),
              }
            : null,
        )
        .filter(Boolean),
      effects: Object.keys(effectNames3D).filter((id) => player[id] > 0),
      effectDetails: Object.entries(effectNames3D)
        .filter(([id]) => player[id] > 0)
        .map(([id, name]) => ({ id, name, turns: player[id] })),
      hasEye: !!isCarrying(OLARNEYE),
      hasCure: !!isCarrying(createObject(OPOTION, 21)),
      saveError: saveError3D,
    };
  },
};
window.addEventListener("pagehide", () => window.ularn.save());
