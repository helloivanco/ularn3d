import * as THREE from "three";

const ndc = new THREE.Vector3();

/**
 * Move a world point so it projects onto a drawing-buffer pixel center.
 * Nearest-filtered sprites stop sampling between texels, which is the soft,
 * crawling edge. The pixel-ratio cap stays where it is.
 * Returns false when the point is off-screen; the caller keeps the original.
 */
export const pixelAlignWorld = (position, camera, width, height, target, hold) => {
  const out = target || position;
  if (!(width > 0) || !(height > 0)) return false;
  ndc.copy(position).project(camera);
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || ndc.z < -1 || ndc.z > 1) {
    return false;
  }
  const rawX = (ndc.x * 0.5 + 0.5) * width;
  const rawY = (ndc.y * 0.5 + 0.5) * height;
  let sx = Math.round(rawX);
  let sy = Math.round(rawY);
  // Stick to the current pixel until the point is clearly into the next one,
  // so a settled camera does not flicker on the rounding boundary.
  if (hold) {
    if (hold.x != null && Math.abs(rawX - hold.x) < 0.65) sx = hold.x;
    if (hold.y != null && Math.abs(rawY - hold.y) < 0.65) sy = hold.y;
    hold.x = sx;
    hold.y = sy;
  }
  ndc.x = (sx / width) * 2 - 1;
  ndc.y = (sy / height) * 2 - 1;
  out.copy(ndc).unproject(camera);
  return true;
};
