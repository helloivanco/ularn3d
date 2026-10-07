/**
 * A floor keeps one lemming, and a new adventurer's dagger kills it on a normal swing.
 * Run via: node --test tests/lemming-balance.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(path, "utf8");

const boot = () => {
  function Storage() {}
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Math,
    Date,
    JSON,
    Map,
    Set,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    Storage,
    ULARN: true,
    DEBUG_NO_MONSTERS: false,
    diroffx: [0, 0, 1, 0, -1, 1, -1, 1, -1],
    diroffy: [0, 1, 0, -1, 0, -1, -1, 1, 1],
    KNOWALL: 3,
    KNOWHERE: 1,
    setKnow() {},
    getKnow() {
      return 0;
    },
    isGenocided() {
      return false;
    },
    genocide: [],
    wizard: 0,
    HARDGAME: 0,
    GAMEOVER: false,
    game_started: true,
    mazeMode: false,
    napping: false,
    gtime: 0,
    level: 0,
    getPref() {
      return false;
    },
    colorText(text) {
      return text;
    },
    amiga_mode: false,
    updateLog() {},
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  for (const file of [
    "public/engine/common/util.js",
    "public/engine/data.js",
    "public/engine/object.js",
    "public/engine/monster.js",
    "public/engine/monsterdata.js",
    "public/engine/level.js",
    "public/engine/mazes.js",
    "public/engine/spellsinfo.js",
    "public/engine/storedata.js",
    "public/engine/config.js",
    "public/engine/state.js",
    "public/engine/global.js",
    "public/engine/create.js",
    "public/engine/player.js",
    "public/engine/inventory.js",
    "public/engine/spells.js",
  ]) {
    vm.runInContext(read(file), context, { filename: file });
  }
  vm.runInContext(
    `
    ULARN = true;
    setGameConfig();
    player = {
      x: 20, y: 10, BLINDCOUNT: 0,
      LAMP: false, WAND: false, SLAYING: false, NEGATESPIRIT: false,
      CUBEofUNDEAD: false, NOTHEFT: false, SLASH: false, BESSMANN: false,
      TALISMAN: false, HAND: false, ORB: false, ELVEN: false, SLAY: false,
      VORPAL: false, STAFF: false, PRESERVER: false, PAD: false,
      ELEVUP: false, ELEVDOWN: false
    };
    `,
    context,
  );
  return context;
};

const countLemmings = `(() => {
  const cells = [];
  let others = 0;
  for (let y = 0; y < MAXY; y++) {
    for (let x = 0; x < MAXX; x++) {
      const monster = monsterAt(x, y);
      if (!monster) continue;
      if (monster.arg === LEMMING) cells.push([x, y]);
      else others++;
    }
  }
  let close = 0;
  for (let a = 0; a < cells.length; a++) {
    for (let b = a + 1; b < cells.length; b++) {
      const dist = Math.max(Math.abs(cells[a][0] - cells[b][0]), Math.abs(cells[a][1] - cells[b][1]));
      if (dist <= 2) close++;
    }
  }
  return { count: cells.length, close, others, cells };
})()`;

test("lemming fight stats stay a one-hit creature and only the lemming is easier to hit", () => {
  const ctx = boot();
  const stats = vm.runInContext(
    `
    const row = (id) => {
      const monster = monsterlist[id];
      return { armorclass: monster.armorclass, hitpoints: monster.hitpoints, damage: monster.damage, attack: monster.attack };
    };
    const lem = monsterlist[LEMMING];
    ({
      name: lem.desc,
      ...row(LEMMING),
      gnome: row(GNOME),
      hobgoblin: row(HOBGOBLIN),
      jackal: row(JACKAL),
      kobold: row(KOBOLD),
    });
    `,
    ctx,
  );
  assert.equal(stats.name, "lemming");
  assert.equal(stats.hitpoints, 0);
  assert.equal(stats.damage, 0);
  assert.equal(stats.attack, 0);
  assert.equal(stats.armorclass, 18);
  const sameRow = (row, armorclass, hitpoints, damage) => {
    assert.equal(row.armorclass, armorclass);
    assert.equal(row.hitpoints, hitpoints);
    assert.equal(row.damage, damage);
    assert.equal(row.attack, 0);
  };
  sameRow(stats.gnome, 10, 2, 1);
  sameRow(stats.hobgoblin, 13, 3, 2);
  sameRow(stats.jackal, 7, 1, 1);
  sameRow(stats.kobold, 15, 1, 1);
});

test("a starting adventurer's typical dagger swing kills a lemming", () => {
  const ctx = boot();
  const result = vm.runInContext(
    `
    player = new Player();
    player.setCharacterClass("Adventurer");
    recalc();
    generateFreshLevel(1);
    for (let y = 0; y < MAXY; y++) {
      for (let x = 0; x < MAXX; x++) setMonster(x, y, null);
    }
    player.x = 20;
    player.y = 10;
    player.LEVEL = 1;
    player.EXPERIENCE = 0;
    player.HALFDAM = 0;
    player.TIMESTOP = 0;
    player.BLINDCOUNT = 0;
    player.HOLDMONST = 0;
    const dagger = player.inventory.find((item) => item && item.matches(ODAGGER));
    player.WIELD = dagger;
    recalc();
    const hitSkill = monsterlist[LEMMING].armorclass + player.LEVEL + player.DEXTERITY + player.WCLASS / 4 - 12;
    const formerHitSkill = hitSkill - monsterlist[LEMMING].armorclass;
    let hits = 0;
    const samples = {};
    for (let swing = 1; swing <= 20; swing++) {
      for (let pity = 1; pity <= 71; pity++) {
        player.LEVEL = 1;
        player.EXPERIENCE = 0;
        player.HALFDAM = 0;
        player.TIMESTOP = 0;
        let calls = 0;
        rnd = (n) => {
          calls += 1;
          if (calls === 1) return swing;
          if (calls === 2 && n === 71) return pity;
          if (n === 100) return 100;
          return 1;
        };
        setMonster(21, 10, null);
        const mob = setMonster(21, 10, LEMMING);
        const before = mob.hitpoints;
        hitmonster(21, 10);
        const gone = monsterAt(21, 10) == null;
        if (gone) hits += 1;
        if (pity === 71) samples[swing] = { before, after: mob.hitpoints, gone };
      }
    }
    ({
      hits,
      trials: 20 * 71,
      hitSkill,
      formerHitSkill,
      level: player.LEVEL,
      dexterity: player.DEXTERITY,
      strength: player.STRENGTH,
      weaponClass: player.WCLASS,
      dagger: !!(dagger && dagger.matches(ODAGGER) && dagger.arg === 0),
      full: fullhit(1),
      samples,
      hitpoints: monsterlist[LEMMING].hitpoints,
      armorclass: monsterlist[LEMMING].armorclass,
    });
    `,
    ctx,
  );

  assert.equal(result.dagger, true);
  assert.equal(result.level, 1);
  assert.equal(result.dexterity, 12);
  assert.equal(result.strength, 12);
  assert.equal(result.weaponClass, 3);
  assert.equal(result.full, 1);
  assert.equal(result.hitpoints, 0);
  assert.equal(result.armorclass, 18);
  // Armor class 0 used to-hit 1.75: only a d20 of 1, plus the 4-in-71 pity, 147/1420.
  assert.equal(result.formerHitSkill, 1.75);
  assert.equal(result.hitSkill, 19.75);
  assert.equal(result.trials, 1420);
  assert.equal(result.hits, 1353);
  const median = result.samples[10];
  const upperMedian = result.samples[11];
  for (const swing of [median, upperMedian]) {
    assert.equal(swing.before, 0);
    assert.equal(swing.after, -2);
    assert.equal(swing.gone, true);
  }
  assert.equal(result.samples[20].before, 0);
  assert.equal(result.samples[20].after, 0);
  assert.equal(result.samples[20].gone, false);
});

test("the deep-floor lemming injection stays a two-percent roll", () => {
  const ctx = boot();
  const source = read("public/engine/global.js");
  assert.match(source, /rnd\(100\) <= 2/);
  assert.match(source, /tmp = LEMMING/);
  const result = vm.runInContext(
    `
    level = 8;
    const original = rnd;
    const queue = [];
    rnd = (value) => (queue.length ? queue.shift() : original(value));
    try {
      queue.push(1, 9, 1, 2, 1, 1, 1, 3);
      ({
        formerTenPercent: makemonst(8),
        twoPercent: makemonst(8),
        onePercent: makemonst(8),
        justOutside: makemonst(8),
      });
    } finally {
      rnd = original;
    }
    `,
    ctx,
  );
  assert.notEqual(result.formerTenPercent, 1);
  assert.equal(result.twoPercent, 1);
  assert.equal(result.onePercent, 1);
  assert.notEqual(result.justOutside, 1);
});

test("a normal floor is not covered in lemmings", () => {
  const ctx = boot();
  const floors = vm.runInContext(
    `
    const depths = [1, 1, 1, 1, 1, 1, 2, 3, 8, 8, 8, 8];
    const floors = [];
    for (const depth of depths) {
      const built = generateFreshLevel(depth);
      const survey = ${countLemmings};
      floors.push({ depth, ok: built.ok, ...survey });
    }
    floors;
    `,
    ctx,
  );
  assert.equal(floors.length, 12);
  for (const floor of floors) {
    assert.equal(floor.ok, true, `depth ${floor.depth} failed to build`);
    assert.ok(floor.count <= 1, `depth ${floor.depth} spawned ${floor.count} lemmings`);
    assert.equal(floor.close, 0, `depth ${floor.depth} placed lemmings within two tiles`);
    if (floor.depth === 1) assert.ok(floor.others >= 1, "other species were removed from the floor");
  }
  const early = floors.filter((floor) => floor.depth === 1);
  const typical = early.reduce((sum, floor) => sum + floor.count, 0) / early.length;
  assert.ok(typical <= 1, `level 1 averaged ${typical} lemmings`);
});

test("breeding cannot put a ring of lemmings around the hero", () => {
  const ctx = boot();
  const result = vm.runInContext(
    `
    generateFreshLevel(1);
    for (let y = 0; y < MAXY; y++) {
      for (let x = 0; x < MAXX; x++) {
        if (monsterAt(x, y) && monsterAt(x, y).arg === LEMMING) setMonster(x, y, null);
      }
    }
    player.x = 20;
    player.y = 10;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setItem(20 + dx, 10 + dy, OEMPTY);
        setMonster(20 + dx, 10 + dy, null);
      }
    }
    setMonster(21, 10, LEMMING);
    for (let i = 0; i < 40; i++) createmonster(LEMMING);
    const trailed = setMonster(21, 11, LEMMING);
    let near = 0;
    let total = 0;
    for (let y = 0; y < MAXY; y++) {
      for (let x = 0; x < MAXX; x++) {
        const monster = monsterAt(x, y);
        if (!monster || monster.arg !== LEMMING) continue;
        total++;
        if (Math.max(Math.abs(x - 20), Math.abs(y - 10)) === 1) near++;
      }
    }
    const grid = LEVELS[level].monsters;
    grid[30][8] = createMonster(LEMMING);
    grid[30][14] = createMonster(LEMMING);
    grid[10][10] = createMonster(LEMMING);
    const beforeThin = ${countLemmings};
    thinLemmings();
    const afterThin = ${countLemmings};
    let keptNear = false;
    for (let dy = -1; dy <= 1 && !keptNear; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const monster = monsterAt(20 + dx, 10 + dy);
        if (monster && monster.arg === LEMMING) keptNear = true;
      }
    }
    ({ trailed: trailed && trailed.arg, near, total, beforeThin: beforeThin.count, afterThin: afterThin.count, afterClose: afterThin.close, keptNear });
    `,
    ctx,
  );
  assert.equal(result.trailed, null);
  assert.equal(result.near, 1);
  assert.equal(result.total, 1);
  assert.ok(result.beforeThin > 1);
  assert.equal(result.afterThin, 1);
  assert.equal(result.afterClose, 0);
  assert.equal(result.keptNear, true);
});
