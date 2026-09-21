import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { APP_VERSION, CHECKSUM_RELEASE_URL, DOWNLOAD_FILENAME, DOWNLOAD_PATH, DOWNLOAD_RELEASE_URL } from "./app-version.mjs";

/** Shipped game, site, and desktop files. Changing them is a product release. */
export const PRODUCT_PATHS = [
  "src/",
  "public/",
  "desktop/",
  "index.html",
  "vite.config.js",
  "scripts/app-version.mjs",
  "scripts/build-engine.mjs",
  "vercel.json",
  "package.json",
];

export const isProductPath = (file) =>
  PRODUCT_PATHS.some((prefix) => file === prefix.replace(/\/$/, "") || file.startsWith(prefix));

export const parseVersion = (value) => {
  const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid product version: ${value}`);
  return match.slice(1).map(Number);
};

export const versionGreater = (left, right) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export const dispositionHeader = (vercel) =>
  (vercel.headers || [])
    .flatMap((entry) => entry.headers || [])
    .find((header) => header.key === "Content-Disposition")?.value;

export const redirectDestination = (vercel, source) =>
  (vercel.redirects || []).find((item) => item.source === source)?.destination;

/** package.json, lockfile, Vercel filename, and GitHub Release download URL must share one version. */
export const checkStampedVersion = () => {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const vercel = readJson("vercel.json");
  if (pkg.scripts?.version !== "node scripts/sync-version.mjs") {
    throw new Error('package.json is missing "version": "node scripts/sync-version.mjs"');
  }
  if (pkg.version !== APP_VERSION) {
    throw new Error(`app-version.mjs read ${APP_VERSION} but package.json is ${pkg.version}`);
  }
  if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) {
    throw new Error(`package-lock.json version does not match package.json ${pkg.version}`);
  }
  const expected = `attachment; filename="${DOWNLOAD_FILENAME}"`;
  const disposition = dispositionHeader(vercel);
  if (disposition !== expected) {
    throw new Error(`vercel.json Content-Disposition is ${disposition}; expected ${expected}. Run npm version patch|minor|major.`);
  }
  const exeRedirect = redirectDestination(vercel, DOWNLOAD_PATH);
  if (exeRedirect !== DOWNLOAD_RELEASE_URL) {
    throw new Error(`vercel.json download redirect is ${exeRedirect}; expected ${DOWNLOAD_RELEASE_URL}. Run npm version patch|minor|major.`);
  }
  const checksumRedirect = redirectDestination(vercel, "/downloads/SHA256SUMS.txt");
  if (checksumRedirect !== CHECKSUM_RELEASE_URL) {
    throw new Error(`vercel.json checksum redirect is ${checksumRedirect}; expected ${CHECKSUM_RELEASE_URL}. Run npm version patch|minor|major.`);
  }
  return pkg.version;
};

export const resolveBaseRef = () => {
  if (process.env.VERSION_BASE) return process.env.VERSION_BASE;
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  return "origin/main";
};

export const readBaseVersion = (base) => {
  const result = spawnSync("git", ["show", `${base}:package.json`], { encoding: "utf8" });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout).version;
  } catch {
    return null;
  }
};

export const changedProductFiles = (base) => {
  const result = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git diff ${base}...HEAD failed`);
  }
  return result.stdout.split("\n").filter(Boolean).filter(isProductPath);
};

/**
 * Product-changing PRs must increase package.json vs the base branch.
 * npm version restamps the Vercel download filename so web and exe cannot drift.
 */
export const checkReleaseBump = () => {
  const version = checkStampedVersion();
  const base = resolveBaseRef();
  const baseVersion = readBaseVersion(base);
  if (!baseVersion) return { version, base, skipped: true };
  if (versionGreater(version, baseVersion)) return { version, base, baseVersion };
  if (version !== baseVersion) {
    throw new Error(`package.json version ${version} must be greater than ${base} (${baseVersion})`);
  }
  const files = changedProductFiles(base);
  if (files.length) {
    throw new Error(
      `Product files changed vs ${base} (${baseVersion}) but package.json is still ${version}. ` +
        "Run npm version patch (or minor / major) so the play page, about footer, JSON-LD, Electron, " +
        "and Windows download filename all pick up a new release.",
    );
  }
  return { version, base, baseVersion };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = checkReleaseBump();
  if (result.skipped) console.log(`product version ${result.version}; no ${result.base} to compare`);
  else console.log(`product version ${result.version} (base ${result.base} ${result.baseVersion})`);
}
