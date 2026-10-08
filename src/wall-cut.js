/** Camera-side wall cutaway so the hero stays visible in tight corridors.
 *  Only the column between camera and player is lowered. A radius half-disk
 *  bitten a hole in long plaza walls when walking past. */
export const WALL_FULL = 1.15;
export const WALL_CUT = 0.36;
export const WALL_TILE_SIZE = 1;
export const FLOOR_HEIGHT = 0.18;
export const FLOOR_CENTER_Y = -0.105;
export const FLOOR_BOTTOM_Y = FLOOR_CENTER_Y - FLOOR_HEIGHT / 2;
/** The floor box's upper face. Bodies and caps meet without overlapping skins. */
export const WALL_BASE_Y = FLOOR_CENTER_Y + FLOOR_HEIGHT / 2;

/** Join the base below the floor boxes, without coplanar overlapping sides. */
export const groundSlab = bottom => ({
  y: (FLOOR_BOTTOM_Y + bottom) / 2,
  height: FLOOR_BOTTOM_Y - bottom,
});
/** Cap on a full-height wall. Cutaway columns keep the shorter lip below. */
export const WALL_LIP = 0.08;
export const WALL_LIP_CUT = 0.028;

export const wallHeight = (dx, dz, towardX, towardZ, town = false) => {
  if (town) return WALL_FULL;
  const along = dx * towardX + dz * towardZ;
  const sideways = Math.abs(dx * towardZ - dz * towardX);
  if (along > 0.2 && along < 1.55 && sideways < 0.7) return WALL_CUT;
  return WALL_FULL;
};

/** Thickness, overhang, and cap center for the existing wall top. */
export const wallLip = (height, town = false) => {
  const cut = !town && height < WALL_FULL - 0.001;
  const thickness = cut ? WALL_LIP_CUT : WALL_LIP;
  return {
    thickness,
    overhang: WALL_TILE_SIZE,
    y: WALL_BASE_Y + height + thickness / 2,
  };
};
