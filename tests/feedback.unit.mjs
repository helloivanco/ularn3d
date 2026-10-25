import test from "node:test";
import assert from "node:assert/strict";
import { Trauma, PresentationClock, diffSnapshot, transitionCause, depthLabel, FeedbackDirector } from "../src/feedback.js";
import { feelSettings } from "../src/feel-settings.js";

test("trauma is bounded, squared and settles to exactly zero", () => {
  const trauma = new Trauma({ decay: 2 }), out = { x: 1, y: 1 };
  trauma.add(3, 0);
  assert.equal(trauma.value, 1);
  assert.equal(trauma.offset(100, out, 10), true);
  assert.ok(Math.abs(out.x) <= 10 && Math.abs(out.y) <= 10);
  const light = new Trauma(), heavy = new Trauma(), a = {}, b = {};
  light.add(.2, 0); heavy.add(.8, 0);
  let lightMax = 0, heavyMax = 0;
  for (let t = 1; t < 200; t += 7) {
    light.offset(t, a, 10); heavy.offset(t, b, 10);
    lightMax = Math.max(lightMax, Math.hypot(a.x, a.y)); heavyMax = Math.max(heavyMax, Math.hypot(b.x, b.y));
  }
  assert.ok(heavyMax > lightMax * 8, "trauma² makes heavy hits punch far harder");
  assert.equal(trauma.offset(2000, out, 10), false);
  assert.equal(out.x, 0);
  assert.equal(out.y, 0);
  const off = new Trauma(); off.add(1, 0);
  assert.equal(off.offset(10, out, 10, 0), false, "a zero shake setting stays still");
});

test("presentation clock holds, caps holds per second and never runs backwards", () => {
  const clock = new PresentationClock({ cap: 120, span: 1000 });
  assert.equal(clock.hold(80, 100), 80);
  assert.equal(clock.now(140), 100, "time stands still during a hold");
  assert.equal(clock.now(180), 100);
  assert.equal(clock.now(200), 120);
  assert.equal(clock.hold(80, 300), 40, "the rolling cap trims later holds");
  assert.equal(clock.hold(80, 400), 0);
  let last = -Infinity;
  for (let t = 0; t < 3000; t += 13) { const now = clock.now(t); assert.ok(now >= last); last = now; }
  assert.equal(clock.hold(60, 3000), 60, "the cap frees up after the window passes");
});

test("snapshot diffs separate mana spend, healing, levels and floors", () => {
  const base = { gameID: "g", hp: 10, hpMax: 10, mana: 3, manaMax: 3, rank: 1, gold: 5, bank: 0, level: 1, deepest: 1, stats: { STR: 12 } };
  const spent = diffSnapshot(base, { ...base, mana: 2 });
  assert.equal(spent.hpLost, 0);
  assert.equal(spent.manaSpent, 1);
  const up = diffSnapshot(base, { ...base, rank: 2, hpMax: 14, stats: { STR: 13 }, level: 2, deepest: 2 });
  assert.equal(up.rankDelta, 1);
  assert.equal(up.hpMaxDelta, 4);
  assert.deepEqual(up.statDeltas, [{ stat: "STR", change: 1 }]);
  assert.deepEqual(up.depth, { from: 1, to: 2 });
  assert.equal(up.newDeepest, true);
  assert.equal(diffSnapshot(base, { ...base, gold: 9, bank: 50 }).goldGained, 0, "a bank withdrawal is not loot");
  assert.equal(diffSnapshot(base, { ...base, gameID: "h" }).sameRun, false);
});

test("transition causes and depth labels", () => {
  assert.equal(transitionCause(13, []), "stairs");
  assert.equal(transitionCause(0, ["You fall through a trap door! You lose 3 hit points."]), "trapdoor");
  assert.equal(transitionCause(0, ["<b>You have been teleported</b>"]), "teleport");
  assert.deepEqual(depthLabel(0), { region: "THE TOWN OF ULARN", depth: "Surface" });
  assert.deepEqual(depthLabel(4), { region: "THE CAVES", depth: "Depth 4" });
  assert.deepEqual(depthLabel(17), { region: "THE VOLCANO", depth: "Depth V2" });
});

