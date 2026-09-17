import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const testDirectory = await mkdtemp(path.join(tmpdir(), "ularn-desktop-test-"));
// A real first launch must create its own profile; an existing temp profile
// would hide app.setPath's requirement that the target directory exists.
const profile = path.join(testDirectory, "new-profile");
const errors = [];
let desktop;
let testingNetworkBlock = false;
async function launch() {
  desktop = await electron.launch({
    args: [".", ...(process.platform === "darwin" ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])],
    env: { ...process.env, ULARN_USER_DATA: profile },
    timeout: 60000,
  });
  const page = await desktop.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !testingNetworkBlock) console.error(`Desktop renderer: ${message.text()}`);
  });
  await page.waitForFunction(() => window.ularn && document.querySelector("#loading")?.hidden, null, { timeout: 60000 })
    .catch(async (error) => {
      console.error("Desktop loading state:", await page.locator("body").innerText(), errors);
      throw error;
    });
  return page;
}

try {
  const page = await launch();
  assert.equal(page.url(), "ularn://game/");
  assert.deepEqual(await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process })),
    { require: "undefined", process: "undefined" });
  const preferences = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.deepEqual(await desktop.evaluate(({ app }) => [app.getPath("userData"), app.getPath("sessionData")]), [profile, profile]);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  await page.locator("#hero-name").fill("Desktop verification");
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  await page.keyboard.press(".");
  await page.keyboard.press("S");
  assert.equal(await page.evaluate(() => ularn.save()), true);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/desktop.png" });
  const original = await page.evaluate(() => {
    ularn.key(".");
    // Make the close handler responsible for this last turn, as when the user
    // quits before the normal two-second autosave debounce has elapsed.
    clearTimeout(saveTimer3D);
    const { x, y, moves, hp, mana, inventory } = ularn.snapshot();
    return { x, y, moves, hp, mana, inventory };
  });
  await desktop.close();
  desktop = null;
  const resumedPage = await launch();
  await expect(resumedPage.locator("#continue")).toBeEnabled();
  await resumedPage.locator("#continue").click();
  await expect(resumedPage.locator("#hud")).toHaveJSProperty("hidden", false);
  const restored = await resumedPage.evaluate(() => {
    const { x, y, moves, hp, mana, inventory } = ularn.snapshot();
    return { x, y, moves, hp, mana, inventory };
  });
  assert.deepEqual(restored, original, "The save survives fully closing and restarting Electron");
  testingNetworkBlock = true;
  assert.equal(await resumedPage.evaluate(async () => {
    try { await fetch("https://example.com/"); return false; } catch { return true; }
  }), true, "External network requests are blocked");
  await resumedPage.evaluate(() => window.open("https://example.com/"));
  assert.equal(desktop.windows().length, 1, "Remote popups are blocked");
  testingNetworkBlock = false;
  assert.deepEqual(errors, []);
  console.log("Desktop smoke passed: offline game, sandbox, movement, save/relaunch, network and popup isolation.");
} finally {
  if (desktop) await desktop.close();
  await rm(testDirectory, { recursive: true, force: true });
}
