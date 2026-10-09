'use strict';


/*
    newcavelevel(level)
    int level;

    function to enter a new level.  This routine must be called anytime the
    player changes levels.  If that level is unknown it will be created.
    A new set of monsters will be created for a new level, and existing
    levels will get a few more monsters.
    Note that it is here we remove genocided monsters from the present level.
 */

let STARTED_LEVEL_CREATION = false;

/*
 * Ularn create.c artifact rolls. rnd(n) is 1..n, so a threshold of 8 is 7/120.
 * 1.3.29 changes six named rates. Every other artifact stays at threshold 8.
 *
 * Brass lamp: 6/120 = 5%. Threshold 7.
 * Sword of slashing: requested 7.333% is not on a 1–120 roll; nearest is 9/120 = 7.5%. Threshold 10.
 * Elven chain: requested 8.133%; nearest is 10/120 = 8.333%. Threshold 11.
 * Orb of enlightenment: requested 8.233%; nearest is 10/120 = 8.333%. Threshold 11.
 *
 * Slayer and the staff of power keep rnd(100) > (gate - (depth - 10)).
 * That is one point per depth. A higher gate removes that many points at every depth.
 * Slayer gate 90 is the old gate 85 minus 5 points. Staff gate 87 is the old gate 85 minus 2 points.
 * Slayer still starts at depth 10. The staff still starts at depth 8.
 */
const ULARN_ARTIFACT_SIDES = 120;
const ULARN_ARTIFACT_UNDER = 8;
const ULARN_BRASS_LAMP_UNDER = 7;
const ULARN_SLASHING_UNDER = 10;
const ULARN_ELVEN_CHAIN_UNDER = 11;
const ULARN_ORB_UNDER = 11;
const ULARN_SLAYER_GATE = 90;
const ULARN_STAFF_GATE = 87;

/* Door provenance for this level: "canned" | "treasure-room" | "repair". */
let levelFromCanned = false;
let doorProvenance = new Map();
let treasureRoomDoors = [];
/* Doors and passages added to join a sealed room or hallway to the start. */
let repairLinks = 0;

/* Procedural carve origin. Canned charts do not set this. */
let eatAnchor = null;
let eatSeeds = [];
/* Treasure rooms whose single door joined the carve. Loot waits until then. */
let pendingTreasureRooms = [];
/* Volcano open-rect monsters rolled during makemaze, placed only after the carve connects. */
let pendingVolcanoMons = [];
/* A treasure room whose door could not join the carved network. */
let levelStructureRejected = false;
/* Empty tiles that may receive stairs, monsters, and items. Null outside generation. */
let placementNetwork = null;
/* null | "procedural" | "canned" — tests pin a source; the game leaves this null. */
let forceMazeSource = null;
/* Start cell for this attempt. Cleared when that tile stops being floor. */
let levelEntry = null;
/* Last attempt, for the connectivity audit. */
let lastLevelGen = null;

const LEVEL_GEN_ATTEMPT_CAP = 48;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawLevelSeed() {
  // One stream: the recorded per-level seed is drawn from the game RNG,
  // and generation keeps consuming that same stream (no second generator).
  if (ENGINE_HOST && ENGINE_HOST.singleStream && typeof ENGINE_HOST.random === "function") {
    return (Math.floor(ENGINE_HOST.random() * 0xffffffff) >>> 0) || 1;
  }
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    if (buf[0]) return buf[0];
  }
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

function beginLevelAttempt(seed) {
  const chosen = (seed >>> 0) || 1;
  if (ENGINE_HOST && ENGINE_HOST.singleStream) return chosen;
  setLevelRng(mulberry32(chosen));
  return chosen;
}

function endLevelAttempt() {
  setLevelRng(null);
  placementNetwork = null;
}

function resetDeferredPopulation() {
  eatAnchor = null;
  eatSeeds = [];
  pendingTreasureRooms = [];
  pendingVolcanoMons = [];
  levelStructureRejected = false;
  placementNetwork = null;
  repairLinks = 0;
  levelEntry = null;
}

function newcavelevel(depth) {

  STARTED_LEVEL_CREATION = true;

  if (level != depth) changedDepth = millis();

  /* 12.4.5
  prevent a rogue monster from starting to move towards the player
  just because it's in the same square as the last hit monster on
  another level
  */
  lasthx = 0;
  lasthy = 0;
  // eslint-disable-next-line no-global-assign
  screen = initGrid(MAXX, MAXY); // in case this was causing weird monster movement

  if (LEVELS[depth]) { // if we have visited this level before
    level = depth;
    sethp(false);
    positionplayer(player.x, player.y, true);
    checkgen();

    STARTED_LEVEL_CREATION = false;

    return;
  }

  /*
   * Build the level and keep it only when every playable tile is on the
   * player's network. A sealed room is joined by a real door or passage,
   * or it is not left on the map. Retries are bounded. The fallback still
   * has to be walkable.
   */
  const built = generateFreshLevel(depth);
  if (!built.ok) {
    const r = built.report || {};
    const line =
      `Ularn level generation failed depth=${depth} seed=${built.seed} attempts=${built.attempts} ` +
      `walkable=${r.walkable} reachable=${r.reachable} unreachable=${r.unreachable}`;
    console.warn(line);
    debug(line);
  }

  alignPlayerToProgression(depth);
  positionplayer(player.x, player.y, true);

  if (GOTW) {
    setKnow(player.x, player.y, KNOWNOT);
  } else {
    showcell(player.x, player.y); /* to show around player */
  }

  checkgen(); /* wipe out any genocided monsters */

  if (wizard) {
    for (var j = 0; j < MAXY; j++)
      for (var i = 0; i < MAXX; i++)
        setKnow(i, j, KNOWALL);
  } else if (level == 0) {
    revealTown();
  }

  /*
  save a checkpoint file to prevent a different random level from being created
  -- disabled in v304 since it's too easy to abuse
  if (depth > 0) {
     saveGame(true);
   }
   */

    STARTED_LEVEL_CREATION = false;

}



function initNewLevel(depth) {
  const newLevel = Object.create(Level);

  newLevel.items = initGrid(MAXX, MAXY, OEMPTY);
  newLevel.monsters = initGrid(MAXX, MAXY, null);
  newLevel.know = initGrid(MAXX, MAXY, 0);

  LEVELS[depth] = newLevel;
  level = depth;
}



function loadcanned() {
  var mazeindex;

  // Classic Ularn: ~1% chance of a treasure map floor.
  if (TREASURE_MAZES && TREASURE_MAZES.length && rnd(100) === 1) {
    const ti = rund(TREASURE_MAZES.length);
    return { maze: TREASURE_MAZES[ti], treasure: true };
  }

  do {
    mazeindex = rund(MAZES.length);
  } while (USED_MAZES.indexOf(mazeindex) > -1 && USED_MAZES.length < MAZES.length);
  USED_MAZES.push(mazeindex);
  //debug(`loadcanned: used: ` + USED_MAZES);
  return { maze: MAZES[mazeindex], treasure: false };
}



function cannedMazeFits(canned) {
  const maze = canned && canned.maze ? canned.maze : canned;
  return maze && maze.length === MAXX * MAXY;
}

function townBounds() {
  const x0 = Math.floor((MAXX - TOWN_SIZE) / 2);
  const y0 = Math.floor((MAXY - TOWN_SIZE) / 2);
  return { x0, y0, x1: x0 + TOWN_SIZE - 1, y1: y0 + TOWN_SIZE - 1 };
}

function homeEntranceX() {
  return Math.floor(MAXX / 2);
}

function homeEntranceY() {
  return MAXY - 1;
}

function isOpenMazeTile(x, y) {
  if (!inBounds(x, y)) return false;
  const item = itemAt(x, y);
  return item && !item.matches(OWALL) && !item.matches(OCLOSEDDOOR);
}

/* Classic Ularn exit is column 33 on the south border. Do not carve a path. */
function placeHomeEntrance() {
  const x = 33 < MAXX - 1 ? 33 : homeEntranceX();
  const y = homeEntranceY();
  setItem(x, y, OHOMEENTRANCE);
  setMonster(x, y, null);
}

