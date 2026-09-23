import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_VERSION, CHECKSUM_RELEASE_URL, DOWNLOAD_FILENAME, DOWNLOAD_RELEASE_URL } from "../scripts/app-version.mjs";
import {
  checkReleaseBump,
  checkStampedVersion,
  isProductPath,
  versionGreater,
} from "../scripts/check-release-version.mjs";

const htmlSources = ["index.html", "play/index.html", "public/about/index.html"];
const downloadSources = ["index.html", "play/index.html", "public/about/index.html"];

test("npm version restamp keeps package.json, lockfile, and Vercel filename together", () => {
  const version = checkStampedVersion();
  assert.equal(version, APP_VERSION);
  assert.equal(DOWNLOAD_FILENAME, `Ularn-${version}.windows.exe`);
  assert.equal(DOWNLOAD_RELEASE_URL, `https://github.com/helloivanco/ularn3d/releases/download/v${version}/${DOWNLOAD_FILENAME}`);
  assert.equal(CHECKSUM_RELEASE_URL, `https://github.com/helloivanco/ularn3d/releases/download/v${version}/SHA256SUMS.txt`);
  assert.notEqual(version, "1.0.0");
  assert.notEqual(version, "1.1.0");
  assert.notEqual(version, "1.2.0");
  assert.notEqual(version, "1.2.1");
  assert.notEqual(version, "1.3.1");
  assert.notEqual(version, "1.3.2");
  assert.notEqual(version, "1.3.3");
  assert.notEqual(version, "1.3.4");
  assert.notEqual(version, "1.3.5");
  assert.notEqual(version, "1.3.6");
  assert.notEqual(version, "1.3.7");
  assert.notEqual(version, "1.3.8");
});

test("play page and field guide stamp version from package.json placeholders", () => {
  for (const file of htmlSources) {
    const html = readFileSync(file, "utf8");
    assert.match(html, /__APP_VERSION__/);
    assert.equal(html.includes(APP_VERSION), false, `${file} must not hardcode ${APP_VERSION}`);
    assert.doesNotMatch(html, /Ularn-1\.\d+\.\d+\.windows\.exe/);
  }
  for (const file of downloadSources) {
    assert.match(readFileSync(file, "utf8"), /__DOWNLOAD_FILENAME__/);
  }
  const home = readFileSync("index.html", "utf8");
  assert.match(home, /"softwareVersion": "__APP_VERSION__"/);
  assert.match(home, /class="footer-version"[^>]*>v__APP_VERSION__/);
  const play = readFileSync("play/index.html", "utf8");
  assert.match(play, /"softwareVersion": "__APP_VERSION__"/);
  assert.match(play, /class="site-version"[^>]*>v__APP_VERSION__/);
  const about = readFileSync("public/about/index.html", "utf8");
  assert.match(about, /class="footer-version"[^>]*>v__APP_VERSION__/);
  assert.match(about, /id="history"/);
  assert.match(about, /Noah Morgan/);
  assert.match(about, /Phil Cordier/);
  assert.doesNotMatch(about, /href="\/credits\/?"/);
  assert.doesNotMatch(home, /href="\/credits\/?"/);
  assert.doesNotMatch(play, /href="\/credits\/?"/);
  assert.match(home, /href="\/about\/#history"/);
  assert.match(play, /href="\/about\/#history"/);
});

test("Electron artifact names read package.json version", () => {
  const yaml = readFileSync("desktop/electron-builder.yml", "utf8");
  assert.match(yaml, /artifactName: Ularn-\$\{version\}-windows-\$\{arch\}\.\$\{ext\}/);
  assert.match(yaml, /artifactName: Ularn-\$\{version\}-windows-\$\{arch\}-setup\.exe/);
  assert.match(yaml, /^\s*- package\.json$/m);
});

test("product path matcher covers shipped web and exe sources", () => {
  assert.equal(isProductPath("src/world.js"), true);
  assert.equal(isProductPath("public/about/index.html"), true);
  assert.equal(isProductPath("desktop/main.cjs"), true);
  assert.equal(isProductPath("index.html"), true);
  assert.equal(isProductPath("play/index.html"), true);
  assert.equal(isProductPath("docs/DESKTOP.md"), false);
  assert.equal(isProductPath("tests/version.unit.mjs"), false);
  assert.equal(versionGreater("1.2.0", "1.1.0"), true);
  assert.equal(versionGreater("1.1.0", "1.1.0"), false);
});

test("product-changing releases must bump version relative to the base branch", () => {
  const result = checkReleaseBump();
  assert.equal(result.version, APP_VERSION);
  if (result.skipped) return;
  assert.ok(versionGreater(result.version, result.baseVersion) || result.version === result.baseVersion);
});
