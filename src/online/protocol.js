export const ROOM_EVENTS = ["action", "state", "ack", "ping", "emote", "chat", "snapshot"];

export const packState = (body, compress) => {
  const json = JSON.stringify(body);
  return compress ? compress(json) : json;
};

export const unpackState = (packed, decompress) => {
  const json = decompress ? decompress(packed) : packed;
  return JSON.parse(json);
};

export const createHostSession = ({ userId, applyInput, capture, diff, checksum, compress, decompress }) => {
  let state = capture();
  let turn = 0;
  const applied = new Map();
  const waiting = new Map();
  const log = [];
  const outbound = [];

  const emit = (event, payload) => {
    outbound.push({ event, payload });
  };

  let lastDiff = { same: true };

  const remember = (before) => {
    state = capture();
    lastDiff = diff(before, state);
    turn += 1;
    emit("state", {
      turn,
      checksum: checksum(state),
      full: false,
      packed: packState({ diff: lastDiff }, compress),
    });
  };

  const accept = (from, payload) => {
    const before = capture();
    applyInput(payload.input, from);
    applied.set(from.userId, payload.seq);
    log.push({ turn: turn + 1, userId: from.userId, seq: payload.seq, input: payload.input });
    emit("ack", { userId: from.userId, seq: payload.seq, accepted: true, turn: turn + 1 });
    remember(before);
  };

  const drain = (from) => {
    const bag = waiting.get(from.userId);
    if (!bag) return;
    let next = (applied.get(from.userId) ?? 0) + 1;
    while (bag.has(next)) {
      const payload = bag.get(next);
      bag.delete(next);
      accept(from, payload);
      next += 1;
    }
  };

  return {
    userId,
    log: () => log.slice(),
    turn: () => turn,
    checksum: () => checksum(state),
    takeOutbound: () => outbound.splice(0, outbound.length),
    snapshot: () => {
      emit("state", {
        turn,
        checksum: checksum(state),
        full: true,
        packed: packState({ full: state }, compress),
      });
    },
    receive: (from, event, payload) => {
      if (event === "snapshot") {
        emit("state", {
          turn,
          checksum: checksum(state),
          full: true,
          packed: packState({ full: state }, compress),
        });
        return;
      }
      if (event !== "action") return;
      if (!from || from.role === "spectator") {
        emit("ack", { userId: from?.userId ?? null, seq: payload?.seq ?? 0, accepted: false, reason: "spectator" });
        return;
      }
      const seq = payload?.seq;
      if (!Number.isInteger(seq) || seq < 1) {
        emit("ack", { userId: from.userId, seq: seq ?? 0, accepted: false, reason: "bad_seq" });
        return;
      }
      const seen = applied.get(from.userId) ?? 0;
      if (seq <= seen) {
        emit("ack", { userId: from.userId, seq, accepted: true, duplicate: true, turn });
        return;
      }
      const bag = waiting.get(from.userId) ?? new Map();
      waiting.set(from.userId, bag);
      if (!bag.has(seq)) bag.set(seq, payload);
      drain(from);
    },
  };
};

export const createReplica = ({ checksum, apply, decompress }) => {
  let state = null;
  let turn = -1;
  let currentChecksum = null;
  let needsSnapshot = false;

  return {
    turn: () => turn,
    checksum: () => currentChecksum,
    needsSnapshot: () => needsSnapshot,
    state: () => state,
    receive: (event, payload) => {
      if (event !== "state") return;
      if (payload.turn < turn) return;
      const decoded = unpackState(payload.packed, decompress);
      const isFull = Boolean(payload.full || decoded.full);
      if (!isFull) {
        if (!state || payload.turn !== turn + 1) {
          needsSnapshot = true;
          return;
        }
        state = apply(state, decoded.diff);
      } else {
        state = decoded.full;
      }
      const actual = checksum(state);
      turn = payload.turn;
      currentChecksum = actual;
      needsSnapshot = actual !== payload.checksum;
    },
  };
};

export const createPlayer = ({ userId, role }) => {
  let seq = 0;
  const unacked = new Map();
  return {
    userId,
    role,
    nextAction: (input, turn) => {
      seq += 1;
      const payload = { userId, seq, input, turn };
      unacked.set(seq, payload);
      return payload;
    },
    retry: () => [...unacked.values()],
    ack: (payload) => {
      if (payload.userId === userId && payload.accepted) unacked.delete(payload.seq);
    },
    pending: () => unacked.size,
  };
};
