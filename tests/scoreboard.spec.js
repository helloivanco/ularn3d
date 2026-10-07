import { test, expect } from "@playwright/test";

const origin = "https://ularn-test.supabase.co";
const endpoint = `${origin}/rest/v1/ularn_scores`;
const config = { url: origin, publishableKey: "sb_publishable_test" };
const globalScore = {
  game_id: "global-game", edition: "3d", ularn: true, winner: true,
  difficulty: 2, score: 200500, player_name: "Global Hero", character: "Wizard",
  time_used: 18, moves: 1200, fate: "a winner", level_name: "H",
  created_at: "2026-10-07T00:00:00Z", details: {},
};
const fixtures = new WeakMap();

async function mockDatabase(page, fixture) {
  await page.route("**/engine/score-config.js", route => route.fulfill({
    contentType: "text/javascript", body: `window.ULARN_SCORE_CONFIG = ${JSON.stringify(config)};`,
  }));
  await page.route(`${endpoint}**`, async route => {
    const request = route.request();
    fixture.requests.push(request.method());
    const params = new URL(request.url()).searchParams;
    if (request.method() === "POST") {
      fixture.submitted.push(request.postDataJSON());
      if (fixture.failUpload) return route.fulfill({ status: 503, body: "Unavailable" });
      const row = { ...request.postDataJSON(), created_at: globalScore.created_at };
      if (!fixture.rows.some(saved => saved.game_id === row.game_id && saved.edition === row.edition)) fixture.rows.push(row);
      return route.fulfill({ status: 201 });
    }
    if (fixture.delay) await fixture.delay;
    if (fixture.failRead) return route.fulfill({ status: 503, body: "Unavailable" });
    if (fixture.malformed) return route.fulfill({ json: { error: "Invalid data" } });
    const winner = params.get("winner");
    const id = params.get("game_id")?.slice(3);
    return route.fulfill({ json: fixture.rows.filter(row =>
      (!winner || row.winner === (winner === "eq.true")) && (!id || row.game_id === id)
    ) });
  });
}

test.beforeEach(async ({ page }) => {
  const fixture = { rows: [], requests: [], submitted: [] };
  fixtures.set(page, fixture);
  await mockDatabase(page, fixture);
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});

async function openScores(page) {
  await page.locator("#pause").click();
  await page.locator("#view-scores").click();
  await expect(page.locator("#engine-modal")).toBeVisible();
}
async function finish(page) {
  await page.evaluate(async () => { player.GOLD = 100; await died(GNOME, true); });
  await page.locator('.terminal-footer [data-key="return"]').click();
}

test("Supabase global records load on demand, paginate, and open details", async ({ page }) => {
  const fixture = fixtures.get(page);
  fixture.rows = Array.from({ length: 20 }, (_, index) => ({
    ...globalScore, game_id: `global-${index}`, player_name: `Global Hero ${index}`, difficulty: 20 - index,
  }));
  fixture.rows.push({ ...globalScore, game_id: "visitor", player_name: "Global Visitor", winner: false });
  fixture.rows[0].details = await page.evaluate(() => {
    const score = new LocalScore();
    return { player: JSON.parse(score.player), extra: score.extra, gamelog: ["A global expedition"] };
  });
  expect(fixture.requests).toEqual([]);
  await openScores(page);
  await expect(page.locator("#LARN")).toContainText("Ularn Global Scoreboard");
  await expect(page.locator("#LARN [data-score-game]")).toHaveCount(18);
  await page.locator('#LARN [data-score-game="global-0"]').click();
  await expect(page.locator("#score-details")).toContainText("Player: Global Hero 0");
  await expect(page.locator("#score-details")).toContainText("A global expedition");
  await page.locator('.terminal-footer [data-key="space"]').click();
  await expect(page.locator("#LARN")).toContainText("Global Hero 19");
  await page.locator('.terminal-footer [data-key="space"]').click();
  await expect(page.locator("#LARN")).toContainText("Global Visitor");
  await page.keyboard.press("Escape");
  await expect(page.locator("#engine-modal")).toBeHidden();
  expect(fixture.requests).toEqual(["GET", "GET", "GET"]);
});

test("completed scores persist to Supabase and another player can read them", async ({ page, browser }) => {
  const fixture = fixtures.get(page);
  await finish(page);
  await expect(page.locator("#LARN")).toContainText("This game");
  await expect(page.locator("#score-sync-status")).toContainText("saved globally");
  expect(fixture.submitted).toHaveLength(1);
  const saved = fixture.submitted[0];
  expect(saved).toMatchObject({ edition: "3d", score: 100, winner: false });
  for (const name of ["playerIP", "playerID", "browser", "created_at"]) expect(saved).not.toHaveProperty(name);
  expect(await page.evaluate(() => ularnScoreService.status().pending)).toBe(0);
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await mockDatabase(other, fixture);
    await other.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
    await other.goto("/play/");
    await expect(other.locator("#loading")).toBeHidden({ timeout: 15000 });
    await other.locator("#begin").click();
    await openScores(other);
    await expect(other.locator(`#LARN [data-score-game="${saved.game_id}"]`)).toHaveCount(1);
  } finally { await context.close(); }
});

