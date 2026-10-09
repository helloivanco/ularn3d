import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  CHECKSUM_RELEASE_URL,
  DOWNLOAD_PATH,
  DOWNLOAD_RELEASE_URL,
} from "./app-version.mjs";

const vercelPath = "vercel.json";
const vercel = JSON.parse(readFileSync(vercelPath, "utf8"));

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

// The GitHub asset supplies its own versioned filename, including when the
// last completed Windows build is older than this website build.
vercel.headers = vercel.headers.filter(entry => entry.source !== DOWNLOAD_PATH);
setRedirect(DOWNLOAD_PATH, DOWNLOAD_RELEASE_URL);
setRedirect("/downloads/SHA256SUMS.txt", CHECKSUM_RELEASE_URL);
writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`);
if (process.env.npm_lifecycle_event === "version")
  spawnSync("git", ["add", vercelPath], { stdio: "inherit" });
