import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import { APP_VERSION, DOWNLOAD_FILENAME, stampVersion } from "./scripts/app-version.mjs";

// The game and static guide are separate pages. Development must serve the
// same guide URL as the production static host, without an SPA catch-all.
const directoryIndex = (server) => {
  server.middlewares.use((request, _response, next) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/about/" || url.pathname === "/about")
      request.url = `/about/index.html${url.search}`;
    next();
  });
};

// Stamp product version into HTML that Vite copies from public/ without transform.
const stampPublicHtml = (root) => {
  const about = join(root, "about/index.html");
  if (!existsSync(about)) return;
  writeFileSync(about, stampVersion(readFileSync(about, "utf8")));
};

const injectAppVersion = () => ({
  name: "inject-app-version",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => stampVersion(html),
  },
  configureServer(server) {
    // Serve a stamped about page during `vite` so placeholders never reach the browser.
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url || "/", "http://localhost");
      const path = url.pathname;
      if (path !== "/about/" && path !== "/about" && path !== "/about/index.html")
        return next();
      const file = join(server.config.root, "public/about/index.html");
      if (!existsSync(file)) return next();
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(stampVersion(readFileSync(file, "utf8")));
    });
  },
  closeBundle() {
    // Public HTML is copied as-is; stamp version tokens after the copy lands in dist/.
    stampPublicHtml(join(process.cwd(), "dist"));
  },
  buildStart() {
    this.info?.(`app version ${APP_VERSION}; download saves as ${DOWNLOAD_FILENAME}`);
  },
});

export default defineConfig({
  appType: "mpa",
  plugins: [
    {
      name: "guide-directory-index",
      configureServer: directoryIndex,
      configurePreviewServer: directoryIndex,
    },
    injectAppVersion(),
  ],
});
