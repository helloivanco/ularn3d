import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_LIMIT, createChatLog } from "../src/online/chat.js";

test("chat keeps history, filters words, and ignores a muted player", async () => {
  let clock = 1_000;
  const saved = [];
  const chat = createChatLog({
    now: () => clock,
    persist: async (message) => {
      saved.push(message.body);
      return { ok: true };
    },
  });
  chat.history([
    { channel: "party", name: "Bea", body: "Follow me", userId: "bea" },
    { channel: "spectators", name: "Cid", body: "East", userId: "cid" },
  ]);
  assert.equal(chat.visible().length, 1);
  assert.equal(await chat.post({ body: "  Wait  ", name: "Ada" }).then((result) => result.ok), true);
  assert.equal(saved[0], "Wait");
  assert.equal((await chat.post({ body: "shit" })).ok, false);
  assert.equal((await chat.post({ body: "x".repeat(CHAT_LIMIT + 1) })).error, "length");
  chat.mute("bea");
  chat.receive({ channel: "party", name: "Bea", body: "Help!", userId: "bea" });
  assert.equal(chat.visible().some((row) => row.userId === "bea"), false);
  chat.setChannel("spectators");
  chat.receive({ id: "m1", channel: "party", name: "Ada", body: "Low HP", userId: "ada" });
  chat.receive({ id: "m1", channel: "party", name: "Ada", body: "Low HP", userId: "ada" });
  assert.equal(chat.unread(), 1);
});

test("typing blocks movement keys and a map ping fades after 4 seconds", () => {
  let clock = 5_000;
  const chat = createChatLog({ now: () => clock });
  assert.equal(chat.blocksGameKeys(), false);
  chat.setTyping(true);
  assert.equal(chat.blocksGameKeys(), true);
  chat.ping({ x: 4, y: 9 });
  assert.equal(chat.pings().length, 1);
  clock += 4001;
  assert.equal(chat.pings().length, 0);
});
