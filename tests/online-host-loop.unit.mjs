import test from "node:test";
import assert from "node:assert/strict";
import { createHostLoop, createHostSession } from "../src/online/protocol.js";

test("each host tick auto-rests a disconnected player inside the grace window", () => {
  const inputs = [];
  const session = createHostSession({
    userId: "host",
    applyInput: (input, from) => inputs.push(`${from.slot}:${input}`),
    capture: () => ({ n: inputs.length }),
    diff: (_before, after) => ({ value: after }),
    checksum: (state) => String(state.n),
  });
  let clock = 1_000_000;
  const member = {
    userId: "bea",
    role: "player",
    connected: false,
    banned: false,
    leftAt: clock - 5_000,
    slot: 1,
  };
  const beats = [];
  const loop = createHostLoop(session, {
    members: () => [member],
    now: () => clock,
  });
  loop.start({
    schedule: (fn) => {
      beats.push(fn);
      return 7;
    },
    clear() {},
  });
  assert.deepEqual(inputs, ["1:."]);
  beats[0]();
  assert.equal(inputs.length, 1);
  clock += 1000;
  beats[0]();
  assert.deepEqual(inputs, ["1:.", "1:."]);
  clock += 1000;
  member.leftAt = clock - 121_000;
  beats[0]();
  assert.equal(inputs.length, 2);
  member.leftAt = clock - 1_000;
  member.role = "spectator";
  clock += 1000;
  beats[0]();
  assert.equal(inputs.length, 2);
});
