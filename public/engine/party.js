"use strict";

/*
 * One to four adventurers. Solo leaves PARTY_ON false and never calls
 * these helpers, so the classic globals stay the only hero.
 *
 * Globals that are really "the hero" (swapped when the active adventurer
 * changes):
 *   player          position, stats, inventory, spells, effects
 *   level           dungeon depth of the active hero
 *   gtime           that hero's turn clock
 *   logname         character name
 *   LOG             that hero's journal
 *   LEVELS[n].know  that hero's fog; items and monsters stay shared
 *   lastmonst, lastnum, hitflag, lastpx, lastpy, lasthx, lasthy
 *   prayed, dropflag, nomove, viewflag, lasttime, rmst
 *   course, outstanding_taxes
 *
 * Shared world (not swapped): LEVELS items and monsters, spheres, genocide,
 * wizard, cheat, difficulty, the seeded RNG stream.
 */

var PARTY_LIMIT = 4;
var PARTY_ON = false;
var ADVENTURERS = [];
var ACTIVE_SLOT = 0;
var cooperationActingAdventurers = null;

function partySize() {
  return PARTY_ON ? ADVENTURERS.length : 1;
}

function partyOn() {
  return PARTY_ON;
}

function activeSlot() {
  return PARTY_ON ? ACTIVE_SLOT : 0;
}

function snapshotKnow() {
  const copy = [];
  if (!LEVELS) return copy;
  for (let depth = 0; depth < LEVELS.length; depth++) {
    const floor = LEVELS[depth];
    if (!floor || !floor.know) {
      copy.push(null);
      continue;
    }
    const columns = [];
    for (let x = 0; x < floor.know.length; x++) {
      columns.push(floor.know[x] ? floor.know[x].slice() : null);
    }
    copy.push(columns);
  }
  return copy;
}

function applyKnow(copy) {
  if (!copy || !LEVELS) return;
  for (let depth = 0; depth < copy.length; depth++) {
    const columns = copy[depth];
    const floor = LEVELS[depth];
    if (!columns || !floor || !floor.know) continue;
    for (let x = 0; x < columns.length; x++) {
      const column = columns[x];
      if (!column || !floor.know[x]) continue;
      for (let y = 0; y < column.length; y++) floor.know[x][y] = column[y];
    }
  }
}

function captureSlot(slot, name) {
  return {
    slot: slot,
    name: name || logname,
    role: slot === 0 ? "host" : "player",
    alive: !!(player && player.HP > 0),
    ghost: !!(player && player.HP <= 0),
    connected: true,
    player: player,
    level: level,
    gtime: gtime,
    logname: logname,
    lastmonst: lastmonst,
    lastnum: lastnum,
    hitflag: hitflag,
    lastpx: lastpx,
    lastpy: lastpy,
    lasthx: lasthx,
    lasthy: lasthy,
    prayed: prayed,
    dropflag: dropflag,
    nomove: nomove,
    viewflag: viewflag,
    lasttime: lasttime,
    rmst: rmst,
    course: course ? course.slice() : [],
    outstandingTaxes: outstanding_taxes,
    log: LOG ? LOG.slice() : [],
    know: snapshotKnow(),
  };
}

function applySlot(slot) {
  player = slot.player;
  level = slot.level;
  gtime = slot.gtime;
  logname = slot.logname;
  lastmonst = slot.lastmonst;
  lastnum = slot.lastnum;
  hitflag = slot.hitflag;
  lastpx = slot.lastpx;
  lastpy = slot.lastpy;
  lasthx = slot.lasthx;
  lasthy = slot.lasthy;
  prayed = slot.prayed;
  dropflag = slot.dropflag;
  nomove = slot.nomove;
  viewflag = slot.viewflag;
  lasttime = slot.lasttime;
  rmst = slot.rmst;
  course = slot.course ? slot.course.slice() : [];
  outstanding_taxes = slot.outstandingTaxes;
  LOG = slot.log ? slot.log.slice() : [];
  applyKnow(slot.know);
  ACTIVE_SLOT = slot.slot;
}

function actingAdventurerView(slot) {
  const who = slot || (PARTY_ON ? ADVENTURERS[ACTIVE_SLOT] : null);
  if (!who || who.slot === ACTIVE_SLOT) {
    return [{ x: player.x, y: player.y, dungeon: level, slot: who ? who.slot : 0, name: who ? who.name : logname }];
  }
  return [{
    x: who.player.x,
    y: who.player.y,
    dungeon: who.level,
    slot: who.slot,
    name: who.name,
  }];
}

/*
 * Wrap the current hero as adventurer 0. Does not roll the RNG and does
 * not rewrite live globals. Later turns still mutate the same player.
 */
function enablePartyOfOne() {
  if (PARTY_ON) return ADVENTURERS[ACTIVE_SLOT];
  ADVENTURERS = [captureSlot(0, logname)];
  ACTIVE_SLOT = 0;
  PARTY_ON = true;
  cooperationActingAdventurers = function () {
    return actingAdventurerView(ADVENTURERS[ACTIVE_SLOT]);
  };
  return ADVENTURERS[0];
}

function findTownEntrance() {
  const floor = LEVELS && LEVELS[0];
  if (!floor || !floor.items) return { x: player.x, y: player.y };
  for (let x = 0; x < floor.items.length; x++) {
    const column = floor.items[x];
    if (!column) continue;
    for (let y = 0; y < column.length; y++) {
      const item = column[y];
      if (!item || !item.matches) continue;
      if ((typeof OENTRANCE !== "undefined" && item.matches(OENTRANCE)) ||
          (typeof OSTAIRSUP !== "undefined" && item.matches(OSTAIRSUP)) ||
          (typeof OVOLDOWN !== "undefined" && item.matches(OVOLDOWN))) {
        return { x: x, y: y };
      }
    }
  }
  return { x: player.x, y: player.y };
}

