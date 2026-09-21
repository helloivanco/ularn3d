import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** Product version from package.json (Electron / website release). */
export const APP_VERSION = version;

/** Stable download URL path; the saved filename carries the version. */
export const DOWNLOAD_PATH = "/downloads/Ularn.windows.exe";

/** Filename browsers save when downloading the Windows portable build. */
export const DOWNLOAD_FILENAME = `Ularn-${APP_VERSION}.windows.exe`;

const RELEASE_BASE = `https://github.com/helloivanco/ularn3d/releases/download/v${APP_VERSION}`;

/** GitHub Release asset for the versioned Windows portable build. */
export const DOWNLOAD_RELEASE_URL = `${RELEASE_BASE}/${DOWNLOAD_FILENAME}`;

/** GitHub Release asset for the matching SHA-256 checksum file. */
export const CHECKSUM_RELEASE_URL = `${RELEASE_BASE}/SHA256SUMS.txt`;

const TOKEN = "__APP_VERSION__";

/** Replace version placeholders in HTML or text. */
export const stampVersion = (text) =>
  text.replaceAll(TOKEN, APP_VERSION).replaceAll("__DOWNLOAD_FILENAME__", DOWNLOAD_FILENAME);
