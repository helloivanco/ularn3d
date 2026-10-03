/** Camera-side wall cutaway so the hero stays visible in tight corridors.
 *  Only the column between camera and player is lowered. A radius half-disk
 *  bitten a hole in long plaza walls when walking past. */
export const WALL_FULL = 1.15;
export const WALL_CUT = 0.36;
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
  if (!cut) return { thickness: WALL_LIP, overhang: 1.015, y: height + 0.025 };
  return {
    thickness: WALL_LIP_CUT,
    overhang: 0.992,
    y: height + WALL_LIP_CUT * 0.35,
  };
};