function inTown(x, y) {
  const b = townBounds();
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

function revealTown() {
  const b = townBounds();
  for (let y = b.y0 - 1; y <= b.y1 + 1; y++) {
    for (let x = b.x0 - 1; x <= b.x1 + 1; x++) {
      if (x >= 0 && y >= 0 && x < MAXX && y < MAXY) setKnow(x, y, KNOWALL);
    }
  }
}

function layoutTown() {
  const b = townBounds();
  for (let y = 0; y < MAXY; y++) {
    for (let x = 0; x < MAXX; x++) {
      setItem(x, y, inTown(x, y) ? OEMPTY : OWALL);
    }
  }
  if (player) {
    player.x = Math.floor((b.x0 + b.x1) / 2);
    player.y = Math.floor((b.y0 + b.y1) / 2);
  }
}

function findItemXY(what, arg) {
  for (let y = 0; y < MAXY; y++) {
    for (let x = 0; x < MAXX; x++) {
      const item = itemAt(x, y);
      if (item.matches(what) && (arg == null || item.arg === arg)) return { x, y };
    }
  }
  return null;
}

function ensureSpecialLevelArtifacts(depth) {
  if (depth == DBOTTOM && !findItemXY(OLARNEYE)) {
    fillroom(OLARNEYE, 0);
    const at = findItemXY(OLARNEYE);
    if (at) setMonster(at.x, at.y, createMonster(DEMONPRINCE));
  }
  if (depth == VBOTTOM && !findItemXY(OPOTION, 21)) {
    fillroom(OPOTION, 21);
    const at = findItemXY(OPOTION, 21);
    if (at) setMonster(at.x, at.y, createMonster(LUCIFER));
  }
}

function cannedlevel(depth) {

  var loaded = loadcanned();
  if (!cannedMazeFits(loaded)) return false;
  var canned = loaded.maze;
  var isTreasure = !!loaded.treasure;
  levelFromCanned = true;
  beginLevelLootSet();

  var pt = 0;
  for (var y = 0; y < MAXY; y++) {
    for (var x = 0; x < MAXX; x++) {
      setItem(x, y, OEMPTY);
      switch (canned[pt++]) {
        case '#':
          setItem(x, y, OWALL);
          break;
        case 'D':
          setItem(x, y, createObject(OCLOSEDDOOR, rnd(30)));
          noteDoor(x, y, "canned");
          break;
        case '-':
          setItem(x, y, isTreasure
            ? createTreasureMapLoot(depth)
            : createDepthLoot(depth + 1));
          break;
        case '$':
          setItem(x, y, createGold(50 + rnd(40) * (depth + 1)));
          break;
        case '.':
          if (depth < (ULARN ? MAXLEVEL - 6: MAXLEVEL)) break;
          setMonster(x, y, makemonst(depth + 1));
          break;
        case '~':
          if (depth != DBOTTOM) break;
          setItem(x, y, OLARNEYE);
          ULARN ? setMonster(x, y, DEMONPRINCE) : setMonster(x, y, rund(8) + DEMONLORD);
          break;
        case '!':
          if (depth != VBOTTOM) break;
          setItem(x, y, createObject(OPOTION, 21));
          ULARN ? setMonster(x, y, LUCIFER) : setMonster(x, y, DEMONPRINCE);
          break;
      } // switch
    } // for
  } // for
  if (isTreasure) scatterTreasureMapExtras(depth);
  return true;
}

/* High-value loot for rare treasure-room floors — gold-biased. */
function createTreasureMapLoot(depth) {
  const roll = rnd(100);
  if (roll < 55) return createGold(80 + rnd(60) * (depth + 1));
  if (roll < 68) return createObject(ODIAMOND, 20 + rnd(30) + depth * 2);
  if (roll < 78) return createObject(ORUBY, 15 + rnd(20) + depth);
  if (roll < 86) return createObject(OEMERALD, 12 + rnd(15) + depth);
  if (roll < 92) return createObject(OSAPPHIRE, 10 + rnd(12) + depth);
  if (roll < 96) return createObject(OSCROLL, newscroll());
  if (roll < 98) return createObject(OPOTION, newpotion());
  if (ULARN && roll < 99) return createDepthLoot(depth + 2);
  return createObject(OCHEST, Math.max(1, depth));
}

function scatterTreasureMapExtras(depth) {
  /* Modest extras only — more gold than items; do not carpet the floor. */
  for (let i = 0; i < 4 + rnd(3); i++) {
    fillroom(OGOLDPILE, 100 + rnd(80) * (depth + 1));
  }
  for (let i = 0; i < 1 + rnd(2); i++) {
    fillroom(createTreasureMapLoot(depth));
  }
}

/*
 * Depth-scaled floor loot. Prefer higher-tier gear on deeper floors and avoid
 * repeating the same item type on one level when possible.
 */
let levelLootKeys = null;

function beginLevelLootSet() {
  levelLootKeys = new Set();
}

function lootTypeKey(item) {
  if (!item) return ``;
  if (item.matches(OGOLDPILE)) return `gold`;
  if (item.matches(OSCROLL)) return `scroll:${item.arg}`;
  if (item.matches(OPOTION)) return `potion:${item.arg}`;
  return `${item.id}`;
}

function createDepthLoot(depth) {
  const lev = Math.max(1, depth);
  const tries = 12;
  for (let t = 0; t < tries; t++) {
    let item;
    const roll = rnd(100);
    if (lev <= 3) {
      if (roll < 28) item = createObject(OSCROLL, newscroll());
      else if (roll < 50) item = createObject(OPOTION, newpotion());
      else if (roll < 68) item = createGold(12 * rnd(lev + 1) + (lev << 3) + 10);
      else if (roll < 78) item = createObject(OBOOK, lev);
      else if (roll < 86) item = createObject(ODAGGER, rund(lev / 3 + 1));
      else if (roll < 92) item = createObject(OLEATHER, rund(lev / 3 + 1));
      else if (roll < 96) item = createObject(OSPEAR, rund(lev / 2 + 1));
      else item = createObject(OCOOKIE, 0);
    } else if (lev <= 7) {
      if (roll < 22) item = createObject(OSCROLL, newscroll());
      else if (roll < 40) item = createObject(OPOTION, newpotion());
      else if (roll < 55) item = createGold(12 * rnd(lev + 1) + (lev << 3) + 20);
      else if (roll < 65) item = createObject(OBOOK, lev);
      else if (roll < 73) item = createObject(OLONGSWORD, rund(lev / 3 + 1));
      else if (roll < 80) item = createObject(OCHAIN, rund(lev / 3 + 1));
      else if (roll < 86) item = createObject(OBATTLEAXE, rund(lev / 3 + 1));
      else if (roll < 91) item = createObject(OSHIELD, rund(lev / 3 + 1));
      else if (roll < 95) item = createObject(ORING, rund(lev / 2 + 1));
      else item = createObject(OCHEST, lev);
    } else if (lev <= 12) {
      if (roll < 18) item = createObject(OSCROLL, newscroll());
      else if (roll < 34) item = createObject(OPOTION, newpotion());
      else if (roll < 48) item = createGold(20 * rnd(lev + 1) + (lev << 4));
      else if (roll < 56) item = createObject(OBOOK, lev);
      else if (roll < 64) item = createObject(O2SWORD, rund(lev / 3 + 1));
      else if (roll < 72) item = createObject(OPLATE, rund(lev / 3 + 1));
      else if (roll < 78) item = createObject(OSWORD, rund(lev / 3 + 1));
      else if (roll < 84) item = createObject(OSPLINT, rund(lev / 2 + 1));
      else if (roll < 90) item = createObject(ODIAMOND, rnd(10 * lev + 1) + 10);
      else if (roll < 95) item = createObject(OSTRRING, 1 + rnd(3));
      else item = createObject(OCHEST, lev);
    } else {
      if (roll < 15) item = createObject(OSCROLL, newscroll());
      else if (roll < 28) item = createObject(OPOTION, newpotion());
      else if (roll < 42) item = createGold(30 * rnd(lev + 1) + (lev << 4));
      else if (roll < 50) item = createObject(OBOOK, lev);
      else if (roll < 58) item = createObject(OPLATEARMOR, rund(lev / 3 + 1));
      else if (roll < 66) item = createObject(O2SWORD, rund(lev / 2 + 1));
      else if (roll < 74) item = createObject(ODIAMOND, rnd(12 * lev + 1) + 20);
      else if (roll < 82) item = createObject(ORUBY, rnd(8 * lev + 1) + 10);
      else if (roll < 90) item = createObject(OENERGYRING, rund(lev / 4 + 1));
      else item = createObject(OCHEST, lev);
    }
    const key = lootTypeKey(item);
    if (!levelLootKeys || !levelLootKeys.has(key) || key === `gold`) {
      if (levelLootKeys && key !== `gold`) levelLootKeys.add(key);
      return item;
    }
  }
  return createRandomItem(lev);
}



/*
 * One cave attempt: maze, original rooms, original doors, then a reachability
 * repair. Stairs, monsters, and items are placed only after the floor is one
 * network. Canned charts keep their rooms; a sealed room gets a door.
 */
function finishLevelPopulation(depth) {
  placementNetwork = networkFromStart(depth);
  placeLevelStairs(depth);
  ensureSpecialLevelArtifacts(depth);
  placeDeferredMonsters(depth);
  placeDeferredTreasureLoot(depth);
  makeobject(depth);
  enforceDoorProvenance();
  updateWalls();
  /* Placement does not seal a passage. Repair again if a door was rejected. */
  repairPlayableRegions(depth);
  enforceDoorProvenance();
  updateWalls();
}

function generateFreshLevel(depth) {
  let playable = false;
  let seed = 0;
  let report = null;
  let attempts = 0;
  let populated = false;

  for (let attempt = 1; attempt <= LEVEL_GEN_ATTEMPT_CAP && !playable; attempt++) {
    attempts = attempt;
    populated = false;
    seed = beginLevelAttempt(drawLevelSeed());
    try {
      initNewLevel(depth);
      resetLevelDoorBook();
      resetDeferredPopulation();

      if (depth === 0) {
        makemaze(depth);
        makeobject(depth);
        playable = true;
        populated = true;
        report = { walkable: 0, reachable: 0, unreachable: 0, stairs: 0, unreachableStairs: 0, unreachablePopulated: 0, doors: 0, invalidDoors: 0 };
        break;
      }

      /* 1–2. eat() or a canned chart, original rooms, legitimate doors. */
      makemaze(depth);
      enforceDoorProvenance();

      /* 3–5. Join sealed rooms, then require one player network. */
      repairPlayableRegions(depth);
      report = walkableReport(depth);
      const structureOk = report.unreachable === 0 && !levelStructureRejected;
      if (!structureOk) continue;

      /* 6–9. Stairs and population only on the reachable floor. */
      finishLevelPopulation(depth);
      populated = true;

      /* 10. Stairs, monsters, items, and every other playable tile. */
      report = walkableReport(depth);
      playable = levelTraversalOk(depth) && contentReachable(depth, report);
    } finally {
      endLevelAttempt();
    }
  }

  if (!playable && depth !== 0) {
    seed = beginLevelAttempt((seed >>> 0) || 1);
    try {
      if (!populated) {
        repairPlayableRegions(depth);
        eraseUnreachablePlayable(depth, false);
        finishLevelPopulation(depth);
        populated = true;
      } else {
        repairPlayableRegions(depth);
        eraseUnreachablePlayable(depth, false);
        enforceDoorProvenance();
        updateWalls();
      }
      report = walkableReport(depth);
      if (report.unreachable !== 0 || report.unreachablePopulated !== 0 || report.unreachableStairs !== 0) {
        eraseUnreachablePlayable(depth, true);
        placementNetwork = networkFromStart(depth);
        placeLevelStairs(depth);
        ensureSpecialLevelArtifacts(depth);
        enforceDoorProvenance();
        updateWalls();
        repairPlayableRegions(depth);
        enforceDoorProvenance();
        updateWalls();
      }
      report = walkableReport(depth);
      playable = levelTraversalOk(depth) && contentReachable(depth, report);
    } finally {
      endLevelAttempt();
    }
  }

  lastLevelGen = {
    ok: playable,
    depth,
    seed,
    attempts,
    canned: levelFromCanned,
    repairLinks,
    report,
  };
  return lastLevelGen;
}

/* subroutine to make the caverns for a given level. only walls are made */
function makemaze(k) {
  pendingTreasureRooms = [];
  pendingVolcanoMons = [];
  levelStructureRejected = false;
  eatAnchor = null;
  eatSeeds = [];

  let useCanned = false;
  if (forceMazeSource === "procedural") {
    useCanned = false;
  } else if (forceMazeSource === "canned") {
    useCanned = k > 0;
  } else if (k == DBOTTOM || k == VBOTTOM) {
    useCanned = true;
  }
  else if (k > 1) {
    if (ULARN) {
      useCanned = rnd(100) < 50;
    }
    else {
      useCanned = rnd(17) <= 4;
    }
  }

  if (useCanned && cannedMapsAvailable() && cannedlevel(k)) {
    if (k == 1) placeHomeEntrance();
    levelEntry = null;
    return;
  }

  if (k == 0) {
    layoutTown();
    return;
  }

  /*
   * Ularn create.c makemaze: walls, eat(), the original open rectangles,
   * then one east-west clearing. No north-south spine and no density sculpt.
   * Doors are not carved here.
   */
  for (let i = 0; i < MAXY; i++) {
    for (let j = 0; j < MAXX; j++) {
      setItem(j, i, OWALL);
    }
  }

  eat(1, 1);
  rememberEatAnchor();

  /* Open spaces — not on dungeon bottom or volcano bottom (those are canned). */
  if (k != DBOTTOM && k != VBOTTOM) {
    const tmp2 = rnd(3) + 3;
    for (let tmp = 0; tmp < tmp2; tmp++) {
      const my = rnd(11) + 2;
      const myl = my - rnd(2);
      const myh = my + rnd(2);
      let mx;
      let mxl;
      let mxh;
      let mon = null;
      if (k <= DBOTTOM) {
        mx = rnd(44) + 5;
        mxl = mx - rnd(4);
        mxh = mx + rnd(12) + 3;
      } else {
        mx = rnd(60) + 3;
        mxl = mx - rnd(2);
        mxh = mx + rnd(2);
        mon = makemonst(k);
      }
      paintOpenRect(mxl, mxh, myl, myh, mon);
    }
    /* D1 keeps this clearing on the row beside the south exit (column 33). */
    const row = k === 1 ? MAXY - 2 : rnd(MAXY - 2);
    for (let i = 1; i < MAXX - 1; i++) {
      setItem(i, row, OEMPTY);
      setMonster(i, row, null);
    }
  }

  if (k > (ULARN ? 4 : 1)) {
    treasureroom(k);
  }

  if (k == 1) placeHomeEntrance();
  levelEntry = null;
}

/* Walkable network: walls block; closed doors count (the player can open them). */
function isNetworkTile(x, y) {
  if (!inBounds(x, y)) return false;
  const item = itemAt(x, y);
  return !!(item && !item.matches(OWALL));
}

/*
 * Orthogonal flood. Teleport landings (1.3.28) still use this and do not
 * treat a diagonal touch as a connection.
 */
function floodNetworkFrom(sx, sy, seen) {
  if (!isNetworkTile(sx, sy) || seen.has(`${sx},${sy}`)) return;
  const q = [[sx, sy]];
  seen.add(`${sx},${sy}`);
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx,
        ny = y + dy,
        key = `${nx},${ny}`;
      if (seen.has(key) || !isNetworkTile(nx, ny)) continue;
      seen.add(key);
      q.push([nx, ny]);
    }
  }
}

