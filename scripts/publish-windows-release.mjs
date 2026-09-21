import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { APP_VERSION, DOWNLOAD_FILENAME } from "./app-version.mjs";

const portable = "release/Ularn.windows.exe";
const versioned = `release/${DOWNLOAD_FILENAME}`;
const sidecar = "release/Ularn.windows.exe.sha256";
const sums = "release/SHA256SUMS.txt";
const tag = `v${APP_VERSION}`;

copyFileSync(portable, versioned);
const hash = readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error(`Invalid checksum sidecar: ${sidecar}`);
writeFileSync(sums, `${hash}  ${DOWNLOAD_FILENAME}\n`);

const runGh = (args) => spawnSync("gh", args, { stdio: "inherit", encoding: "utf8" });
const exists = spawnSync("gh", ["release", "view", tag], { encoding: "utf8" });
const files = [versioned, sums];
const result = exists.status === 0
  ? runGh(["release", "upload", tag, ...files, "--clobber"])
  : runGh([
      "release", "create", tag,
      "--title", `Ularn ${APP_VERSION}`,
      "--notes", `Windows portable download for Ularn ${APP_VERSION}.`,
      ...files,
    ]);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`published ${DOWNLOAD_FILENAME} as ${tag}`);
