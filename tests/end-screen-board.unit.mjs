import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatEndScreenBoard } from "../src/online/end-board.js";
import { fetchPublicScores, interpretScoreList } from "../src/online/live.js";

const started = "2026-10-04T00:00:00.000Z";

test("a failed read is an error, and zero public rows is an empty board", () => {
  const failed = formatEndScreenBoard({ ok: false, error: "unavailable", rows: [] }, "Ularn");
  assert.match(failed, /Could not load the scoreboard\./);
  assert.match(failed, /Ularn Scoreboard/);
  assert.match(failed, /Start a new expedition/);
  assert.doesNotMatch(failed, /not available/i);
  assert.doesNotMatch(failed, /The scoreboard is empty/);
  assert.doesNotMatch(failed, /This game/);

  const empty = formatEndScreenBoard({ ok: true, rows: [] }, "Ularn");
  assert.match(empty, /The scoreboard is empty/);
  assert.doesNotMatch(empty, /not available/i);
  assert.doesNotMatch(empty, /Could not load/);
});

test("the end screen lists verified public scores and skips a client-typed score", () => {
  const text = formatEndScreenBoard({
    ok: true,
    rows: [
      { name: "Ivan", score: 999999, verified: false, flagged: false, created_at: started, who: "Ivan" },
      { name: "Ada", score: 20, verified: true, flagged: false, created_at: started, mode: "solo" },
      { name: "Bea", score: 50, verified: true, flagged: true, created_at: started, mode: "coop" },
      { name: "Cid<script>", score: 80, verified: true, flagged: false, created_at: started, mode: "coop" },
    ],
  }, "Ularn");
  assert.match(text, /1\. Cid&lt;script&gt; · 80 · verified/);
  assert.match(text, /2\. Ada · 20 · verified/);
  assert.doesNotMatch(text, /999999/);
  assert.doesNotMatch(text, /Ivan/);
  assert.doesNotMatch(text, /Bea/);
  assert.doesNotMatch(text, /<script>/);
  assert.doesNotMatch(text, /not available/i);
  assert.doesNotMatch(text, /This game/);
});

test("a query error is not the same as an empty list", () => {
  const failed = interpretScoreList({ error: { message: "nope" }, data: null });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.rows, []);
  const empty = interpretScoreList({ data: [] });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.rows, []);
  const listed = interpretScoreList({
    data: [{
      user_id: "ada",
      display_name: "Ada",
      score: 20,
      mode: "solo",
      verified: true,
      flagged: false,
      created_at: started,
      won: false,
      depth_reached: 3,
    }],
  }, "ada");
  assert.equal(listed.ok, true);
  assert.equal(listed.rows[0].score, 20);
  assert.equal(listed.rows[0].yours, true);
});

test("without a supabase client the public board read fails", async () => {
  const result = await fetchPublicScores();
  assert.equal(result.ok, false);
  assert.doesNotMatch(formatEndScreenBoard(result), /The scoreboard is empty/);
});

test("the 3D end screen does not force the local scoreboard", () => {
  const bridge = readFileSync("src/bridge.js", "utf8");
  assert.doesNotMatch(bridge, /showLocalScoreBoard/);
  assert.match(bridge, /loadPublicBoard/);
  assert.doesNotMatch(bridge, /Global scoreboard not available/);
});