/*
 * Real movement. Orthogonal steps cross open floor and a closed door the
 * player can open. Diagonal steps match moveplayer: a closed door on either
 * corner blocks the cut. Walls are never steps.
 */
function playerCanStep(x, y, nx, ny) {
  if (!isNetworkTile(nx, ny)) return false;
  const dx = nx - x;
  const dy = ny - y;
  if (dx === 0 && dy === 0) return false;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  if (dx === 0 || dy === 0) return true;
  const cornerA = itemAt(x + dx, y);
  const cornerB = itemAt(x, y + dy);
  if (cornerA && cornerA.matches(OCLOSEDDOOR)) return false;
  if (cornerB && cornerB.matches(OCLOSEDDOOR)) return false;
  return true;
}

function floodPlayerFrom(sx, sy, seen) {
  if (!isNetworkTile(sx, sy) || seen.has(`${sx},${sy}`)) return;
  const q = [[sx, sy]];
  seen.add(`${sx},${sy}`);
  while (q.length) {
    const [x, y] = q.shift();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key) || !playerCanStep(x, y, nx, ny)) continue;
        seen.add(key);
        q.push([nx, ny]);
      }
    }
  }
}

function largestNetworkComponent() {
  let best = new Set();
  const claimed = new Set();
  for (let y = 0; y < MAXY; y++) {
    for (let x = 0; x < MAXX; x++) {
      const key = `${x},${y}`;
      if (claimed.has(key) || !isNetworkTile(x, y)) continue;
      const comp = new Set();
      floodPlayerFrom(x, y, comp);
      for (const k of comp) claimed.add(k);
      if (comp.size > best.size) best = comp;
    }
  }
  return best;
}

function cannedMapsAvailable() {
  const sample = (MAZES && MAZES.length && MAZES[0]) || (COMMON_MAZES && COMMON_MAZES[0]);
  return !!(sample && sample.length === MAXX * MAXY);
}

function resetLevelDoorBook() {
  levelFromCanned = false;
  doorProvenance = new Map();
  treasureRoomDoors = [];
}

function noteDoor(x, y, source, room) {
  doorProvenance.set(`${x},${y}`, source);
  if (source === "treasure-room" && room) treasureRoomDoors.push({ x, y, room });
}

function isDoorItem(it) {
  return !!(it && (it.matches(OCLOSEDDOOR) || it.matches(OOPENDOOR)));
}

function paintOpenRect(x0, x1, y0, y1, mon) {
  const xa = Math.max(1, Math.min(x0, x1));
  const xb = Math.min(MAXX - 1, Math.max(x0, x1));
  const ya = Math.max(1, Math.min(y0, y1));
  const yb = Math.min(MAXY - 1, Math.max(y0, y1));
  for (let i = xa; i < xb; i++) {
    for (let j = ya; j < yb; j++) {
      setItem(i, j, OEMPTY);
      setMonster(i, j, null);
    }
  }
  /* Roll the monster during the carve so the maze stream stays put. Place it later. */
  if (mon != null) pendingVolcanoMons.push({ xa, xb, ya, yb, mon });
}

function rememberEatAnchor() {
  eatAnchor = null;
  eatSeeds = [];
  let sx = -1;
  let sy = -1;
  for (let y = 0; y < MAXY && sx < 0; y++) {
    for (let x = 0; x < MAXX; x++) {
      if (!isNetworkTile(x, y)) continue;
      sx = x;
      sy = y;
      break;
    }
  }
  if (sx < 0) return;
  const seen = new Set();
  floodNetworkFrom(sx, sy, seen);
  eatSeeds = [...seen];
  let best = null;
  let bestD = Infinity;
  for (const key of eatSeeds) {
    const [x, y] = key.split(",").map(Number);
    const dist = Math.abs(x - 1) + Math.abs(y - 1);
    if (dist < bestD) {
      bestD = dist;
      best = { x, y };
    }
  }
  eatAnchor = best;
}

