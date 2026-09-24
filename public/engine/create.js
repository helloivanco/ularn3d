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

  initNewLevel(depth);
  makemaze(depth);

  updateWalls();

  makeobject(depth);
  ensureSpecialLevelArtifacts(depth);
  sethp(true);
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

  /*
   * Rare structured treasure-room floors (0.10%). Maze-like layout with more
   * gold than items — not the old blank open treasure maps.
   */
  if (TREASURE_MAZES && TREASURE_MAZES.length && rnd(1000) === 1) {
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

/* D1's town exit sits on the south border. Square rooms no longer span that
   edge, so carve a guaranteed approach from the maze after generation. */
function placeHomeEntrance() {
  const x = homeEntranceX();
  const y = homeEntranceY();
  const ax = x;
  const ay = y - 1;
  setItem(x, y, OHOMEENTRANCE);
  setMonster(x, y, null);
  if (inBounds(ax, ay) && !isOpenMazeTile(ax, ay)) {
    setItem(ax, ay, OEMPTY);
    setMonster(ax, ay, null);
  }

  const reachesMaze = () => {
    const seen = new Set([`${ax},${ay}`]);
    const q = [[ax, ay]];
    while (q.length) {
      const [cx, cy] = q.shift();
      if (!(cx === ax && cy === ay) && !(cx === x && cy === y) && cy < MAXY - 1)
        return true;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const nx = cx + dx,
          ny = cy + dy,
          key = `${nx},${ny}`;
        if (seen.has(key) || !isOpenMazeTile(nx, ny)) continue;
        seen.add(key);
        q.push([nx, ny]);
      }
    }
    return false;
  };

  if (reachesMaze()) return;

  let tx = 1,
    ty = 1,
    best = Infinity;
  for (let j = 1; j < MAXY - 1; j++) {
    for (let i = 1; i < MAXX - 1; i++) {
      if (i === ax && j === ay) continue;
      if (!isOpenMazeTile(i, j)) continue;
      const d = Math.abs(i - ax) + Math.abs(j - ay);
      if (d < best) {
        best = d;
        tx = i;
        ty = j;
      }
    }
  }
  let cx = ax,
    cy = ay;
  while (cx !== tx || cy !== ty) {
    if (cx !== tx) cx += Math.sign(tx - cx);
    else cy += Math.sign(ty - cy);
    if (itemAt(cx, cy).matches(OWALL)) {
      setItem(cx, cy, OEMPTY);
      setMonster(cx, cy, null);
    }
  }
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



/* subroutine to make the caverns for a given level. only walls are made */
function makemaze(k) {
  let useCanned = false;
  if (k == DBOTTOM || k == VBOTTOM) {
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

  if (useCanned && COMMON_MAZES[0]?.length === MAXX * MAXY && cannedlevel(k)) {
    /* 0.10% rare treasure room even on canned floors (structured room, +3 monsters). */
    if (!LEVELS[k]?.treasureFloor && rnd(1000) === 1) placeRareTreasureRoom(k);
    if (k == 1) placeHomeEntrance();
    return;
  }

  if (k == 0) {
    layoutTown();
    return;
  }

  buildRoomCorridorMaze(k);

  /* 0.10% chance of a gold-heavy treasure room with depth+3 monsters. */
  if (rnd(1000) === 1) placeRareTreasureRoom(k);

  if (k == 1) placeHomeEntrance();

}

/*
 * Room-and-corridor dungeon: closed rooms linked by 1-wide halls.
 * Doors only appear in walls that separate two floor tiles (never decorative).
 */
function buildRoomCorridorMaze(k) {
  for (let i = 0; i < MAXY; i++)
    for (let j = 0; j < MAXX; j++)
      setItem(j, i, OWALL);

  const rooms = [];
  const overlaps = (rx, ry, rw, rh) => {
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      if (rx < r.x + r.w + 1 && rx + rw + 1 > r.x && ry < r.y + r.h + 1 && ry + rh + 1 > r.y)
        return true;
    }
    return false;
  };

  const target = 7 + rund(4);
  for (let attempt = 0; attempt < 500 && rooms.length < target; attempt++) {
    const rw = 5 + rund(6);
    const rh = 3 + rund(4);
    const rx = 1 + rund(Math.max(1, MAXX - rw - 2));
    const ry = 1 + rund(Math.max(1, MAXY - rh - 2));
    if (overlaps(rx, ry, rw, rh)) continue;
    rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) });
  }
  if (rooms.length < 5) {
    const presets = [
      [2, 2, 7, 4], [14, 2, 8, 4], [28, 2, 7, 4], [42, 2, 8, 4],
      [2, 9, 8, 4], [16, 10, 7, 4], [30, 9, 8, 5], [44, 10, 7, 4],
      [10, 15, 10, 3], [32, 15, 10, 3],
    ];
    for (let p = 0; p < presets.length && rooms.length < 6; p++) {
      const [x, y, w, h] = presets[p];
      if (x + w >= MAXX - 1 || y + h >= MAXY - 1) continue;
      if (overlaps(x, y, w, h)) continue;
      rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
    }
  }

  for (let ri = 0; ri < rooms.length; ri++) {
    const r = rooms[ri];
    const mon = k >= MAXLEVEL ? makemonst(k) : null;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        setItem(x, y, OEMPTY);
        if (mon) setMonster(x, y, mon);
      }
  }

  const inRoom = (x, y, r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

  const carveCorridor = (a, b) => {
    let x = a.cx;
    let y = a.cy;
    const path = [];
    const horizFirst = rnd(2) === 1;
    let guard = 200;
    while ((x !== b.cx || y !== b.cy) && guard-- > 0) {
      path.push([x, y]);
      if (horizFirst) {
        if (x !== b.cx) x += Math.sign(b.cx - x);
        else if (y !== b.cy) y += Math.sign(b.cy - y);
      } else {
        if (y !== b.cy) y += Math.sign(b.cy - y);
        else if (x !== b.cx) x += Math.sign(b.cx - x);
      }
    }
    path.push([b.cx, b.cy]);

    let doorPlaced = false;
    for (let i = 0; i < path.length; i++) {
      const px = path[i][0];
      const py = path[i][1];
      if (px <= 0 || py <= 0 || px >= MAXX - 1 || py >= MAXY - 1) continue;
      const here = itemAt(px, py);
      const wasWall = here && here.matches(OWALL);
      const entersB = wasWall && (
        inRoom(px - 1, py, b) || inRoom(px + 1, py, b) ||
        inRoom(px, py - 1, b) || inRoom(px, py + 1, b)
      );
      if (entersB && !doorPlaced && rnd(10) <= 7) {
        setItem(px, py, createObject(OCLOSEDDOOR, rnd(30)));
        doorPlaced = true;
      } else if (!here.matches(OCLOSEDDOOR)) {
        setItem(px, py, OEMPTY);
      }
    }
  };

  const order = rooms.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rund(i + 1);
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  for (let i = 1; i < order.length; i++) carveCorridor(rooms[order[i - 1]], rooms[order[i]]);
  const extras = 1 + rund(3);
  for (let e = 0; e < extras && rooms.length > 2; e++) {
    carveCorridor(rooms[rund(rooms.length)], rooms[rund(rooms.length)]);
  }

  /* Extra doors only at true choke-points (floor on opposite sides). */
  const candidates = [];
  for (let y = 1; y < MAXY - 1; y++) {
    for (let x = 1; x < MAXX - 1; x++) {
      if (!itemAt(x, y).matches(OWALL)) continue;
      const floor = (xx, yy) => {
        const it = itemAt(xx, yy);
        return it && !it.matches(OWALL) && !it.matches(OCLOSEDDOOR);
      };
      if ((floor(x - 1, y) && floor(x + 1, y)) || (floor(x, y - 1) && floor(x, y + 1)))
        candidates.push([x, y]);
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rund(i + 1);
    const t = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = t;
  }
  const want = Math.min(candidates.length, 3 + rund(5));
  for (let i = 0; i < want; i++) {
    setItem(candidates[i][0], candidates[i][1], createObject(OCLOSEDDOOR, rnd(30)));
  }

  /* Keep border solid. */
  for (let x = 0; x < MAXX; x++) {
    setItem(x, 0, OWALL);
    setItem(x, MAXY - 1, OWALL);
  }
  for (let y = 0; y < MAXY; y++) {
    setItem(0, y, OWALL);
    setItem(MAXX - 1, y, OWALL);
  }
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
 *  Rare treasure room (0.10% of floors): enclosed room structure, more gold
 *  than items, monsters scaled to depth+3 for this floor's room only.
 */
function placeRareTreasureRoom(lv) {
  const xsize = rnd(4) + 6; /* 6–9 */
  const ysize = rnd(3) + 5; /* 5–7 */
  const tx = rnd(Math.max(4, MAXX - xsize - 3)) + 1;
  const ty = rnd(Math.max(3, MAXY - ysize - 3)) + 1;
  rareTreasureRoom(lv, xsize, ysize, tx, ty, rnd(9));
  if (LEVELS[lv]) LEVELS[lv].treasureFloor = true;
}

function rareTreasureRoom(lv, xsize, ysize, tx, ty, glyph) {
  var i, j;

  for (j = ty - 1; j <= ty + ysize; j++)
    for (i = tx - 1; i <= tx + xsize; i++)
      if (i > 0 && j > 0 && i < MAXX - 1 && j < MAXY - 1)
        setItem(i, j, OEMPTY);

  for (j = ty; j < ty + ysize; j++)
    for (i = tx; i < tx + xsize; i++) {
      setItem(i, j, OWALL);
      setMonster(i, j, null);
    }

  for (j = ty + 1; j < ty + ysize - 1; j++)
    for (i = tx + 1; i < tx + xsize - 1; i++)
      setItem(i, j, OEMPTY);

  /* Door must sit on a wall between the room interior and outside floor. */
  switch (rnd(2)) {
    case 1:
      i = tx + 1 + rund(Math.max(1, xsize - 2));
      j = ty + (ysize - 1) * rund(2);
      setItem(i, j, createObject(OCLOSEDDOOR, glyph));
      break;
    case 2:
      i = tx + (xsize - 1) * rund(2);
      j = ty + 1 + rund(Math.max(1, ysize - 2));
      setItem(i, j, createObject(OCLOSEDDOOR, glyph));
      break;
  }

  /* Clear a one-cell approach outside the door so it connects. */
  for (j = ty; j < ty + ysize; j++) {
    for (i = tx; i < tx + xsize; i++) {
      const it = itemAt(i, j);
      if (!it || !it.matches(OCLOSEDDOOR)) continue;
      const outs = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
      for (let o = 0; o < outs.length; o++) {
        const ox = outs[o][0];
        const oy = outs[o][1];
        if (ox <= 0 || oy <= 0 || ox >= MAXX - 1 || oy >= MAXY - 1) continue;
        if (ox >= tx && ox < tx + xsize && oy >= ty && oy < ty + ysize) continue;
        if (itemAt(ox, oy).matches(OWALL)) setItem(ox, oy, OEMPTY);
      }
    }
  }

  /*
   * Sparse placement — classic loot budgets, not a carpet.
   * More gold piles than items; monsters only in this room at depth+3.
   */
  const monLevel = lv + 3;
  const interior = [];
  for (j = ty + 1; j < ty + ysize - 1; j++)
    for (i = tx + 1; i < tx + xsize - 1; i++)
      interior.push([i, j]);
  for (let n = interior.length - 1; n > 0; n--) {
    const m = rund(n + 1);
    const tmp = interior[n];
    interior[n] = interior[m];
    interior[m] = tmp;
  }
  let p = 0;
  const goldN = Math.min(interior.length, 5 + rnd(4)); /* 6–9 gold */
  const itemN = Math.min(interior.length - goldN, 2 + rnd(2)); /* 2–4 items */
  const monN = Math.min(interior.length, 3 + rnd(3)); /* 3–6 monsters */
  for (let g = 0; g < goldN && p < interior.length; g++, p++) {
    setItem(interior[p][0], interior[p][1], createGold(80 + rnd(50) * (lv + 1)));
  }
  for (let it = 0; it < itemN && p < interior.length; it++, p++) {
    setItem(interior[p][0], interior[p][1], createTreasureMapLoot(lv));
  }
  for (let m = 0; m < monN && m < interior.length; m++) {
    const [mx, my] = interior[m];
    setMonster(mx, my, makemonst(monLevel));
  }
}



/*
 *  Classic mid-tier treasure closet (occasional enclosed room). Kept rarer
 *  than original Larn so floors stay maze-like; the gold-heavy +3-monster
 *  variant is placeRareTreasureRoom at 0.10%.
 */
function treasureroom(lv) {
  for (let tx = 1 + rnd(8); tx < MAXX - 10; tx += 12) {
    if (rnd(40) == 2) {
      let xsize = rnd(4) + 4;
      let ysize = rnd(3) + 4;
      let ty = rnd(Math.max(4, MAXY - ysize - 2)) + 1;
      troom(lv, xsize, ysize, tx, ty, rnd(9));
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

  switch (rnd(2)) /* locate the door on the treasure room */ {
    case 1:
      /* on horizontal walls */
      i = tx + rund(xsize);
      j = ty + (ysize - 1) * rund(2);
      setItem(i, j, createObject(OCLOSEDDOOR, glyph));
      break;

    case 2:
      /* on vertical walls */
      i = tx + (xsize - 1) * rund(2);
      j = ty + rund(ysize);
      setItem(i, j, createObject(OCLOSEDDOOR, glyph));
      break;
  }

  const rndcount = getDifficulty() < 2 ? 6 : 4;
  let monstbump = getDifficulty() < 2 ? 1 : 3;
  if (ULARN) monstbump++;
  let tmpy = ty + (ysize >> 1);
  for (let tmpx = tx + 1; tmpx <= tx + xsize - 2; tmpx += 2) {
    for (i = 0, j = rnd(rndcount); i <= j; i++) {
      setItem(tmpx, tmpy, createDepthLoot(lv + 2), SCATTER);
      if (rnd(101) < 8) // chance of another item
        setItem(tmpx, tmpy, createDepthLoot(lv + 2), SCATTER); 
      setMonster(tmpx, tmpy, makemonst(lv + monstbump), SCATTER);
    }
  }

}



/*
    subroutine to create the objects in the maze for the given level
 */
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

  if (depth == MAXLEVEL) fillroom(OVOLUP, 0); /* volcano shaft up from the temple */

  if ((depth > 0) &&        /* no stairs on home level */
      (depth != DBOTTOM) && /* no stairs on bottom of dungeon */
      (depth != VBOTTOM)) {  /* no stairs on bottom of volcano but ularn has dead down stairs on v3, v4 */
    fillroom(OSTAIRSDOWN, 0);
  }

  if (depth > 1) { /* no stairs on home level, D1 */
    if (ULARN && depth == MAXLEVEL) {
      fillroom(OSTAIRSUP, 0); /* ularn has dead up stairs on V1 */
    }
    else if (depth != MAXLEVEL) {
      fillroom(OSTAIRSUP, 0); /* no up stairs on V1 */
    } 
  } 

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
    fillmroom(1, OCHEST, depth);
  else 
    fillmroom(rund(2), OCHEST, depth);

  if (depth < MAXLEVEL) {
    fillmroom((rund(2)), ODIAMOND, rnd(10 * depth + 1) + 10);
    fillmroom(rund(2), ORUBY, rnd(6 * depth + 1) + 6);
    fillmroom(rund(2), OEMERALD, rnd(4 * depth + 1) + 4);
    fillmroom(rund(2), OSAPPHIRE, rnd(3 * depth + 1) + 2);
  }

  var i;
  for (i = 0; i < rnd(4) + 3; i++) 
    fillroom(OPOTION, newpotion()); /* make a POTION */
  for (i = 0; i < rnd(5) + 3; i++) 
    fillroom(OSCROLL, newscroll()); /* make a SCROLL */
  for (i = 0; i < rnd(12) + 11; i++) 
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
    // only one of these per level
    var created = false;
    /* Slightly higher than the classic rnd(120) < 8 (~6.7%) lamp roll. */
    created |= createArtifact(OBRASSLAMP,       player.LAMP,         !created && rnd(120) < 10);
    created |= createArtifact(OWWAND,           player.WAND,         !created && rnd(120) < 8);
    created |= createArtifact(OORBOFDRAGON,     player.SLAYING,      !created && rnd(120) < 8);
    created |= createArtifact(OSPIRITSCARAB,    player.NEGATESPIRIT, !created && rnd(120) < 8);
    created |= createArtifact(OCUBEofUNDEAD,    player.CUBEofUNDEAD, !created && rnd(120) < 8);
    created |= createArtifact(ONOTHEFT,         player.NOTHEFT,      !created && rnd(120) < 8);
    created |= createArtifact(OSWORDofSLASHING, player.SLASH,        !created && rnd(120) < 11);
    created |= createArtifact(OHAMMER,          player.BESSMANN,     !created && rnd(120) < 13);
    created |= createArtifact(OSPHTALISMAN,     player.TALISMAN,     !created && rnd(120) < 8);
    created |= createArtifact(OHANDofFEAR,      player.HAND,         !created && rnd(120) < 8);
    created |= createArtifact(OORB,             player.ORB,          !created && rnd(120) < 8);
    created |= createArtifact(OELVENCHAIN,      player.ELVEN,        !created && rnd(120) < 8);
    created |= createArtifact(OSLAYER,          player.SLAY,         !created && depth >= 10 && rnd(100) > (82 - (depth - 10)));
    created |= createArtifact(OVORPAL,          player.VORPAL,       !created && rnd(120) < 10);
    created |= createArtifact(OPSTAFF,          player.STAFF,        !created && depth >= 8 && rnd(100) > (85 - (depth - 10)));
    created |= createArtifact(OLIFEPRESERVER,   player.PRESERVER,    !created && depth >= 5 && rnd(120) < 8); // different than Ularn 1.6
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
    artifact = fillroom(artifact);
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
function fillroom(what, arg) {
  var safe = 100;
  var x = rnd(MAXX - 2);
  var y = rnd(MAXY - 2);
  if (level == 0) {
    const b = townBounds();
    x = b.x0 + rund(TOWN_SIZE);
    y = b.y0 + rund(TOWN_SIZE);
  }
  while (!itemAt(x, y).matches(OEMPTY)) {
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
      break;
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
        ((player.x != x) || (player.y != y))) { // not on player
      let monster = createMonster(what);
      setMonster(x, y, monster);
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

  var nummonsters;
  if (newLevel) {
    nummonsters = rnd(12) + 2 + (level >> 1);
  } else {
    nummonsters = (level >> 1) + 1;
  }

  for (let i = 0; i < nummonsters; i++) {
    fillmonst(makemonst(level));
  }

  if (ULARN && newLevel && !DEBUG_NO_MONSTERS) {
    /*
    ** level 11 gets 1 demon lord
    ** level 12 gets 2 demon lords
    ** level 13 gets 3 demon lords
    ** level 14 gets 4 demon lords
    ** level 15 gets 5 demon lords
    */
    var numdemons = 0;
    if ((level >= MAXLEVEL - 5) && (level < MAXLEVEL)) {
      numdemons = level - 10;
      for (let j = 1 ; j <= numdemons ; j++) {
        if (!fillmonst(DEMONLORD + rund(7))) {
          j--;
        }
      }
    }
    /*
    ** level V1 gets 1 demon prince
    ** level V2 gets 2 demon princes
    ** level V3 gets 3 demon princes
    ** level V4 gets 4 demon princes
    ** level V5 gets 5 demon princes
    */
    else if (level >= MAXLEVEL) {
      numdemons = level - MAXLEVEL + 1;
      for (let j = 1 ; j <= numdemons ; j++){
        if (!fillmonst(DEMONPRINCE)) {
          j--;
        }
      }
    }
  }

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
