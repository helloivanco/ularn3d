import { containsBlockedWord } from "./words.js";

export const QUICK_CHAT = ["Help!", "Follow me", "Wait", "Going down", "Low HP"];
export const CHAT_LIMIT = 280;
export const PING_MS = 4000;
export const HISTORY = 50;

export const createChatLog = ({ now = () => Date.now(), persist } = {}) => {
  const messages = [];
  const muted = new Set();
  const pings = [];
  let channel = "party";
  let unread = 0;
  let typing = false;

  const livePings = () => pings.filter((ping) => ping.until > now());

  return {
    channel: () => channel,
    setChannel: (next) => {
      channel = next === "spectators" ? "spectators" : "party";
      unread = 0;
    },
    unread: () => unread,
    visible: () =>
      messages.filter((message) => message.channel === channel && !muted.has(message.userId)).slice(-HISTORY),
    history: (rows) => {
      messages.length = 0;
      for (const row of (rows || []).slice(-HISTORY)) messages.push(row);
    },
    post: async ({ body, userId = "local", name = "You" } = {}) => {
      const text = String(body || "").trim();
      if (!text || text.length > CHAT_LIMIT) return { ok: false, error: "length" };
      if (containsBlockedWord(text)) return { ok: false, error: "filtered" };
      const message = { channel, body: text, userId, name, at: now() };
      if (persist) {
        const saved = await persist(message);
        if (saved && saved.ok === false) return saved;
      }
      messages.push(message);
      unread = 0;
      return { ok: true, message };
    },
    receive: (message) => {
      if (!message || muted.has(message.userId)) return;
      if (message.id && messages.some((row) => row.id === message.id)) return;
      messages.push(message);
      if (message.channel !== channel) unread += 1;
    },
    mute: (userId) => muted.add(userId),
    typing: () => typing,
    setTyping: (value) => {
      typing = !!value;
    },
    blocksGameKeys: () => typing,
    ping: (point) => {
      pings.push({ x: point.x, y: point.y, until: now() + PING_MS });
    },
    pings: livePings,
    quick: QUICK_CHAT,
  };
};
