import { getSupabase } from "./config.js";
import { openRoomChannel } from "./channel.js";
import { createHostLoop, createHostSession, createPlayer, createReplica } from "./protocol.js";
import { beginRun, claimAbandonedHost, markReady, recentChat, submitScore, touchRoom } from "./rooms.js";
import { chooseHeir } from "./reliability.js";

const compress = (text) =>
  typeof LZString !== "undefined" ? LZString.compressToUTF16(text) : text;

const decompress = (text) =>
  typeof LZString !== "undefined" ? LZString.decompressFromUTF16(text) : text;

const productVersion = () => {
  const text = document.querySelector(".site-version")?.textContent?.replace(/^v/, "").trim() || "";
  return /^\d+\.\d+\.\d+$/.test(text) ? text : "1.3.42";
};

const captureEngine = () => (typeof captureGameState === "function" ? captureGameState() : null);

const checksumEngine = (engine) =>
  engine && typeof checksumGameState === "function" ? checksumGameState(engine) : "";

/**
 * One private room channel for presence, chat, and the host's turn log.
 * The host runs the world. Everyone else replays that log and checks the
 * host's captured checksum.
 */
export const createLiveRoom = ({ self, roomId, onRoster, onChat, onStatus, onStarted, onScore, onClaimed }) => {
  let channel = null;
  let hostSession = null;
  let hostLoop = null;
  let player = null;
  let replica = null;
  let members = [];
  let started = false;
  let booted = false;
  let finished = false;
  let runId = null;
  let seed = null;
  let difficulty = 0;
  let appliedInputs = 0;
  let pollTimer = null;
  let retryTimer = null;
  let closed = false;
  let ready = false;
  const played = [];
  const queued = [];
  const chain = { current: Promise.resolve() };

  const publish = () => {
    if (!hostSession || !channel) return;
    for (const message of hostSession.takeOutbound()) channel.send(message.event, message.payload);
  };

  const bootWorld = async ({ seed: nextSeed, name, difficulty: nextDifficulty }) => {
    if (booted) return { ok: true };
    seed = Number(nextSeed);
    difficulty = Number(nextDifficulty) || 0;
    if (typeof window.ularn?.start !== "function") return { ok: false, error: "unavailable" };
    await window.ularn.start({
      name: name || self.name || "Adventurer",
      character: "Adventurer",
      difficulty,
      seed,
    });
    booted = true;
    started = true;
    onStarted?.();
    return { ok: true };
  };

  const playAction = (action) => {
    if (action === "aura:on" || action === "aura:off") {
      window.ularn?.setAura?.(action === "aura:on", { role: "host" });
      return;
    }
    window.ularn?.key?.(action);
  };

  const replayThrough = (inputs) => {
    const rows = inputs || [];
    for (let index = appliedInputs; index < rows.length; index++) {
      const action = rows[index]?.action;
      if (action) playAction(action);
    }
    appliedInputs = rows.length;
  };

  const applyState = (payload) => {
    if (!replica) {
      replica = createReplica({
        checksum: (state) => checksumEngine(state?.engine),
        apply: (base, diff) => ({
          engine: typeof applyDiff === "function" ? applyDiff(base?.engine, diff?.engine) : base?.engine,
          inputs: (base?.inputs || []).concat(diff?.inputs || []),
        }),
        decompress,
      });
    }
    replica.receive("state", payload);
    const state = replica.state();
    replayThrough(state?.inputs);
    const local = checksumEngine(captureEngine());
    const remote = checksumEngine(state?.engine);
    if (local && remote && local !== remote) {
      channel?.send("snapshot", { request: true, userId: self.userId });
      onStatus?.("The game fell out of step. Asking the host for the world again.");
    }
    if (window.ularn?.snapshot?.()?.over) finish();
    window.dispatchEvent(new Event("ularn:update"));
  };

  const enqueueState = (payload) => {
    chain.current = chain.current.then(async () => {
      if (closed) return;
      if (!booted) {
        queued.push(payload);
        return;
      }
      if (self.role === "host") return;
      applyState(payload);
    }).catch(() => onStatus?.("Online unavailable"));
  };

  const flushQueued = () => {
    const waiting = queued.splice(0, queued.length);
    for (const payload of waiting) applyState(payload);
  };

  const finish = async () => {
    if (finished || self.role !== "host" || !runId) return;
    finished = true;
    try {
      const result = await submitScore({
        runId,
        log: played.map((row) => ({ actor: row.actor, action: row.action })),
      });
      onScore?.(result);
    } catch {
      onScore?.({ ok: false, verified: false, reason: "unavailable" });
    }
  };

  const makeSession = () => {
    hostSession = createHostSession({
      userId: self.userId,
      applyInput: (input, from) => {
        const action = String(input);
        playAction(action);
        played.push({
          actor: Number.isInteger(from?.slot) ? from.slot : 0,
          action,
        });
        if (window.ularn?.snapshot?.()?.over) finish();
      },
      capture: () => ({
        engine: captureEngine(),
        inputs: played.slice(),
      }),
      diff: (before, after) => ({
        engine: typeof diffState === "function" ? diffState(before?.engine, after?.engine) : { same: true },
        inputs: (after?.inputs || []).slice(before?.inputs?.length || 0),
      }),
      checksum: (state) => checksumEngine(state?.engine) || checksumEngine(captureEngine()),
      compress,
      decompress,
    });
    hostLoop?.stop();
    hostLoop = createHostLoop(hostSession, {
      members: () => members.filter((member) => member.role !== "spectator"),
      now: () => Date.now(),
    });
    hostLoop.start();
  };

  const onEvent = (event, payload) => {
    if (event === "chat") {
      onChat?.(payload);
      return;
    }
    if (event === "ack") {
      player?.ack(payload);
      return;
    }
    if (event === "snapshot" && payload?.begin) {
      chain.current = chain.current.then(async () => {
        if (self.role === "host" || booted) return;
        runId = payload.runId;
        await bootWorld(payload);
        flushQueued();
      }).catch(() => onStatus?.("Online unavailable"));
      return;
    }
    if (event === "snapshot" && payload?.request && self.role === "host") {
      hostSession?.snapshot();
      publish();
      return;
    }
    if (event === "state") {
      enqueueState(payload);
      return;
    }
    if (event === "action" && self.role === "host") {
      const member = members.find((person) => person.userId === payload.userId);
      const from = member && member.role !== "spectator"
        ? member
        : { userId: payload.userId, role: "spectator", slot: null };
      hostSession?.receive(from, "action", payload);
      publish();
    }
  };

  const refresh = async () => {
    if (closed) return;
    const loaded = await loadRoster(roomId);
    if (!loaded.ok) {
      onStatus?.("Online unavailable");
      return;
    }
    members = loaded.members;
    const mine = members.find((member) => member.userId === self.userId);
    if (mine) {
      ready = !!mine.ready;
      if (mine.role === "host" && self.role !== "host" && started) {
        self.role = "host";
        played.length = 0;
        for (const row of replica?.state()?.inputs || []) played.push(row);
        makeSession();
        hostSession.snapshot();
        publish();
        onClaimed?.();
      } else if (mine.role) {
        self.role = mine.role;
      }
    }
    onRoster?.(members, loaded.room);
    const history = await recentChat(roomId);
    if (Array.isArray(history) && history.length) onChat?.(history, true);
    if (self.role === "host") {
      const depth = window.ularn?.snapshot?.()?.level;
      await touchRoom(roomId, Number.isInteger(depth) ? depth : null);
    } else if (mine && self.role !== "spectator") {
      const heir = chooseHeir(members, Date.now());
      if (heir?.userId === self.userId) {
        const claimed = await claimAbandonedHost(roomId);
        if (claimed?.ok) await refresh();
      }
    }
  };

  const open = async () => {
    const supabase = await getSupabase();
    if (!supabase) return { ok: false, error: "unavailable" };
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) return { ok: false, error: "unavailable" };
    if (supabase.realtime?.setAuth) await supabase.realtime.setAuth(token);
    player = createPlayer({ userId: self.userId, role: self.role });
    let subscribed = false;
    channel = openRoomChannel(supabase, {
      roomId,
      userId: self.userId,
      role: self.role,
      onEvent,
      onStatus: (status) => {
        if (status === "SUBSCRIBED") subscribed = true;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          onStatus?.("Online unavailable");
        }
      },
    });
    const startedAt = Date.now();
    while (!subscribed && Date.now() - startedAt < 8000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!subscribed) return { ok: false, error: "unavailable" };
    await refresh();
    pollTimer = setInterval(refresh, 2000);
    retryTimer = setInterval(() => {
      if (closed || self.role === "host" || !started) return;
      for (const payload of player.retry()) channel?.send("action", payload);
    }, 1000);
    return { ok: true };
  };

  return {
    open,
    refresh,
    ready: () => ready,
    started: () => started,
    members: () => members,
    toggleReady: async () => {
      if (self.role === "spectator") return { ok: false, error: "spectator" };
      ready = !ready;
      const result = await markReady(roomId, ready);
      if (!result?.ok) ready = !ready;
      await refresh();
      return result;
    },
    start: async () => {
      if (self.role !== "host") return { ok: false, error: "not_host" };
      const run = await beginRun({ mode: "coop", roomId, engineVersion: productVersion() });
      if (!run?.ok) return run;
      runId = run.run_id;
      const world = await bootWorld({
        seed: run.seed,
        name: self.name,
        difficulty: Number(document.querySelector("#difficulty")?.value || 0),
      });
      if (!world.ok) return world;
      makeSession();
      started = true;
      channel?.send("snapshot", {
        begin: true,
        seed,
        runId,
        difficulty,
        name: self.name,
      });
      hostSession.snapshot();
      publish();
      return { ok: true, seed, runId };
    },
    sendInput: (input) => {
      if (!started || self.role === "spectator") return false;
      const payload = player.nextAction(input);
      payload.slot = self.slot ?? 0;
      payload.role = self.role;
      if (self.role === "host") {
        hostSession.receive(
          { userId: self.userId, role: "host", slot: self.slot ?? 0 },
          "action",
          payload,
        );
        publish();
        return true;
      }
      return channel?.send("action", payload) !== false;
    },
    say: (message) => channel?.send("chat", message),
    beat: () => (hostLoop ? hostLoop.beat() : []),
    close: () => {
      closed = true;
      clearInterval(pollTimer);
      clearInterval(retryTimer);
      hostLoop?.stop();
      channel?.close();
    },
  };
};

