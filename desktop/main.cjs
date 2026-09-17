const { app, BrowserWindow, Menu, protocol, session } = require("electron");
const path = require("node:path");
const { mkdirSync } = require("node:fs");
const { readFile } = require("node:fs/promises");
const { APP_ORIGIN, SCHEME, isLocalURL, resolveAssetPath, assetHeaders } = require("./protocol.cjs");

app.setName("Ularn");
// Portable and installed editions keep the same saves across upgrades; never
// store progress in an install directory or a portable executable's temp path.
const profilePath = !app.isPackaged && process.env.ULARN_USER_DATA
  ? path.resolve(process.env.ULARN_USER_DATA)
  : path.join(app.getPath("appData"), "Ularn");
mkdirSync(profilePath, { recursive: true });
app.setPath("userData", profilePath);
app.setPath("sessionData", profilePath);

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

let mainWindow;
const webPreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  backgroundThrottling: true,
};

function secureWindow(window) {
  let closing = false;
  window.setMenu(null);
  window.webContents.on("will-navigate", (event, url) => {
    if (!isLocalURL(url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => ({
    action: isLocalURL(url) ? "allow" : "deny",
    overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences },
  }));
  window.webContents.on("did-create-window", secureWindow);
  window.on("close", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    // A player can close the window before the browser's debounced autosave.
    // The bridge rejects unfinished prompts, preserving the last stable turn.
    const contents = window.webContents;
    let deadline;
    Promise.race([
      contents.executeJavaScript("window.ularn?.save?.()", true).catch(() => {}),
      new Promise((resolve) => { deadline = setTimeout(resolve, 1000); }),
    ]).finally(() => {
      clearTimeout(deadline);
      if (window.isDestroyed()) return;
      contents.session.flushStorageData();
      window.close();
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Ularn — The Caves Below",
    width: 1440, height: 960, minWidth: 800, minHeight: 600,
    backgroundColor: "#101c20", show: false, autoHideMenuBar: true,
    webPreferences,
  });
  secureWindow(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(`${APP_ORIGIN}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(process.platform === "darwin" ? Menu.buildFromTemplate([
      { role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" },
    ]) : null);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest({
      urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
    }, (_details, callback) => callback({ cancel: true }));
    const root = path.join(app.getAppPath(), "dist");
    protocol.handle(SCHEME, async (request) => {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method not allowed", { status: 405 });
      const file = resolveAssetPath(request.url, root);
      if (!file) return new Response("Forbidden", { status: 403 });
      try {
        const body = await readFile(file);
        return new Response(request.method === "HEAD" ? null : body, { headers: assetHeaders(file) });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error) => {
    console.error("Ularn desktop could not start:", error);
    app.exit(1);
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    if (app.isReady()) session.defaultSession.flushStorageData();
  });
}
