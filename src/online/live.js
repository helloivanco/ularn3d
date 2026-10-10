import { getSupabase } from "./config.js";
import { openRoomChannel } from "./channel.js";
import { beginRun, markReady, syncRoom, sendRoomAction, submitScore, finishRoom, touchRoom } from "./rooms.js";

const productVersion = () => {
  const schema = JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent || '{}');
  return schema.softwareVersion || schema.mainEntity?.softwareVersion || 'unknown';
};

/** The server orders and identifies actions. Every browser follows the same log. */
export const createLiveRoom = ({ self, roomId, onRoster, onChat, onStatus, onStarted, onScore, onClaimed, onEnded }) => {
  let channel = null;
  let timer = null;
  let notificationTimer = null;
  let closed = false;
  let started = false;
  let booted = false;
  let healthy = true;
  let ready = false;
  let members = [];
  let room = null;
  let seq = 0;
  let syncing = null;
  let processing = Promise.resolve();
  let sending = Promise.resolve();
  let queuedMovement = 0;
  let queuedCommands = 0;
  let submitting = false;
  let notificationStatus = 'CONNECTING';
  let checksumSeq = -1;
  let cachedChecksum = null;
  let reportedDepth = -1;
  const waiting = new Map();
  const log = [];

  const canAct = () => !closed && healthy && started && !room?.finished && self.role !== 'spectator' &&
    !!window.ularn?.roomCanAct?.(self.slot);
  const follow = actor => window.ularn?.roomView?.(actor);
  const drain = () => {
    processing = processing.then(() => {
      if (!booted || closed) return;
      while (waiting.has(seq + 1)) {
        const row = waiting.get(seq + 1);
        waiting.delete(seq + 1);
        window.ularn.applyRoomAction(row);
        seq = Number(row.seq);
        log.push(row);
      }
      const owner = window.ularn?.roomPromptActor?.();
      if (owner != null && owner !== self.slot && self.role !== 'spectator') {
        const person = members.find(member => member.slot === owner);
        onStatus?.(`${person?.name || 'Another player'} is choosing an action. You can chat while waiting.`);
      } else if (healthy) onStatus?.('');
      if (!submitting && self.role === 'host' && room?.run_id && window.ularn?.snapshot?.()?.over) {
        submitting = true;
        onScore?.({ pending: true });
        finishRoom(roomId).then(() => submitScore({ runId: room.run_id, log })).then(onScore).catch(() => onScore?.({ verified: false, reason: 'unavailable' }));
      }
    });
    return processing;
  };
  const accept = rows => {
    for (const row of rows || []) {
      const n = Number(row?.seq);
      if (row?.room_id !== roomId || !Number.isSafeInteger(n) || n <= seq) continue;
      waiting.set(n, row);
    }
    return drain();
  };
  const refresh = () => {
    if (closed) return Promise.resolve({ ok: false, error: 'closed' });
    if (syncing) return syncing;
    syncing = (async () => {
      let result;
      do {
        result = await syncRoom(roomId, seq);
        if (closed) return { ok: false, error: 'closed' };
        if (!result?.ok) {
          healthy = false;
          if (['not_member', 'room_not_found', 'expired'].includes(result?.error)) {
            close();
            onEnded?.(result.error);
          } else onStatus?.('Reconnecting… Your room and character are saved.');
          return result;
        }
        healthy = true;
        room = result.room;
        members = result.members;
        const mine = members.find(member => member.userId === self.userId);
        if (!mine || mine.banned) { close(); onEnded?.('not_member'); return { ok: false, error: 'not_member' }; }
        const becameHost = self.role !== 'host' && mine.role === 'host';
        self.role = mine.role;
        self.slot = mine.slot;
        ready = !!mine.ready;
        onRoster?.(members, room);
        onChat?.(result.chat || [], true);
        if (becameHost) onClaimed?.();
        if (!booted && room.status === 'playing') {
          const config = room.game_config;
          if (config?.version !== 2 || !config.players?.length) return { ok: false, error: 'old_room' };
          onStatus?.('Joining the expedition…');
          const view = self.role === 'spectator' ? config.players[0].slot : self.slot;
          await window.ularn.beginRoom({ seed: room.seed, config, viewActor: view });
          booted = true;
        }
        await accept(result.actions);
      } while (booted && Number(room.action_seq) > seq && result.actions?.length);
      if (booted && !started && seq === Number(room.action_seq)) {
        started = true;
        onStarted?.();
      }
      if (booted && self.role === 'host') {
        const depth = Math.max(0, ...window.ularn.party().map(person => person.dungeon));
        if (depth > reportedDepth) { reportedDepth = depth; touchRoom(roomId, depth); }
      }
      return { ok: true };
    })().catch(() => {
      healthy = false;
      onStatus?.('Reconnecting… Your room and character are saved.');
      return { ok: false, error: 'unavailable' };
    }).finally(() => { syncing = null; });
    return syncing;
  };
  const changed = () => {
    if (closed || notificationTimer) return;
    notificationTimer = setTimeout(() => { notificationTimer = null; refresh(); }, 80);
  };
  const close = () => {
    closed = true;
    clearInterval(timer);
    clearTimeout(notificationTimer);
    channel?.close();
    return Promise.allSettled([syncing, sending]);
  };
  return {
    open: async () => {
      const supabase = await getSupabase();
      if (!supabase) return { ok: false, error: 'unavailable' };
      const loaded = await refresh();
      if (!loaded?.ok) return loaded;
      const session = await supabase.auth.getSession();
      if (supabase.realtime?.setAuth) await supabase.realtime.setAuth(session.data.session?.access_token);
      channel = openRoomChannel(supabase, {
        roomId,
        onAction: row => { accept([row]); if (Number(row.seq) > seq + 1) changed(); },
        onChange: changed,
        onStatus: status => { notificationStatus = status; if (status === 'SUBSCRIBED') changed(); },
      });
      timer = setInterval(refresh, 1000);
      return { ok: true };
    },
    refresh,
    ready: () => ready,
    started: () => started,
    members: () => members,
    room: () => room,
    canAct,
    follow,
    toggleReady: async () => {
      if (self.role === 'spectator' || started) return { ok: false, error: 'not_player' };
      const result = await markReady(roomId, !ready);
      await refresh();
      return result;
    },
    start: async () => {
      const result = await beginRun({ mode: 'coop', roomId, engineVersion: productVersion(), difficulty: Number(document.querySelector('#difficulty')?.value || 0) });
      if (result?.ok) await refresh();
      return result;
    },
    sendInput: input => {
      const view = window.ularn?.snapshot?.();
      const movement = !view?.prompt && !queuedCommands && /^(up|down|left|right|home|end|pageup|pagedown|[hjklbyunHJKLBYUN])$/.test(String(input));
      if (movement && queuedMovement) return Promise.resolve({ ok: false, error: 'pending' });
      if (queuedCommands >= 32) return Promise.resolve({ ok: false, error: 'pending' });
      if (movement) queuedMovement += 1;
      else queuedCommands += 1;
      const requestId = crypto.randomUUID();
      const task = async () => {
        if (window.ularn?.snapshot?.()?.over && ["return", "space", "escape", "z"].includes(input)) return { ok: window.ularn.roomEndKey(input) };
        if (!canAct()) return { ok: false, error: 'busy' };
        let result;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (closed) return { ok: false, error: 'closed' };
          result = await sendRoomAction(roomId, requestId, String(input));
          if (result?.ok || result?.error !== 'unavailable') break;
          await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
        }
        if (result?.ok) {
          await accept([result.action]);
          if (Number(result.action.seq) > seq) await refresh();
        } else {
          onStatus?.(result?.error === 'rate_limited' ? 'Please slow down for a moment.' : 'That action could not be sent. Reconnecting…');
          await refresh();
        }
        return result;
      };
      const result = sending.then(task, task).finally(() => { if (movement) queuedMovement -= 1; else queuedCommands -= 1; });
      sending = result.catch(() => {});
      return result;
    },
    diagnostics: () => ({ seq, role: self.role, slot: self.slot, healthy, started, notifications: notificationStatus,
      get checksum() {
        if (checksumSeq !== seq) { cachedChecksum = window.ularn?.roomChecksum?.(); checksumSeq = seq; }
        return cachedChecksum;
      },
    }),
    close,
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
