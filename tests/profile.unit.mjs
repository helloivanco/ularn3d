import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_KEY, emptyProfile, loadProfile, saveProfile, recordRun, noteSpecies,
  bestiaryCount, rememberLastRun,
} from "../src/profile.js";
import { FEATS, CALLINGS, checkFeats } from "../src/feats.js";

const memory = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), data };
};

const ending = (over = {}) => ({
  gameID: "g1", score: 100, what: "killed by a gnome", depth: 3, deepest: 4, moves: 500,
  winner: false, hardlev: 0, character: "Adventurer", who: "Ivan", kills: 5, debug: false, ...over,
});

const ids = (unlocked) => unlocked.map((entry) => entry.id);

test("a run records once by gameID and leaves the input alone", () => {
  const start = emptyProfile();
  const first = recordRun(start, ending(), { at: 1 });
  assert.equal(first.recorded, true);
  assert.equal(start.runs, 0);
  assert.deepEqual(start.history, []);
  assert.equal(first.profile.runs, 1);
  assert.equal(first.profile.deaths, 1);
  assert.equal(first.profile.kills, 5);
  assert.equal(first.profile.deepest, 4);
  assert.deepEqual(first.profile.recorded, ["g1"]);
  assert.deepEqual(first.profile.lastRun, { name: "Ivan", character: "Adventurer", difficulty: 0 });

  const again = recordRun(first.profile, ending({ score: 9999 }));
  assert.equal(again.recorded, false);
  assert.equal(again.deltas, null);
  assert.equal(again.profile, first.profile);
});

test("bests, rank and calling bests come back as deltas", () => {
  let profile = recordRun(emptyProfile(), ending({ gameID: "a", score: 100 })).profile;
  const better = recordRun(profile, ending({ gameID: "b", score: 300, deepest: 9, kills: 2, winner: true }));
  assert.deepEqual(better.deltas.newBest, { score: true, depth: true, kills: false });
  assert.equal(better.deltas.previousBest.score, 100);
  assert.equal(better.deltas.rank, 1);
  assert.equal(better.deltas.of, 2);
  assert.equal(better.deltas.callingBest, true);
  profile = better.profile;
  assert.deepEqual(profile.best, { score: 300, game: "b", depth: 9, kills: 5, moves: 500 });
  assert.equal(profile.wins, 1);
  assert.equal(profile.deaths, 1);
  assert.deepEqual(profile.callings.Adventurer, { runs: 2, best: 300 });

  const middle = recordRun(profile, ending({ gameID: "c", score: 200, character: "Wizard" }));
  assert.equal(middle.deltas.newBest.score, false);
  assert.equal(middle.deltas.rank, 2);
  assert.equal(middle.deltas.of, 3);
  assert.equal(middle.deltas.callingBest, true);
  assert.deepEqual(middle.profile.callings.Wizard, { runs: 1, best: 200 });
});

test("history keeps the newest 30, newest first", () => {
  let profile = emptyProfile();
  for (let i = 0; i < 35; i++) profile = recordRun(profile, ending({ gameID: `g${i}`, score: i })).profile;
  assert.equal(profile.runs, 35);
  assert.equal(profile.history.length, 30);
  assert.equal(profile.history[0].game, "g34");
  assert.equal(profile.history.at(-1).game, "g5");
  assert.equal(profile.recorded.length, 30);
  assert.equal(profile.recorded.at(-1), "g34");
  const last = recordRun(profile, ending({ gameID: "g35", score: 0 }));
  assert.equal(last.deltas.of, 30);
  assert.equal(last.deltas.rank, 30);
});

test("a debug run counts as a run but never sets bests", () => {
  const result = recordRun(emptyProfile(), ending({ debug: true, score: 5000, deepest: 15 }));
  assert.equal(result.recorded, true);
  assert.equal(result.profile.runs, 1);
  assert.deepEqual(result.profile.best, emptyProfile().best);
  assert.equal(result.profile.deepest, 0);
  assert.deepEqual(result.deltas.newBest, { score: false, depth: false, kills: false });
  assert.equal(result.deltas.callingBest, false);
  assert.equal(result.profile.callings.Adventurer.best, 0);
});

test("corrupt, missing or foreign storage loads an empty profile", () => {
  assert.deepEqual(loadProfile(memory()), emptyProfile());
  assert.deepEqual(loadProfile(memory({ [PROFILE_KEY]: "{nope" })), emptyProfile());
  assert.deepEqual(loadProfile(memory({ [PROFILE_KEY]: JSON.stringify({ v: 2, runs: 4 }) })), emptyProfile());
  assert.deepEqual(loadProfile({ getItem() { throw new Error("blocked"); } }), emptyProfile());
  assert.deepEqual(loadProfile(null), emptyProfile());
});

test("a profile round-trips and a throwing storage never throws", () => {
  const store = memory();
  const profile = recordRun(emptyProfile(), ending()).profile;
  assert.equal(saveProfile(store, profile), true);
  assert.deepEqual(loadProfile(store), profile);
  assert.equal(saveProfile({ setItem() { throw new Error("quota"); } }, profile), false);
  assert.equal(saveProfile(null, profile), false);
});