function livingEatAnchor() {
  if (eatAnchor && isNetworkTile(eatAnchor.x, eatAnchor.y)) return eatAnchor;
  for (const key of eatSeeds) {
    const [x, y] = key.split(",").map(Number);
    if (isNetworkTile(x, y)) return { x, y };
  }
  return null;
}

function roomInterior(x, y, room) {
  return x > room.tx && x < room.tx + room.xsize - 1 && y > room.ty && y < room.ty + room.ysize - 1;
}

function roomWallRect(x, y, room) {
  return x >= room.tx && x < room.tx + room.xsize && y >= room.ty && y < room.ty + room.ysize;
}

function treasureDoorValid(x, y, net) {
  const rec = treasureRoomDoors.find((d) => d.x === x && d.y === y);
  if (!rec) return false;
  const room = rec.room;
  if (!roomWallRect(x, y, room) || roomInterior(x, y, room)) return false;
  const same = treasureRoomDoors.filter((d) => d.room === room);
  if (same.length !== 1) return false;

  let interior = null;
  let exterior = null;
  let laterals = null;
  if (y === room.ty) {
    interior = [x, y + 1];
    exterior = [x, y - 1];
    laterals = [[x - 1, y], [x + 1, y]];
  } else if (y === room.ty + room.ysize - 1) {
    interior = [x, y - 1];
    exterior = [x, y + 1];
    laterals = [[x - 1, y], [x + 1, y]];
  } else if (x === room.tx) {
    interior = [x + 1, y];
    exterior = [x - 1, y];
    laterals = [[x, y - 1], [x, y + 1]];
  } else if (x === room.tx + room.xsize - 1) {
    interior = [x - 1, y];
    exterior = [x + 1, y];
    laterals = [[x, y - 1], [x, y + 1]];
  } else {
    return false;
  }

  if (!roomInterior(interior[0], interior[1], room)) return false;
  const inside = itemAt(interior[0], interior[1]);
  if (!inside || inside.matches(OWALL) || isDoorItem(inside)) return false;
  if (!inBounds(exterior[0], exterior[1]) || roomWallRect(exterior[0], exterior[1], room)) return false;
  const outside = itemAt(exterior[0], exterior[1]);
  if (!outside || outside.matches(OWALL)) return false;
  for (const [lx, ly] of laterals) {
    const lat = itemAt(lx, ly);
    if (!lat || !lat.matches(OWALL)) return false;
  }
  /* The outside face has to sit on the carved network the player starts in. */
  const reached = net || networkFromStart(level);
  return reached.has(`${exterior[0]},${exterior[1]}`);
}

/* A chart door the player can stand beside and open. A door in solid rock is not one. */
function cannedDoorHasFloor(x, y) {
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const it = itemAt(x + dx, y + dy);
    if (it && !it.matches(OWALL)) return true;
  }
  return false;
}

/*
 * Canned doors stay when they open onto floor. Treasure-room doors stay when
 * they are that room's single entrance. Repair doors stay when they join two
 * floors. Anything else goes back to wall.
 */
function enforceDoorProvenance() {
  if (level === 0) return;
  let net = null;
  const reached = () => net || (net = networkFromStart(level));
  for (let y = 0; y < MAXY; y++) {
    for (let x = 0; x < MAXX; x++) {
      const it = itemAt(x, y);
      if (!isDoorItem(it)) continue;
      const source = doorProvenance.get(`${x},${y}`);
      if (source === "canned" && cannedDoorHasFloor(x, y)) continue;
      if (source === "treasure-room" && treasureDoorValid(x, y, reached())) continue;
      if (source === "repair" && repairDoorValid(x, y, reached())) continue;
      setItem(x, y, OWALL);
      setMonster(x, y, null);
      doorProvenance.delete(`${x},${y}`);
      net = null;
    }
  }
}

function needsStairsDown(depth) {
  if (depth <= 0 || depth == DBOTTOM || depth == VBOTTOM) return false;
  /* Ularn: no stair down on V3, V4, or V5. Deeper volcano is pits and trapdoors. */
  if (ULARN && depth >= VBOTTOM - 2) return false;
  return true;
}

function needsStairsUp(depth) {
  if (depth <= 1) return false;
  /* Dead-end up on D15 (spoiler) and on V1 (stairs.js). */
  if (ULARN && (depth == DBOTTOM || depth == MAXLEVEL)) return true;
  if (depth == DBOTTOM) return false;
  if (depth == MAXLEVEL) return false;
  return true;
}

function levelStartCell(depth) {
  if (levelEntry && isNetworkTile(levelEntry.x, levelEntry.y)) return levelEntry;
  const found = levelStartCellUncached(depth);
  levelEntry = found;
  return found;
}

function levelStartCellUncached(depth) {
  if (!levelFromCanned) {
    if (depth === 1) {
      const exit = findItemXY(OHOMEENTRANCE);
      if (exit && isNetworkTile(exit.x, exit.y)) return { x: exit.x, y: exit.y };
      const x = 33 < MAXX - 1 ? 33 : homeEntranceX();
      const y = MAXY - 2;
      if (isNetworkTile(x, y)) return { x, y };
    }
    const carved = livingEatAnchor();
    if (carved) return carved;
    if (player && isNetworkTile(player.x, player.y)) return { x: player.x, y: player.y };
  } else {
    if (depth == DBOTTOM) {
      const eye = findItemXY(OLARNEYE);
      if (eye && isNetworkTile(eye.x, eye.y)) return { x: eye.x, y: eye.y };
    }
    if (depth == VBOTTOM) {
      const pot = findItemXY(OPOTION, 21);
      if (pot && isNetworkTile(pot.x, pot.y)) return { x: pot.x, y: pot.y };
    }
    const main = largestNetworkComponent();
    if (player && main.has(`${player.x},${player.y}`)) return { x: player.x, y: player.y };
    for (const key of main) {
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    }
  }
  for (let y = 0; y < MAXY; y++) {
    for (let x = 0; x < MAXX; x++) {
      if (isNetworkTile(x, y)) return { x, y };
    }
  }
  return null;
}

function networkFromStart(depth) {
  const seen = new Set();
  const start = levelStartCell(depth);
  if (!start) return seen;
  floodPlayerFrom(start.x, start.y, seen);
  return seen;
}

function walkableReport(depth) {
  const seen = networkFromStart(depth);
  let walkable = 0;
  let unreachable = 0;
  let stairs = 0;
  let unreachableStairs = 0;
  let unreachablePopulated = 0;
  let doors = 0;
  let invalidDoors = 0;
  for (let y = 0; y < MAXY; y++) {
    for (let x = 0; x < MAXX; x++) {
      if (!isNetworkTile(x, y)) continue;
      walkable++;
      const key = `${x},${y}`;
      const reach = seen.has(key);
      if (!reach) unreachable++;
      const it = itemAt(x, y);
      const mon = monsterAt(x, y);
      const isStair = !!(it && (
        it.matches(OSTAIRSDOWN) ||
        it.matches(OSTAIRSUP) ||
        it.matches(OVOLUP) ||
        it.matches(OHOMEENTRANCE)
      ));
      const door = isDoorItem(it);
      if (isStair) {
        stairs++;
        if (!reach) unreachableStairs++;
      }
      if (door) {
        doors++;
        if (!doorRecordOk(x, y, seen)) invalidDoors++;
      }
      const populated = !!mon || !!(it && !it.matches(OEMPTY) && !it.matches(OWALL) && !door && !isStair);
      if (populated && !reach) unreachablePopulated++;
    }
  }
  return {
    walkable,
    reachable: seen.size,
    unreachable,
    stairs,
    unreachableStairs,
    unreachablePopulated,
    doors,
    invalidDoors,
  };
}

function contentReachable(depth, report) {
  return report.unreachable === 0
    && report.unreachableStairs === 0
    && report.unreachablePopulated === 0
    && report.invalidDoors === 0
    && !levelStructureRejected;
}

function isMapBorder(x, y) {
  return x === 0 || y === 0 || x === MAXX - 1 || y === MAXY - 1;
}

/* Floor you can stand on. A door is not a side of another door. */
function doorSideFloor(x, y) {
  if (!inBounds(x, y)) return false;
  const it = itemAt(x, y);
  if (!it || it.matches(OWALL) || isDoorItem(it)) return false;
  return true;
}

/* One passage axis, stone on both sides, neither face is rock. */
function passageDoorGeometry(x, y) {
  if (isMapBorder(x, y)) return false;
  const axes = [
    { sides: [[x, y - 1], [x, y + 1]], lats: [[x - 1, y], [x + 1, y]] },
    { sides: [[x - 1, y], [x + 1, y]], lats: [[x, y - 1], [x, y + 1]] },
  ];
  for (const axis of axes) {
    if (!doorSideFloor(axis.sides[0][0], axis.sides[0][1])) continue;
    if (!doorSideFloor(axis.sides[1][0], axis.sides[1][1])) continue;
    let latOk = true;
    for (const [lx, ly] of axis.lats) {
      const lat = itemAt(lx, ly);
      if (!lat || !lat.matches(OWALL)) latOk = false;
    }
    if (latOk) return true;
  }
  return false;
}

