import test from "node:test";
import assert from "node:assert/strict";
import { windowsDownload, selectWindowsAsset } from "../api/windows-download.js";

const asset = name => ({ name, state: "uploaded", size: 100,
  digest: `sha256:${"a".repeat(64)}`,
  browser_download_url: `https://github.com/helloivanco/ularn3d/releases/download/v1.3.69/${name}` });
const release = { tag_name: "v1.3.69", draft: false, prerelease: false,
  assets: [asset("Ularn-1.3.69.windows.exe"), asset("SHA256SUMS.txt")] };
const request = (path = "", method = "GET") => new Request(`https://ularn-3d.vercel.app/api/windows-download${path}`, { method });

test("download and checksum resolve the last completed build's version rather than the web version", async () => {
  const fetcher = async url => {
    assert.equal(url, "https://api.github.com/repos/helloivanco/ularn3d/releases/latest");
    return Response.json(release);
  };
  for (const method of ["GET", "HEAD"]) for (const checksum of [false, true]) {
    const response = await windowsDownload(request(checksum ? "?file=checksum" : "", method), fetcher);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), release.assets[checksum ? 1 : 0].browser_download_url);
    assert.match(response.headers.get("vercel-cdn-cache-control"), /s-maxage=300/);
    assert.equal(await response.text(), "");
  }
});

test("drafts, incomplete uploads, missing checksums and unexpected asset URLs never redirect", () => {
  for (const invalid of [
    { ...release, draft: true }, { ...release, prerelease: true },
    { ...release, assets: [release.assets[0]] },
    { ...release, assets: [{ ...release.assets[0], state: "new" }, release.assets[1]] },
    { ...release, assets: [{ ...release.assets[0], digest: null }, release.assets[1]] },
    { ...release, assets: [{ ...release.assets[0], browser_download_url: "https://example.com/wrong.exe" }, release.assets[1]] },
  ]) assert.throws(() => selectWindowsAsset(invalid));
});

test("GitHub outages fail explicitly without caching an error as a download", async t => {
  t.mock.method(console, "error", () => {});
  for (const fetcher of [async () => new Response("unavailable", { status: 503 }), async () => { throw new Error("network failure"); }]) {
    const response = await windowsDownload(request(), fetcher);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("location"), null);
  }
});

test("unsupported methods and arbitrary download selections do not call GitHub", async () => {
  const fetcher = async () => { throw new Error("should not fetch"); };
  assert.equal((await windowsDownload(request("", "POST"), fetcher)).status, 405);
  assert.equal((await windowsDownload(request("?file=other"), fetcher)).status, 400);
});
