import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import protocol from "../desktop/protocol.cjs";

const root = path.resolve("/tmp/ularn-desktop-dist");

test("desktop permits only reads and inserts on the configured Supabase scoreboard", () => {
  const origin = "https://ularn-test.supabase.co";
  for (const method of ["GET", "POST", "OPTIONS"])
    assert.equal(protocol.isScoreboardRequest(origin + "/rest/v1/ularn_scores?select=score", method, origin), true, method);
  for (const method of ["PUT", "PATCH", "DELETE"])
    assert.equal(protocol.isScoreboardRequest(origin + "/rest/v1/ularn_scores", method, origin), false, method);
  for (const url of [
    "https://example.com/", "http://ularn-test.supabase.co/rest/v1/ularn_scores",
    "https://ularn-test.supabase.co.evil/rest/v1/ularn_scores",
    "https://user@ularn-test.supabase.co/rest/v1/ularn_scores",
    "https://broadcast.larn.workers.dev/api/highscore/highscores/ularn",
    origin + "/rest/v1/profiles", origin + "/auth/v1/signup",
    origin + "/rest/v1/ularn_scores%2Fextra", origin + "/rest/v1/ularn_scores#fragment",
  ]) assert.equal(protocol.isScoreboardRequest(url, "GET", origin), false, url);
  assert.equal(protocol.isScoreboardRequest(origin + "/rest/v1/ularn_scores", "GET"), false);
});

test("desktop URLs resolve only within the bundled assets", () => {
  assert.equal(protocol.resolveAssetPath("ularn://game/", root), path.join(root, "index.html"));
  assert.equal(protocol.resolveAssetPath("ularn://game", root), path.join(root, "index.html"));
  assert.equal(protocol.resolveAssetPath("ularn://game/about/", root), path.join(root, "about/index.html"));
  assert.equal(protocol.resolveAssetPath("ularn://game/about/?source=desktop", root), path.join(root, "about/index.html"));
  assert.equal(protocol.resolveAssetPath("ularn://game/engine/larn_local.html?ularn=true", root), path.join(root, "engine/larn_local.html"));
  assert.equal(protocol.resolveAssetPath("ularn://game/assets/example%20file.js", root), path.join(root, "assets/example file.js"));
  for (const url of [
    "https://game/index.html", "ularn://game.evil/index.html", "ularn://evil/",
    "ularn://user@game/", "ularn://game:123/", "file:///etc/passwd",
    "ularn://game/%2e%2e%2fsecret", "ularn://game/%5c..%5csecret",
    "ularn://game/assets%2f..%2f..%2fsecret", "ularn://game/C:%5csecret",
    "ularn://game/about/%2e%2e%2f%2e%2e%2fsecret/", "ularn://game/about/%5c..%5csecret/",
    "ularn://game/secret%00.txt", "ularn://game/%invalid",
  ]) assert.equal(protocol.resolveAssetPath(url, root), null, url);
});

test("desktop responses use correct module types and restrictive CSP", () => {
  assert.match(protocol.assetHeaders("/dist/assets/game.js")["content-type"], /^text\/javascript/);
  assert.match(protocol.assetHeaders("/dist/engine/LICENSE")["content-type"], /^text\/plain/);
  const headers = protocol.assetHeaders(path.join(root, "index.html"), "https://ularn-test.supabase.co");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.match(headers["content-security-policy"], /script-src 'self';/);
  assert.match(headers["content-security-policy"], /connect-src 'self'/);
  assert.match(headers["content-security-policy"], /connect-src 'self' https:\/\/ularn-test\.supabase\.co;/);
  assert.match(headers["content-security-policy"], /object-src 'none'/);
  assert.doesNotMatch(headers["content-security-policy"], /unsafe-eval/);
  assert.match(protocol.assetHeaders(path.join(root, "engine", "larn_local.html"))["content-security-policy"], /script-src 'self' 'unsafe-inline'/);
});
