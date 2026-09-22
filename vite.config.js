import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { APP_VERSION, DOWNLOAD_FILENAME, stampVersion } from "./scripts/app-version.mjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const staticDirs = ["about", "credits"];

// Marketing pages live under public/; play and home are Vite HTML entries.
const directoryIndex = (server) => {
  server.middlewares.use((request, _response, next) => {
    const url = new URL(request.url, "http://localhost");
    for (const dir of staticDirs) {
      if (url.pathname === `/${dir}/` || url.pathname === `/${dir}`) {
        request.url = `/${dir}/index.html${url.search}`;
        break;
      }
    }
    if (url.pathname === "/play" || url.pathname === "/play/") {
      request.url = `/play/index.html${url.search}`;
    }
    next();
  });
};

const stampPublicHtmlTree = (root) => {
  for (const dir of staticDirs) {
    const file = join(root, dir, "index.html");
    if (!existsSync(file)) continue;
    writeFileSync(file, stampVersion(readFileSync(file, "utf8")));
  }
};

const serveStampedPublicPage = (server) => {
  server.middlewares.use((request, response, next) => {
    const url = new URL(request.url || "/", "http://localhost");
    const path = url.pathname;
    const match = staticDirs.find(
      (dir) => path === `/${dir}/` || path === `/${dir}` || path === `/${dir}/index.html`
    );
    if (!match) return next();
    const file = join(server.config.root, "public", match, "index.html");
    if (!existsSync(file)) return next();
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(stampVersion(readFileSync(file, "utf8")));
  });
};

const injectAppVersion = () => ({
  name: "inject-app-version",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => stampVersion(html),
  },
  configureServer(server) {
    serveStampedPublicPage(server);
  },
  closeBundle() {
    stampPublicHtmlTree(join(process.cwd(), "dist"));
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
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, "index.html"),
        play: resolve(rootDir, "play/index.html"),
      },
    },
  },
});
