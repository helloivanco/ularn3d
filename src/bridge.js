/* 3D adapter. The engine owns gameplay; explicit balance changes stay here. */
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
// Room players record their own adventurer (see recordRoomScore3D). Other parties stay off the board.
cloudflareWriteHighScore = score => PARTY_ON && !ROOM_SESSION_ON ? Promise.resolve(false) : ularnScoreService.submit(score, "3d");
// A weekly run reads its own week's board, practice runs included.
getHighscores = () => ularnScoreService.highscores(ULARN, "3d", weeklyRun3D?.label);
cloudflareLoadGame = async id => scoreDetailsText(await ularnScoreService.details(id, "3d"));
let roomScoreActor3D = null, roomScore3D = null, roomScoreSent3D = false;
const roomFates3D = new Map();
const expeditionScoreQuery3D = dbQueryHighScores;
const originalShowScores3D = showScores;
showScores = function (...args) { originalShowScores3D(...args); window.dispatchEvent(new Event("ularn:update")); };
// Spectators and older parties read the verified Supabase board. It does not print a score from this device.
dbQueryHighScores = async (...args) => {
  if (!PARTY_ON || roomScoreActor3D != null) return expeditionScoreQuery3D(...args);
  const paintBoard = (text) => {
    alternativeDisplay = " ";
    lprcat(text);
    blt();
  };
  const unavailable = `                    <b>${GAMENAME} Scoreboard</b>\n\n  Could not load the scoreboard.\n\n                 ----  Start a new expedition to play again  ----`;
  paintBoard(`                    <b>${GAMENAME} Scoreboard</b>\n\n  Loading the scoreboard...\n`);
  try {
    const load = window.ularnOnline && window.ularnOnline.loadPublicBoard;
    if (typeof load !== "function") {
      paintBoard(unavailable);
      return;
    }
    const text = await load(GAMENAME);
    paintBoard(typeof text === "string" && text ? text : unavailable);
  } catch (error) {
    console.error("dbQueryHighScores():", error);
    paintBoard(unavailable);
  }
};

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
  if (ROOM_APPLYING) return originalInput3D(event, key);
  if (
    graphicsPaused3D ||
    document.hidden ||
    document.querySelector("dialog[open]")
  )
    return false;
  if (ROOM_SESSION_ON) {
    const input = KEYBOARD_INPUT && ["return", "enter", ENTER].includes(key) ? `text:${KEYBOARD_INPUT}` : event?.shift && key.length === 1 ? key.toUpperCase() : key;
    window.ularnOnline?.sendInput?.(input);
    return false;
  }
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
  const stairs = stairsTravel3D(key);
  if (stairs) return originalInput3D(event, stairs);
  return originalInput3D(event, key);
};
// Away from stairs, > and < walk to the matching stairs already seen on this
// floor (the engine's } and { travel) instead of saying there is no way down.
function stairsTravel3D(key) {
  if ((key !== ">" && key !== "<") || !mazeMode || blocking_callback || GAMEOVER || !getPref("explore_stairs")) return null;
  const down = key === ">";
  const here = down ? [OSTAIRSDOWN, OVOLDOWN, OENTRANCE] : [OSTAIRSUP, OVOLUP, OHOMEENTRANCE];
  if (here.some((id) => itemAt(player.x, player.y).matches(id))) return null;
  const target = down
    ? level === 0 ? OENTRANCE : OSTAIRSDOWN
    : level === 1 ? OHOMEENTRANCE : level === MAXLEVEL ? OVOLUP : OSTAIRSUP;
  for (let y = 0; y < MAXY; y++)
    for (let x = 0; x < MAXX; x++)
      if (getKnow(x, y) & HAVESEEN && itemAt(x, y).matches(target)) return down ? "}" : "{";
  return null;
}

const SAVE_KEY_3D = "ularn3d.expedition.v1";
const AUTO_LOOT_KEY_3D = "ularn3d.autoLoot";
function readAutoLoot3D() {
  try {
    return localStorage.getItem(AUTO_LOOT_KEY_3D) !== "false";
  } catch {
    return true;
  }
}

