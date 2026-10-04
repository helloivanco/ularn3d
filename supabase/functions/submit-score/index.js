// Submit a finished run. The service role key is read from the function secret
// SUPABASE_SERVICE_ROLE_KEY. Do not put that value in the repo.
//
// The classic engine is a browser script. Replaying it inside this isolate
// needs Node's vm plus a DOM stand-in, and a long run can pass the free-plan
// 2 second CPU cap. This function therefore records the log and rejects the
// run with replay_unavailable unless a replay hook is injected by tests.
// Rejected and unverified runs are not inserted into the public scores table.

import {
  callerIsCurrentHost,
  callerMaySubmit,
  handleSubmit,
  rejectionUpdatesRun,
} from "../_shared/submit.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const decide = (input) => handleSubmit(input);

/**
 * Load the run, recognize the room's current host, and record a score attempt
 * in private.score_submits. Unauthorized callers and the rate limit do not
 * change the run. Replay stays unavailable unless a test injects one.
 */
export const acceptScore = async ({ admin, body, callerId, now = Date.now(), ip = "", replay }) => {
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
      replay: async () => ({ ok: false, reason: "replay_unavailable" }),
    });
    if (outcome.decision.reason === "unavailable") return json({ ok: false, error: "unavailable" }, 503);
    return json({ ok: outcome.decision.verified === true, ...outcome.decision });
  });
}