const loadRoster = async (roomId) => {
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, error: "unavailable" };
  const members = await supabase
    .from("room_members")
    .select("user_id, role, slot, ready, connected, banned, last_seen, joined_at, left_at")
    .eq("room_id", roomId);
  if (members.error) return { ok: false, error: "unavailable" };
  const room = await supabase
    .from("rooms")
    .select("id, join_code, status, seed, host_user_id")
    .eq("id", roomId)
    .maybeSingle();
  if (room.error) return { ok: false, error: "unavailable" };
  const ids = (members.data || []).map((row) => row.user_id);
  const profiles = ids.length
    ? await supabase.from("profiles").select("user_id, display_name").in("user_id", ids)
    : { data: [] };
  const names = new Map((profiles.data || []).map((row) => [row.user_id, row.display_name]));
  return {
    ok: true,
    room: room.data,
    members: (members.data || []).map((row) => ({
      userId: row.user_id,
      name: names.get(row.user_id) || "Player",
      role: row.role,
      slot: row.slot,
      ready: !!row.ready,
      connected: !!row.connected,
      banned: !!row.banned,
      lastSeen: row.last_seen ? Date.parse(row.last_seen) : Date.now(),
      joinedAt: row.joined_at ? Date.parse(row.joined_at) : 0,
      leftAt: row.left_at ? Date.parse(row.left_at) : null,
    })),
  };
};

