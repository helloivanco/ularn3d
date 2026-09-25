/**
 * 3D door slab orientation for Ularn corridors.
 *
 * Default door mesh (rotation.y = 0): thin along Z, wide along X — the door
 * plane blocks north↔south travel. Rotate π/2 so the plane blocks east↔west.
 *
 * Keep in sync with `doorPassageFacing3D` in src/bridge.js.
 *
 * @param {{ north: boolean, south: boolean, east: boolean, west: boolean }} open
 * @returns {number} yaw radians for the door group
 */
export const doorPassageFacingFromOpen = (open) => {
  const north = !!open.north;
  const south = !!open.south;
  const east = !!open.east;
  const west = !!open.west;
  const ns = north && south;
  const ew = east && west;
  /* N–S corridor: door plane blocks N/S travel (default mesh). */
  if (ns && !ew) return 0;
  /* E–W corridor: door plane blocks E/W travel. */
  if (ew && !ns) return Math.PI / 2;
  /* Crossroads: prefer stone on the sides — walls E+W ⇒ N–S passage door. */
  if (!east && !west && (north || south)) return 0;
  if (!north && !south && (east || west)) return Math.PI / 2;
  return 0;
};
