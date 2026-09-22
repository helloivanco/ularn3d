import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import asar from "@electron/asar";
import protocol from "../desktop/protocol.cjs";
import { toArchivePath, toPosixPath } from "../desktop/asar-path.mjs";

const root = path.resolve("/tmp/ularn-desktop-dist");

test("desktop URLs resolve only within the bundled assets", () => {
  assert.equal(protocol.resolveAssetPath("ularn://game/", root), path.join(root, "index.html"));
  assert.equal(protocol.resolveAssetPath("ularn://game", root), path.join(root, "index.html"));
  assert.equal(protocol.resolveAssetPath("ularn://game/play/", root), path.join(root, "play/index.html"));
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
  const headers = protocol.assetHeaders(path.join(root, "index.html"));
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.match(headers["content-security-policy"], /script-src 'self';/);
  assert.match(headers["content-security-policy"], /connect-src 'self'/);
  assert.match(headers["content-security-policy"], /object-src 'none'/);
  assert.doesNotMatch(headers["content-security-policy"], /unsafe-eval/);
  assert.match(protocol.assetHeaders(path.join(root, "engine", "larn_local.html"))["content-security-policy"], /script-src 'self' 'unsafe-inline'/);
});

test("asar lookup paths use native separators for nested files", () => {
  assert.equal(toArchivePath("dist/about/index.html"), path.join("dist", "about", "index.html"));
  assert.equal(toArchivePath("dist\\about\\index.html"), path.join("dist", "about", "index.html"));
  assert.equal(toPosixPath(path.join("dist", "downloads", "Ularn.windows.exe")), "dist/downloads/Ularn.windows.exe");
});

test("asar nested game files extract with native path separators", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ularn-asar-"));
  try {
    const source = path.join(root, "app");
    await mkdir(path.join(source, "dist", "about"), { recursive: true });
    await mkdir(path.join(source, "desktop"), { recursive: true });
    await writeFile(path.join(source, "dist", "about", "index.html"), "<html>about</html>");
    await writeFile(path.join(source, "desktop", "main.cjs"), "module.exports = {}");
    const archive = path.join(root, "app.asar");
    await asar.createPackage(source, archive);
    const nested = path.join("dist", "about", "index.html");
    assert.equal(asar.extractFile(archive, toArchivePath(nested)).toString(), "<html>about</html>");
    assert.equal(toPosixPath(nested), "dist/about/index.html");
    assert.equal(asar.listPackage(archive).some((file) => toPosixPath(file).includes("/dist/downloads/")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