function repairDoorValid(x, y, net) {
  if (!isDoorItem(itemAt(x, y))) return false;
  if (!passageDoorGeometry(x, y)) return false;
  const reached = net || networkFromStart(level);
  return reached.has(`${x},${y}`);
}

function outsideComponents(main) {
  const seen = new Set();
  const comps = [];
  for (let y = 0; y < MAXY; y++) {
    for (let x = 0; x < MAXX; x++) {
      const key = `${x},${y}`;
      if (main.has(key) || seen.has(key) || !isNetworkTile(x, y)) continue;
      const comp = new Set();
      floodPlayerFrom(x, y, comp);
      for (const k of comp) seen.add(k);
      comps.push(comp);
    }
  }
  comps.sort((a, b) => a.size - b.size);
  return comps;
}

function componentProtected(comp) {
  for (const key of comp) {
    const [x, y] = key.split(",").map(Number);
    const it = itemAt(x, y);
    if (!it) continue;
    if (it.matches(OLARNEYE) || it.matches(OHOMEENTRANCE)) return true;
    if (it.matches(OSTAIRSDOWN) || it.matches(OSTAIRSUP) || it.matches(OVOLUP)) return true;
    if (it.matches(OPOTION) && it.arg === 21) return true;
  }
  return false;
}

/* A connected treasure room keeps its one door. Its wall is not a shortcut. */
function connectedTreasureWall(x, y, main) {
  for (const room of pendingTreasureRooms) {
    if (!roomWallRect(x, y, room) || roomInterior(x, y, room)) continue;
    if (main.has(`${room.tx + 1},${room.ty + 1}`)) return true;
  }
  return false;
}

function findDirectRepairDoor(main) {
  let best = null;
  for (let y = 1; y < MAXY - 1; y++) {
    for (let x = 1; x < MAXX - 1; x++) {
      const it = itemAt(x, y);
      if (!it || !it.matches(OWALL)) continue;
      if (connectedTreasureWall(x, y, main)) continue;
      if (!passageDoorGeometry(x, y)) continue;
      const axes = [
        [[x, y - 1], [x, y + 1]],
        [[x - 1, y], [x + 1, y]],
      ];
      let joins = false;
      for (const [a, b] of axes) {
        if (!doorSideFloor(a[0], a[1]) || !doorSideFloor(b[0], b[1])) continue;
        const aIn = main.has(`${a[0]},${a[1]}`);
        const bIn = main.has(`${b[0]},${b[1]}`);
        if (aIn !== bIn) joins = true;
      }
      if (!joins) continue;
      const score = y * MAXX + x;
      if (!best || score < best.score) best = { score, path: [[x, y]] };
    }
  }
  return best;
}

/* Shortest orthogonal wall path from the start network to some other floor. */
function findRepairLink(main) {
  const dist = new Map();
  const prev = new Map();
  const q = [];
  for (const key of main) {
    dist.set(key, 0);
    q.push(key);
  }
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  let qi = 0;
  while (qi < q.length) {
    const key = q[qi++];
    const [x, y] = key.split(",").map(Number);
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const nk = `${nx},${ny}`;
      if (dist.has(nk)) continue;
      if (isNetworkTile(nx, ny)) {
        if (main.has(nk)) continue;
        const walls = [];
        let cur = key;
        while (cur && !main.has(cur)) {
          const [cx, cy] = cur.split(",").map(Number);
          walls.push([cx, cy]);
          cur = prev.get(cur);
        }
        walls.reverse();
        if (!walls.length) continue;
        return { path: walls };
      }
      if (isMapBorder(nx, ny)) continue;
      if (connectedTreasureWall(nx, ny, main)) continue;
      const wall = itemAt(nx, ny);
      if (!wall || !wall.matches(OWALL)) continue;
      dist.set(nk, 1);
      prev.set(nk, key);
      q.push(nk);
    }
  }
  return null;
}

function applyRepairLink(path) {
  for (const [x, y] of path) {
    setItem(x, y, OEMPTY);
    setMonster(x, y, null);
    doorProvenance.delete(`${x},${y}`);
  }
  for (const [x, y] of path) {
    if (!passageDoorGeometry(x, y)) continue;
    setItem(x, y, createObject(OCLOSEDDOOR, 0));
    setMonster(x, y, null);
    noteDoor(x, y, "repair");
    repairLinks++;
    return;
  }
  repairLinks++;
}

function eraseComponent(comp) {
  for (const key of comp) {
    const [x, y] = key.split(",").map(Number);
    setItem(x, y, OWALL);
    setMonster(x, y, null);
    doorProvenance.delete(key);
  }
  pendingTreasureRooms = pendingTreasureRooms.filter((room) => {
    for (let y = room.ty + 1; y < room.ty + room.ysize - 1; y++) {
      for (let x = room.tx + 1; x < room.tx + room.xsize - 1; x++) {
        if (comp.has(`${x},${y}`)) return false;
      }
    }
    return true;
  });
  treasureRoomDoors = treasureRoomDoors.filter((d) => !comp.has(`${d.x},${d.y}`));
  pendingVolcanoMons = pendingVolcanoMons.filter((rect) => {
    for (let x = rect.xa; x < rect.xb; x++) {
      for (let y = rect.ya; y < rect.yb; y++) {
        if (comp.has(`${x},${y}`)) return false;
      }
    }
    return true;
  });
}

/*
 * Join every sealed room or hallway to the start. A single wall becomes a
 * door when the throat is legal. A thicker gap becomes the shortest passage,
 * with a door on that passage when the throat is legal. A pocket that cannot
 * be joined without opening the map border is not generated.
 */
function repairPlayableRegions(depth) {
  let guard = 64;
  while (guard-- > 0) {
    const main = networkFromStart(depth);
    if (!main.size) return false;
    const outside = outsideComponents(main);
    if (!outside.length) {
      levelStructureRejected = false;
      return true;
    }
    const door = findDirectRepairDoor(main);
    if (door) {
      applyRepairLink(door.path);
      continue;
    }
    const link = findRepairLink(main);
    if (link) {
      applyRepairLink(link.path);
      continue;
    }
    const victim = outside.find((comp) => !componentProtected(comp));
    if (!victim) return false;
    eraseComponent(victim);
  }
  return false;
}

/* Drop playable tiles that are still off the start network. */
function eraseUnreachablePlayable(depth, force) {
  let guard = 64;
  while (guard-- > 0) {
    const main = networkFromStart(depth);
    const outside = outsideComponents(main);
    if (!outside.length) {
      levelStructureRejected = false;
      return true;
    }
    const victim = force ? outside[0] : outside.find((comp) => !componentProtected(comp));
    if (!victim) return false;
    eraseComponent(victim);
  }
  return false;
}

function pickEmptyOnNetwork(net) {
  const candidates = [];
  for (const key of net) {
    const [x, y] = key.split(",").map(Number);
    if (x <= 0 || y <= 0 || x >= MAXX - 1 || y >= MAXY - 1) continue;
    const it = itemAt(x, y);
    if (it && it.matches(OEMPTY) && !monsterAt(x, y)) candidates.push([x, y]);
  }
  if (!candidates.length) return null;
  return candidates[rund(candidates.length)];
}

/* Place a missing object on the start network. Never slide an existing one. */
function placeOnNetwork(what, arg, net) {
  const at = findItemXY(what, arg);
  if (at) return at;
  const spot = pickEmptyOnNetwork(net);
  if (!spot) return null;
  setItem(spot[0], spot[1], createObject(what, arg == null ? 0 : arg));
  setMonster(spot[0], spot[1], null);
  return { x: spot[0], y: spot[1] };
}

function placeLevelStairs(depth) {
  if (depth === 0) return;
  if (depth == 1) placeHomeEntrance();
  const net = placementNetwork || networkFromStart(depth);
  if (!net.size) return;
  if (needsStairsDown(depth)) placeOnNetwork(OSTAIRSDOWN, 0, net);
  if (needsStairsUp(depth)) placeOnNetwork(OSTAIRSUP, 0, net);
  if (depth == MAXLEVEL) placeOnNetwork(OVOLUP, 0, net);
  if (depth == DBOTTOM) placeOnNetwork(OLARNEYE, 0, net);
  if (depth == VBOTTOM) placeOnNetwork(OPOTION, 21, net);
}

function ensureLevelStairs(depth) {
  placeLevelStairs(depth);
}

function alignPlayerToProgression(depth) {
  if (!player || depth <= 0) return;
  const net = networkFromStart(depth);
  if (!net.size) return;
  if (canMove(player.x, player.y) && net.has(`${player.x},${player.y}`)) return;
  /* Procedural floors are one network; a wall landing still uses positionplayer. */
  if (!levelFromCanned) return;
  let best = null;
  let bestD = Infinity;
  for (const key of net) {
    const [x, y] = key.split(",").map(Number);
    if (!canMove(x, y)) continue;
    const dist = Math.abs(x - player.x) + Math.abs(y - player.y);
    if (dist < bestD) {
      bestD = dist;
      best = [x, y];
    }
  }
  if (!best) return;
  player.x = best[0];
  player.y = best[1];
}

function countItem(what, arg) {
  let n = 0;
  for (let y = 0; y < MAXY; y++) {
    for (let x = 0; x < MAXX; x++) {
      const item = itemAt(x, y);
      if (item && item.matches(what) && (arg == null || item.arg === arg)) n++;
    }
  }
  return n;
}

