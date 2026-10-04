// Submit a finished run. The service role key is read from the function secret
// SUPABASE_SERVICE_ROLE_KEY. Do not put that value in the repo.
//
// verify_jwt must stay on. This function trusts the Authorization bearer token
// and does not sign the caller in itself. Turning verify_jwt off would let an
// unsigned request pick a user id.
//
// The replay engine is bundled as gzip parts (see engine-boot.js). A cold start
// does not download it from GitHub. Hosted isolates that cannot fit those parts
// read the same bytes from private.replay_engine_part.
//
// The function replays the log in a headless engine and inserts that score.
// The request body does not choose the number. A log that cannot finish inside
// the free-plan CPU budget is rejected as replay_cpu_cap. Other runs still verify.

import {
  callerIsCurrentHost,
  callerMaySubmit,
  handleSubmit,
  rejectionUpdatesRun,
} from "../_shared/submit.js";
import { replayFinishedRun } from "../_shared/replay.js";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });

export const decide = (input) => handleSubmit(input);

const publishVerifiedScore = async (admin, run, decision) => {
  const profile = await admin.from("profiles").select("display_name").eq("user_id", run.user_id).maybeSingle();
  if (profile?.error) {
    return {
      decision: { ok: false, status: "rejected", verified: false, reason: "unavailable" },
      updateRun: false,
    };
  }
  const displayName = profile?.data?.display_name;
  if (!displayName) {
    await admin.from("runs").update({
      status: "rejected",
      reject_reason: "missing_profile",
      input_hash: null,
    }).eq("id", run.id).eq("status", "started");
    return {
      decision: { ok: false, status: "rejected", verified: false, reason: "missing_profile" },
      updateRun: true,
    };
  }
  const inserted = await admin.from("scores").insert({
    run_id: run.id,
    user_id: run.user_id,
    display_name: displayName,
    mode: run.mode,
    party_size: run.party_size || 1,
    score: decision.score,
    depth_reached: decision.depth ?? 0,
    turns: decision.turns ?? 0,
    won: !!decision.won,
    killed_by: decision.killedBy || "",
    engine_version: decision.engineVersion || run.engine_version || "",
    verified: true,
    flagged: false,
  });
  if (inserted?.error && inserted.error.code !== "23505") {
    return {
      decision: { ok: false, status: "rejected", verified: false, reason: "unavailable" },
      updateRun: false,
    };
  }
  const updated = await admin.from("runs").update({
    status: "verified",
    reject_reason: null,
    input_hash: decision.checksum || null,
  }).eq("id", run.id).eq("status", "started");
  if (updated?.error) {
    return {
      decision: { ok: false, status: "rejected", verified: false, reason: "unavailable" },
      updateRun: false,
    };
  }
  return { decision, updateRun: true };
};

/**
 * Load the run, recognize the room's current host, replay the log, and insert
 * the verified score. Unauthorized callers and the rate limit do not change
 * the run. Pass `replay` only from tests that need a stand-in.
 */
export const acceptScore = async ({
  admin,
  body,
  callerId,
  now = Date.now(),
  ip = "",
  replay = replayFinishedRun,
}) => {
  const loaded = await admin.from("runs").select("*").eq("id", body?.run_id).maybeSingle();
  const run = loaded?.data ?? null;
  let hostUserId = null;
  let member = null;
  if (run?.mode === "coop" && run.room_id) {
    const room = await admin.from("rooms").select("host_user_id").eq("id", run.room_id).maybeSingle();
    hostUserId = room?.data?.host_user_id ?? null;
    const seated = await admin
      .from("room_members")
      .select("role,banned")
      .eq("room_id", run.room_id)
      .eq("user_id", callerId)
      .maybeSingle();
    member = seated?.data ?? null;
  }
  const isHost = callerIsCurrentHost({ callerId, hostUserId, member });
  const allowed = callerMaySubmit({ run, callerId, isHost });
  let recentSubmits = 0;
  if (allowed && run?.status === "started") {
    const noted = await admin.rpc("note_score_submit", {
      p_user_id: callerId,
      p_ip: ip || "",
    });
    if (noted?.error) {
      return {
        decision: { ok: false, status: "rejected", verified: false, reason: "unavailable" },
        updateRun: false,
        isHost,
      };
    }
    recentSubmits = Number(noted?.data ?? 0);
  }
  const decision = await handleSubmit({
    run,
    log: body?.log,
    now,
    callerId,
    isHost,
    recentSubmits,
    claimedScore: body?.score,
    bodySeed: body?.seed,
    replay,
  });
  if (decision.verified) {
    const published = await publishVerifiedScore(admin, run, decision);
    return { decision: published.decision, updateRun: published.updateRun, isHost };
  }
  const updateRun = decision.status === "rejected"
    && rejectionUpdatesRun({ run, callerId, isHost, reason: decision.reason });
  if (updateRun) {
    await admin.from("runs").update({
      status: "rejected",
      reject_reason: decision.reason,
      input_hash: null,
    }).eq("id", run.id).eq("status", "started");
  }
  return { decision, updateRun, isHost };
};

const userIdFrom = (header) => {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const text = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(text).sub || null;
  } catch {
    return null;
  }
};

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const callerId = userIdFrom(request.headers.get("Authorization"));
    if (!callerId) return json({ ok: false, error: "unauthenticated" }, 401);
    const body = await request.json().catch(() => ({}));
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ ok: false, error: "unavailable" }, 503);
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const forwarded = request.headers.get("x-forwarded-for") || "";
    const ip = forwarded.split(",")[0].trim();
    const outcome = await acceptScore({
      admin,
      body,
      callerId,
      ip,
    });
    if (outcome.decision.reason === "unavailable") return json({ ok: false, error: "unavailable" }, 503);
    return json({ ok: outcome.decision.verified === true, ...outcome.decision });
  });
}
