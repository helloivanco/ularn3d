import test from "node:test";
import assert from "node:assert/strict";
import { handleSubmit, publicBoard } from "../supabase/functions/_shared/submit.js";
import { bootEngine, playInputs, scriptedRun } from "./lib/engine-session.mjs";

const scoreOf = (api) => (api.player.GOLD || 0) + (api.player.BANKACCOUNT || 0);

const replayLog = async ({ seed, log }) => {
  const played = await scriptedRun({
    seed,
    inputs: log.map((row) => row.action),
  });
  return {
    ok: true,
    score: scoreOf(played.api),
    depth: played.level,
    turns: played.gtime,
    won: false,
    checksum: played.checksum,
  };
};

const started = "2026-10-04T00:00:00.000Z";
const later = Date.parse(started) + 60_000;

test("a forged score, a reused run, a client seed, a fast run, and a non-host are rejected", async () => {
  const log = [{ action: "." }, { action: "." }];
  const run = {
    id: "run-1",
    user_id: "ada",
    mode: "solo",
    status: "started",
    seed: 2,
    started_at: started,
  };
  const forged = await handleSubmit({
    run,
    log,
    now: later,
    callerId: "ada",
    claimedScore: 999999,
    bodySeed: 1,
    replay: replayLog,
  });
  assert.equal(forged.verified, true);
  assert.notEqual(forged.score, 999999);
  assert.equal(forged.seed, 2);

  const reused = await handleSubmit({
    run: { ...run, status: "submitted" },
    log,
    now: later,
    callerId: "ada",
    replay: replayLog,
  });
  assert.equal(reused.reason, "reused");

  const fast = await handleSubmit({
    run,
    log: Array.from({ length: 40 }, () => ({ action: "." })),
    now: Date.parse(started) + 10,
    callerId: "ada",
    replay: replayLog,
  });
  assert.equal(fast.reason, "too_fast");

  const stranger = await handleSubmit({
    run: { ...run, mode: "coop" },
    log,
    now: later,
    callerId: "bea",
    isHost: false,
    replay: replayLog,
  });
  assert.equal(stranger.reason, "not_host");

  const tampered = await handleSubmit({
    run: { ...run, snapshotChecksum: "deadbeef" },
    log,
    now: later,
    callerId: "ada",
    replay: replayLog,
  });
  assert.equal(tampered.reason, "checksum_mismatch");
});

test("a recorded solo run and a recorded co-op run replay to the same score", async () => {
  const inputs = [".", ".", ".", "."];
  const log = inputs.map((action, seq) => ({ action, seq }));
  const seen = await replayLog({ seed: 2, log });
  const again = await handleSubmit({
    run: {
      user_id: "ada",
      mode: "solo",
      status: "started",
      seed: 2,
      started_at: started,
      snapshotChecksum: seen.checksum,
    },
    log,
    now: later,
    callerId: "ada",
    replay: replayLog,
  });
  assert.equal(again.score, seen.score);
  assert.equal(again.turns, 4);

  const coop = async () => {
    const api = bootEngine({ seed: 2 });
    api.enablePartyOfOne();
    api.addAdventurer("Bea");
    await playInputs(api, inputs);
    return scoreOf(api);
  };
  assert.equal(await coop(), await coop());
});

test("the public board hides unverified and flagged rows", () => {
  const rows = publicBoard([
    { mode: "solo", score: 10, verified: false, flagged: false, created_at: started },
    { mode: "solo", score: 50, verified: true, flagged: true, created_at: started },
    { mode: "solo", score: 20, verified: true, flagged: false, created_at: started },
    { mode: "coop", score: 80, verified: true, flagged: false, created_at: started },
  ], { mode: "solo" });
  assert.deepEqual(rows.map((row) => row.score), [20]);
});