function doorRecordOk(x, y, net) {
  const source = doorProvenance.get(`${x},${y}`);
  if (source === "canned") return cannedDoorHasFloor(x, y);
  if (source === "treasure-room") return treasureDoorValid(x, y, net);
  if (source === "repair") return repairDoorValid(x, y, net);
  return false;
}

function doorsFollowProvenance() {
  const net = networkFromStart(level);
  for (let y = 0; y < MAXY; y++) {
    for (let x = 0; x < MAXX; x++) {
      const it = itemAt(x, y);
      if (!isDoorItem(it)) continue;
      if (!doorRecordOk(x, y, net)) return false;
    }
  }
  if (!levelFromCanned) {
    for (const rec of treasureRoomDoors) {
      const it = itemAt(rec.x, rec.y);
      if (!isDoorItem(it) || !treasureDoorValid(rec.x, rec.y, net)) return false;
    }
  }
  return true;
}

function levelTraversalOk(depth) {
  if (depth === 0) return true;
  const main = networkFromStart(depth);
  if (!main.size) return false;

  const onMain = (what, arg) => {
    const at = findItemXY(what, arg);
    return !!(at && main.has(`${at.x},${at.y}`));
  };

  const report = walkableReport(depth);
  if (report.unreachable !== 0 || levelStructureRejected) return false;

  if (needsStairsDown(depth) && !onMain(OSTAIRSDOWN)) return false;
  if (needsStairsUp(depth) && !onMain(OSTAIRSUP)) return false;
  if (!needsStairsDown(depth) && countItem(OSTAIRSDOWN) > 0) return false;
  if (depth == 1 && countItem(OSTAIRSUP) > 0) return false;

  if (depth == 1) {
    const exit = findItemXY(OHOMEENTRANCE);
    if (!exit) return false;
    const ay = exit.y - 1;
    if (!isNetworkTile(exit.x, ay)) return false;
    if (!main.has(`${exit.x},${ay}`) && !main.has(`${exit.x},${exit.y}`)) return false;
  }

  if (depth == MAXLEVEL && !onMain(OVOLUP)) return false;
  if (depth == DBOTTOM && !onMain(OLARNEYE)) return false;
  if (depth == VBOTTOM && !onMain(OPOTION, 21)) return false;
  if (ULARN && depth == VBOTTOM) {
    const pit = findItemXY(OPIT);
    const trap = findItemXY(OIVTRAPDOOR);
    if (!pit || !main.has(`${pit.x},${pit.y}`)) return false;
    if (!trap || !main.has(`${trap.x},${trap.y}`)) return false;
  }

  return doorsFollowProvenance();
}

function updateWalls(x, y, dist) {
  var x1, x2, y1, y2;
  if (x == null) {
    x1 = 0;
    x2 = MAXX - 1;
    y1 = 0;
    y2 = MAXY - 1;
  } else {
    x1 = x - dist;
    x2 = x + dist;
    y1 = y - dist;
    y2 = y + dist;
  }
  for (y = y1; y <= y2; y++)
    for (x = x1; x <= x2; x++)
      setWallArg(x, y);
}



/* function to eat away a filled in maze */
function eat(xx, yy) {
  var dir = rnd(4);
  var tries = 2;

  while (tries) {
    switch (dir) {
      case 1:
        if (xx <= 2) break; /* west */
        if (!itemAt(xx - 1, yy).matches(OWALL) || !itemAt(xx - 2,yy).matches(OWALL)) break;
        setItem(xx - 1, yy, OEMPTY);
        setItem(xx - 2, yy, OEMPTY);
        eat(xx - 2, yy);
        break;

      case 2:
        if (xx >= MAXX - 3) break; /* east */
        if (!itemAt(xx + 1, yy).matches(OWALL) || !itemAt(xx + 2, yy).matches(OWALL)) break;
        setItem(xx + 1, yy, OEMPTY);
        setItem(xx + 2, yy, OEMPTY);
        eat(xx + 2, yy);
        break;

      case 3:
        if (yy <= 2) break; /* south */
        if (!itemAt(xx, yy - 1).matches(OWALL) || !itemAt(xx, yy - 2).matches(OWALL)) break;
        setItem(xx, yy - 1, OEMPTY);
        setItem(xx, yy - 2, OEMPTY);
        eat(xx, yy - 2);
        break;

      case 4:
        if (yy >= MAXY - 3) break; /* north */
        if (!itemAt(xx, yy + 1).matches(OWALL) || !itemAt(xx, yy + 2).matches(OWALL)) break;
        setItem(xx, yy + 1, OEMPTY);
        setItem(xx, yy + 2, OEMPTY);
        eat(xx, yy + 2);
        break;
    }

    if (++dir > 4) {
      dir = 1;
      --tries;
    }
  }
}



/*
 *  Classic treasure rooms (Ularn eat()-era): occasional enclosed rooms with a
 *  single door on a wall. Doors are junctions into the maze, not decorations.
 */
function treasureroom(lv) {
  for (let tx = 1 + rnd(10); tx < MAXX - 10; tx += 10) {
    /* Ularn: rnd(10) <= 2 is 2/10. Bottoms always get a room if this code runs. */
    if (lv == DBOTTOM || lv == VBOTTOM || rnd(10) <= 2) {
      const xsize = rnd(6) + 3;
      const ysize = rnd(3) + 3;
      let ty = rnd(Math.max(1, MAXY - 9)) + 1;
      let roomX = tx;
      if (lv == DBOTTOM || lv == VBOTTOM) roomX = tx + rnd(Math.max(1, MAXX - 24));
      const maxX = MAXX - xsize - 1;
      const maxY = MAXY - ysize - 1;
      if (roomX < 1) roomX = 1;
      if (roomX > maxX) roomX = Math.max(1, maxX);
      if (ty < 1) ty = 1;
      if (ty > maxY) ty = Math.max(1, maxY);
      const glyph = lv == DBOTTOM || lv == VBOTTOM ? rnd(3) + 6 : rnd(9);
      troom(lv, xsize, ysize, roomX, ty, glyph);
    }
  }
}



/*
 *  subroutine to create a treasure room of any size at a given location
 *  room is filled with objects and monsters
 *  the coordinate given is that of the upper left corner of the room
 */
function troom(lv, xsize, ysize, tx, ty, glyph) {
  var i, j;

  // debug(`treasureroom: level ${lv} at ${tx},${ty} size ${xsize}x${ysize}`);

  for (j = ty - 1; j <= ty + ysize; j++)
    for (i = tx - 1; i <= tx + xsize; i++)
      setItem(i, j, OEMPTY); /* clear out space for room */

  /* now put in the walls */
  for (j = ty; j < ty + ysize; j++)
    for (i = tx; i < tx + xsize; i++) {
      setItem(i, j, OWALL);
      setMonster(i, j, null);
    }

  for (j = ty + 1; j < ty + ysize - 1; j++)
    for (i = tx + 1; i < tx + xsize - 1; i++)
    setItem(i, j, OEMPTY); /* now clear out interior */

  const room = { tx, ty, xsize, ysize };
  let placed = false;
  for (let attempt = 0; attempt < 16 && !placed; attempt++) {
    if (rnd(2) === 1) {
      i = tx + 1 + rund(Math.max(1, xsize - 2));
      j = ty + (ysize - 1) * rund(2);
    } else {
      i = tx + (xsize - 1) * rund(2);
      j = ty + 1 + rund(Math.max(1, ysize - 2));
    }
    setItem(i, j, createObject(OCLOSEDDOOR, glyph));
    noteDoor(i, j, "treasure-room", room);
    if (treasureDoorValid(i, j)) {
      placed = true;
    } else {
      setItem(i, j, OWALL);
      doorProvenance.delete(`${i},${j}`);
      treasureRoomDoors.pop();
    }
  }
  if (!placed) {
    /* No hallway and no extra door. The caller discards this floor. */
    levelStructureRejected = true;
    return;
  }

  pendingTreasureRooms.push({ lv, xsize, ysize, tx, ty });
}

/* Treasure-room monsters. One rnd(rndcount) per column, same as Ularn troom. */
function placeDeferredMonsters(depth) {
  beginDeferredLemmingCap();
  try {
  for (const rect of pendingVolcanoMons) {
    for (let i = rect.xa; i < rect.xb; i++) {
      for (let j = rect.ya; j < rect.yb; j++) {
        if (!itemAt(i, j) || !itemAt(i, j).matches(OEMPTY)) continue;
        if (placementNetwork && !placementNetwork.has(`${i},${j}`)) continue;
        setMonster(i, j, rect.mon);
      }
    }
  }
  for (const room of pendingTreasureRooms) {
    const rndcount = getDifficulty() < 2 ? 6 : 4;
    let monstbump = getDifficulty() < 2 ? 1 : 3;
    if (ULARN) monstbump++;
    const tmpy = room.ty + (room.ysize >> 1);
    room.columns = [];
    for (let tmpx = room.tx + 1; tmpx <= room.tx + room.xsize - 2; tmpx += 2) {
      const n = rnd(rndcount);
      room.columns.push({ tmpx, tmpy, n });
      for (let i = 0; i <= n; i++) {
        setMonster(tmpx, tmpy, makemonst(room.lv + monstbump), SCATTER);
      }
    }
  }
  stockNewLevelMonsters();
  } finally {
    endDeferredLemmingCap();
  }
  if (depth == null) return;
}

