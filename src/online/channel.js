import { ROOM_EVENTS } from "./protocol.js";

const PING_MS = 15000;

export const openRoomChannel = (supabase, { roomId, userId, role, onEvent, onPresence }) => {
  const topic = `room:${roomId}`;
  const channel = supabase.channel(topic, {
    config: { private: true, presence: { key: userId } },
  });
  for (const event of ROOM_EVENTS) {
    channel.on("broadcast", { event }, (message) => {
      onEvent?.(event, message.payload ?? {});
    });
  }
  channel.on("presence", { event: "sync" }, () => {
    onPresence?.(channel.presenceState());
  });
  let pingTimer = null;
  channel.subscribe((status) => {
    if (status !== "SUBSCRIBED") return;
    channel.track({ userId, role, connected: true });
    pingTimer = setInterval(() => {
      channel.track({ userId, role, connected: true });
      if (role === "spectator") return;
      channel.send({ type: "broadcast", event: "ping", payload: { userId, at: Date.now() } });
    }, PING_MS);
  });

  return {
    topic,
    send: (event, payload) => {
      if (event === "action" && role === "spectator") return false;
      channel.send({ type: "broadcast", event, payload });
      return true;
    },
    close: () => {
      clearInterval(pingTimer);
      supabase.removeChannel(channel);
    },
  };
};
