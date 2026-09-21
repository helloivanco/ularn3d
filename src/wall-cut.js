/** Camera-side wall cutaway so the hero stays visible in tight corridors.
 *  Only the column between camera and player is lowered. A radius half-disk
 *  bitten a hole in long plaza walls when walking past. */
export const WALL_FULL = 1.15;
export const WALL_CUT = 0.36;

export const wallHeight = (dx, dz, towardX, towardZ, town = false) => {
  if (town) return WALL_FULL;
  const along = dx * towardX + dz * towardZ;
  const sideways = Math.abs(dx * towardZ - dz * towardX);
  if (along > 0.2 && along < 1.55 && sideways < 0.7) return WALL_CUT;
  return WALL_FULL;
};
