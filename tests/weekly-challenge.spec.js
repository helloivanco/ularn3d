import { test, expect } from "@playwright/test";

const origin = "https://ularn-test.supabase.co";
const endpoint = `${origin}/rest/v1/ularn_scores`;
const config = { url: origin, publishableKey: "sb_publishable_test" };
const row = {
  edition: "3d", ularn: true, winner: false, difficulty: 2, time_used: 40, moves: 300,
  character: "Wizard", fate: "killed by a jackal", level_name: "2", created_at: "2026-10-20T00:00:00Z",
};

// Scores go to a fake project. Any other Supabase host is refused, so a test
// can never write to the live board.
async function mockDatabase(page, fixture) {
  await page.route("**/engine/score-config.js", route => route.fulfill({
    contentType: "text/javascript", body: `window.ULARN_SCORE_CONFIG = ${JSON.stringify(config)};`,
  }));
  await page.route(/\.supabase\.co\//, async route => {
    const request = route.request();
    if (!request.url().startsWith(endpoint)) return route.abort();
    if (request.method() === "POST") {
      const saved = { ...request.postDataJSON(), created_at: row.created_at };
      fixture.submitted.push(saved);
      if (!fixture.rows.some(old => old.game_id === saved.game_id)) fixture.rows.push(saved);
      return route.fulfill({ status: 201 });
    }
    const params = new URL(request.url()).searchParams;
    fixture.reads.push(Object.fromEntries(params));
    const winner = params.get("winner");
    const week = params.get("details->>gotw")?.slice(3);
    const id = params.get("game_id")?.slice(3);
    return route.fulfill({ json: fixture.rows.filter(saved =>
      (!winner || saved.winner === (winner === "eq.true")) &&
      (!week || saved.details?.gotw === week) && (!id || saved.game_id === id)
    ).sort((a, b) => b.score - a.score) });
  });
}

async function openTitle(page, fixture) {
  await mockDatabase(page, fixture);
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.audio.v1", JSON.stringify({ enabled: false }));
  });
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await expect(page.locator("#weekly")).toBeVisible();
}
async function playWeekly(page) {
  await page.locator("#weekly-start").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
}
async function finish(page) {
  await page.evaluate(async () => { player.GOLD = 100; await died(createMonster(GNOME), true); });
  await page.locator('.terminal-footer [data-key="return"]').click();
}

// Items and creatures of a floor, cell by cell. Layout leaves out creatures,
// which move once the hero has been on that floor.
const fingerprints = (page) => page.evaluate(() => {
  const print = (depth, creatures) => {
    let text = "";
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) {
      const item = LEVELS[depth].items[x][y], monster = LEVELS[depth].monsters[x][y];
      text += `${item ? `${item.id}:${item.arg}` : "-"}${creatures && monster ? `/${monster.arg}` : ""},`;
    }
    return fnv1a64(text);
  };
  return {
    full: [0, 1, 2, 3].map(depth => print(depth, true)),
    layout: [0, 1, 2, 3].map(depth => print(depth, false)),
    book: dnd_item.find(item => item.itemId === OBOOK.id).arg,
  };
});
// The hero reaches a floor the way a trapdoor or teleport would, sturdy
// enough that resting beside a creature there is safe.
const arrive = (page, depth) => page.evaluate(depth => {
  newcavelevel(depth);
  // Land on bare floor, as a teleport does: picking up what lies underfoot
  // would change the floor's treasure, which these checks compare.
  const bare = (x, y) => itemAt(x, y)?.matches(OEMPTY) && !monsterAt(x, y);
  if (!bare(player.x, player.y)) {
    let best = null;
    for (let x = 1; x < MAXX - 1; x++) for (let y = 1; y < MAXY - 1; y++) {
      const distance = Math.abs(x - player.x) + Math.abs(y - player.y);
      if (bare(x, y) && (!best || distance < best.distance)) best = { x, y, distance };
    }
    player.x = best.x; player.y = best.y;
  }
  player.HP = player.HPMAX = 1000;
  paint();
}, depth);
const press = async (page, keys) => {
  for (const key of keys) {
    const before = await page.evaluate(() => gtime);
    await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => gtime)).toBeGreaterThan(before);
  }
};

test("two fresh browsers get the same weekly dungeon whatever they do first", async ({ page, browser }) => {
  const fixture = { rows: [], reads: [], submitted: [] };
  await openTitle(page, fixture);
  const week = await page.evaluate(() => ularn.weekly());
  await expect(page.locator("#weekly-title")).toHaveText(`Weekly challenge · Week ${week.week}`);
  await expect(page.locator("#weekly-rules")).toContainText(`as a ${week.character} on difficulty ${week.difficulty}`);
  await expect(page.locator("#weekly-start")).toHaveText("Play");
  // The calling and difficulty chosen on the form do not apply to the week.
  await page.locator(".class-choice", { hasText: week.character === "Ogre" ? "Elf" : "Ogre" }).click();
  await page.locator("#difficulty").selectOption("10");
  await playWeekly(page);
  expect(await page.evaluate(() => [GOTW, player.char_picked, getDifficulty(), ularn.snapshot().weekly]))
    .toEqual([true, week.character, week.difficulty, { label: week.label, practice: false }]);
  expect(await page.evaluate(() => ularn.snapshot().log.join("\n"))).toContain("This is your counted run");

  // First browser: rests and walks in town, then arrives on floor 1.
  await press(page, [".", ".", "l", "l", ".", "."]);
  const first = await fingerprints(page);
  await arrive(page, 1);
  const firstArrival = await fingerprints(page);
  await press(page, [".", ".", "."]);
  const firstLater = await fingerprints(page);

  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await openTitle(other, { rows: [], reads: [], submitted: [] });
    await playWeekly(other);
    expect(await other.evaluate(() => ularn.snapshot().weekly.label)).toBe(week.label);
    // Second browser: different moves, and it goes straight to floor 3.
    await press(other, ["h", ".", "h", "j"]);
    await arrive(other, 3);
    const second = await fingerprints(other);
    await press(other, [".", "."]);

    expect(new Set(first.full.slice(1)).size).toBe(3);
    expect(second.layout[0]).toBe(first.layout[0]);
    expect(second.book).toBe(first.book);
    // Arriving on a floor neither adds nor moves anything on it.
    expect(firstArrival.full[1]).toBe(first.full[1]);
    expect(second.full[3]).toBe(first.full[3]);
    // Floors the other browser never entered match exactly.
    expect(second.full[1]).toBe(first.full[1]);
    expect(second.full[2]).toBe(first.full[2]);
    expect(firstLater.full[2]).toBe(first.full[2]);
    // Floors walked on keep the same walls, doors, stairs and treasure.
    expect(firstLater.layout[1]).toBe(first.layout[1]);
    expect((await fingerprints(other)).layout[3]).toBe(first.layout[3]);
  } finally {
    await context.close();
  }
});

