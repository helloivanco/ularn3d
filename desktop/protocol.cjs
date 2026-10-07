const path = require("node:path");
const { createHash } = require("node:crypto");

const APP_ORIGIN = "ularn://game";
const SCHEME = "ularn";
function scoreOrigin(projectURL) {
  try {
    const url = new URL(projectURL);
    return url.protocol === "https:" && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

function isScoreboardRequest(value, method, projectURL) {
  if (!["GET", "POST", "OPTIONS"].includes(method)) return false;
  try {
    const url = new URL(value);
    return url.origin === scoreOrigin(projectURL) && !url.username && !url.password &&
      !url.hash && url.pathname === "/rest/v1/ularn_scores";
  } catch {
    return false;
  }
}

function isLocalURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === `${SCHEME}:` && url.hostname === "game" &&
      !url.port && !url.username && !url.password;
  } catch {
    return false;
  }
}

// URL pathname is decoded once, before resolving, including on Windows. Reject
// encoded separators and traversal rather than trusting a URL string prefix.
function resolveAssetPath(value, root) {
  if (!isLocalURL(value)) return null;
  try {
    const pathname = decodeURIComponent(new URL(value).pathname || "/");
    if (pathname.includes("\\") || pathname.includes("\0") ||
        pathname.split("/").some((part) => part === ".." || part.includes(":")))
      return null;
    const documentPath = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    const candidate = path.resolve(root, `.${documentPath}`);
    const relative = path.relative(root, candidate);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      return null;
    return candidate;
  } catch {
    return null;
  }
}

const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function assetHeaders(file, projectURL) {
  const legacyPage = file.endsWith(`${path.sep}larn_local.html`);
  // The optional vendored classic page initializes through an inline script.
  // The 3D page only needs its existing context-recovery button's handler.
  const reloadHash = createHash("sha256").update("location.reload()").digest("base64");
  return {
    "content-type": path.basename(file) === "LICENSE" ? "text/plain; charset=utf-8" :
      types[path.extname(file).toLowerCase()] || "application/octet-stream",
    "content-security-policy": [
      "default-src 'self'", `script-src 'self'${legacyPage ? " 'unsafe-inline'" : ""}`,
      `script-src-attr ${legacyPage ? "'unsafe-inline'" : `'unsafe-hashes' 'sha256-${reloadHash}'`}`,
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
      "font-src 'self' data:", "media-src 'self' blob:", `connect-src 'self'${scoreOrigin(projectURL) ? ` ${scoreOrigin(projectURL)}` : ""}`,
      "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
      "frame-src 'none'", "frame-ancestors 'none'", "form-action 'none'",
    ].join("; "),
    "x-content-type-options": "nosniff",
  };
}

module.exports = { APP_ORIGIN, SCHEME, isLocalURL, isScoreboardRequest, resolveAssetPath, assetHeaders };