function tileBlocked(item) {
  if (!item || !item.matches) return true;
  if (typeof OWALL !== "undefined" && item.matches(OWALL)) return true;
  return false;
}

function occupyTownFloor(preferred) {
  const floor = LEVELS[0];
  const offsets = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  for (let i = 0; i < offsets.length; i++) {
    const x = preferred.x + offsets[i][0];
    const y = preferred.y + offsets[i][1];
    if (!inBounds(x, y)) continue;
    if (tileBlocked(floor.items[x][y])) continue;
    let taken = false;
    for (let s = 0; s < ADVENTURERS.length; s++) {
      const other = ADVENTURERS[s];
      if (other && other.player && other.level === 0 && other.player.x === x && other.player.y === y && other.alive) {
        taken = true;
      }
    }
    if (!taken) return { x: x, y: y };
  }
  return preferred;
}

/*
 * Fresh adventurer at the town entrance. Uses the same class setup as a
 * new solo hero. Call only after the shared dungeon already exists.
 */
function addAdventurer(name, characterClass) {
  if (!PARTY_ON) enablePartyOfOne();
  if (ADVENTURERS.length >= PARTY_LIMIT) return null;
  ADVENTURERS[ACTIVE_SLOT] = captureSlot(ACTIVE_SLOT, ADVENTURERS[ACTIVE_SLOT].name);
  const previous = ACTIVE_SLOT;
  const slot = ADVENTURERS.length;
  player = new Player();
  logname = String(name || "Ally").slice(0, 24);
  const picked = characterClass || "Adventurer";
  player.setCharacterClass(picked);
  player.setGender("Male");
  learnPotion(createObject(OPOTION, 21));
  recalc();
  level = 0;
  const spot = occupyTownFloor(findTownEntrance());
  player.x = spot.x;
  player.y = spot.y;
  gtime = 0;
  lastmonst = "";
  lastnum = 0;
  hitflag = 0;
  lasthx = 0;
  lasthy = 0;
  prayed = 1;
  dropflag = 0;
  rmst = 120;
  course = [];
  outstanding_taxes = 0;
  LOG = Array(LOG_SIZE).fill(" ");
  const created = captureSlot(slot, logname);
  created.role = "player";
  created.know = snapshotKnow();
  for (let depth = 0; depth < created.know.length; depth++) {
    const columns = created.know[depth];
    if (!columns) continue;
    for (let x = 0; x < columns.length; x++) {
      if (!columns[x]) continue;
      for (let y = 0; y < columns[x].length; y++) columns[x][y] = 0;
    }
  }
  if (created.know[0]) {
    created.player.x = spot.x;
    created.player.y = spot.y;
  }
  ADVENTURERS.push(created);
  applySlot(ADVENTURERS[previous]);
  showcell(player.x, player.y);
  return slot;
}

function activateAdventurer(slot) {
  if (!PARTY_ON) return false;
  if (slot < 0 || slot >= ADVENTURERS.length) return false;
  ADVENTURERS[ACTIVE_SLOT] = captureSlot(ACTIVE_SLOT, ADVENTURERS[ACTIVE_SLOT].name);
  if (slot !== ACTIVE_SLOT) applySlot(ADVENTURERS[slot]);
  return true;
}

function adventurerSummaries() {
  if (!PARTY_ON) {
    return [{
      slot: 0,
      name: logname,
      role: "host",
      alive: !!(player && player.HP > 0),
      ghost: !!(player && player.HP <= 0),
      x: player ? player.x : 0,
      y: player ? player.y : 0,
      dungeon: level,
      hp: player ? player.HP : 0,
      hpmax: player ? player.HPMAX : 0,
      xl: player ? player.LEVEL : 1,
    }];
  }
  return ADVENTURERS.map(function (slot) {
    return {
      slot: slot.slot,
      name: slot.name,
      role: slot.role,
      alive: slot.slot === ACTIVE_SLOT ? !!(player && player.HP > 0) : slot.alive,
      ghost: slot.ghost,
      x: slot.slot === ACTIVE_SLOT && player ? player.x : slot.player.x,
      y: slot.slot === ACTIVE_SLOT && player ? player.y : slot.player.y,
      dungeon: slot.slot === ACTIVE_SLOT ? level : slot.level,
      hp: slot.slot === ACTIVE_SLOT && player ? player.HP : slot.player.HP,
      hpmax: slot.slot === ACTIVE_SLOT && player ? player.HPMAX : slot.player.HPMAX,
      xl: slot.player.LEVEL,
    };
  });
}

function capturePartyState(seen) {
  if (!PARTY_ON) return null;
  return {
    active: ACTIVE_SLOT,
    members: ADVENTURERS.map(function (slot) {
      const live = slot.slot === ACTIVE_SLOT;
      return {
        slot: slot.slot,
        name: slot.name,
        role: slot.role,
        alive: live ? !!(player && player.HP > 0) : slot.alive,
        ghost: live ? !!(player && player.HP <= 0) : slot.ghost,
        level: live ? level : slot.level,
        gtime: live ? gtime : slot.gtime,
        x: live && player ? player.x : slot.player.x,
        y: live && player ? player.y : slot.player.y,
        hp: live && player ? player.HP : slot.player.HP,
        know: plainData(live ? snapshotKnow() : slot.know, seen),
      };
    }),
  };
}
