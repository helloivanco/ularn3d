/**
 * Seeded melee exchange shared by the headless lock and its browser twin.
 * The browser runs the 3D bridge and every feedback listener; the headless
 * engine runs neither, so equal checksums prove the presentation only observes.
 */
export const COMBAT_SEED = 7;
export const COMBAT_TURNS = 120;
/** Captured from the bridge-less seeded engine. Do not edit without a fresh pre-change run. */
export const COMBAT_GOLDEN = "45b937231bf66f76";

// Runs inside the engine global scope, so it may only use functions and vars.
// Species 23 is the troll: sturdy enough to trade blows for the whole script.
export function stageCombat(g) {
  g.player.HP = g.player.HPMAX = 4000;
  const steps = [[1, 0, "l"], [-1, 0, "h"], [0, 1, "j"], [0, -1, "k"]];
  for (const [dx, dy, key] of steps) {
    const x = g.player.x + dx, y = g.player.y + dy;
    if (g.inBounds(x, y) && !g.monsterAt(x, y) && g.itemAt(x, y).id === 0) {
      g.setMonster(x, y, g.createMonster(23));
      return key;
    }
  }
  throw new Error("no open tile beside the hero");
}