const harness = ({ settings = feelSettings(), reduced = false } = {}) => {
  const calls = [];
  const record = (sink) => new Proxy({}, { get: (_, name) => (...args) => calls.push([`${sink}.${String(name)}`, ...args]) });
  let now = 1000;
  const pending = [];
  const timers = { setTimeout: (fn, ms) => { pending.push(fn); return pending.length; }, clearTimeout: () => {} };
  const director = new FeedbackDirector({ sinks: { world: record("world"), hud: record("hud"), audio: record("audio") }, settings, reduced, now: () => now, timers });
  return { director, calls, names: () => calls.map(([name]) => name), flush: () => { while (pending.length) pending.shift()(); }, tick: (ms) => { now += ms; } };
};
const snap = (over = {}) => ({ gameID: "g", hp: 20, hpMax: 20, mana: 2, manaMax: 2, rank: 1, title: "novice", gold: 0, bank: 0,
  level: 1, deepest: 1, x: 5, y: 5, stats: {}, tiles: [{ x: 6, y: 5, id: 0, monster: { uid: 7 } }], log: [], ...over });

test("a kill layers flash, number, shake, hold and sound", async () => {
  const { director, names } = harness();
  director.onDamage({ level: 1, to: { x: 6, y: 5 }, uid: 7, amount: 5, maxHp: 5, killed: true, xp: 3, self: true });
  director.onUpdate(snap(), snap({ tiles: [] }));
  const seen = names();
  for (const name of ["world.hitMonster", "hud.floater", "world.shake", "world.hold", "audio.play"]) assert.ok(seen.includes(name), name);
});

test("reduced motion keeps numbers but drops shake and hit-stop", () => {
  const { director, names } = harness({ reduced: true });
  director.onDamage({ level: 1, to: { x: 6, y: 5 }, uid: 7, amount: 5, maxHp: 5, killed: true, self: true });
  director.onUpdate(snap(), snap());
  const seen = names();
  assert.ok(seen.includes("hud.floater"));
  assert.ok(!seen.includes("world.shake"));
  assert.ok(!seen.includes("world.hold"));
});

test("settings switch numbers and shake off", () => {
  const { director, names } = harness({ settings: feelSettings({ numbers: false, shake: 0 }) });
  director.onHurt({ level: 1, amount: 8, uid: 7, from: { x: 6, y: 5 }, self: true });
  director.onUpdate(snap(), snap({ hp: 12 }));
  const seen = names();
  assert.ok(seen.includes("hud.hurt"));
  assert.ok(!seen.includes("hud.floater"));
  assert.ok(!seen.includes("world.shake"));
});

test("other adventurers' events and room catch-up bursts are ignored", () => {
  const { director, names } = harness();
  director.onDamage({ level: 1, to: { x: 6, y: 5 }, uid: 7, amount: 5, killed: false, self: false });
  director.onUpdate(snap(), snap());
  assert.ok(!names().includes("world.hitMonster"));
  const burst = harness();
  for (let i = 0; i < 5; i++) {
    burst.director.onDamage({ level: 1, to: { x: 6, y: 5 }, uid: 7, amount: 1, killed: false, self: true });
    burst.director.onUpdate(snap(), snap());
  }
  assert.equal(burst.director.metrics().catchUps, 2);
  assert.equal(burst.names().filter((name) => name === "world.hitMonster").length, 3);
});

test("level-ups queue as large beats, low health raises a heartbeat", () => {
  const { director, calls, flush, tick } = harness();
  director.onUpdate(snap(), snap({ rank: 2, hpMax: 24, title: "apprentice" }));
  flush();
  const banner = calls.find(([name]) => name === "hud.levelUp");
  assert.deepEqual(banner[1], { rank: 2, title: "apprentice", deltas: ["+4 max HP"] });
  director.onUpdate(snap(), snap({ hp: 2 }));
  assert.deepEqual(calls.filter(([name]) => name === "audio.heartbeat").at(-1), ["audio.heartbeat", 100]);
  tick(10);
  director.onUpdate(snap({ hp: 2 }), snap({ hp: 2, over: true }));
  assert.deepEqual(calls.filter(([name]) => name === "audio.heartbeat").at(-1), ["audio.heartbeat", 0]);
});

test("floor changes show a card and stair-dancing skips the veil", () => {
  const { director, names, tick } = harness();
  assert.equal(director.beforeWorld(snap(), snap({ level: 2 })), "veil");
  tick(400);
  assert.equal(director.beforeWorld(snap({ level: 2 }), snap({ level: 1 })), "quick");
  tick(3000);
  assert.equal(director.beforeWorld(snap(), snap({ level: 2 })), "veil");
  director.onUpdate(snap(), snap({ level: 2, deepest: 2 }));
  assert.ok(names().includes("hud.depthCard"));
  assert.equal(director.beforeWorld(snap(), snap({ gameID: "other", level: 2 })), null);
});

test("reset clears queued work", () => {
  const { director } = harness();
  director.onDamage({ level: 1, to: { x: 6, y: 5 }, uid: 7, amount: 5, self: true });
  director.reset();
  assert.equal(director.metrics().queued, 0);
});
