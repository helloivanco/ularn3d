/* The engine's own screens (stores, the bank, the college, the trading post)
   list their choices as "a) leather armor". Pointing at one finds it, and the
   caller presses its letter: the same key a keyboard player would type. It
   only reads the text the engine drew. */

const CHOICE = /(^|\s)([a-zA-Z])\) (?=\S)/g;

/** The choices on one line of text: their key and [start, end) columns. */
export function lineChoices(line) {
  const found = [];
  for (const match of line.matchAll(CHOICE)) found.push({ key: match[2], start: match.index + match[1].length });
  return found.map((choice, index) => {
    // A choice runs to the next one on the line, without the padding before it.
    const next = index + 1 < found.length ? found[index + 1].start : line.length;
    return { ...choice, end: choice.start + line.slice(choice.start, next).trimEnd().length };
  });
}

/** The choice at a column of a line, or null between or outside choices. */
export function choiceAt(line, column) {
  return lineChoices(line).find(({ start, end }) => column >= start && column < end) ?? null;
}

function caretAt(x, y) {
  const position = document.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** The choice under a point in the engine's text, with a Range over it, or null. */
export function pointedChoice(root, x, y) {
  const caret = caretAt(x, y);
  if (!caret || !root.contains(caret.node) || caret.node.nodeType !== Node.TEXT_NODE) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  let at = -1, total = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === caret.node) at = total + caret.offset;
    nodes.push({ node, from: total });
    total += node.data.length;
  }
  if (at < 0) return null;
  const text = nodes.map(({ node }) => node.data).join("");
  const lineStart = text.lastIndexOf("\n", at - 1) + 1, lineEnd = text.indexOf("\n", at);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  const choice = choiceAt(line, at - lineStart);
  if (!choice) return null;
  // The caret snaps to the nearer character edge; make sure the point is on the text itself.
  const range = document.createRange();
  const place = (offset, edge) => {
    const { node, from } = nodes.findLast(({ from }) => from <= offset);
    range[edge](node, Math.min(offset - from, node.data.length));
  };
  place(lineStart + choice.start, "setStart");
  place(lineStart + choice.end, "setEnd");
  const inside = [...range.getClientRects()].some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  return inside ? { key: choice.key, range } : null;
}
