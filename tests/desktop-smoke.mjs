import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const testDirectory = await mkdtemp(path.join(tmpdir(), "ularn-desktop-test-"));
// A real first launch must create its own profile; an existing temp profile
// would hide app.setPath's requirement that the target directory exists.
const profile = path.join(testDirectory, "new-profile");
const errors = [];
const scoreConfig = JSON.parse(await readFile("dist/engine/score-config.json", "utf8"));
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
  assert.equal(page.url(), "ularn://game/play/");
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
  await expect.poll(() => page.evaluate(() => ularnAudio.metrics().playingRegion), { timeout: 10000 }).toBe("town");
  assert.equal(await page.evaluate(() => ularnAudio.metrics().contextState), "running", "Music unlocks on Play through the offline desktop host");
  await page.keyboard.press(".");
  await page.keyboard.press("S");
  assert.equal(await page.evaluate(() => ularn.save()), true);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/desktop.png" });
  await page.keyboard.press(".");
  await expect.poll(() => page.evaluate(() => {
    const metrics = ularnPersistence.metrics();
    const saved = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem("ularn3d.expedition.v1")));
    return metrics.worker && metrics.completed > 0 && saved.state.player.MOVESMADE === player.MOVESMADE;
  }), { timeout: 10000 }).toBe(true);
  assert.equal(await page.evaluate(() => {
    const saved = JSON.parse(LZString.decompressFromUTF16(localStorage.getItem("ularn3d.expedition.v1")));
    return saved.state.player.MOVESMADE === player.MOVESMADE;
  }), true, "The desktop worker saves the latest completed turn through the local protocol");
  const original = await page.evaluate(() => {
    ularn.key(".");
    // Close without an explicit Save click — pagehide / quit must persist.
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
  let scoreUploads = 0;
  await resumedPage.route(`${scoreConfig.url}/rest/v1/ularn_scores**`, route => {
    if (route.request().method() === "POST") {
      scoreUploads++;
      return route.fulfill({ status: 201 });
    }
    return route.fulfill({ json:
    new URL(route.request().url()).searchParams.get("winner") === "eq.true" ? [{
      game_id: "desktop-score", edition: "3d", ularn: true, winner: true, player_name: "Global desktop hero",
      character: "Wizard", difficulty: 1, score: 100500, time_used: 20, moves: 1200, fate: "a winner", level_name: "H", created_at: "2026-10-07T00:00:00Z",
    }] : [],
    });
  });
  assert.equal(await resumedPage.evaluate(() => {
    const score = new LocalScore(); score.gameID = "desktop-submission"; score.score = 100;
    return cloudflareWriteHighScore(score);
  }), true, "Desktop scores upload through the same durable service");
  assert.equal(scoreUploads, 1);
  assert.equal(await resumedPage.evaluate(() => ularnScoreService.status().pending), 0);
  await resumedPage.locator("#pause").click();
  await resumedPage.locator("#view-scores").click();
  await expect(resumedPage.locator("#LARN")).toContainText("Global desktop hero");
  await expect(resumedPage.locator("#engine-modal")).toBeVisible();
  await resumedPage.keyboard.press("Escape");
  await expect(resumedPage.locator("#engine-modal")).toBeHidden();
  testingNetworkBlock = true;
  assert.equal(await resumedPage.evaluate(async () => {
    try { await fetch("https://example.com/"); return false; } catch { return true; }
  }), true, "External network requests are blocked");
  await resumedPage.evaluate(() => window.open("https://example.com/"));
  assert.equal(desktop.windows().length, 1, "Remote popups are blocked");
  testingNetworkBlock = false;
  assert.deepEqual(errors, []);
  console.log("Desktop smoke passed: offline game, sandbox, movement, save/relaunch, global scoreboard, network and popup isolation.");
} finally {
  if (desktop) await desktop.close();
  await rm(testDirectory, { recursive: true, force: true });
}
