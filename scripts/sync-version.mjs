import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  CHECKSUM_RELEASE_URL,
  DOWNLOAD_FILENAME,
  DOWNLOAD_PATH,
  DOWNLOAD_RELEASE_URL,
} from "./app-version.mjs";

const vercelPath = "vercel.json";
const vercel = JSON.parse(readFileSync(vercelPath, "utf8"));

const setHeader = (key, value) => {
  let found = false;
  for (const entry of vercel.headers || []) {
    if (entry.source !== DOWNLOAD_PATH) continue;
    for (const header of entry.headers || []) {
      if (header.key !== key) continue;
      header.value = value;
      found = true;
    }
  }
  if (!found) throw new Error(`vercel.json is missing the ${key} header for ${DOWNLOAD_PATH}`);
};

const setRedirect = (source, destination) => {
  vercel.redirects ??= [];
  const entry = vercel.redirects.find((item) => item.source === source);
  if (!entry) {
    vercel.redirects.unshift({ source, destination, permanent: false });
    return;
  }
  entry.destination = destination;
  entry.permanent = false;
};

setHeader("Content-Disposition", `attachment; filename="${DOWNLOAD_FILENAME}"`);
setRedirect(DOWNLOAD_PATH, DOWNLOAD_RELEASE_URL);
setRedirect("/downloads/SHA256SUMS.txt", CHECKSUM_RELEASE_URL);
writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`);
if (process.env.npm_lifecycle_event === "version")
  spawnSync("git", ["add", vercelPath], { stdio: "inherit" });