// Weekly challenge (larn.org's Game of the Week). Everyone who starts it in the
// same ISO week gets the town, store and all 21 floors built from one seed,
// with the calling and difficulty that seed picks. Each browser's first run of
// the week counts; later runs are practice and are never recorded, like the
// engine's DIED_RETRIED_GOTW games.
const WEEKLY_KEY_3D = "ularn3d.weekly.v1";
const WEEKLY_CALLINGS_3D = ["Adventurer", "Wizard", "Rogue", "Elf", "Dwarf", "Ogre", "Klingon", "Rambo"];
const WEEKLY_LABEL_3D = /^\d{4}_\d{1,2}$/;
const weekLabel3D = getGotwLabel;
let weeklyRun3D = null; // { label, practice } while a weekly run is loaded
// A run belongs to the week it started in, even if it ends after Sunday.
getGotwLabel = (date) => weeklyRun3D?.label || weekLabel3D(date);
function weeklyChallenge3D(date = new Date()) {
  const label = weekLabel3D(date);
  const seed = Number.parseInt(fnv1a64(`ularn3d.weekly.${label}`).slice(-8), 16) >>> 0 || 1;
  return {
    label,
    year: getISOYear(date),
    week: getISOWeek(date),
    seed,
    character: WEEKLY_CALLINGS_3D[seed % WEEKLY_CALLINGS_3D.length],
    difficulty: 1 + (Math.floor(seed / WEEKLY_CALLINGS_3D.length) % 3),
    // getISOWeekDate is the week's Thursday at 00:00 UTC; the week ends at Monday's.
    closesAt: getISOWeekDate(date).getTime() + 4 * 86400000,
  };
}
function readWeeklyRecord3D() {
  try {
    const record = JSON.parse(localStorage.getItem(WEEKLY_KEY_3D));
    return WEEKLY_LABEL_3D.test(record?.label) ? record : null;
  } catch {
    return null;
  }
}
function writeWeeklyRecord3D(record) {
  try {
    localStorage.setItem(WEEKLY_KEY_3D, JSON.stringify(record));
  } catch {
    /* Without storage the attempt cannot be remembered on this browser. */
  }
}
function savedWeekly3D() {
  try {
    const raw = localStorage.getItem(SAVE_KEY_3D);
    const data = raw && JSON.parse(LZString.decompressFromUTF16(raw));
    return WEEKLY_LABEL_3D.test(data?.weekly?.label) ? data.weekly : null;
  } catch {
    return null;
  }
}
// Build every floor and the store now, from the week's seed, so no floor
// depends on what the player did before reaching it. This is what larn.org's
// uploadGOTWforDate did on its server. Play itself stays as random as any solo run.
function beginWeekly3D(week) {
  GOTW = true; // keeps each new floor unseen while it is built
  const home = { x: player.x, y: player.y };
  for (let depth = 1; depth < LEVELS.length; depth++) newcavelevel(depth);
  player.x = home.x;
  player.y = home.y;
  newcavelevel(0);
  dnd_item = null;
  initpricelist();
  // storedata.js picks the store's spellbook once per page load.
  const book = dnd_item.find((item) => item.itemId === OBOOK.id);
  if (book) book.arg = 2 * 100 + rund(9);
  installEngineHost(null);
  const practice = readWeeklyRecord3D()?.label === week.label;
  gameID = `w${week.label}-${Math.random().toString(36).slice(2, 12)}`;
  weeklyRun3D = { label: week.label, practice };
  if (!practice) writeWeeklyRecord3D({ label: week.label, gameID });
  updateLog(`Weekly challenge, week ${week.week} of ${week.year}: everyone this week explores this same dungeon.`);
  updateLog(practice
    ? "This is a practice run. Your counted run this week is already recorded, so this one is not."
    : "This is your counted run. Its result goes on the weekly board.");
}
// A weekly floor is built at the start, so arriving there the first time is
// not a return visit. Skip the engine's return-visit monsters, which would be
// placed at random and differ from player to player.
const originalSethp3D = sethp;
sethp = function (newLevel) {
  if (GOTW && !newLevel && level > 0 && !isLevelVisited(level)) return;
  return originalSethp3D(newLevel);
};

// Presentation identity belongs outside the saved rule objects. Weak references
// also let dead monsters and discarded levels be collected normally.
const monsterPresentation3D = new WeakMap();
let nextMonsterID3D = 1;

// Lemmings stay one to a floor, on the tiles classic stocking already chose.
// Solo 3D no longer adds a second population or skips the engine cap.
// Contact stays harmless, and one dagger swing still clears the creature.
const localBalance3D = () => ULARN && !PARTY_ON && !ENGINE_HOST?.singleStream;
const originalFillMonsterBalance3D = fillmonst;
fillmonst = function (species, awake) {
  if (localBalance3D() && (species === LEMMING || species?.arg === LEMMING) && isGenocided(LEMMING))
    return null;
  return originalFillMonsterBalance3D(species, awake);
};

// Harmless lemmings must not set the engine's "under attack" interruption flag
// or suppress nearby stairs, doors, rest and native exploration interactions.
const originalHitPlayerBalance3D = hitplayer;
hitplayer = function (x, y) {
  if (localBalance3D() && monsterAt(x, y)?.matches(LEMMING)) return;
  return originalHitPlayerBalance3D(x, y);
};
const originalNearbyMonstersBalance3D = nearbymonsters;
nearbymonsters = function () {
  const monsters = originalNearbyMonstersBalance3D();
  return localBalance3D() ? monsters.filter((monster) => !monster.matches(LEMMING)) : monsters;
};
const originalNearbyMonsterBalance3D = nearbymonst;
nearbymonst = function () {
  return localBalance3D() ? nearbymonsters().length > 0 : originalNearbyMonsterBalance3D();
};
const originalExplorerMonstersBalance3D = MazeExplorer.monstersAdjacentTo;
MazeExplorer.monstersAdjacentTo = function (x, y) {
  const monsters = originalExplorerMonstersBalance3D.call(this, x, y);
  return localBalance3D() ? monsters.filter((monster) => !monster.matches(LEMMING)) : monsters;
};

const originalPlayerMoveBalance3D = moveplayer;
moveplayer = function (direction) {
  const canAdvance = localBalance3D() && !player.CONFUSE && !player.TIMESTOP &&
    Number.isInteger(direction) && direction >= 1 && direction <= 8;
  const from = { x: player.x, y: player.y, level };
  const x = from.x + diroffx[direction], y = from.y + diroffy[direction];
  const lemming = canAdvance && inBounds(x, y) && monsterAt(x, y)?.matches(LEMMING);
  const result = originalPlayerMoveBalance3D(direction);
  // Keep the normal attack, loot, XP and terrain interactions. Advancing into
  // the cleared square is part of this one action, not another engine turn.
  if (lemming && !GAMEOVER && !blocking_callback && level === from.level &&
    player.x === from.x && player.y === from.y && !monsterAt(x, y))
    return originalPlayerMoveBalance3D(direction);
  return result;
};

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

