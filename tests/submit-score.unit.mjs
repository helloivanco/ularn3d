/**
 * The current room host can submit a co-op run. A stranger who knows the
 * run id does not change it. The rate limit counts score_submits, not run status.
 *
 * Run: node --test tests/submit-score.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { acceptScore } from "../supabase/functions/submit-score/index.js";
import { MAX_REPLAY_TURNS, replayFinishedRun } from "../supabase/functions/_shared/replay.js";
import { bootEngine, playInputs } from "./lib/engine-session.mjs";

const started = "2026-10-04T00:00:00.000Z";
const later = Date.parse(started) + 60_000;
const roomId = "room-1";

const memory = ({ run, hostUserId = null, member = null, already = 0, profile = { display_name: "Ada" } }) => {
  const submits = Array.from({ length: already }, () => ({ user_id: "seed" }));
  const updates = [];
  const inserts = [];
  const chain = (data) => {
    const api = {
      select() { return api; },
      eq() { return api; },
      update(patch) {
        updates.push(patch);
        return api;
      },
      insert(row) {
        inserts.push(row);
        return { error: null };
      },
      maybeSingle: async () => ({ data }),
    };
    return api;
  };
  return {
    submits,
    updates,
    inserts,
    from(table) {
      if (table === "runs") return chain(run);
      if (table === "rooms") return chain(hostUserId ? { host_user_id: hostUserId } : null);
      if (table === "room_members") return chain(member);
      if (table === "profiles") return chain(profile);
      if (table === "scores") return chain(null);
      return chain(null);
    },
    rpc: async (name, args) => {
      assert.equal(name, "note_score_submit");
      const recent = submits.length;
      if (recent < 5) submits.push({ user_id: args.p_user_id, ip: args.p_ip });
      return { data: recent };
    },
  };
};

const hostMember = { role: "host", banned: false };
const log = [{ action: "." }, { action: "." }];

test("the current host is recognized, and a later host still is", async () => {
  const run = {
    id: "run-1",
    user_id: "ada",
    mode: "coop",
    status: "started",
    room_id: roomId,
    seed: 2,
    started_at: started,
  };
  const admin = memory({ run, hostUserId: "ada", member: hostMember });
  const outcome = await acceptScore({
    admin,
    body: { run_id: run.id, log, score: 999999, seed: 1 },
    callerId: "ada",
    now: later,
    replay: async () => ({ ok: true, score: 12, depth: 1, turns: 2, won: false, checksum: "abc" }),
  });
  assert.equal(outcome.isHost, true);
  assert.equal(outcome.decision.verified, true);
  assert.equal(outcome.decision.score, 12);
  assert.equal(outcome.decision.seed, 2);
  assert.notEqual(admin.inserts[0].score, 999999);
  assert.equal(admin.inserts[0].score, 12);
  assert.equal(admin.inserts[0].verified, true);
  assert.equal(admin.inserts[0].display_name, "Ada");
  assert.equal(outcome.updateRun, true);
  assert.equal(admin.updates[0].status, "verified");
  assert.equal(admin.submits.length, 1);

  const transferred = memory({
    run,
    hostUserId: "bea",
    member: hostMember,
  });
  const nextHost = await acceptScore({
    admin: transferred,
    body: { run_id: run.id, log },
    callerId: "bea",
    now: later,
    replay: async () => ({ ok: false, reason: "replay_unavailable" }),
  });
  assert.equal(nextHost.isHost, true);
  assert.equal(nextHost.decision.reason, "replay_unavailable");
  assert.equal(nextHost.updateRun, true);
  assert.equal(transferred.updates[0].status, "rejected");
  assert.equal(transferred.updates[0].reject_reason, "replay_unavailable");
});

test("not_host and not_owner leave the run started and do not record an attempt", async () => {
  const coop = {
    id: "run-coop",
    user_id: "ada",
    mode: "coop",
    status: "started",
    room_id: roomId,
    seed: 2,
    started_at: started,
  };
  const stranger = memory({ run: coop, hostUserId: "ada", member: { role: "player", banned: false } });
  const refused = await acceptScore({
    admin: stranger,
    body: { run_id: coop.id, log },
    callerId: "bea",
    now: later,
    replay: async () => ({ ok: true, score: 1, depth: 0, turns: 2 }),
  });
  assert.equal(refused.decision.reason, "not_host");
  assert.equal(refused.updateRun, false);
  assert.equal(stranger.updates.length, 0);
  assert.equal(stranger.submits.length, 0);
  assert.equal(coop.status, "started");

  const former = memory({ run: coop, hostUserId: "bea", member: { role: "player", banned: false } });
  const dropped = await acceptScore({
    admin: former,
    body: { run_id: coop.id, log },
    callerId: "ada",
    now: later,
    replay: async () => ({ ok: true, score: 1, depth: 0, turns: 2 }),
  });
  assert.equal(dropped.decision.reason, "not_host");
  assert.equal(dropped.updateRun, false);
  assert.equal(former.submits.length, 0);

  const solo = {
    id: "run-solo",
    user_id: "ada",
    mode: "solo",
    status: "started",
    seed: 2,
    started_at: started,
  };
  const other = memory({ run: solo });
  const owned = await acceptScore({
    admin: other,
    body: { run_id: solo.id, log },
    callerId: "bea",
    now: later,
    replay: async () => ({ ok: true, score: 1, depth: 0, turns: 2 }),
  });
  assert.equal(owned.decision.reason, "not_owner");
  assert.equal(owned.updateRun, false);
  assert.equal(other.updates.length, 0);
  assert.equal(other.submits.length, 0);
  assert.equal(solo.status, "started");
});

test("the owner can still reject a tampered or impossible log", async () => {
  const run = {
    id: "run-solo",
    user_id: "ada",
    mode: "solo",
    status: "started",
    seed: 2,
    started_at: started,
    snapshotChecksum: "deadbeef",
  };
  const tampered = memory({ run });
  const bad = await acceptScore({
    admin: tampered,
    body: { run_id: run.id, log, score: 999999 },
    callerId: "ada",
    now: later,
    replay: async () => ({ ok: true, score: 4, depth: 0, turns: 2, checksum: "abc" }),
  });
  assert.equal(bad.decision.reason, "checksum_mismatch");
  assert.equal(bad.updateRun, true);
  assert.equal(tampered.updates[0].reject_reason, "checksum_mismatch");
  assert.equal(tampered.submits.length, 1);

  const fast = memory({ run });
  const impossible = await acceptScore({
    admin: fast,
    body: { run_id: run.id, log: Array.from({ length: 40 }, () => ({ action: "." })) },
    callerId: "ada",
    now: Date.parse(started) + 10,
    replay: async () => ({ ok: true, score: 1, depth: 0, turns: 40, checksum: "deadbeef" }),
  });
  assert.equal(impossible.decision.reason, "too_fast");
  assert.equal(impossible.updateRun, true);
  assert.equal(fast.updates[0].status, "rejected");
});

test("five recorded attempts rate-limit the next one without rejecting the run", async () => {
  const run = {
    id: "run-solo",
    user_id: "ada",
    mode: "solo",
    status: "started",
    seed: 2,
    started_at: started,
  };
  const admin = memory({ run, already: 5 });
  const limited = await acceptScore({
    admin,
    body: { run_id: run.id, log },
    callerId: "ada",
    now: later,
    replay: async () => ({ ok: true, score: 9, depth: 1, turns: 2, checksum: "abc" }),
  });
  assert.equal(limited.decision.reason, "rate_limited");
  assert.equal(limited.updateRun, false);
  assert.equal(admin.updates.length, 0);
  assert.equal(admin.submits.length, 5);
  assert.equal(run.status, "started");
});

const scoreOf = (api) => (api.player.GOLD || 0) + (api.player.BANKACCOUNT || 0);

test("a solo run and a co-op run replay inside submit and land on the board", async () => {
  const inputs = [".", ".", ".", "."];
  const log = inputs.map((action, seq) => ({ action, seq }));
  const soloPlayed = await replayFinishedRun({ seed: 2, log, mode: "solo" });
  assert.equal(soloPlayed.ok, true);
  const solo = {
    id: "run-live-solo",
    user_id: "ada",
    mode: "solo",
    status: "started",
    seed: 2,
    party_size: 1,
    engine_version: soloPlayed.engineVersion,
    started_at: started,
    snapshotChecksum: soloPlayed.checksum,
  };
  const soloAdmin = memory({ run: solo });
  const soloScore = await acceptScore({
    admin: soloAdmin,
    body: { run_id: solo.id, log, score: 999999, seed: 1 },
    callerId: "ada",
    now: later,
  });
  assert.equal(soloScore.decision.verified, true);
  assert.equal(soloScore.decision.score, soloPlayed.score);
  assert.notEqual(soloScore.decision.score, 999999);
  assert.equal(soloAdmin.inserts[0].score, soloPlayed.score);
  assert.equal(soloAdmin.inserts[0].verified, true);
  assert.equal(soloAdmin.inserts[0].flagged, false);
  assert.equal(soloAdmin.updates.at(-1).status, "verified");

  const coopNode = async () => {
    const api = bootEngine({ seed: 2 });
    api.enablePartyOfOne();
    api.addAdventurer("Bea");
    await playInputs(api, inputs);
    return scoreOf(api);
  };
  const expected = await coopNode();
  const coopPlayed = await replayFinishedRun({ seed: "2", log, mode: "coop" });
  assert.equal(coopPlayed.ok, true);
  assert.equal(coopPlayed.score, expected);
  const coop = {
    id: "run-live-coop",
    user_id: "ada",
    mode: "coop",
    status: "started",
    room_id: roomId,
    seed: "2",
    party_size: 2,
    engine_version: coopPlayed.engineVersion,
    started_at: started,
    snapshotChecksum: coopPlayed.checksum,
  };
  const coopAdmin = memory({ run: coop, hostUserId: "ada", member: hostMember });
  const coopScore = await acceptScore({
    admin: coopAdmin,
    body: { run_id: coop.id, log, score: 999999 },
    callerId: "ada",
    now: later,
  });
  assert.equal(coopScore.isHost, true);
  assert.equal(coopScore.decision.verified, true);
  assert.equal(coopScore.decision.score, expected);
  assert.equal(coopAdmin.inserts[0].score, expected);
  assert.equal(coopAdmin.inserts[0].mode, "coop");
  assert.equal(coopAdmin.updates.at(-1).status, "verified");
});

test("a huge log is replay_cpu_cap for the owner and does not burn a stranger's run", async () => {
  const huge = Array.from({ length: MAX_REPLAY_TURNS + 1 }, () => ({ action: "." }));
  const longAgo = "2020-01-01T00:00:00.000Z";
  const run = {
    id: "run-huge",
    user_id: "ada",
    mode: "solo",
    status: "started",
    seed: 2,
    started_at: longAgo,
    engine_version: "1.3.37",
  };
  let booted = false;
  const owner = memory({ run });
  const capped = await acceptScore({
    admin: owner,
    body: { run_id: run.id, log: huge, score: 999999 },
    callerId: "ada",
    now: Date.parse(longAgo) + huge.length * 50 + 5000,
    replay: (input) => replayFinishedRun({ ...input, onBoot: () => { booted = true; } }),
  });
  assert.equal(capped.decision.reason, "replay_cpu_cap");
  assert.equal(booted, false);
  assert.equal(capped.updateRun, true);
  assert.equal(owner.updates[0].reject_reason, "replay_cpu_cap");
  assert.equal(owner.inserts.length, 0);
  assert.equal(run.status, "started");

  const stranger = memory({ run });
  const refused = await acceptScore({
    admin: stranger,
    body: { run_id: run.id, log: huge },
    callerId: "bea",
    now: Date.parse(longAgo) + huge.length * 50 + 5000,
  });
  assert.equal(refused.decision.reason, "not_owner");
  assert.equal(refused.updateRun, false);
  assert.equal(stranger.updates.length, 0);
  assert.equal(stranger.inserts.length, 0);
  assert.equal(stranger.submits.length, 0);
});

test("a replay that runs past the CPU budget is refused without failing a short one", async () => {
  const log = [{ action: "." }, { action: "." }, { action: "." }, { action: "." }];
  let ticks = 0;
  const slow = await replayFinishedRun({
    seed: 2,
    log,
    mode: "solo",
    clock: () => {
      ticks += 1;
      return ticks < 3 ? 0 : 10_000;
    },
    budgetMs: 1000,
  });
  assert.equal(slow.reason, "replay_cpu_cap");

  const quick = await replayFinishedRun({ seed: 2, log, mode: "solo" });
  assert.equal(quick.ok, true);
  assert.equal(quick.turns, 4);
});