test("the first weekly run counts, survives Continue, and later runs are practice", async ({ page }) => {
  const fixture = { rows: [], reads: [], submitted: [] };
  await openTitle(page, fixture);
  const week = await page.evaluate(() => ularn.weekly());
  await playWeekly(page);
  const gameID = await page.evaluate(() => gameID);
  expect(gameID).toMatch(new RegExp(`^w${week.label}-`));

  await page.locator("#pause").click();
  await page.locator("#save-exit").click();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await expect(page.locator("#weekly-start")).toHaveText("Continue");
  await expect(page.locator("#weekly-status")).toHaveText("Your counted run is in progress.");
  await expect(page.locator("#save-notice")).toContainText("this week's counted run ends with it");
  await playWeekly(page);
  expect(await page.evaluate(() => [gameID, GOTW, ularn.snapshot().weekly])).toEqual([gameID, true, { label: week.label, practice: false }]);

  await finish(page);
  await expect(page.locator("#LARN")).toContainText("Ularn Weekly Global Scoreboard");
  await expect(page.locator('#LARN [data-score-latest="true"] .score-latest-position')).toHaveText("Weekly visitors · #1");
  await expect(page.locator("#LARN .score-current")).toContainText("← You");
  await expect(page.locator("#global-scores")).toHaveText("Weekly board");
  await expect(page.locator("#score-sync-status")).toContainText("saved globally");
  expect(fixture.submitted).toHaveLength(1);
  expect(fixture.submitted[0]).toMatchObject({ game_id: gameID, character: week.character, difficulty: week.difficulty, details: { gotw: week.label } });
  expect(fixture.reads.at(-1)).toMatchObject({ "details->>gotw": `eq.${week.label}` });

  // Back on the title screen the week is used: the board marks this run and
  // another week's run stays off it.
  fixture.rows.push(
    { ...row, game_id: "w-this-week", player_name: "Rival", score: 900, details: { gotw: week.label } },
    { ...row, game_id: "w-last-week", player_name: "Last Week", score: 5000, details: { gotw: "2020_1" } },
  );
  await page.locator("#new-after-death").click();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await expect(page.locator("#weekly-start")).toHaveText("Practice");
  await expect(page.locator("#weekly-status")).toHaveText("Your run: 100, killed by a gnome on H. Practice runs are not recorded.");
  await page.locator("#weekly-board").click();
  await expect(page.locator("#weekly-board-title")).toHaveText(`Weekly board · Week ${week.week}`);
  await expect(page.locator("#weekly-board-list li")).toHaveText([
    "Rival · 900 · killed by a jackal on 2",
    "Adventurer · 100 · killed by a gnome on H ← You",
  ]);
  await expect(page.locator("#weekly-board-list li.yours")).toHaveCount(1);
  await page.locator("#weekly-dialog .dialog-x").click();

  // A second run the same week is the same dungeon, but nothing records it.
  await playWeekly(page);
  expect(await page.evaluate(() => ularn.snapshot().weekly)).toEqual({ label: week.label, practice: true });
  expect(await page.evaluate(() => ularn.snapshot().log.join("\n"))).toContain("This is a practice run");
  await finish(page);
  await expect(page.locator("#LARN")).toContainText("Ularn Weekly Global Scoreboard");
  await expect(page.locator("#score-sync-status")).toHaveText("Practice runs are not recorded.");
  expect(fixture.submitted).toHaveLength(1);
  // Not in local records either, and the counted run stays the week's attempt.
  expect(await page.evaluate(() => [localStorageGetObject("losers", []).map(score => score.gameID), ularn.weekly().attempt.gameID]))
    .toEqual([[gameID], gameID]);
});

test("ordinary expeditions keep the global board and no week", async ({ page }) => {
  const fixture = { rows: [], reads: [], submitted: [] };
  await openTitle(page, fixture);
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  expect(await page.evaluate(() => [GOTW, ularn.snapshot().weekly, ularn.weekly().attempt])).toEqual([false, null, null]);
  await finish(page);
  await expect(page.locator("#LARN")).toContainText("Ularn Global Scoreboard");
  await expect(page.locator("#global-scores")).toHaveText("Global scores");
  expect(fixture.submitted[0].details).not.toHaveProperty("gotw");
  expect(fixture.reads.every(params => !("details->>gotw" in params))).toBe(true);
});
