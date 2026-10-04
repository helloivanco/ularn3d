/** Watch-along. Spectator input never reaches the engine. Fog is the followed player's. */

export const createSpectatorView = (players = []) => {
  let index = 0;
  let freeCamera = false;
  const cast = () => players.filter((player) => player.role !== "spectator");

  const followed = () => {
    const people = cast();
    if (!people.length) return null;
    index = ((index % people.length) + people.length) % people.length;
    return people[index];
  };

  return {
    acceptInput: () => false,
    followed,
    follow: (name) => {
      const found = cast().findIndex((player) => player.name === name);
      if (found < 0) return followed();
      index = found;
      freeCamera = false;
      return followed();
    },
    next: () => {
      const people = cast();
      if (people.length) index = (index + 1) % people.length;
      freeCamera = false;
      return followed();
    },
    setFreeCamera: (enabled) => {
      freeCamera = !!enabled;
    },
    freeCamera: () => freeCamera,
    /** Free look stays on the followed player's level. */
    level: () => followed()?.dungeon ?? followed()?.level ?? 0,
    fogOf: (knowByName) => {
      const who = followed();
      if (!who || !knowByName) return null;
      return knowByName[who.name] ?? null;
    },
    badge: (count) => `Spectating ${followed()?.name ?? "…"} · ${count} watching`,
  };
};

/** Null means "not spectating" and leaves every tile. A set hides anything outside it. */
export const tilesInFog = (tiles, seen) => {
  if (seen == null) return tiles || [];
  const allow = seen instanceof Set ? seen : new Set(seen);
  return (tiles || []).filter((tile) => allow.has(`${tile.x},${tile.y}`));
};
