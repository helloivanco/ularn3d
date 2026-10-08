import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION, DOWNLOAD_FILENAME } from "./app-version.mjs";
import { versionGreater } from "./check-release-version.mjs";

const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const defaultGh = args => spawnSync("gh", args, { encoding: "utf8" });

export function publishWindowsRelease({ version = APP_VERSION, directory = "release", gh = defaultGh,
  target = process.env.GITHUB_SHA } = {}) {
  const repo = "helloivanco/ularn3d", tag = `v${version}`;
  const portable = join(directory, DOWNLOAD_FILENAME);
  const bytes = readFileSync(portable), hash = digest(bytes);
  const sidecar = readFileSync(`${portable}.sha256`, "utf8").trim().split(/\s+/)[0];
  if (bytes[0] !== 77 || bytes[1] !== 90 || hash !== `sha256:${sidecar}`)
    throw new Error("The portable executable does not match its verified checksum.");

  const versionedName = `Ularn-${version}.windows.exe`;
  const versioned = join(directory, versionedName), sums = join(directory, "SHA256SUMS.txt");
  copyFileSync(portable, versioned);
  writeFileSync(`${portable}.sha256`, `${hash.slice(7)}  ${DOWNLOAD_FILENAME}\n`);
  writeFileSync(sums, `${hash.slice(7)}  ${DOWNLOAD_FILENAME}\n${hash.slice(7)}  ${versionedName}\n`);
  const expected = [
    { name: DOWNLOAD_FILENAME, size: bytes.length, digest: hash },
    { name: versionedName, size: bytes.length, digest: hash },
    { name: `${DOWNLOAD_FILENAME}.sha256`, size: readFileSync(`${portable}.sha256`).length, digest: digest(readFileSync(`${portable}.sha256`)) },
    { name: "SHA256SUMS.txt", size: readFileSync(sums).length, digest: digest(readFileSync(sums)) },
  ];
  const run = args => {
    const result = gh(args);
    if (result.status !== 0) throw new Error(result.stderr || `GitHub command failed: ${args.slice(0, 2).join(" ")}`);
    return result.stdout;
  };
  // The tag endpoint returns published releases only. Listing includes drafts
  // for the writer, and reading by ID works before publication.
  const locate = () => JSON.parse(run(["api", `repos/${repo}/releases?per_page=100`])).find(release => release.tag_name === tag);
  const ready = (release, manifest = expected) => manifest.every(file => release.assets?.some(asset =>
    asset.name === file.name && asset.state === "uploaded" && asset.size === file.size && asset.digest === file.digest));
  let found = locate();
  if (found && !found.draft) {
    // Rebuilt NSIS files can differ by timestamps. Preserve the published
    // payload, checking its aliases and checksums against its own digest.
    const exe = found.assets?.find(asset => asset.name === DOWNLOAD_FILENAME);
    if (!/^sha256:[a-f0-9]{64}$/.test(exe?.digest || '') || exe.size < 2)
      throw new Error("Published Windows executable is missing or unverified.");
    const publishedHash = exe.digest.slice(7);
    const sidecarText = `${publishedHash}  ${DOWNLOAD_FILENAME}\n`;
    const sumsText = `${sidecarText}${publishedHash}  ${versionedName}\n`;
    const published = [
      { name: DOWNLOAD_FILENAME, size: exe.size, digest: exe.digest },
      { name: versionedName, size: exe.size, digest: exe.digest },
      { name: `${DOWNLOAD_FILENAME}.sha256`, size: Buffer.byteLength(sidecarText), digest: digest(sidecarText) },
      { name: "SHA256SUMS.txt", size: Buffer.byteLength(sumsText), digest: digest(sumsText) },
    ];
    if (!ready(found, published)) throw new Error("Published release assets differ; keep existing downloads intact and repair them explicitly.");
    return { tag, alreadyPublished: true };
  }
  if (!found) {
    const commit = target || spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("A tested commit is required to create the release tag.");
    run(["release", "create", tag, "--repo", repo, "--draft", "--target", commit,
      "--title", `Ularn ${version}`, "--notes", `Windows portable download for Ularn ${version}.`]);
    found = locate();
  }
  if (!Number.isSafeInteger(found?.id)) throw new Error("Could not resolve the draft release ID.");
  run(["release", "upload", tag, portable, versioned, `${portable}.sha256`, sums, "--repo", repo, "--clobber"]);
  const uploaded = JSON.parse(run(["api", `repos/${repo}/releases/${found.id}`]));
  if (!ready(uploaded)) throw new Error("Uploaded asset checksums or sizes do not match; the release stays a draft.");
  const latest = gh(["api", `repos/${repo}/releases/latest`]);
  if (latest.status !== 0 && !/\b404\b/.test(latest.stderr || "")) throw new Error(latest.stderr || "Could not inspect the latest release.");
  const newer = latest.status === 0 && versionGreater(JSON.parse(latest.stdout).tag_name.replace(/^v/, ""), version);
  run(["release", "edit", tag, "--repo", repo, "--draft=false", `--latest=${!newer}`]);
  return { tag, alreadyPublished: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`published ${publishWindowsRelease().tag} with verified stable and versioned Windows downloads`);
}
