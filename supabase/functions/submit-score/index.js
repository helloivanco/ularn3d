// Submit a finished run. The service role key is read from the function secret
// SUPABASE_SERVICE_ROLE_KEY. Do not put that value in the repo.
//
// The classic engine is a browser script. Replaying it inside this isolate
// needs Node's vm plus a DOM stand-in, and a long run can pass the free-plan
// 2 second CPU cap. This function therefore records the log and rejects the
// run with replay_unavailable unless a replay hook is injected by tests.
// Rejected and unverified runs are not inserted into the public scores table.

import { handleSubmit } from "../_shared/submit.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const decide = (input) => handleSubmit(input);

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
    const loaded = await admin.from("runs").select("*").eq("id", body.run_id).maybeSingle();
    const run = loaded.data;
    const decision = await decide({
      run,
      log: body.log,
      now: Date.now(),
      callerId,
      isHost: false,
      claimedScore: body.score,
      bodySeed: body.seed,
      replay: async () => ({ ok: false, reason: "replay_unavailable" }),
    });
    if (run && decision.status === "rejected") {
      await admin.from("runs").update({
        status: "rejected",
        reject_reason: decision.reason,
        input_hash: null,
      }).eq("id", run.id).eq("status", "started");
    }
    return json({ ok: decision.verified === true, ...decision });
  });
}