/** Same columns the in-game leaderboard reads. RLS already hides unverified and flagged rows. */
const SCORE_LIST_COLUMNS =
  "user_id, display_name, score, mode, verified, flagged, created_at, won, depth_reached";

export const interpretScoreList = (listed, userId) => {
  if (!listed || listed.error || !Array.isArray(listed.data)) {
    return { ok: false, error: "unavailable", rows: [] };
  }
  return {
    ok: true,
    rows: listed.data.map((row) => ({
      name: row.display_name,
      score: row.score,
      mode: row.mode,
      verified: row.verified,
      flagged: row.flagged,
      created_at: row.created_at,
      yours: !!userId && row.user_id === userId,
      won: row.won,
      depth: row.depth_reached,
    })),
  };
};

/** Public leaderboard. ok:false is a failed read. ok:true with no rows is an empty board. */
export const fetchPublicScores = async (userId) => {
  try {
    const supabase = await getSupabase();
    if (!supabase) return { ok: false, error: "unavailable", rows: [] };
    const listed = await supabase
      .from("scores")
      .select(SCORE_LIST_COLUMNS)
      .order("score", { ascending: false })
      .limit(100);
    return interpretScoreList(listed, userId);
  } catch {
    return { ok: false, error: "unavailable", rows: [] };
  }
};

export const loadScores = async (userId) => {
  const result = await fetchPublicScores(userId);
  return result.ok ? result.rows : [];
};
