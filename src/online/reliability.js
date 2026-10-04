/** Reconnect grace and host migration. Pure so the lobby can be tested without a socket. */

export const RECONNECT_MS = 120_000;
export const HOST_ABSENT_MS = 15_000;

export const canResume = (member, now) => {
  if (!member || member.banned) return false;
  if (member.connected) return true;
  if (member.leftAt == null) return false;
  return now - member.leftAt <= RECONNECT_MS;
};

/** While a seat is inside the grace window the host auto-rests that adventurer. */
export const shouldAutoRest = (member, now) => {
  if (!member || member.banned || member.connected || member.role === "spectator") return false;
  return canResume(member, now);
};

/**
 * The longest-connected player (earliest joinedAt) becomes host once the
 * current host has been unseen for 15 seconds.
 */
export const chooseHeir = (members, now) => {
  const host = members.find((member) => member.role === "host" && !member.banned);
  if (!host) return null;
  const seen = host.lastSeen ?? now;
  if (now - seen < HOST_ABSENT_MS) return null;
  const players = members
    .filter((member) => member.role === "player" && member.connected && !member.banned)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  return players[0] ?? null;
};

export const showReconnecting = (since, now) => since != null && now - since < RECONNECT_MS;

export const formatBrowseRoom = (room) => {
  const players = room.players ?? 0;
  const max = room.max_players ?? 4;
  const depth = room.depth ?? 0;
  const spectators = room.spectators ?? 0;
  const locked = !!room.locked;
  return {
    code: room.join_code,
    players,
    max,
    depth,
    locked,
    spectators,
    label: `${room.join_code} · ${players}/${max} · D${depth}${locked ? " · locked" : ""} · ${spectators} watching`,
  };
};
