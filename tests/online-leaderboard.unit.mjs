import test from "node:test";
import assert from "node:assert/strict";
import { handleSubmit, publicBoard } from "../supabase/functions/_shared/submit.js";
import { replayFinishedRun } from "../supabase/functions/_shared/replay.js";
import { bootEngine, playInputs } from "./lib/engine-session.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { concatEngineFiles } from "../supabase/functions/_shared/engine-files.js";
import { ENGINE_SOURCE } from "../supabase/functions/_shared/engine-source.js";
import { ENGINE_SOURCE_SHA256, extractEngineBundle, forceEngineContext } from "../supabase/functions/_shared/engine-boot.js";

const scoreOf = (api) => (api.player.GOLD || 0) + (api.player.BANKACCOUNT || 0);

const replayLog = (input) => replayFinishedRun({ ...input, mode: input.mode || "solo" });

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
  const nodeCoop = await coop();
  assert.equal(nodeCoop, await coop());
  const hosted = await replayFinishedRun({ seed: 2, log, mode: "coop" });
  assert.equal(hosted.ok, true);
  assert.equal(hosted.score, nodeCoop);
  const decided = await handleSubmit({
    run: {
      user_id: "ada",
      mode: "coop",
      status: "started",
      seed: 2,
      started_at: started,
      snapshotChecksum: hosted.checksum,
    },
    log,
    now: later,
    callerId: "ada",
    isHost: true,
    claimedScore: 999999,
    replay: replayFinishedRun,
  });
  assert.equal(decided.verified, true);
  assert.equal(decided.score, nodeCoop);
  assert.notEqual(decided.score, 999999);
});

test("the edge script sandbox matches a vm replay", async () => {
  const inputs = [".", ".", ".", "."];
  const vm = bootEngine({ seed: 2, context: "vm" });
  await playInputs(vm, inputs);
  const vmState = vm.captureGameState();
  vmState.party = null;
  const script = bootEngine({ seed: 2, context: "script" });
  await playInputs(script, inputs);
  const scriptState = script.captureGameState();
  scriptState.party = null;
  assert.equal(script.checksumGameState(scriptState), vm.checksumGameState(vmState));
  assert.equal(script.__replayScore().score, vm.__replayScore().score);

  const coopVm = bootEngine({ seed: 2, context: "vm" });
  coopVm.enablePartyOfOne();
  coopVm.addAdventurer("Bea");
  await playInputs(coopVm, inputs);
  const coopScript = bootEngine({ seed: 2, context: "script" });
  coopScript.enablePartyOfOne();
  coopScript.addAdventurer("Bea");
  await playInputs(coopScript, inputs);
  assert.equal(coopScript.__replayScore().score, coopVm.__replayScore().score);

  const long = bootEngine({ seed: 2, context: "script" });
  await playInputs(long, Array.from({ length: 500 }, () => "."));
  const longState = long.captureGameState();
  longState.party = null;
  assert.equal(long.gtime, 500);
  assert.equal(long.checksumGameState(longState), "6be9109be59dae15");

  forceEngineContext("script");
  try {
    const played = await replayFinishedRun({ seed: 2, log: inputs, mode: "solo" });
    assert.equal(played.ok, true);
    assert.equal(played.checksum, vm.checksumGameState(vmState));
    const coop = await replayFinishedRun({ seed: 2, log: inputs, mode: "coop" });
    assert.equal(coop.ok, true);
    assert.equal(coop.score, coopVm.__replayScore().score);
  } finally {
    forceEngineContext(null);
  }
});

test("the edge bundle matches the engine scripts on disk", async () => {
  const built = concatEngineFiles((rel) => readFileSync(`public/engine/${rel}`, "utf8"));
  const packed = readFileSync("supabase/functions/_shared/engine-source.js", "utf8");
  assert.equal(ENGINE_SOURCE, built);
  assert.equal(extractEngineBundle(packed), built);
  assert.equal(createHash("sha256").update(packed).digest("hex"), ENGINE_SOURCE_SHA256);
  const { gunzipSync } = await import("node:zlib");
  const { BUNDLED_ENGINE_SHA256, ENGINE_PART_COUNT } = await import("../supabase/functions/_shared/engine-bundle-meta.js");
  let b64 = "";
  for (let i = 0; i < ENGINE_PART_COUNT; i++) {
    const part = await import(`../supabase/functions/_shared/engine-part-${i}.js`);
    b64 += part.PART;
  }
  const source = gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
  assert.equal(source, built);
  assert.equal(createHash("sha256").update(source).digest("hex"), BUNDLED_ENGINE_SHA256);
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
