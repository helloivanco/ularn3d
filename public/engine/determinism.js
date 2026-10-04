"use strict";

/*
 * Seeded game stream, state checksum, and diff/apply.
 * Solo play does not install a host, so this file changes nothing until
 * createEngineHost + installEngineHost run.
 *
 * Product version stamped for replay. Keep it aligned with package.json.
 */
var ENGINE_VERSION = "1.3.39";

var ENGINE_INPUT_LOG = [];

function createEngineHost(seed, options) {
  const opts = options || {};
  const random = mulberry32((Number(seed) >>> 0) || 1);
  let clock = 1700000000000;
  return {
    seed: (Number(seed) >>> 0) || 1,
    random: function () {
      return random();
    },
    singleStream: true,
    skipDelay: opts.skipDelay !== false,
    skipPaint: !!opts.skipPaint,
    recordInputs: opts.recordInputs !== false,
    now: function () {
      clock += 16;
      return clock;
    },
  };
}

function resetInputLog() {
  ENGINE_INPUT_LOG = [];
}

function pushInput(entry) {
  const row = {
    actor: entry && entry.actor ? entry.actor | 0 : 0,
    turn: entry && entry.turn != null ? entry.turn | 0 : gtime | 0,
    action: entry && entry.action != null ? String(entry.action) : "",
    seq: entry && entry.seq != null ? entry.seq | 0 : ENGINE_INPUT_LOG.length,
  };
  ENGINE_INPUT_LOG.push(row);
  return row;
}

function readInputLog() {
  return ENGINE_INPUT_LOG.slice();
}

function fnv1a64(text) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const value = String(text);
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    let out = "[";
    for (let i = 0; i < value.length; i++) {
      if (i) out += ",";
      out += stableStringify(value[i]);
    }
    return out + "]";
  }
  const keys = Object.keys(value).sort();
  let out = "{";
  for (let i = 0; i < keys.length; i++) {
    if (i) out += ",";
    out += JSON.stringify(keys[i]) + ":" + stableStringify(value[keys[i]]);
  }
  return out + "}";
}

function plainData(value, seen) {
  if (value == null) return null;
  const kind = typeof value;
  if (kind === "function" || kind === "symbol") return undefined;
  if (kind === "number") return Number.isFinite(value) ? value : null;
  if (kind === "bigint") return value.toString();
  if (kind !== "object") return value;
  if (typeof Node !== "undefined" && value instanceof Node) return null;
  if (seen.has(value)) return { $ref: seen.get(value) };
  const id = seen.size;
  seen.set(value, id);
  if (Array.isArray(value)) {
    const list = [];
    for (let i = 0; i < value.length; i++) {
      const child = plainData(value[i], seen);
      list.push(child === undefined ? null : child);
    }
    return list;
  }
  const out = {};
  const keys = Object.keys(value).sort();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key[0] === "_") continue;
    const child = plainData(value[key], seen);
    if (child !== undefined) out[key] = child;
  }
  return out;
}

function plainGrid(grid, seen) {
  if (!grid) return null;
  const columns = [];
  for (let x = 0; x < grid.length; x++) {
    const column = grid[x];
    if (!column) {
      columns.push(null);
      continue;
    }
    const cells = [];
    for (let y = 0; y < column.length; y++) {
      const child = plainData(column[y], seen);
      cells.push(child === undefined ? null : child);
    }
    columns.push(cells);
  }
  return columns;
}

function captureGameState() {
  const seen = new Map();
  const levels = [];
  const floors = typeof LEVELS !== "undefined" && LEVELS ? LEVELS : [];
  for (let depth = 0; depth < floors.length; depth++) {
    const floor = floors[depth];
    if (!floor) {
      levels.push(null);
      continue;
    }
    levels.push({
      items: plainGrid(floor.items, seen),
      monsters: plainGrid(floor.monsters, seen),
      know: plainGrid(floor.know, seen),
    });
  }
  const state = {
    version: ENGINE_VERSION,
    level: level,
    gtime: gtime,
    difficulty: typeof getDifficulty === "function" ? getDifficulty() : HARDGAME,
    logname: logname,
    gameover: GAMEOVER,
    wizard: wizard,
    cheat: cheat,
    rmst: rmst,
    lastmonst: lastmonst,
    lastnum: lastnum,
    hitflag: hitflag,
    prayed: prayed,
    dropflag: dropflag,
    nomove: nomove,
    viewflag: viewflag,
    lasttime: lasttime,
    outstandingTaxes: outstanding_taxes,
    course: plainData(course, seen),
    genocide: plainData(genocide, seen),
    usedMazes: plainData(typeof USED_MAZES !== "undefined" ? USED_MAZES : [], seen),
    player: plainData(player, seen),
    log: plainData(typeof LOG !== "undefined" ? LOG : [], seen),
    spheres: plainData(spheres, seen),
    levels: levels,
    party: typeof capturePartyState === "function" ? capturePartyState(seen) : null,
    multiplayer: typeof partySize === "function" && partySize() > 1,
    aura: typeof cooperationAuraOn === "function" ? cooperationAuraOn() : false,
  };
  return state;
}

function checksumGameState(state) {
  const text = stableStringify(state || captureGameState());
  return fnv1a64(text);
}

function diffAny(before, after) {
  if (Object.is(before, after)) return { same: true };
  if (before === null || after === null || typeof before !== "object" || typeof after !== "object") {
    return { same: false, value: after === undefined ? null : after };
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
      return { same: false, value: after };
    }
    const slots = new Array(before.length);
    let same = true;
    for (let i = 0; i < before.length; i++) {
      const child = diffAny(before[i], after[i]);
      slots[i] = child;
      if (!child.same) same = false;
    }
    return same ? { same: true } : { same: false, array: slots };
  }
  const keys = Object.keys(before).concat(Object.keys(after));
  keys.sort();
  const fields = {};
  let same = true;
  let previous = "";
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === previous) continue;
    previous = key;
    const child = diffAny(before[key], after[key]);
    if (!child.same) {
      fields[key] = child;
      same = false;
    }
  }
  return same ? { same: true } : { same: false, fields: fields };
}

function diffState(before, after) {
  return diffAny(before, after);
}

function applyAny(base, diff) {
  if (!diff || diff.same) return base;
  if (Object.prototype.hasOwnProperty.call(diff, "value")) return diff.value;
  if (diff.array) {
    const source = Array.isArray(base) ? base : [];
    const next = new Array(diff.array.length);
    for (let i = 0; i < diff.array.length; i++) next[i] = applyAny(source[i], diff.array[i]);
    return next;
  }
  const next = {};
  const source = base && typeof base === "object" && !Array.isArray(base) ? base : {};
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i++) next[keys[i]] = source[keys[i]];
  const changed = Object.keys(diff.fields || {});
  for (let i = 0; i < changed.length; i++) {
    const key = changed[i];
    next[key] = applyAny(source[key], diff.fields[key]);
  }
  return next;
}

function applyDiff(base, diff) {
  return applyAny(base, diff);
}