/* Treasure-room loot uses the column counts rolled with the monsters. */
function placeDeferredTreasureLoot(depth) {
  if (depth == null) return;
  for (const room of pendingTreasureRooms) {
    for (const col of room.columns || []) {
      for (let i = 0; i <= col.n; i++) {
        setItem(col.tmpx, col.tmpy, createDepthLoot(room.lv + 2), SCATTER);
        if (rnd(101) < 8) setItem(col.tmpx, col.tmpy, createDepthLoot(room.lv + 2), SCATTER);
      }
    }
  }
}



/*
    subroutine to create the objects in the maze for the given level
 */
function coopScale() {
  return typeof coopMultiplier === "function" ? coopMultiplier() : 1;
}

function makeobject(depth) {
  beginLevelLootSet();
  if (depth == 0) {
    fillTownBuilding(OENTRANCE, 0);  /*  entrance to dungeon         */
    fillTownBuilding(ODNDSTORE, 0);  /*  the DND STORE               */
    fillTownBuilding(OSCHOOL, 0);    /*  college of Larn             */
    fillTownBuilding(OBANK, 0);      /*  1st national bank of larn   */
    fillTownBuilding(OVOLDOWN, 0);   /*  volcano shaft to temple     */
    fillTownBuilding(OHOME, 0);      /*  the players home & family   */
    fillTownBuilding(OTRADEPOST, 0); /*  the trading post            */
    fillTownBuilding(OLRS, 0);       /*  the larn revenue service    */
    return;
  }

  /* Stairs and the V1 shaft are placed on the reachable network before this. */

  if (ULARN) {
    if (depth > 3 &&          // > 3
        depth != DBOTTOM &&   // not on 15
        depth != MAXLEVEL &&  // not on V1
        depth != VBOTTOM) {   // not on V5
      createArtifact(OELEVATORUP, player.ELEVUP, rnd(100) > 85);
    }
    if (depth > 0 &&               // not on home
        (depth <= (DBOTTOM - 5) || // < level 10
         depth == DBOTTOM ||       // 15
         depth == VBOTTOM)) {      // V5
      createArtifact(OELEVATORDOWN, player.ELEVDOWN, rnd(100) > 85);
    }
  }

  /* make the random objects in the maze */
  fillmroom(rund(3), OBOOK, depth);
  fillmroom(rund(3), OALTAR, 0);
  fillmroom(rund(3), OSTATUE, 0);
  fillmroom(rund(3), OFOUNTAIN, 0);
  fillmroom(rund(2), OTHRONE, 0);
  fillmroom(rund(2), OMIRROR, 0);
  fillmroom(rund(3), OCOOKIE, 0);

  /* be sure to have pits and trapdoors on V3, V4, and V5 */
	/* because there are no stairs on those levels */
  if (ULARN && depth >= MAXLEVEL + MAXVLEVEL - 3) {
    fillroom(OPIT, 0);
    fillroom(OIVTRAPDOOR,0);
  }
  /* regular pits */ 
  fillmroom(rund(3), OPIT, 0);

  if (ULARN || (depth != DBOTTOM) && (depth != VBOTTOM))
    fillmroom(rund(2), OIVTRAPDOOR, 0);

  fillmroom(rund(2), OTRAPARROWIV, 0);
  fillmroom(rnd(3) - 2, OIVDARTRAP, 0);
  fillmroom(rnd(3) - 2, OIVTELETRAP, 0);

  if (depth == 1)
    fillmroom(1 * coopScale(), OCHEST, depth);
  else
    fillmroom(rund(2) * coopScale(), OCHEST, depth);

  if (depth < MAXLEVEL) {
    fillmroom((rund(2)) * coopScale(), ODIAMOND, rnd(10 * depth + 1) + 10);
    fillmroom(rund(2) * coopScale(), ORUBY, rnd(6 * depth + 1) + 6);
    fillmroom(rund(2) * coopScale(), OEMERALD, rnd(4 * depth + 1) + 4);
    fillmroom(rund(2) * coopScale(), OSAPPHIRE, rnd(3 * depth + 1) + 2);
  }

  var i;
  for (i = 0; i < (rnd(4) + 3) * coopScale(); i++)
    fillroom(OPOTION, newpotion()); /* make a POTION */
  for (i = 0; i < (rnd(5) + 3) * coopScale(); i++)
    fillroom(OSCROLL, newscroll()); /* make a SCROLL */
  for (i = 0; i < (rnd(12) + 11) * coopScale(); i++)
    fillroom(OGOLDPILE, 12 * rnd(depth + 1) + (depth << 3) + 10); /* make GOLD */

  if (depth == (ULARN ? 8 : 5)) 
    fillroom(OBANK2, 0); /* branch office of the bank */

  if (ULARN && depth >= 4) {
    /* Dealer McDope's Pad */
    createArtifact(OPAD, player.PAD, rnd(100) > 75);
  }

  froom(2, ORING, 0); /* a ring mail */
  froom(1, OSTUDLEATHER, 0); /* a studded leather */
  froom(3, OSPLINT, 0); /* a splint mail */
  froom(5, OSHIELD, rund(3)); /* a shield */
  froom(2, OBATTLEAXE, rund(3)); /* a battle axe */
  froom(5, OLONGSWORD, rund(3)); /* a long sword */
  froom(5, OFLAIL, rund(3)); /* a flail */
  froom(7, OSPEAR, rnd(5)); /* a spear */
  froom(4, OREGENRING, rund(3)); /* ring of regeneration */
  froom(1, OPROTRING, rund(3)); /* ring of protection */
  froom(2, OSTRRING, 1 + rnd(3)); /* ring of strength */
  froom(2, ORINGOFEXTRA, 0); /* ring of extra regen */

  if (ULARN) {
    // only one of these per level — coexistence order unchanged
    var created = false;
    /* Brass lamp is 6/120. Classic Ularn is threshold 8. */
    created |= createArtifact(OBRASSLAMP,       player.LAMP,         !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_BRASS_LAMP_UNDER);
    created |= createArtifact(OWWAND,           player.WAND,         !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ARTIFACT_UNDER);
    created |= createArtifact(OORBOFDRAGON,     player.SLAYING,      !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ARTIFACT_UNDER);
    created |= createArtifact(OSPIRITSCARAB,    player.NEGATESPIRIT, !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ARTIFACT_UNDER);
    created |= createArtifact(OCUBEofUNDEAD,    player.CUBEofUNDEAD, !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ARTIFACT_UNDER);
    created |= createArtifact(ONOTHEFT,         player.NOTHEFT,      !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ARTIFACT_UNDER);
    created |= createArtifact(OSWORDofSLASHING, player.SLASH,        !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_SLASHING_UNDER);
    created |= createArtifact(OHAMMER,          player.BESSMANN,     !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ARTIFACT_UNDER);
    created |= createArtifact(OSPHTALISMAN,     player.TALISMAN,     !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ARTIFACT_UNDER);
    created |= createArtifact(OHANDofFEAR,      player.HAND,         !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ARTIFACT_UNDER);
    created |= createArtifact(OORB,             player.ORB,          !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ORB_UNDER);
    created |= createArtifact(OELVENCHAIN,      player.ELVEN,        !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ELVEN_CHAIN_UNDER);
    created |= createArtifact(OSLAYER,          player.SLAY,         !created && depth >= 10 && rnd(100) > (ULARN_SLAYER_GATE - (depth - 10)));
    /* Vorpal stays at threshold 8. The 3D build had raised it above that. */
    created |= createArtifact(OVORPAL,          player.VORPAL,       !created && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ARTIFACT_UNDER);
    created |= createArtifact(OPSTAFF,          player.STAFF,        !created && depth >= 8 && rnd(100) > (ULARN_STAFF_GATE - (depth - 10)));
    /* Life preservation is not in Ularn 1.5. This port's depth >= 5 and rnd(120) < 8 is unchanged. */
    created |= createArtifact(OLIFEPRESERVER,   player.PRESERVER,    !created && depth >= 5 && rnd(ULARN_ARTIFACT_SIDES) < ULARN_ARTIFACT_UNDER);
  }
  else {
    createArtifact(OORBOFDRAGON,     player.SLAYING,      rnd(151) < 3);
    createArtifact(OSPIRITSCARAB,    player.NEGATESPIRIT, rnd(151) < 4);
    createArtifact(OCUBEofUNDEAD,    player.CUBEofUNDEAD, rnd(151) < 4);
    createArtifact(ONOTHEFT,         player.NOTHEFT,      rnd(151) < 3);
    createArtifact(OSWORDofSLASHING, player.SLASH,        rnd(151) < 3);
    createArtifact(OHAMMER,          player.BESSMANN,     rnd(151) < 6);
  }

  if (getDifficulty() < 3 || (rnd(4) == 3)) {
    if (depth > 3) {
      froom(3, OSWORD, rund(6)); /* sunsword */
      froom(5, O2SWORD, rnd(6)); /* a two handed sword */
      froom(3, OBELT, rund(7)); /* belt of striking */
      froom(3, OENERGYRING, rund(6)); /* energy ring */
      froom(4, OPLATE, rund(8)); /* platemail */
      if (!ULARN) froom(3, OCLEVERRING, 1 + rnd(2)); /* ring of cleverness */
    }
  }

  /* Rare loot goblin — any dungeon floor, flees, equal-chance drop. */
  if (ULARN && depth >= 1 && rnd(200) < 3) {
    const goblin = fillmonst(LOOTGOBLIN, true);
    if (goblin) goblin.lootGoblinTurns = 0;
  }

  if (depth == 1) placeHomeEntrance();
} // makeobject()