/** Commands the pinned inventory offers for a pack item, the main use first. Read-only. */
function packUses3D(item) {
  const uses = [];
  const equipped = player.WIELD === item || player.WEAR === item || player.SHIELD === item;
  if (canQuaff(item)) uses.push("q");
  else if (canRead(item)) uses.push("r");
  else if (canEat(item)) uses.push("e");
  else if (canWear(item)) { if (!equipped) uses.push("W"); }
  else if (item.isWeapon() && !equipped) uses.push("w");
  uses.push("d");
  return uses;
}

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
function emitAction3D(kind, location, detail = {}) {
  window.dispatchEvent(new CustomEvent("ularn:action", { detail: { kind, level: location.level, from: location.from, ...detail } }));
}
const originalTakeAudio3D = take;
take = function (item) {
  const active = mazeMode, location = { level, from: { x: player.x, y: player.y } };
  const known = item?.matches(OPOTION) ? isKnownPotion(item) : item?.matches(OSCROLL) ? isKnownScroll(item) : true;
  const result = originalTakeAudio3D(item);
  if (active && result) emitAction3D("loot", location, item ? { item: { id: item.id, arg: known ? item.arg ?? 0 : null, known } } : {});
  return result;
};
const originalQuaffAudio3D = quaffPotion;
quaffPotion = function (item) {
  const location = { level, from: { x: player.x, y: player.y } }, present = player.inventory.includes(item);
  const result = originalQuaffAudio3D(item);
  if (present && !player.inventory.includes(item)) emitAction3D("potion", location);
  return result;
};
const originalReadAudio3D = readSomething;
readSomething = function (item) {
  const location = { level, from: { x: player.x, y: player.y } }, present = player.inventory.includes(item);
  const result = originalReadAudio3D(item);
  if (present && !player.inventory.includes(item)) emitAction3D("read", location);
  return result;
};
const originalDoorAudio3D = act_open_door;
act_open_door = function (x, y) {
  const location = { level, from: { x: player.x, y: player.y } }, closed = itemAt(x, y)?.matches(OCLOSEDDOOR);
  const result = originalDoorAudio3D(x, y);
  if (closed && itemAt(x, y)?.matches(OOPENDOOR)) emitAction3D("door", location);
  return result;
};
const originalChestAudio3D = act_open_chest;
act_open_chest = function (x, y) {
  const location = { level, from: { x: player.x, y: player.y } }, chest = itemAt(x, y)?.matches(OCHEST), hp = player.HP;
  const result = originalChestAudio3D(x, y);
  if (chest && !itemAt(x, y)?.matches(OCHEST)) emitAction3D("chest", location, { exploded: player.HP < hp });
  return result;
};
// Fountains, altars and thrones: each act_* runs only once the engine has
// confirmed the feature is underfoot, so the call itself is the action.
// Observe-only: arguments and results pass through untouched.
for (const [name, kind, act] of [["act_drink_fountain", "fountain", "drink"], ["act_wash_fountain", "fountain", "wash"],
  ["act_desecrate_altar", "altar", "desecrate"], ["act_sit_throne", "throne", "sit"], ["act_sit_dead_throne", "throne", "sit"],
  ["act_remove_gems", "throne", "gems"]]) {
  const original = globalThis[name];
  if (typeof original !== "function") continue;
  globalThis[name] = function (...args) {
    const location = { level, from: { x: player.x, y: player.y } }, result = original.apply(this, args);
    emitAction3D(kind, location, { act });
    return result;
  };
}
// A prayer counts once the engine accepts it (not on cancel or overdraft).
const originalPrayAudio3D = act_donation_pray;
act_donation_pray = function (offering) {
  const location = { level, from: { x: player.x, y: player.y } }, result = originalPrayAudio3D(offering);
  if (offering != ESC && prayed === 1) emitAction3D("altar", location, { act: "pray" });
  return result;
};
const originalHitMonster3D = hitmonster;
hitmonster = function (x, y) {
  const monster = monsterAt(x, y);
  if (!monster || player.TIMESTOP) return originalHitMonster3D(x, y);
  const weapon = weaponView3D();
  const from = { x: player.x, y: player.y };
  const beforeHP = monster.hitpoints;
  const combatLevel = level;
  let result;
  if (localBalance3D() && monster.matches(LEMMING)) {
    const blind = ifblind(x, y);
    updateLog(`You hit the ${blind ? "monster" : monster}${period}`);
    // Use the normal death/loot/experience path, including weakened attacks.
    // Bypassing the lemming attempt also removes its 40% post-attack birth.
    result = hitm(x, y, Math.max(1, monster.hitpoints) * (player.HALFDAM > 0 ? 2 : 1));
  } else {
    result = originalHitMonster3D(x, y);
  }
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
  spellDepth3D++;
  let result;
  try { result = originalSpellDamage3D(id); } finally { spellDepth3D--; }
  const spell = acceptedSpell3D;
  acceptedSpell3D = null;
  if (!spell) return result;
  if (blocking_callback === getdirectioninput && keyboard_input_callback) {
    spellAimAssist3D = true;
    const resolveDirection = keyboard_input_callback;
    keyboard_input_callback = function (direction) {
      const confused = !!player.CONFUSE;
      spellDepth3D++;
      let value;
      try { value = resolveDirection(direction); } finally { spellDepth3D--; }
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
  spellDepth3D++;
  try { return originalProjectileStep3D(id, x, y, dx, dy, ...args); } finally { spellDepth3D--; }
};
const originalExitSpell3D = exitspell;
exitspell = function () {
  const spell = projectileSpell3D;
  projectileSpell3D = null;
  if (spell) emitCombat3D({ ...spell, phase: "impact", to: spell.lastVisible, path: [spell.lastVisible] });
  return originalExitSpell3D();
};

// Feedback events only observe: they read rule state before and after the
// original call, never touch the engine RNG or clock, and never write fields.
// Server replay runs without this bridge, so any write here would desync rooms.
let spellDepth3D = 0;
const visibleAt3D = (x, y) => inBounds(x, y) && !player.BLINDCOUNT && !!(getKnow(x, y) & KNOWHERE);
const selfActor3D = () => !ROOM_SESSION_ON || ACTIVE_SLOT === ROOM_ACTORS[ROOM_VIEW_ACTOR];
function emitFeel3D(type, detail) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}
// Mimics keep their disguise, so their species, name and health stay hidden.
function monsterFeelView3D(monster) {
  const mimic = monster.arg === MIMIC && monster.mimicarg;
  const species = mimic || monster.arg;
  return { uid: monsterView3D(monster).uid, species, name: monsterlist[species]?.desc || "", known: !mimic };
}
const originalHitPlayerFeel3D = hitplayer;
hitplayer = function (x, y) {
  const monster = monsterAt(x, y), hp = player.HP, at = level, lines = LOG.length, last = LOG[LOG.length - 1];
  const result = originalHitPlayerFeel3D(x, y);
  if (!monster || level !== at || (localBalance3D() && monster.matches(LEMMING))) return result;
  const amount = Math.max(0, hp - player.HP);
  const missed = !amount && (LOG.length !== lines || LOG[LOG.length - 1] !== last) && /miss/i.test(plainText3D(LOG[LOG.length - 1]));
  const seen = visibleAt3D(x, y) && monster.isVisible();
  emitFeel3D("ularn:hurt", {
    level: at, amount, missed, fatal: GAMEOVER || player.HP <= 0, self: selfActor3D(),
    ...(seen ? { from: { x, y }, ...monsterFeelView3D(monster) } : {}),
  });
  return result;
};
const originalHitMonsterFeel3D = hitm;
hitm = function (x, y, damage) {
  const monster = monsterAt(x, y), at = level;
  if (!monster) return originalHitMonsterFeel3D(x, y, damage);
  const maxHp = monsterlist[monster.arg]?.hitpoints || monster.hitpoints;
  const before = Math.min(monster.hitpoints, maxHp), xp = monster.experience;
  const seen = visibleAt3D(x, y) && monster.isVisible();
  const result = originalHitMonsterFeel3D(x, y, damage);
  if (level !== at || !seen) return result;
  const killed = monsterAt(x, y) !== monster;
  const view = monsterFeelView3D(monster);
  emitFeel3D("ularn:damage", {
    level: at, to: { x, y }, ...view, maxHp: view.known ? maxHp : null,
    amount: Math.max(0, before - Math.max(0, monster.hitpoints)), killed, xp: killed ? xp : 0,
    source: spellDepth3D > 0 ? "spell" : "weapon", self: selfActor3D(),
  });
  return result;
};
// Read-only twin of isLevelVisited(), which memoizes into EXPLORED_LEVELS.
function deepestVisited3D() {
  let deepest = level;
  for (let lev = LEVELS.length - 1; lev > deepest; lev--) {
    if (EXPLORED_LEVELS[lev]) return lev;
    const know = LEVELS[lev]?.know;
    if (know && know.some((column) => column.some((cell) => cell && cell !== KNOWNOT))) return lev;
  }
  return deepest;
}
let deepestKey3D = "", deepest3D = 0;
let ending3D = null;
function endingView3D(score) {
  if (!score) return null;
  return {
    score: score.score, what: plainText3D(score.what), levelName: score.level, depth: level, deepest: deepestVisited3D(),
    timeused: score.timeused, moves: score.moves, winner: !!score.winner, hardlev: score.hardlev,
    character: score.character, who: score.who, gameID: score.gameID, kills: player?.MONSTKILLED ?? 0,
    rank: player?.LEVEL ?? 1, title: CLASSES[Math.max(0, Math.min(CLASSES.length, player?.LEVEL ?? 1) - 1)] || "",
    gold: player?.GOLD ?? 0, debug: !!score.debug,
  };
}

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
/** Cached LOG view — avoid LOG.slice() on every paint while the journal is unchanged. */
let logView3D = [];
let logViewLen3D = -1;
let logViewLast3D = null;
let logRev3D = 0;
let logSliceCount3D = 0;
const logViewForSnapshot3D = () => {
  if (!LOG) {
    logView3D = [];
    logViewLen3D = 0;
    logViewLast3D = null;
    return logView3D;
  }
  const len = LOG.length;
  const last = len ? LOG[len - 1] : null;
  if (len === logViewLen3D && last === logViewLast3D) return logView3D;
  logView3D = LOG.slice();
  logViewLen3D = len;
  logViewLast3D = last;
  logRev3D++;
  logSliceCount3D++;
  return logView3D;
};
let saveTimer3D = null, saveIdle3D = null;
// The 2 s autosave captures GameState in a frame's spare time (after the
// frame, or at most 50 ms late), not in the middle of drawing a walk.
const whenIdle3D = (callback) => typeof requestIdleCallback === "function"
  ? { idle: requestIdleCallback(callback, { timeout: 50 }) }
  : { frame: requestAnimationFrame(() => { saveIdle3D.timer = setTimeout(callback, 0); }) };
function cancelAutosave3D() {
  clearTimeout(saveTimer3D); saveTimer3D = null;
  if (saveIdle3D?.idle != null) cancelIdleCallback(saveIdle3D.idle);
  if (saveIdle3D?.frame != null) cancelAnimationFrame(saveIdle3D.frame);
  if (saveIdle3D?.timer != null) clearTimeout(saveIdle3D.timer);
  saveIdle3D = null;
}
let saveEpoch3D = 0, saveSequence3D = 0, saveWorker3D = null;
let saveInFlight3D = null, saveWorkerFailed3D = false;
const saveQueue3D = new Map();
const saveMetrics3D = { worker: false, pending: 0, compressionMs: 0, captureMs: 0, writeMs: 0, completed: 0 };
window.ularnPersistence = Object.freeze({ metrics: () => ({ ...saveMetrics3D }) });

function reportSaveError3D() {
  const previous = saveError3D;
  saveError3D = "Saving unavailable. Check browser storage.";
  if (!previous) window.dispatchEvent(new CustomEvent("ularn:storage", { detail: saveError3D }));
}
function invalidatePendingSaves3D() {
  saveEpoch3D++;
  saveQueue3D.clear();
  saveMetrics3D.pending = 0;
}
function writeCompressed3D(job) {
  if (job.epoch !== saveEpoch3D || GAMEOVER || !initialized3D) return;
  // A newer capture for this slot supersedes an older worker response.
  if (saveQueue3D.has(job.key)) return;
  const started = performance.now();
  try {
    if (job.legacy) {
      localStorage.setItem(job.key + COMPRESSED_DATA, job.compressed);
      localStorage.setItem(job.key, COMPRESSED_DATA);
    } else localStorage.setItem(job.key, job.compressed);
    saveMetrics3D.writeMs = performance.now() - started;
    saveMetrics3D.compressionMs = job.compressionMs || 0;
    saveMetrics3D.completed++;
    diskWriteCount3D++;
    if (saveError3D) window.dispatchEvent(new CustomEvent("ularn:storage", { detail: "" }));
    saveError3D = "";
  } catch { reportSaveError3D(); }
}
function pumpSaves3D() {
  saveMetrics3D.pending = saveQueue3D.size + (saveInFlight3D ? 1 : 0);
  if (saveInFlight3D || !saveQueue3D.size) return;
  const [key, job] = saveQueue3D.entries().next().value;
  saveQueue3D.delete(key);
  if (job.epoch !== saveEpoch3D || GAMEOVER) { pumpSaves3D(); return; }
  if (!saveWorker3D && !saveWorkerFailed3D) {
    try {
      saveWorker3D = new Worker(new URL("/engine/workers/autosaveWorker.js", location.href));
      saveMetrics3D.worker = true;
      saveWorker3D.onmessage = ({ data }) => {
        if (data.sequence !== saveInFlight3D?.sequence) return;
        if (data.error) { failSaveWorker3D(); return; }
        saveInFlight3D = null;
        writeCompressed3D(data);
        pumpSaves3D();
      };
      saveWorker3D.onerror = (event) => { event.preventDefault(); failSaveWorker3D(); };
    } catch { saveWorkerFailed3D = true; }
  }
  saveInFlight3D = job;
  saveMetrics3D.pending = saveQueue3D.size + 1;
  if (saveWorker3D) {
    try { saveWorker3D.postMessage(job); } catch { failSaveWorker3D(); }
  } else {
    // Worker-less hosts keep the original format, using an idle opportunity.
    const compress = () => {
      if (job !== saveInFlight3D) return;
      saveInFlight3D = null;
      if (job.epoch === saveEpoch3D && !GAMEOVER) {
        try {
          const started = performance.now();
          writeCompressed3D({ ...job, compressed: LZString.compressToUTF16(job.value), compressionMs: performance.now() - started });
        } catch { reportSaveError3D(); }
      }
      pumpSaves3D();
    };
    if (window.requestIdleCallback) requestIdleCallback(compress, { timeout: 1000 });
    else setTimeout(compress, 0);
  }
}
function failSaveWorker3D() {
  saveWorker3D?.terminate(); saveWorker3D = null; saveWorkerFailed3D = true;
  saveMetrics3D.worker = false;
  if (saveInFlight3D?.epoch === saveEpoch3D && !saveQueue3D.has(saveInFlight3D.key))
    saveQueue3D.set(saveInFlight3D.key, saveInFlight3D);
  saveInFlight3D = null;
  pumpSaves3D();
}
function equipmentSlots3D() {
  return Object.fromEntries(["WIELD", "WEAR", "SHIELD"].map((field) =>
    [field, player[field] ? player.inventory.indexOf(player[field]) : null]));
}
function enqueueSave3D(key, data, legacy = false) {
  const started = performance.now();
  try {
    // Serialize now, while stable: GameState contains live engine references.
    const value = JSON.stringify(data);
    saveMetrics3D.captureMs = performance.now() - started;
    saveQueue3D.set(key, { key, value, legacy, epoch: saveEpoch3D, sequence: ++saveSequence3D });
    pumpSaves3D();
  } catch { reportSaveError3D(); }
}
const saveData3D = () => ({
  version: 1,
  state: new GameState(true),
  // Equal-looking items can occupy different slots. Preserve their identity,
  // since the original loader matches equipment only by item ID and bonus.
  equipment: equipmentSlots3D(),
  // A weekly run keeps its week and practice flag across Continue.
  ...(weeklyRun3D ? { weekly: weeklyRun3D } : {}),
});
function autosave3D() {
  if (!initialized3D || GAMEOVER || !mazeMode || blocking_callback || napping) return;
  enqueueSave3D(SAVE_KEY_3D, saveData3D());
}
const originalCheckpointSave3D = saveGame;
saveGame = function (checkpoint) {
  if (!initialized3D || !checkpoint) return originalCheckpointSave3D(checkpoint);
  const state = new GameState(true);
  state.cheat = true;
  enqueueSave3D(`ularn3d.legacy.checkpointbackup${ULARN ? "_ularn" : ""}`, state, true);
  return true;
};

const originalPaint3D = paint;
paint = function () {
  originalPaint3D();
  if (!initialized3D) return;
  window.dispatchEvent(new Event("ularn:update"));
  if (GAMEOVER) {
    saveDirty3D = false;
    invalidatePendingSaves3D();
    cancelAutosave3D();
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
    if (saveTimer3D === null && saveIdle3D === null) saveTimer3D = setTimeout(() => {
      saveTimer3D = null;
      saveIdle3D = whenIdle3D(() => { saveIdle3D = null; autosave3D(); });
    }, 1950);
  }
};

window.ularn = {
  showScoreboard(local = false) {
    if (!initialized3D || (!scoreboardActive && (blocking_callback || !mazeMode))) return;
    loadScores(GAMEOVER ? new LocalScore() : null, true, true, local);
    window.dispatchEvent(new Event("ularn:update"));
  },
  party() {
    if (typeof adventurerSummaries !== "function") return [];
    const people = adventurerSummaries();
    if (!ROOM_SESSION_ON) return people;
    return people.filter(person => person.connected !== false).map(person => ({ ...person, slot: ROOM_ACTORS.findIndex(slot => slot === person.slot) }));
  },
  fog(name) {
    if (typeof adventurerSeen !== "function") return null;
    return adventurerSeen(name);
  },
  applyRest(slot) {
    if (typeof activateAdventurer === "function" && slot != null) activateAdventurer(slot);
    if (typeof mainloop === "function") mainloop(null, ".");
    return true;
  },
  setAura(on, from) {
    if (typeof hostSetCooperationAura !== "function") return { ok: false, aura: false, multiplayer: false };
    const result = hostSetCooperationAura(!!on, from || { role: "player" });
    window.dispatchEvent(new Event("ularn:update"));
    return result;
  },
  groups() {
    if (typeof encounterGroups !== "function") return [];
    return encounterGroups(this.party().filter((member) => member.alive));
  },
  setAutoLoot(enabled) {
    if (ROOM_SESSION_ON && !ROOM_APPLYING) {
      window.ularnOnline?.sendInput?.(enabled ? "loot:on" : "loot:off");
      return !!enabled;
    }
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
  // Read-only: who and where the saved expedition is, for the title's Continue.
  saveSummary() {
    try {
      const saved = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem(SAVE_KEY_3D)))?.state;
      if (!saved?.player || saved.GAMEOVER || !Number.isInteger(saved.level)) return null;
      // The title runs before setGameConfig; 3D is always Ularn, whose limit is 40000.
      const limit = typeof TIMELIMIT === "number" ? TIMELIMIT : 40000;
      return {
        name: String(saved.logname || ""), character: String(saved.player.char_picked || ""),
        level: saved.level, rank: saved.player.LEVEL,
        timeLeft: Math.max(0, Math.ceil((limit - (saved.gtime || 0)) / 100)),
      };
    } catch {
      return null;
    }
  },
  // Which kind of answer the open prompt wants, so a controller can give it.
  promptKind() {
    if (!blocking_callback) return null;
    return blocking_callback === getdirectioninput ? "direction" : "choice";
  },
  // Read-only species list for the bestiary; templates are never touched.
  species() {
    return ULARN_monsterlist.slice(1).map((monster, index) => ({
      id: index + 1, name: plainText3D(monster.desc), symbol: plainText3D(monster.char), level: monster.level,
    }));
  },
  /** This week's challenge, this browser's counted attempt, and a saved weekly run. */
  weekly() {
    const week = weeklyChallenge3D();
    const record = readWeeklyRecord3D();
    const saved = savedWeekly3D();
    return {
      ...week,
      attempt: record?.label === week.label ? { gameID: record.gameID, result: record.result || null } : null,
      saved: saved?.label === week.label ? { practice: !!saved.practice } : null,
    };
  },
  async start({
    name = "Adventurer",
    character = "Adventurer",
    difficulty = 0,
    resume = false,
    seed = null,
    skipPaint = false,
    weekly = false,
  } = {}) {
    if (initialized3D) return;
    ending3D = null;
    deepestKey3D = "";
    ULARN = true;
    GOTW = false;
    weeklyRun3D = null;
    PARAMS = { ularn: "true" };
    playerID = "local";
    ULARN_monsterlist.forEach((monster, index) =>
      Object.assign(monster, baseMonsterStats3D[index]),
    );
    setGameConfig();
    loadPreferences();
    // Auto explore (X), travel to an object (G) and travel to stairs ({ }) start
    // on unless the player turned them off in Options. A room never runs one:
    // every browser must apply exactly the same shared steps.
    for (const name of ["explore_toggle", "explore_object", "explore_stairs"]) {
      if (ROOM_SESSION_ON) overridePref(name, false);
      else if (localStorageGetObject(name, null) === null) overridePref(name, true);
    }
    overridePref("no_intro", true);
    overridePref("side_inventory", false);
    const autoLoot = ROOM_SESSION_ON ? false : readAutoLoot3D();
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
        trimJournalLog();
        logViewLen3D = -1;
        if (data.equipment) {
          for (const field of ["WIELD", "WEAR", "SHIELD"])
            player[field] =
              data.equipment[field] === null
                ? null
                : player.inventory[data.equipment[field]];
        }
        setGameDifficulty(getDifficulty());
        if (WEEKLY_LABEL_3D.test(data.weekly?.label)) {
          GOTW = true;
          weeklyRun3D = { label: data.weekly.label, practice: !!data.weekly.practice };
        }
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
    // The week decides the seed, calling and difficulty. Rooms never run one.
    const week = weekly && !ROOM_SESSION_ON ? weeklyChallenge3D() : null;
    if (week) ({ seed, character, difficulty } = week);
    if (seed != null) {
      installEngineHost(
        createEngineHost(seed, { skipPaint: !!skipPaint, skipDelay: true }),
      );
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
    if (week) beginWeekly3D(week);
    paint();
    this.save();
  },
  key(key, shift = false) {
    if (!initialized3D) return;
    mousetrap({ shift, preventDefault() {} }, key);
  },
  /** Use, equip or drop a pack item by letter. See usePackItem in party.js. */
  usePack(command, letter) {
    if (ROOM_SESSION_ON) return window.ularnOnline?.sendInput?.(`use:${command}:${letter}`);
    if (!initialized3D) return false;
    return usePackItem(command, letter);
  },
  openToward(direction) {
    if (ROOM_SESSION_ON) return window.ularnOnline?.sendInput?.(`open:${direction}`);
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
    if (ROOM_SESSION_ON) return false;
    if (!initialized3D || GAMEOVER || !mazeMode || blocking_callback || napping)
      return false;
    cancelAutosave3D(); invalidatePendingSaves3D();
    try {
      localStorage.setItem(
        SAVE_KEY_3D,
        LZString.compressToUTF16(JSON.stringify(saveData3D())),
      );
      diskWriteCount3D++;
      saveDirty3D = false;
      if (saveError3D)
        window.dispatchEvent(new CustomEvent("ularn:storage", { detail: "" }));
      saveError3D = "";
      return true;
    } catch {
      reportSaveError3D();
      return false;
    }
  },
  /** Diagnostics: dirty means moves pending; diskWrites count localStorage persists. */
  saveStats() {
    return { dirty: saveDirty3D, diskWrites: diskWriteCount3D };
  },
  /** DEV/CI: journal + snapshot alloc counters (cheap; always safe to call). */
  perfStats() {
    return {
      logLines: LOG ? LOG.length : 0,
      logCap: LOG_JOURNAL_CAP,
      logRev: logRev3D,
      logSlices: logSliceCount3D,
      tileBuffer: snapshotTiles3D.length,
    };
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
        tile.stair = stair;
        tile.doorFacing = isDoor ? doorPassageFacing3D(x, y) : null;
        tile.wall = !masked && item.matches(OWALL);
        tile.hazard = !masked && !!item.isTrap();
        tile.closed = !masked && item.matches(OCLOSEDDOOR);
        tile.store = !masked && item.isStore();
        // Only rebuild display strings when presentation identity changes.
        const presentSig = masked
          ? -1
          : (Math.imul(tile.id + 1, 9973) ^
              Math.imul((tile.arg ?? 0) + 1, 131) ^
              ((know & KNOWALL) * 17) ^
              (stair?.blocked ? 3 : 0) ^
              (knownConsumable ? 0 : 5) ^
              (isDoor ? 7 : 0)) |
            0;
        if (tile._sig !== presentSig) {
          tile._sig = presentSig;
          tile.name =
            masked
              ? "The floor"
              : plainText3D(item.shortName()) +
                (stair?.blocked ? " (dead end)" : "");
          tile.symbol = masked
            ? plainText3D(itemlist[0].ularnchar)
            : item.matches(OHOMEENTRANCE)
              ? "<"
              : item.matches(OSTAIRSUP)
                ? "<"
                : item.matches(OSTAIRSDOWN)
                  ? ">"
                  : plainText3D(itemlist[item.id].ularnchar);
        }
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
          // Mimics wear another creature's name. The hover card is only for
          // a creature the player can already identify.
          mon.known = monster.arg !== MIMIC;
          // The engine's own per-species cap; the UI only shows a wound band.
          mon.hpMax = mon.known ? monsterlist[monster.arg].hitpoints : null;
          mon.harmless = localBalance3D() && monster.matches(LEMMING);
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
    const structure = structureRev ^ n;
    const depthKey = `${gameID}|${level}`;
    if (depthKey !== deepestKey3D) { deepestKey3D = depthKey; deepest3D = deepestVisited3D(); }
    return {
      tiles,
      structureRev: structure,
      actorRev,
      mapRev: structure ^ actorRev,
      logRev: logRev3D,
      width: MAXX,
      height: MAXY,
      level,
      dungeonFloors: DBOTTOM,
      volcanoFloors: MAXVLEVEL,
      maze: mazeMode,
      over: GAMEOVER,
      // After death, Enter still opens the scoreboard once; afterward only a new run is valid.
      awaitingScoreboard: GAMEOVER && blocking_callback === endgame,
      winner: !!player.winner,
      scoreboard: scoreboardActive,
      localScores: scoreboardLocal,
      scoreSync: ularnScoreService.status(),
      weekly: weeklyRun3D,
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
      gameID,
      character: player.char_picked,
      x: player.x,
      y: player.y,
      hp: player.HP,
      hpMax: player.HPMAX,
      mana: player.SPELLS,
      manaMax: player.SPELLMAX,
      xp: player.EXPERIENCE,
      xpNext: SKILL[Math.min(player.LEVEL, MAXPLEVEL)],
      xpFloor: SKILL[Math.max(0, Math.min(player.LEVEL, MAXPLEVEL) - 1)] ?? 0,
      title: CLASSES[Math.max(0, Math.min(CLASSES.length, player.LEVEL) - 1)] || "",
      rank: player.LEVEL,
      gold: player.GOLD,
      bank: player.BANKACCOUNT,
      ac: player.AC,
      wc: player.WCLASS,
      weapon: weaponView3D(),
      autoLoot: !!getPref("auto_pickup"),
      multiplayer: typeof partySize === "function" && partySize() > 1,
      aura: typeof cooperationAuraOn === "function" ? cooperationAuraOn() : false,
      moves: player.MOVESMADE,
      kills: player.MONSTKILLED,
      spellsKnown: player.knownSpells.filter(Boolean).length,
      deepest: Math.max(level, deepest3D),
      difficulty: getDifficulty(),
      ending: ending3D,
      timeLeft: Math.max(0, (TIMELIMIT - gtime) / 100),
      log: logViewForSnapshot3D(),
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
                arg: item.arg ?? 0,
                known: item.matches(OPOTION) ? isKnownPotion(item) : item.matches(OSCROLL) ? isKnownScroll(item) : true,
                equipped: ["WIELD", "WEAR", "SHIELD"].filter((field) => player[field] === item),
                uses: packUses3D(item),
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

// Room simulation stays on the last authenticated actor. Rendering temporarily
// selects this browser's adventurer, then restores the simulation actor.
const roomSnapshot3D = window.ularn.snapshot.bind(window.ularn);
window.ularn.snapshot = function () {
  if (!ROOM_SESSION_ON) return roomSnapshot3D();
  const canonical = ACTIVE_SLOT;
  const partyWon = GAMEOVER && !!player?.winner;
  const view = ROOM_ACTORS[ROOM_VIEW_ACTOR];
  if (view != null && view !== canonical) activateAdventurer(view);
  try {
    const state = roomSnapshot3D();
    if (state) state.autoLoot = !!ROOM_AUTO_LOOT[ROOM_VIEW_ACTOR];
    if (state && GAMEOVER) state.winner = partyWon;
    if (state && (ROOM_PROMPT_ACTOR !== ROOM_VIEW_ACTOR || window.ularnOnline?.spectating?.())) {
      state.prompt = false;
      state.maze = !GAMEOVER;
      state.aimAssist = false;
    }
    if (state) state.roomBlocked = !window.ularnOnline?.acceptsInput?.();
    return state;
  } finally {
    if (ACTIVE_SLOT !== canonical) activateAdventurer(canonical);
  }
};
window.ularn.beginRoom = async function ({ seed, config, viewActor, runId = null, scoreActor = null }) {
  if (initialized3D && !ROOM_SESSION_ON) throw new Error('Finish the current expedition before joining a room.');
  ROOM_SESSION_ON = true;
  const first = config.players[0];
  await this.start({ name: first.name, character: first.character, difficulty: config.difficulty, seed });
  beginRoomParty(config.players);
  ROOM_VIEW_ACTOR = viewActor;
  roomScoreActor3D = runId && scoreActor != null ? scoreActor : null;
  roomScore3D = null;
  roomScoreSent3D = false;
  roomFates3D.clear();
  // One board row per adventurer per run, so a reload after the end cannot add a second.
  if (roomScoreActor3D != null) gameID = `${runId}-${roomScoreActor3D}`;
  window.dispatchEvent(new Event('ularn:update'));
};
window.ularn.applyRoomAction = function (row) {
  const accepted = applyRoomAction(row);
  if (GAMEOVER) recordRoomScore3D();
  window.dispatchEvent(new Event('ularn:update'));
  return accepted;
};

// The engine ends a room with the last adventurer standing as the active
// hero. Each browser instead scores its own adventurer, using the fate it met.
const originalBecomeGhost3D = becomeGhost;
becomeGhost = function (reason) {
  const fell = originalBecomeGhost3D(reason);
  if (fell && ROOM_SESSION_ON) roomFates3D.set(ACTIVE_SLOT, reason);
  return fell;
};
const originalRevive3D = reviveAdventurer;
reviveAdventurer = function (slotIndex) {
  const revived = originalRevive3D(slotIndex);
  if (revived) roomFates3D.delete(slotIndex);
  return revived;
};
function ownRoomScore3D() {
  if (roomScore3D || roomScoreActor3D == null || !GAMEOVER) return roomScore3D;
  const index = ROOM_ACTORS[roomScoreActor3D];
  if (index == null || !ADVENTURERS[index]) return null;
  const canonical = ACTIVE_SLOT;
  const partyWon = !!player?.winner;
  activateAdventurer(index);
  const kept = lastmonst;
  try {
    if (roomFates3D.has(index)) lastmonst = roomFates3D.get(index);
    else if (index !== canonical) lastmonst = partyWon && player.HP > 0 ? DIED_WINNER : DIED_QUITTER;
    roomScore3D = new LocalScore();
  } finally {
    lastmonst = kept;
    if (ACTIVE_SLOT !== canonical) activateAdventurer(canonical);
  }
  return roomScore3D;
}
function recordRoomScore3D() {
  if (roomScoreSent3D || !ROOM_SESSION_ON || !GAMEOVER) return;
  const score = ownRoomScore3D();
  if (!score) return;
  roomScoreSent3D = true;
  ending3D = endingView3D(score);
  originalWriteScore3D(score);
  window.dispatchEvent(new Event('ularn:update'));
}
const originalWriteScore3D = writeScoreToDatabase;
writeScoreToDatabase = function (endGameScore) {
  if (weeklyRun3D) {
    const record = readWeeklyRecord3D();
    if (record?.gameID === endGameScore.gameID)
      writeWeeklyRecord3D({
        ...record,
        result: {
          score: endGameScore.score,
          winner: !!endGameScore.winner,
          fate: String(endGameScore.what || "").replace(/<[^>]*>/g, ""),
          level: endGameScore.level,
        },
      });
  }
  if (!ROOM_SESSION_ON) {
    ending3D = endingView3D(endGameScore);
    // A practice run shows its recap but is never recorded, like the
    // engine's DIED_RETRIED_GOTW games. Rooms never run a weekly challenge.
    if (weeklyRun3D?.practice) return Promise.resolve();
    return originalWriteScore3D(endGameScore);
  }
  // Let died() finish with its own hero before switching to this browser's.
  setTimeout(recordRoomScore3D, 0);
  return Promise.resolve();
};
const originalLoadScores3D = loadScores;
loadScores = function (newScore, ...rest) {
  const own = ROOM_SESSION_ON && GAMEOVER ? ownRoomScore3D() : null;
  return originalLoadScores3D(own || newScore, ...rest);
};
window.ularn.roomView = function (actor) {
  ROOM_VIEW_ACTOR = actor;
  window.dispatchEvent(new Event('ularn:update'));
};
window.ularn.roomCanAct = roomCanAct;
window.ularn.roomPromptActor = () => ROOM_PROMPT_ACTOR;
window.ularn.roomChecksum = () => checksumGameState(captureGameState());
window.ularn.roomEndKey = function (key) {
  if (!GAMEOVER || !["return", "space", "escape", "z"].includes(key)) return false;
  ROOM_APPLYING = true;
  try { originalInput3D(null, key); return true; }
  finally { ROOM_APPLYING = false; }
};
window.ularn.fogActor = function (actor) {
  const index = ROOM_ACTORS[actor];
  if (index == null) return [];
  if (index === ACTIVE_SLOT) return seenCells(LEVELS[level]?.know);
  const slot = ADVENTURERS[index];
  return seenCells(slot?.know?.[slot.level]);
};
