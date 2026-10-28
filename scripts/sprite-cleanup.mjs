/*
 * Pixel clean-up for the generated item art, run once by
 * scripts/bake-item-art.mjs. The game ships the result and does no pixel work.
 */

// Generated sprites often sit on a pale card, sometimes a baked checkerboard.
// Flood-fill that plate from the edges so the item floats on the dungeon floor
// without a white halo. The fill is 4-connected and only takes neutral pixels,
// so it cannot slip through a one-pixel diagonal outline into white diamond
// facets, steel blades or a lavender bottle. Hit testing still uses the
// original plane, so click targets do not shrink.
export function stripPaleSpriteBackground(imageData, sat = 12, lumaMin = 168, alphaCut = 10) {
  const { data, width: w, height: h } = imageData;
  const n = w * h;
  const mark = new Uint8Array(n);
  const stack = [];
  const spread = (o) => {
    const r = data[o],
      g = data[o + 1],
      b = data[o + 2];
    return (r > g ? (r > b ? r : b) : g > b ? g : b) - (r < g ? (r < b ? r : b) : g < b ? g : b);
  };
  const luma = (o) => (data[o] + data[o + 1] + data[o + 2]) / 3;
  const isPale = (i) => {
    const o = i * 4;
    return data[o + 3] < alphaCut || (spread(o) <= sat && luma(o) >= lumaMin);
  };
  const push = (i) => {
    if (mark[i] || !isPale(i)) return;
    mark[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x + 1 < w) push(i + 1);
    if (i >= w) push(i - w);
    if (i + w < n) push(i + w);
  }
  clearEnclosedCheckers(imageData, mark, alphaCut);
  for (let i = 0; i < n; i++) {
    if (!mark[i]) continue;
    const o = i * 4;
    data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
  }
  return imageData;
}

// Ring and belt holes keep the generator's two-tone checker, out of reach of
// the edge fill. Clear an enclosed region only when it is a sharp neutral
// checker ringed mostly by dark or saturated item pixels; polished highlights
// and glass sit inside more bright material and stay.
function clearEnclosedCheckers({ data, width: w, height: h }, mark, alphaCut) {
  const n = w * h;
  const spread = (o) => Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]);
  const luma = (o) => (data[o] + data[o + 1] + data[o + 2]) / 3;
  const isCard = (i) => data[i * 4 + 3] >= alphaCut && spread(i * 4) <= 6 && luma(i * 4) >= 200;
  const seen = new Uint8Array(n);
  const minSize = Math.round(n * 0.0045);
  for (let start = 0; start < n; start++) {
    if (mark[start] || seen[start] || !isCard(start)) continue;
    const part = [start];
    seen[start] = 1;
    let light = 0, mid = 0, pairs = 0, sharp = 0, rim = 0, solid = 0;
    for (let k = 0; k < part.length; k++) {
      const i = part[k], x = i % w, l = luma(i * 4);
      if (l >= 244) light++;
      else if (l <= 236) mid++;
      for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || mark[j]) continue;
        if (!isCard(j)) {
          rim++;
          if (luma(j * 4) < 150 || spread(j * 4) > 40) solid++;
          continue;
        }
        if (j > i) {
          pairs++;
          if (Math.abs(luma(j * 4) - l) >= 12) sharp++;
        }
        if (!seen[j]) {
          seen[j] = 1;
          part.push(j);
        }
      }
    }
    const size = part.length;
    const checker = sharp / Math.max(1, pairs) >= 0.12 && light / size >= 0.15 && mid / size >= 0.15;
    if (size >= minSize && checker && solid / Math.max(1, rim) >= 0.35) for (const i of part) mark[i] = 1;
  }
}

/**
 * Copy neighboring item colors into fully transparent pixels (alpha stays 0).
 * Mipmaps average color and alpha separately, so transparent black would
 * otherwise darken every edge as the 256 px art shrinks to tile size.
 */
export function bleedTransparentEdges(imageData, passes = 6) {
  const { data, width: w, height: h } = imageData;
  let filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = data[i * 4 + 3] > 0 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = filled.slice();
    let changed = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!filled[j]) continue;
        r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; count++;
      }
      if (!count) continue;
      data[i * 4] = r / count; data[i * 4 + 1] = g / count; data[i * 4 + 2] = b / count;
      next[i] = 1; changed = true;
    }
    filled = next;
    if (!changed) break;
  }
  return imageData;
}