test("offline scores upload when the connection returns", async ({ page, context }) => {
  const fixture = fixtures.get(page);
  await context.setOffline(true);
  await finish(page);
  await expect(page.locator("#LARN")).toContainText("Ularn Local Scoreboard");
  expect(fixture.submitted).toHaveLength(0);
  expect(await page.evaluate(() => ularnScoreService.status().pending)).toBe(1);
  await context.setOffline(false);
  await expect.poll(() => fixture.submitted.length).toBe(1);
  await expect.poll(() => page.evaluate(() => ularnScoreService.status().pending)).toBe(0);
  await page.reload();
  expect(await page.evaluate(() => ularnScoreService.status().pending)).toBe(0);
  expect(fixture.submitted).toHaveLength(1);
});

test("failed submissions survive reload and retry without duplicates", async ({ page }) => {
  const fixture = fixtures.get(page);
  fixture.failUpload = true;
  await finish(page);
  await expect.poll(() => page.evaluate(() => ularnScoreService.status().pending)).toBe(1);
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await expect.poll(() => fixture.submitted.length).toBeGreaterThanOrEqual(2);
  fixture.failUpload = false;
  await page.evaluate(() => ularnScoreService.flush());
  expect(await page.evaluate(() => ularnScoreService.status().pending)).toBe(0);
  expect(fixture.rows).toHaveLength(1);
});

test("local records remain available online and details stay local", async ({ page }) => {
  const fixture = fixtures.get(page); fixture.rows = [globalScore];
  await page.evaluate(() => {
    const score = new LocalScore(); score.gameID = "past-local-game"; score.who = "Local Hero";
    localWriteHighScore(score);
  });
  await openScores(page);
  await expect(page.locator("#LARN")).toContainText("Global Hero");
  await page.locator("#local-scores").click();
  await page.locator('#LARN [data-score-game="past-local-game"]').click();
  await expect(page.locator("#score-details")).toContainText("Player: Local Hero");
  expect(fixture.requests).toEqual(["GET", "GET"]);
});

test("failed or malformed reads fall back to local records", async ({ page }) => {
  const fixture = fixtures.get(page); fixture.failRead = true;
  await openScores(page);
  await expect(page.locator("#LARN")).toContainText("Ularn Local Scoreboard");
  await expect(page.locator("#score-details")).toContainText("Error loading global scoreboard");
  fixture.failRead = false; fixture.malformed = true;
  await page.locator("#global-scores").click();
  await expect(page.locator("#LARN")).toContainText("Ularn Local Scoreboard");
});

test("leaving during a request prevents a late response reopening the board", async ({ page }) => {
  const fixture = fixtures.get(page); let release;
  fixture.delay = new Promise(resolve => { release = resolve; });
  await openScores(page);
  await expect(page.locator("#LARN")).toContainText("Loading Scoreboard");
  await page.keyboard.press("Escape");
  const response = page.waitForResponse(url => url.url().startsWith(endpoint));
  release(); await response;
  await expect(page.locator("#engine-modal")).toBeHidden();
  expect(await page.evaluate(() => ularn.snapshot().scoreboard)).toBe(false);
});

test("empty and untrusted Supabase scores render safely", async ({ page }) => {
  const fixture = fixtures.get(page);
  fixture.rows = [{ ...globalScore, player_name: '<img src=x onerror="window.scoreInjected=true">' }];
  await openScores(page);
  await expect(page.locator("#LARN")).toContainText("<img");
  await expect(page.locator("#LARN img")).toHaveCount(0);
  expect(await page.evaluate(() => window.scoreInjected)).toBeUndefined();
  fixture.rows = [];
  await page.locator("#global-scores").click();
  await expect(page.locator("#LARN")).toContainText("The scoreboard is empty");
  await expect(page.locator("#LARN")).toContainText("Ularn Global Scoreboard");
});

test("a stalled Supabase service times out to local records", async ({ page }) => {
  fixtures.get(page).delay = new Promise(() => {});
  await openScores(page);
  await expect(page.locator("#LARN")).toContainText("Ularn Local Scoreboard", { timeout: 12000 });
});

test("debug runs stay local and no request targets larn.org", async ({ page }) => {
  const external = [];
  page.on("request", request => { if (request.url().includes("larn.workers.dev")) external.push(request.url()); });
  await page.evaluate(async () => { debug_used = true; player.GOLD = 100; await died(GNOME, true); });
  expect(fixtures.get(page).submitted).toHaveLength(0);
  expect(external).toEqual([]);
});
