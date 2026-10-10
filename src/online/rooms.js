import { getSupabase, readOnlineEnv } from "./config.js";
import { ensureOnlineSession } from "./session.js";

const rpc = async (name, args) => {
  try {
    const supabase = await getSupabase();
    if (!supabase) return { ok: false, error: "unavailable" };
    const result = await supabase.rpc(name, args);
    if (result.error) return { ok: false, error: "unavailable" };
    return result.data ?? { ok: false, error: "unavailable" };
  } catch { return { ok: false, error: "unavailable" }; }
};

export const hostRoom = async ({ displayName, password, isPublic, maxPlayers, turnTimer = 0, character = "Adventurer" }) => {
  const session = await ensureOnlineSession();
  if (!session.ok) return session;
  return rpc("create_room_as", {
    p_password: password || null,
    p_is_public: isPublic,
    p_max_players: maxPlayers,
    p_turn_timer_s: turnTimer,
    p_display_name: displayName,
    p_character_class: character,
  });
};

export const recentChat = async (roomId) => {
  const supabase = await getSupabase();
  if (!supabase || !roomId) return [];
  const result = await supabase.rpc("recent_chat", { p_room_id: roomId });
  if (result.error || !Array.isArray(result.data)) return [];
  return result.data.slice(-50);
};

export const enterRoom = async ({ code, password, role, character = "Adventurer", displayName }) => {
  const session = await ensureOnlineSession({ displayName });
  if (!session.ok) return session;
  const joined = await rpc("join_room_as", {
    p_code: code,
    p_password: password || null,
    p_role: role,
    p_character_class: character,
  });
  if (!joined?.ok) return joined;
  return { ...joined, chat: await recentChat(joined.room_id) };
};

export const listPublicRooms = async () => {
  const session = await ensureOnlineSession();
  if (!session.ok) return [];
  const listed = await rpc("browse_rooms", {});
  return Array.isArray(listed) ? listed : [];
};

export const beginRun = async ({ mode, roomId, engineVersion, difficulty = 0 }) =>
  mode === "coop" ? rpc("start_room", {
    p_room_id: roomId, p_engine_version: engineVersion, p_difficulty: difficulty,
  }) : rpc("start_run", {
    p_mode: mode,
    p_room_id: roomId,
    p_engine_version: engineVersion,
  });

export const configureRoomCharacter = (roomId, character) => rpc("configure_room_character", { p_room_id: roomId, p_character_class: character });
export const syncRoom = (roomId, after = 0) => rpc("sync_room", { p_room_id: roomId, p_after: after });
export const resumeRoom = (roomId) => rpc("resume_room", { p_room_id: roomId });
export const sendRoomAction = (roomId, requestId, input) => rpc("send_room_action", { p_room_id: roomId, p_request_id: requestId, p_input: input });
export const leaveRoom = (roomId) => rpc("leave_room", { p_room_id: roomId });
export const finishRoom = (roomId) => rpc("finish_room", { p_room_id: roomId });
export const kickMember = (roomId, userId) => rpc("kick_member", { p_room_id: roomId, p_user_id: userId });
export const transferHost = (roomId, userId) => rpc("transfer_host", { p_room_id: roomId, p_user_id: userId });

export const claimAbandonedHost = async (roomId) => rpc("claim_host", { p_room_id: roomId });

export const markReady = async (roomId, ready) =>
  rpc("set_ready", { p_room_id: roomId, p_ready: ready });

export const touchRoom = async (roomId, depth = null) =>
  rpc("touch_room", { p_room_id: roomId, p_depth: depth });

export const sendChatMessage = async (roomId, channel, body) =>
  rpc("post_chat", { p_room_id: roomId, p_channel: channel, p_body: body });

/** Replay the finished log. The function, not the browser, chooses the score. */
export const submitScore = async ({ runId, log }) => {
  const config = readOnlineEnv();
  const supabase = await getSupabase();
  if (!config || !supabase) return { ok: false, verified: false, reason: "unavailable" };
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) return { ok: false, verified: false, reason: "unavailable" };
  let response;
  try {
    response = await fetch(`${config.url}/functions/v1/submit-score`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: config.key,
        "content-type": "application/json",
      },
      body: JSON.stringify({ run_id: runId, log }),
    });
  } catch {
    return { ok: false, verified: false, reason: "unavailable" };
  }
  const body = await response.json().catch(() => null);
  if (!body) return { ok: false, verified: false, reason: "unavailable" };
  return body;
};
