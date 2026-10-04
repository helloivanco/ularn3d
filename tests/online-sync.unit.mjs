/**
 * Host-authoritative sync: dedupe, reorder, loss, and a 200-turn replay.
 * Run: node --test tests/online-sync.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bootEngine } from "./lib/engine-session.mjs";
import { createHostSession, createPlayer, createReplica } from "../src/online/protocol.js";
import { openRoomChannel } from "../src/online/channel.js";

const toyHost = () => {
  let n = 0;
  const host = createHostSession({
    userId: "host",
    applyInput: (input) => {
      n += input;
    },
    capture: () => ({ n }),
    diff: (_before, after) => ({ value: after }),
    checksum: (state) => String(state.n),
  });
  const replica = () => createReplica({
    checksum: (state) => String(state.n),
    apply: (_base, diff) => diff.value,
  });
  return { host, replica, read: () => n };
};

test("actions dedupe, reorder, and never apply a spectator", () => {
  const { host, replica, read } = toyHost();
  const ally = { userId: "ally", role: "player" };
  host.receive(ally, "action", { seq: 2, input: 1 });
  assert.equal(read(), 0);
  host.receive(ally, "action", { seq: 1, input: 1 });
  host.receive(ally, "action", { seq: 1, input: 1 });
  assert.equal(read(), 2);
  assert.deepEqual(host.log().map((entry) => entry.seq), [1, 2]);

  host.receive({ userId: "watch", role: "spectator" }, "action", { seq: 1, input: 5 });
  assert.equal(read(), 2);
  const rejected = host.takeOutbound().filter((message) => message.event === "ack" && message.payload.reason === "spectator");
  assert.equal(rejected.length, 1);

  host.snapshot();
  const watch = replica();
  const player = replica();
  for (const message of host.takeOutbound()) {
    watch.receive(message.event, message.payload);
    player.receive(message.event, message.payload);
  }
  assert.equal(watch.checksum(), host.checksum());
  assert.equal(player.checksum(), host.checksum());

  player.receive("state", { turn: 0, checksum: "stale", packed: JSON.stringify({ full: { n: 0 } }) });
  assert.equal(player.turn(), host.turn());
});

test("a private room channel rejects spectator actions", () => {
  const sent = [];
  let removed = false;
  const channel = {
    on() { return channel; },
    subscribe(callback) {
      callback("SUBSCRIBED");
      return channel;
    },
    track() {},
    send(message) { sent.push(message); },
    presenceState() { return {}; },
  };
  const supabase = {
    channel(topic, options) {
      assert.equal(topic, "room:room-1");
      assert.equal(options.config.private, true);
      assert.equal(options.config.presence.key, "watch");
      return channel;
    },
    removeChannel() { removed = true; },
  };
  const room = openRoomChannel(supabase, { roomId: "room-1", userId: "watch", role: "spectator" });
  assert.equal(room.send("action", { seq: 1 }), false);
  assert.equal(sent.length, 0);
  room.close();
  assert.equal(removed, true);
});

const mulberry32 = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

test("host, ally, and spectator match for 200 turns with latency and loss", () => {
  const api = bootEngine({ seed: 2 });
  const compress = (text) => api.LZString.compressToUTF16(text);
  const decompress = (text) => api.LZString.decompressFromUTF16(text);
  const host = createHostSession({
    userId: "host",
    applyInput: (input) => api.mainloop(null, input),
    capture: () => api.captureGameState(),
    diff: (before, after) => api.diffState(before, after),
    checksum: (state) => api.checksumGameState(state),
    compress,
    decompress,
  });
  const replica = () => createReplica({
    checksum: (state) => api.checksumGameState(state),
    apply: (base, diff) => api.applyDiff(base, diff),
    decompress,
  });
  const allyView = replica();
  const watchView = replica();
  const ally = createPlayer({ userId: "ally", role: "player" });
  const leader = createPlayer({ userId: "host", role: "host" });
  const random = mulberry32(7);
  const wire = [];
  let now = 0;

  const send = (to, event, payload, from) => {
    if (random() < 0.05) return;
    const delay = 200 + Math.floor(random() * 150);
    wire.push({ at: now + delay, to, event, payload, from });
  };
  const deliver = () => {
    const due = wire.filter((item) => item.at <= now);
    for (const item of due) {
      const index = wire.indexOf(item);
      if (index >= 0) wire.splice(index, 1);
      if (item.to === "host") host.receive(item.from, item.event, item.payload);
      if (item.to === "views" && item.event === "state") {
        allyView.receive(item.event, item.payload);
        watchView.receive(item.event, item.payload);
      }
      if (item.to === "views" && item.event === "ack") {
        ally.ack(item.payload);
        leader.ack(item.payload);
      }
    }
  };

  host.snapshot();
  for (const message of host.takeOutbound()) {
    allyView.receive(message.event, message.payload);
    watchView.receive(message.event, message.payload);
  }

  const goal = { host: 100, ally: 100 };
  const launched = { host: 0, ally: 0 };
  let guard = 0;
  while (host.turn() < 200 && guard < 8000) {
    guard += 1;
    deliver();
    for (const player of [leader, ally]) {
      if (player.pending() === 0 && launched[player.userId] < goal[player.userId]) {
        player.nextAction(".", host.turn());
        launched[player.userId] += 1;
      }
      for (const payload of player.retry()) {
        send("host", "action", payload, { userId: player.userId, role: player.role });
      }
    }
    host.receive({ userId: "watch", role: "spectator" }, "action", { seq: 1, input: "h" });
    for (const message of host.takeOutbound()) {
      if (message.event === "state" || message.event === "ack") send("views", message.event, message.payload);
    }
    if (allyView.needsSnapshot() || watchView.needsSnapshot()) {
      host.snapshot();
      for (const message of host.takeOutbound()) send("views", message.event, message.payload);
    }
    now += 50;
  }

  while (
    (allyView.checksum() !== host.checksum() || watchView.checksum() !== host.checksum())
    && guard < 12000
  ) {
    guard += 1;
    deliver();
    if (allyView.needsSnapshot() || watchView.needsSnapshot() || allyView.checksum() !== host.checksum()) {
      host.snapshot();
    }
    for (const message of host.takeOutbound()) send("views", message.event, message.payload);
    now += 50;
  }

  assert.equal(host.turn(), 200);
  assert.equal(host.log().length, 200);
  assert.equal(allyView.checksum(), host.checksum());
  assert.equal(watchView.checksum(), host.checksum());
  assert.equal(api.gtime, 200);
  const inputs = new Set(host.log().map((entry) => entry.input));
  assert.deepEqual([...inputs], ["."]);
});
