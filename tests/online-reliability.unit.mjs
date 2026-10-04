import test from "node:test";
import assert from "node:assert/strict";
import {
  HOST_ABSENT_MS,
  RECONNECT_MS,
  canResume,
  chooseHeir,
  formatBrowseRoom,
  shouldAutoRest,
  showReconnecting,
} from "../src/online/reliability.js";

const now = 1_000_000;

test("a dropped player can resume for 120 seconds and then loses the seat", () => {
  const member = { banned: false, connected: false, leftAt: now - 30_000, role: "player" };
  assert.equal(canResume(member, now), true);
  assert.equal(shouldAutoRest(member, now), true);
  assert.equal(canResume({ ...member, leftAt: now - RECONNECT_MS - 1 }, now), false);
  assert.equal(shouldAutoRest({ ...member, role: "spectator" }, now), false);
  assert.equal(canResume({ ...member, banned: true }, now), false);
});

test("the longest-connected player inherits a host who has been gone 15 seconds", () => {
  const members = [
    { userId: "host", role: "host", banned: false, lastSeen: now - HOST_ABSENT_MS + 1000, connected: false },
    { userId: "old", role: "player", banned: false, connected: true, joinedAt: 10 },
    { userId: "new", role: "player", banned: false, connected: true, joinedAt: 20 },
  ];
  assert.equal(chooseHeir(members, now), null);
  members[0].lastSeen = now - HOST_ABSENT_MS;
  assert.equal(chooseHeir(members, now).userId, "old");
  members[1].connected = false;
  assert.equal(chooseHeir(members, now).userId, "new");
});

test("browse rows show depth, a lock, and the spectator count", () => {
  const row = formatBrowseRoom({
    join_code: "K7MQ2P",
    players: 2,
    max_players: 4,
    depth: 3,
    locked: true,
    spectators: 5,
  });
  assert.equal(row.label, "K7MQ2P · 2/4 · D3 · locked · 5 watching");
  assert.equal(showReconnecting(now - 1000, now), true);
  assert.equal(showReconnecting(null, now), false);
});
