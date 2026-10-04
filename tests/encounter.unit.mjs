/**
 * Encounter groups, the turn timer, and co-op doubling.
 * Run: node --test tests/encounter.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { bootEngine } from "./lib/engine-session.mjs";

const loadEncounter = () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${readFileSync("public/engine/aura.js", "utf8")}\n${readFileSync("public/engine/encounter.js", "utf8")}`,
    context,
    { filename: "encounter.js" },
  );
  return context;
};

const countMonsters = (api, depth) => {
  const floor = api.LEVELS[depth];
  let count = 0;
  for (const column of floor?.monsters || []) {
    if (!column) continue;
    for (const monster of column) if (monster) count += 1;
  }
  return count;
};

test("overlapping auras share a turn and a lone adventurer acts freely", () => {
  const api = loadEncounter();
  const left = { slot: 0, x: 10, y: 10, dungeon: 2, name: "Ada" };
  const right = { slot: 1, x: 12, y: 10, dungeon: 2, name: "Bea" };
  const far = { slot: 2, x: 50, y: 10, dungeon: 2, name: "Cid" };
  assert.equal(api.aurasOverlap(left, right), true);
  assert.equal(api.aurasOverlap(left, far), false);
  const groups = api.encounterGroups([far, right, left]);
  const shared = groups.find((group) => group.length === 2);
  assert.equal(shared.map((member) => member.slot).join(","), "0,1");
  assert.equal(api.actorMayAct(0, groups), true);
  assert.equal(api.actorMayAct(1, groups), false);
  assert.equal(api.actorMayAct(2, groups), true);
  api.noteActorMoved(0, groups);
  assert.equal(api.actorMayAct(1, groups), true);
  assert.equal(api.actorMayAct(0, groups), false);
  api.noteActorMoved(1, groups);
  assert.equal(api.actorMayAct(0, groups), true);
});

test("the turn timer auto-rests and can be switched off", () => {
  const api = loadEncounter();
  assert.equal(api.timedAction("h", 0, 19999, 20), "h");
  assert.equal(api.timedAction("h", 0, 20000, 20), ".");
  assert.equal(api.timedAction("h", 0, 99999, 0), "h");
  assert.equal(api.timedAction("h", 0, 99999, null), "h");
});

test("co-op doubles normal monsters and a party of one does not", () => {
  const solo = bootEngine({ seed: 4 });
  const coop = bootEngine({ seed: 4 });
  coop.enablePartyOfOne();
  assert.equal(coop.coopMultiplier(), 1);
  coop.addAdventurer("Bea");
  assert.equal(coop.coopMultiplier(), 2);
  solo.newcavelevel(1);
  coop.newcavelevel(1);
  const soloMonsters = countMonsters(solo, 1);
  const coopMonsters = countMonsters(coop, 1);
  assert.ok(soloMonsters > 0);
  assert.ok(coopMonsters > soloMonsters);
});
