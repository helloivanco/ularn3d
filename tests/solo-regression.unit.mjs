/**
 * Solo regression lock. A fixed seed and 500 waits must checksum the same
 * before and after the multi-adventurer refactor. Party-of-one uses the
 * adventurer list and must land on that same gameplay checksum.
 * Headless replay of the recorded input log must match the first run.
 *
 * Run: node --test tests/solo-regression.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { scriptedRun, bootEngine, playInputs } from "./lib/engine-session.mjs";

const SEED = 2;
const TURNS = 500;
const INPUTS = Array.from({ length: TURNS }, () => ".");
/** Captured from the seeded solo engine. Do not edit without a fresh pre-change run. */
const GOLDEN = "f929932600d427c3";

test("500-turn solo seed matches the golden checksum", async () => {
  const first = await scriptedRun({ seed: SEED, inputs: INPUTS });
  const second = await scriptedRun({ seed: SEED, inputs: INPUTS });
  assert.equal(first.gtime, TURNS);
  assert.equal(first.hp, 10);
  assert.equal(first.x, 27);
  assert.equal(first.y, 9);
  assert.equal(first.level, 0);
  assert.equal(first.checksum, second.checksum);
  assert.equal(first.checksum, GOLDEN);
});

test("party of one matches the solo checksum", async () => {
  const solo = await scriptedRun({ seed: SEED, inputs: INPUTS });
  const party = await scriptedRun({ seed: SEED, inputs: INPUTS, partyOfOne: true });
  assert.equal(party.checksum, solo.checksum);
  assert.equal(party.gtime, solo.gtime);
  assert.equal(party.hp, solo.hp);
  assert.equal(party.x, solo.x);
  assert.equal(party.y, solo.y);
  assert.equal(party.level, solo.level);
});

test("headless replay of the input log matches the original checksum", async () => {
  const original = await scriptedRun({ seed: SEED, inputs: INPUTS });
  const replay = await scriptedRun({
    seed: SEED,
    inputs: original.log.map((row) => row.action),
  });
  assert.equal(replay.checksum, original.checksum);
  assert.equal(original.log.length, TURNS);
  assert.equal(original.log[0].turn, 1);
  assert.equal(original.log[TURNS - 1].turn, TURNS);
});

test("state diff applies back to the same checksum", async () => {
  const api = bootEngine({ seed: SEED });
  const before = api.captureGameState();
  await playInputs(api, INPUTS.slice(0, 25));
  const after = api.captureGameState();
  const applied = api.applyDiff(before, api.diffState(before, after));
  assert.equal(api.checksumGameState(applied), api.checksumGameState(after));
  assert.notEqual(api.checksumGameState(before), api.checksumGameState(after));
});

test("a second adventurer is a separate hero and solo globals restore", async () => {
  const api = bootEngine({ seed: SEED });
  const origin = { x: api.player.x, y: api.player.y, hp: api.player.HP };
  api.enablePartyOfOne();
  const slot = api.addAdventurer("Second");
  assert.equal(slot, 1);
  assert.equal(api.partySize(), 2);
  assert.equal(api.player.x, origin.x);
  assert.equal(api.player.y, origin.y);
  assert.equal(api.player.HP, origin.hp);
  api.activateAdventurer(1);
  assert.equal(api.logname, "Second");
  assert.equal(api.level, 0);
  assert.ok(api.player.HP > 0);
  const ally = { x: api.player.x, y: api.player.y, hp: api.player.HP };
  api.activateAdventurer(0);
  assert.equal(api.player.x, origin.x);
  assert.equal(api.player.y, origin.y);
  assert.equal(api.player.HP, origin.hp);
  api.activateAdventurer(1);
  assert.equal(api.player.x, ally.x);
  assert.equal(api.player.y, ally.y);
  assert.equal(api.player.HP, ally.hp);
});
