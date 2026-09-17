import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import asar from "@electron/asar";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";

const run = promisify(execFile);
const executable = path.resolve(process.argv[2] || "release/Ularn.windows.exe");
const unpacked = path.resolve("release/win-unpacked");
const temporary = await mkdtemp(path.join(tmpdir(), "ularn-portable-check-"));
const sevenZip = process.env.ELECTRON_BUILDER_7ZIP_PATH || await getPath7za();

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(full));
    else if (entry.isFile()) files.push(full);
    else throw new Error(`Unexpected file type in bundle: ${full}`);
  }
  return files.sort();
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

try {
  // NSIS is a real Windows executable containing the complete compressed app.
  const header = await readFile(executable);
  assert.equal(header.subarray(0, 2).toString(), "MZ", "Portable file must be an executable");
  const peOffset = header.readUInt32LE(0x3c);
  assert.equal(header.subarray(peOffset, peOffset + 4).toString(), "PE\0\0");
  await run(sevenZip, ["t", executable], { maxBuffer: 1024 * 1024 });
  const outer = path.join(temporary, "outer");
  await run(sevenZip, ["x", "-y", `-o${outer}`, executable], { maxBuffer: 1024 * 1024 });
  const outerFiles = await filesIn(outer);
  const nested = outerFiles.filter((file) => /(?:^|[\\/])app-64\.(?:7z|zip)$/.test(file));
  let payload = outer;
  if (nested.length) {
    assert.equal(nested.length, 1, "Expected one embedded Windows x64 payload");
    payload = path.join(temporary, "payload");
    await run(sevenZip, ["x", "-y", `-o${payload}`, nested[0]], { maxBuffer: 1024 * 1024 });
  }
  const payloadFiles = await filesIn(payload);
  const archives = payloadFiles.filter((file) => file.endsWith(`${path.sep}resources${path.sep}app.asar`));
  assert.equal(archives.length, 1, "Portable executable must contain the complete game archive");
  const appRoot = path.dirname(path.dirname(archives[0]));
  const expected = await filesIn(unpacked);
  for (const source of expected) {
    const relative = path.relative(unpacked, source);
    assert.equal(await digest(path.join(appRoot, relative)), await digest(source), relative);
  }
  console.log(`Verified ${expected.length} embedded runtime files against win-unpacked.`);
  const bundledFiles = (await filesIn("dist"))
    .filter((file) => !file.startsWith(path.join("dist", "downloads") + path.sep))
    .concat(["desktop/main.cjs", "desktop/protocol.cjs"]);
  for (const file of bundledFiles) {
    assert.equal(asar.extractFile(archives[0], file.replaceAll(path.sep, "/")).equals(await readFile(file)), true,
      `Bundled file differs from current source: ${file}`);
  }
  assert.equal(asar.listPackage(archives[0]).some((file) => file.startsWith("/dist/downloads/")), false,
    "Website downloads must not be embedded recursively");
  const checksum = await digest(executable);
  await writeFile(`${executable}.sha256`, `${checksum}  ${path.basename(executable)}\n`);
  console.log(JSON.stringify({
    executable,
    bytes: (await stat(executable)).size,
    sha256: checksum,
    runtimeFilesVerified: expected.length,
    gameFilesVerified: bundledFiles.length,
    windowsExecutionTested: false,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
