/** Submission gates shared by the Edge Function and the node tests. No score number is trusted. */

export const MIN_MS_PER_TURN = 50;
export const MAX_LOG_CHARS = 500_000;
export const SUBMIT_LIMIT = 5;

const reject = (reason) => ({ ok: false, reason });

export const assessSubmission = ({
  run,
  log,
  now,
  callerId,
  isHost = false,
  recentSubmits = 0,
  banned = false,
}) => {
  if (banned) return reject("banned");
  if (!run) return reject("missing_run");
  if (run.status !== "started") return reject("reused");
  if (run.mode === "coop" && !isHost) return reject("not_host");
  if (callerId && run.user_id !== callerId && !isHost) return reject("not_owner");
  if (recentSubmits >= SUBMIT_LIMIT) return reject("rate_limited");
  if (!Array.isArray(log)) return reject("bad_log");
  if (JSON.stringify(log).length > MAX_LOG_CHARS) return reject("too_large");
  const started = Date.parse(run.started_at);
  if (Number.isFinite(started) && now < started) return reject("future");
  if (log.length > 0 && Number.isFinite(started) && now - started < log.length * MIN_MS_PER_TURN) {
    return reject("too_fast");
  }
  return { ok: true, turns: log.length };
};

/** The room's current host: rooms.host_user_id, still seated as host. */
export const callerIsCurrentHost = ({ callerId, hostUserId, member }) => {
  if (!callerId || !hostUserId || callerId !== hostUserId) return false;
  if (!member || member.role !== "host" || member.banned === true) return false;
  return true;
};

/** Solo owner, or the current host of a co-op room. Banned callers are not allowed. */
export const callerMaySubmit = ({ run, callerId, isHost, banned = false }) => {
  if (banned || !run || !callerId) return false;
  if (run.mode === "coop") return isHost === true;
  return run.user_id === callerId;
};

/**
 * Only an allowed submitter's own bad log rejects the run.
 * not_owner, not_host, and the rate limit leave status untouched.
 */
export const rejectionUpdatesRun = ({ run, callerId, isHost, banned = false, reason }) => {
  if (!callerMaySubmit({ run, callerId, isHost, banned })) return false;
  if (reason === "not_owner" || reason === "not_host" || reason === "rate_limited" || reason === "unavailable") {
    return false;
  }
  return true;
};

export const handleSubmit = async ({
  run,
  log,
  now,
  callerId,
  isHost = false,
  recentSubmits = 0,
  banned = false,
  claimedScore = null,
  bodySeed = null,
  replay,
}) => {
  void claimedScore;
  void bodySeed;
  const gate = assessSubmission({ run, log, now, callerId, isHost, recentSubmits, banned });
  if (!gate.ok) return { status: "rejected", verified: false, reason: gate.reason };
  if (typeof replay !== "function") {
    return { status: "rejected", verified: false, reason: "replay_unavailable" };
  }
  const played = await replay({ seed: run.seed, log, mode: run.mode });
  if (!played?.ok) return { status: "rejected", verified: false, reason: played?.reason || "replay_failed" };
  if (run.snapshotChecksum && played.checksum !== run.snapshotChecksum) {
    return { status: "rejected", verified: false, reason: "checksum_mismatch" };
  }
  return {
    status: "verified",
    verified: true,
    reason: null,
    score: played.score,
    depth: played.depth,
    turns: played.turns,
    won: !!played.won,
    killedBy: played.killedBy || "",
    seed: run.seed,
  };
};

/** Client-side view of the public board. RLS is the real gate. */
export const publicBoard = (rows, { mode, since } = {}) =>
  (rows || [])
    .filter((row) => row.verified && !row.flagged)
    .filter((row) => !mode || row.mode === mode)
    .filter((row) => !since || Date.parse(row.created_at) >= Date.parse(since))
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);
