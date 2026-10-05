import { publicBoard } from "../../supabase/functions/_shared/submit.js";

const END_BOARD_ERROR = "Could not load the scoreboard.";
const END_BOARD_EMPTY = "The scoreboard is empty";

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * Text for the expedition-ended scoreboard.
 * Rows must already be the public board (verified, unflagged). The client score is not an argument.
 */
export const formatEndScreenBoard = (result, gameName = "Ularn") => {
  const header = `                    <b>${escapeHtml(gameName)} Scoreboard</b>\n\n`;
  const footer = `\n\n                 ----  Start a new expedition to play again  ----`;
  if (!result?.ok) return `${header}  ${END_BOARD_ERROR}${footer}`;
  const rows = publicBoard(result.rows).filter((row) => Number.isFinite(Number(row.score)));
  if (!rows.length) return `${header}  ${END_BOARD_EMPTY}${footer}`;
  const lines = rows.map((row, index) => {
    const name = escapeHtml(row.name || "Player");
    return `  ${index + 1}. ${name} · ${Number(row.score)} · verified`;
  });
  if (!lines.length) return `${header}  ${END_BOARD_EMPTY}${footer}`;
  return `${header}${lines.join("\n")}${footer}`;
};