function createArtifact(artifact, exists, odds) {
  var createdArtifact = false;
  if (!exists && odds) {
    const placed = fillroom(artifact);
    if (!placed) return false;
    artifact = placed;
    createdArtifact = true;
    debug(`created ${artifact} on ${level}`);
  }
  if (createdArtifact) {
    switch (artifact.id) {
      case OBRASSLAMP.id:       player.LAMP = true;           break;
      case OWWAND.id:           player.WAND = true;           break;
      case OORBOFDRAGON.id:     player.SLAYING = true;        break;
      case OSPIRITSCARAB.id:    player.NEGATESPIRIT = true;   break;
      case OCUBEofUNDEAD.id:    player.CUBEofUNDEAD = true;   break;
      case ONOTHEFT.id:         player.NOTHEFT = true;        break;
      case OSPHTALISMAN.id:     player.TALISMAN = true;       break;
      case OHANDofFEAR.id:      player.HAND = true;           break;
      case OORB.id:             player.ORB = true;            break;
      case OELVENCHAIN.id:      player.ELVEN = true;          break;
      case OSWORDofSLASHING.id: player.SLASH = true;          break;
      case OHAMMER.id:          player.BESSMANN = true;       break;
      case OSLAYER.id:          player.SLAY = true;           break;
      case OVORPAL.id:          player.VORPAL = true;         break;
      case OPSTAFF.id:          player.STAFF = true;          break;
      case OLIFEPRESERVER.id:   player.PRESERVER = true;      break;

      case OPAD.id:             player.PAD = true;            break;
      case OELEVATORUP.id:      player.ELEVUP = true;         break;
      case OELEVATORDOWN.id:    player.ELEVDOWN = true;       break;

      default:
        debug(`unidentified artifact created: ${artifact}`);
        break;
    }
    return createdArtifact;
  }
}


/*
    subroutine to fill in a number of objects of the same kind
 */
function fillmroom(n, what, arg) {
  for (var i = 0; i < n; i++) {
    fillroom(what, arg);
  }
}



function froom(n, itm, arg) {
  if (rnd(151) < n) {
    fillroom(itm, arg);
    // Same roll as solo. A second copy is placed only when more than one adventurer is present.
    if (coopScale() > 1) fillroom(itm, arg);
  }
}



/*
 * Town buildings need a full empty ring so 3D models never visually overlap.
 * Chebyshev distance >= 2 between any two buildings (one empty square around).
 */
function townBuildingClearanceOk(x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAXX || ny >= MAXY) return false;
      const neighbor = itemAt(nx, ny);
      if (!neighbor.matches(OEMPTY)) return false;
    }
  }
  return true;
}

/*
 * Place a town landmark with at least one empty square on every side.
 */
function fillTownBuilding(what, arg) {
  const b = townBounds();
  var safe = 400;
  var x = b.x0 + 1 + rund(Math.max(1, TOWN_SIZE - 2));
  var y = b.y0 + 1 + rund(Math.max(1, TOWN_SIZE - 2));
  while (!(itemAt(x, y).matches(OEMPTY) && townBuildingClearanceOk(x, y))) {
    x = b.x0 + 1 + rund(Math.max(1, TOWN_SIZE - 2));
    y = b.y0 + 1 + rund(Math.max(1, TOWN_SIZE - 2));
    if (safe-- == 0) {
      debug(`fillTownBuilding: SAFETY! falling back to fillroom`);
      return fillroom(what, arg);
    }
  }
  var newItem = createObject(what, arg);
  setItem(x, y, newItem);
  return newItem;
}

/*
    subroutine to put an object into an empty room
 *  uses a random walk
*/
function placementCellOk(x, y) {
  const it = itemAt(x, y);
  if (!it || !it.matches(OEMPTY)) return false;
  if (placementNetwork && !placementNetwork.has(`${x},${y}`)) return false;
  return true;
}

function fillroom(what, arg) {
  var safe = 2500;
  var x = rnd(MAXX - 2);
  var y = rnd(MAXY - 2);
  if (level == 0) {
    const b = townBounds();
    x = b.x0 + rund(TOWN_SIZE);
    y = b.y0 + rund(TOWN_SIZE);
  }
  while (!placementCellOk(x, y)) {
    x += rnd(3) - 2;
    y += rnd(3) - 2;
    if (level == 0) {
      const b = townBounds();
      if (x > b.x1) x = b.x0;
      if (x < b.x0) x = b.x1;
      if (y > b.y1) y = b.y0;
      if (y < b.y0) y = b.y1;
    } else {
      if (x > MAXX - 2) x = 1;
      if (x < 1) x = MAXX - 2;
      if (y > MAXY - 2) y = 1;
      if (y < 1) y = MAXY - 2;
    }
    if (safe-- == 0) {
      debug(`fillroom: SAFETY!`);
      return null;
    }
  }
  var newItem = createObject(what, arg);
  setItem(x, y, newItem);
  return newItem;
  //debug(`fillroom(): ${newItem}`);
}



/*
    subroutine to put monsters into an empty room without walls or other
    monsters
 */
function fillmonst(what, awake) {
  for (let trys = 10; trys > 0; --trys) /* max # of creation attempts */ {
    let x = rnd(MAXX - 2);
    let y = rnd(MAXY - 2);
    //debug(`fillmonst: ${x},${y} ${itemAt(x, y)}`);
    if ((itemAt(x, y).matches(OEMPTY)) &&       // empty space
        (!monsterAt(x, y)) &&                   // no monster there
        (!placementNetwork || placementNetwork.has(`${x},${y}`)) &&
        ((player.x != x) || (player.y != y))) { // not on player
      let monster = createMonster(what);
      /* A refused lemming still ends the try. Stocking defers that refusal. */
      if (!setMonster(x, y, monster)) return null;
      if (awake) monster.awake = awake;
      setKnow(x, y, getKnow(x, y) & ~KNOWHERE);
      return monster;
    }
  }
  return null; /* creation failure */
}


/*
    creates an entire set of monsters for a level
    must be done when entering a new level
    if sethp(1) then wipe out old monsters else leave them there
 */
function stockNewLevelMonsters() {
  beginDeferredLemmingCap();
  try {
  const nummonsters = (rnd(12) + 2 + (level >> 1)) * coopScale();
  for (let i = 0; i < nummonsters; i++) {
    fillmonst(makemonst(level));
  }
  if (!ULARN || DEBUG_NO_MONSTERS) return;

  /*
  ** level 11 gets 1 demon lord … level 15 gets 5 demon lords
  ** V1 gets 1 demon prince … V5 gets 5 demon princes
  ** Stop if the floor cannot take another, so a full level cannot spin.
  */
  let numdemons = 0;
  let kind = 0;
  if ((level >= MAXLEVEL - 5) && (level < MAXLEVEL)) {
    numdemons = level - 10;
    kind = DEMONLORD;
  } else if (level >= MAXLEVEL) {
    numdemons = level - MAXLEVEL + 1;
    kind = DEMONPRINCE;
  }
  let placed = 0;
  let guard = numdemons * 12;
  while (placed < numdemons && guard-- > 0) {
    const which = kind === DEMONLORD ? DEMONLORD + rund(7) : DEMONPRINCE;
    if (fillmonst(which)) placed++;
  }
  } finally {
    endDeferredLemmingCap();
  }
}

function sethp(newLevel) {
  // if (flg) {
  //   for (var i = 0; i < MAXY; i++) {
  //     for (var j = 0; j < MAXX; j++) {
  //       const monster = monsterAt(j, i);
  //       if (monster)
  //         monster.awake = false;
  //     }
  //   }
  // }

  /* if teleported and found level 1 then know level we are on */
  if (level == 0) {
    player.TELEFLAG = 0;
    return;
  }

  const restore = placementNetwork;
  let imposed = false;
  if (!placementNetwork && player && isNetworkTile(player.x, player.y)) {
    placementNetwork = new Set();
    floodNetworkFrom(player.x, player.y, placementNetwork);
    imposed = true;
  }

  if (newLevel) {
    stockNewLevelMonsters();
  } else {
    beginDeferredLemmingCap();
    try {
      const nummonsters = ((level >> 1) + 1) * coopScale();
      for (let i = 0; i < nummonsters; i++) {
        fillmonst(makemonst(level));
      }
    } finally {
      endDeferredLemmingCap();
    }
  }

  if (imposed) placementNetwork = restore;
  thinLemmings();
}



/* Function to destroy all genocided monsters on the present level */
function checkgen() {
  for (var y = 0; y < MAXY; y++) {
    for (var x = 0; x < MAXX; x++) {
      const monster = monsterAt(x, y);
      if (monster && isGenocided(monster.arg)) {
        setMonster(x, y, null);
      }
    }
  }
}
