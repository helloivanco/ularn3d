const REPOSITORY = "helloivanco/ularn3d";

/** Resolve the asset's own release version, which can lag the web version. */
export function selectWindowsAsset(release, checksum = false) {
  const version = /^v(\d+\.\d+\.\d+)$/.exec(release?.tag_name || "")?.[1];
  if (!version || release.draft || release.prerelease) throw new Error("No completed Windows release.");
  const name = `Ularn-${version}.windows.exe`;
  const executable = release.assets?.find(asset => asset.name === name);
  const sums = release.assets?.find(asset => asset.name === "SHA256SUMS.txt");
  for (const asset of [executable, sums]) {
    if (asset?.state !== "uploaded" || !(asset.size > 1) || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || ""))
      throw new Error("The latest release is missing a verified Windows download or checksum.");
    const expected = `https://github.com/${REPOSITORY}/releases/download/v${version}/${asset.name}`;
    if (asset.browser_download_url !== expected) throw new Error("Unexpected Windows asset URL.");
  }
  return checksum ? sums : executable;
}

export async function windowsDownload(request, fetcher = fetch) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const file = new URL(request.url).searchParams.get("file");
  if (file && file !== "checksum") return new Response("Unknown download", { status: 400 });
  try {
    const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Ularn-Windows-download" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`GitHub release lookup returned ${response.status}.`);
    const asset = selectWindowsAsset(await response.json(), file === "checksum");
    return new Response(null, {
      status: 307,
      headers: {
        Location: asset.browser_download_url,
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Vercel-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=300",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    console.error("Windows download lookup failed:", error.message);
    return new Response("Windows download is temporarily unavailable. Please try again shortly.", {
      status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }
}

export default { fetch: request => windowsDownload(request) };
