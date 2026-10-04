import { getSupabase } from "./config.js";
import { ensureOnlineSession } from "./session.js";

const rpc = async (name, args) => {
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: "unavailable" };
  const result = await supabase.rpc(name, args);
  if (result.error) return { ok: false, error: "unavailable" };
  return result.data ?? { ok: false, error: "unavailable" };
};

export const hostRoom = async ({ displayName, password, isPublic, maxPlayers, turnTimer }) => {
  const session = await ensureOnlineSession({ displayName });
  if (!session.ok) return session;
  return rpc("create_room", {
    p_password: password || null,
    p_is_public: isPublic,
    p_max_players: maxPlayers,
    p_turn_timer_s: turnTimer,
    p_display_name: displayName,
  });
};

export const recentChat = async (roomId) => {
  const supabase = await getSupabase();
  if (!supabase || !roomId) return [];
  const result = await supabase.rpc("recent_chat", { p_room_id: roomId });
  if (result.error || !Array.isArray(result.data)) return [];
  return result.data.slice(-50);
};

export const enterRoom = async ({ code, password, role, characterName, displayName }) => {
  const session = await ensureOnlineSession({ displayName });
  if (!session.ok) return session;
  const joined = await rpc("join_room", {
    p_code: code,
    p_password: password || null,
    p_role: role,
    p_character_name: characterName || null,
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

export const beginRun = async ({ mode, roomId, engineVersion }) =>
  rpc("start_run", {
    p_mode: mode,
    p_room_id: roomId,
    p_engine_version: engineVersion,
  });

export const claimAbandonedHost = async (roomId) => rpc("claim_host", { p_room_id: roomId });

export const markReady = async (roomId, ready) =>
  rpc("set_ready", { p_room_id: roomId, p_ready: ready });

export const sendChatMessage = async (roomId, channel, body) =>
  rpc("post_chat", { p_room_id: roomId, p_channel: channel, p_body: body });
