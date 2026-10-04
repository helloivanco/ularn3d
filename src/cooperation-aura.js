/**
 * Cooperation aura. Players share a floor bubble: a monster takes a turn
 * only for the adventurer who just acted, and only when it is inside that
 * adventurer's aura. There is no networking in this module.
 *
 * Shape: the ellipse of a 20 by 10 tile rectangle, centered as evenly as
 * an even size allows. The extra tile sits on the +x and +y side:
 *
 *   x0 = originX - 9,  x1 = originX + 10     (20 tiles)
 *   y0 = originY - 4,  y1 = originY + 5      (10 tiles)
 *
 * The rectangle's center in tile space is (originX + 0.5, originY + 0.5).
 * Radii are half the sides, 10 and 5, so the ellipse touches the outer
 * edges of that rectangle. A tile (tx, ty) is inside when
 *
 *   ((tx - (originX + 0.5)) / 10)^2 + ((ty - (originY + 0.5)) / 5)^2 <= 1
 *
 * The center row is 20 tiles and the center column is 10. Corners of the
 * bounding box are outside the ellipse. Another dungeon level is outside.
 */

export var AURA_WIDTH = 20;
export var AURA_HEIGHT = 10;

export function auraBoundingBox(originX, originY) {
  const x0 = originX - Math.floor((AURA_WIDTH - 1) / 2);
  const y0 = originY - Math.floor((AURA_HEIGHT - 1) / 2);
  return {
    x0,
    y0,
    x1: x0 + AURA_WIDTH - 1,
    y1: y0 + AURA_HEIGHT - 1,
  };
}

export function auraCenter(originX, originY) {
  const box = auraBoundingBox(originX, originY);
  return {
    x: (box.x0 + box.x1) / 2,
    y: (box.y0 + box.y1) / 2,
  };
}

export function tileInAura(originX, originY, tileX, tileY) {
  const center = auraCenter(originX, originY);
  const dx = (tileX - center.x) / (AURA_WIDTH / 2);
  const dy = (tileY - center.y) / (AURA_HEIGHT / 2);
  return dx * dx + dy * dy <= 1;
}

export function monsterInAdventurerAura(adventurer, monster) {
  if (!adventurer || !monster) return false;
  if (adventurer.dungeon !== monster.dungeon) return false;
  return tileInAura(adventurer.x, adventurer.y, monster.x, monster.y);
}

/**
 * Monsters that act for this player turn.
 * `adventurers` is who just moved — single player passes the local hero
 * only. A monster is returned once if it sits in any of those auras.
 * A monster that is only inside someone who did not just move is absent
 * from the list, so it does not act.
 */
/**
 * What every client draws. The host state wins. A local wish cannot show
 * the aura while the host has it off, and solo never gets the control.
 */
export function auraControl(hostState) {
  if (!hostState || hostState.multiplayer !== true) {
    return { control: false, overlay: false, label: "" };
  }
  const on = hostState.aura === true;
  return { control: true, overlay: on, label: on ? "AURA: ON" : "AURA: OFF" };
}

export function monstersActingFor(adventurers, monsters) {
  const acting = [];
  const seen = new Set();
  const list = adventurers || [];
  for (let i = 0; i < (monsters || []).length; i++) {
    const monster = monsters[i];
    if (!monster) continue;
    const key = monster.dungeon + ":" + monster.x + "," + monster.y;
    if (seen.has(key)) continue;
    let inside = false;
    for (let a = 0; a < list.length; a++) {
      if (monsterInAdventurerAura(list[a], monster)) {
        inside = true;
        break;
      }
    }
    if (!inside) continue;
    seen.add(key);
    acting.push(monster);
  }
  return acting;
}