test("species sightings stick, kills count, and no change keeps the same object", () => {
  const start = emptyProfile();
  const seen = noteSpecies(start, 7, { seen: true, at: 10 });
  assert.equal(seen.firstSeen, true);
  assert.deepEqual(seen.profile.species[7], { seen: 1, killed: 0, first: 10 });
  assert.deepEqual(start.species, {});

  const again = noteSpecies(seen.profile, 7, { seen: true, at: 20 });
  assert.equal(again.firstSeen, false);
  assert.equal(again.profile, seen.profile);
  assert.equal(noteSpecies(seen.profile, 7).profile, seen.profile);

  const killed = noteSpecies(seen.profile, 7, { killed: true });
  assert.equal(killed.firstSeen, false);
  assert.deepEqual(killed.profile.species[7], { seen: 1, killed: 1, first: 10 });

  const unseenKill = noteSpecies(start, 9, { killed: true, at: 5 });
  assert.equal(unseenKill.firstSeen, true);
  assert.equal(bestiaryCount(unseenKill.profile), 1);
  assert.equal(bestiaryCount(killed.profile), 1);
});

test("remembering the same last run keeps the same object", () => {
  const profile = rememberLastRun(emptyProfile(), { name: "Ivan", character: "Elf", difficulty: 2 });
  assert.deepEqual(profile.lastRun, { name: "Ivan", character: "Elf", difficulty: 2 });
  assert.equal(rememberLastRun(profile, { name: "Ivan", character: "Elf", difficulty: 2 }), profile);
  assert.notEqual(rememberLastRun(profile, { name: "Ivan", character: "Ogre", difficulty: 2 }), profile);
});

test("feat titles are short and ids are unique", () => {
  assert.equal(new Set(FEATS.map((entry) => entry.id)).size, FEATS.length);
  for (const entry of FEATS) {
    assert.ok(entry.title.length <= 22, entry.title);
    assert.ok(entry.line && entry.icon, entry.id);
  }
});

test("feats unlock once and a repeat check unlocks nothing", () => {
  const run = {};
  const snap = { level: 5, deepest: 5, rank: 5, gold: 1500, hp: 20, hpMax: 20, kills: 1 };
  const first = checkFeats(emptyProfile(), run, snap, { now: 42 });
  assert.deepEqual(ids(first.unlocked).sort(),
    ["depth-1", "depth-5", "first-blood", "gold-1k", "level-5"]);
  assert.equal(first.profile.feats["depth-5"], 42);
  const second = checkFeats(first.profile, run, snap, { now: 43 });
  assert.deepEqual(second.unlocked, []);
  assert.equal(second.profile, first.profile);
  const debug = checkFeats(emptyProfile(), {}, snap, { debug: true });
  assert.deepEqual(debug.unlocked, []);
});

test("killed dragons and demon lords use the injected species ids", () => {
  const context = { dragonIds: new Set([40]), demonIds: [55], now: 1 };
  const dragon = checkFeats(emptyProfile(), {}, {}, { ...context, killedSpecies: 40 });
  assert.ok(ids(dragon.unlocked).includes("dragon-slayer"));
  assert.ok(!ids(dragon.unlocked).includes("demon-lord"));
  const demon = checkFeats(emptyProfile(), {}, {}, { ...context, killedSpecies: 55 });
  assert.ok(ids(demon.unlocked).includes("demon-lord"));
  const gnome = checkFeats(emptyProfile(), {}, {}, { ...context, killedSpecies: 3 });
  assert.deepEqual(ids(gnome.unlocked), ["first-blood"]);
});

test("bestiary feats unlock at their thresholds", () => {
  const withSeen = (count) => {
    let profile = emptyProfile();
    for (let id = 1; id <= count; id++) profile = noteSpecies(profile, id, { seen: true, at: 0 }).profile;
    return profile;
  };
  const bestiary = (count) => ids(checkFeats(withSeen(count), {}, {}).unlocked);
  assert.deepEqual(bestiary(9), []);
  assert.deepEqual(bestiary(10), ["bestiary-10"]);
  assert.deepEqual(bestiary(25), ["bestiary-10", "bestiary-25"]);
  assert.deepEqual(bestiary(66), ["bestiary-10", "bestiary-25", "bestiary-50", "bestiary-66"]);
});

test("second wind needs a brush with death and then a recovery", () => {
  const run = {};
  let profile = emptyProfile();
  const check = (hp) => {
    const result = checkFeats(profile, run, { hp, hpMax: 100 });
    profile = result.profile;
    return ids(result.unlocked);
  };
  assert.deepEqual(check(60), []);
  assert.deepEqual(check(10), []);
  assert.equal(run.lowHp, true);
  assert.deepEqual(check(49), []);
  assert.deepEqual(check(50), ["second-wind"]);
  assert.deepEqual(checkFeats(emptyProfile(), {}, { hp: 90, hpMax: 100 }).unlocked, []);
});

test("every calling needs a recorded run with all eight", () => {
  let profile = emptyProfile();
  CALLINGS.slice(0, 7).forEach((character, i) => {
    profile = recordRun(profile, ending({ gameID: `c${i}`, character })).profile;
  });
  assert.ok(!ids(checkFeats(profile, {}, {}).unlocked).includes("every-calling"));
  profile = recordRun(profile, ending({ gameID: "c7", character: CALLINGS[7] })).profile;
  assert.deepEqual(ids(checkFeats(profile, {}, {}).unlocked), ["every-calling"]);
});

test("depth, relic and victory feats read the snapshot", () => {
  const snap = { level: 20, deepest: 20, hasEye: true, hasCure: true, winner: true, rank: 20, gold: 10000 };
  const got = ids(checkFeats(emptyProfile(), {}, snap).unlocked);
  for (const id of ["depth-15", "volcano-1", "volcano-5", "eye", "cure", "victory", "level-20", "gold-10k"])
    assert.ok(got.includes(id), id);
});
