import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DOWNLOAD_FILENAME } from "./app-version.mjs";

const vercelPath = "vercel.json";
const vercel = JSON.parse(readFileSync(vercelPath, "utf8"));
let found = false;
for (const entry of vercel.headers || []) {
  for (const header of entry.headers || []) {
    if (header.key !== "Content-Disposition") continue;
    header.value = `attachment; filename="${DOWNLOAD_FILENAME}"`;
    found = true;
  }
}
if (!found) throw new Error("vercel.json is missing the Windows download Content-Disposition header");
writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`);
if (process.env.npm_lifecycle_event === "version")
  spawnSync("git", ["add", vercelPath], { stdio: "inherit" });
