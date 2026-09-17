import { defineConfig } from "vite";

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

export default defineConfig({
  appType: "mpa",
  plugins: [{
    name: "guide-directory-index",
    configureServer: directoryIndex,
    configurePreviewServer: directoryIndex,
  }],
});
