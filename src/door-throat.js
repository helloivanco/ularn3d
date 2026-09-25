/**
 * Door throat geometry and diagonal corner-cut rules.
 *
 * Corridor doors must sit flush between lateral stone so keypad diagonals
 * (1/3/7/9) cannot squeeze past without entering the door tile.
 *
 * Keep engine copies in sync:
 * - public/engine/global.js → closedDoorBlocksDiagonal
 * - public/engine/create.js → sealDoorThroats / doorCorridorAxis
 */

/**
 * @param {'ew'|'ns'|null} axis  ew = floor east+west (travel E–W); ns = floor north+south
 * @returns {{dx:number,dy:number}[]} lateral offsets that must be stone
 */
export const doorLateralOffsets = (axis) => {
  if (axis === "ew") return [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }];
  if (axis === "ns") return [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
  return [];
};

/**
 * Infer corridor axis from opposite open floors (not walls/doors).
 * @param {{n:boolean,s:boolean,e:boolean,w:boolean}} open
 * @returns {'ew'|'ns'|null}
 */
export const doorCorridorAxisFromOpen = (open) => {
  const ew = !!(open.e && open.w);
  const ns = !!(open.n && open.s);
  if (ew && !ns) return "ew";
  if (ns && !ew) return "ns";
  return null;
};

/**
 * Diagonal step from (fx,fy) → (tx,ty) squeezes past a closed door when either
 * orthogonal neighbor cell on the move is a closed door.
 * @param {number} fx
 * @param {number} fy
 * @param {number} tx
 * @param {number} ty
 * @param {(x:number,y:number)=>boolean} isClosedDoor
 */
export const diagonalSqueezesPastClosedDoor = (fx, fy, tx, ty, isClosedDoor) => {
  const dx = tx - fx;
  const dy = ty - fy;
  if (dx === 0 || dy === 0) return false;
  return !!(isClosedDoor(fx + dx, fy) || isClosedDoor(fx, fy + dy));
};

/**
 * True when a walkable diagonal step links one passage side of a corridor door
 * to the other without entering the door cell (generation failure).
 * @param {number} x door x
 * @param {number} y door y
 * @param {'ew'|'ns'} axis
 * @param {(x:number,y:number)=>boolean} isWalkable  floorish (not wall/door)
 */
export const doorHasDiagonalBypass = (x, y, axis, isWalkable) => {
  if (!axis) return false;
  const sideA = axis === "ew" ? [[x - 1, y]] : [[x, y - 1]];
  const sideB = axis === "ew" ? [[x + 1, y]] : [[x, y + 1]];
  const near = (cells) => {
    const out = [];
    for (const [cx, cy] of cells) {
      if (!isWalkable(cx, cy)) continue;
      out.push([cx, cy]);
      for (const [dx, dy] of [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ]) {
        const nx = cx + dx,
          ny = cy + dy;
        if (nx === x && ny === y) continue;
        if (isWalkable(nx, ny)) out.push([nx, ny]);
      }
    }
    return out;
  };
  const aCells = near(sideA);
  const bSet = new Set(near(sideB).map(([bx, by]) => `${bx},${by}`));
  for (const [ax, ay] of aCells) {
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const nx = ax + dx,
        ny = ay + dy;
      if (nx === x && ny === y) continue;
      if (bSet.has(`${nx},${ny}`)) return true;
    }
  }
  return false;
};
