import { test, expect } from "@playwright/test";

async function start(page) {
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
}

const fillJournal = (count) => {
  const lines = Array.from({ length: count }, (_, i) => `Journal history line ${i + 1}`);
  lines.forEach((line) => updateLog(line));
  paint();
  const journal = document.getElementById("journal-lines");
  const style = getComputedStyle(journal);
  return {
    engineCount: LOG.filter((line) => String(line).trim()).length,
    snapshotCount: ularn.snapshot().log.filter((line) => String(line).trim()).length,
    rendered: journal.children.length,
    text: journal.innerText,
    canScroll: journal.scrollHeight > journal.clientHeight + 1,
    overflowY: style.overflowY,
    first: lines[0],
    last: lines.at(-1),
  };
};

test("journal keeps a deep scrollable action history past the old 7/20/60 caps", async ({ page }) => {
  await start(page);
  const result = await page.evaluate(fillJournal, 90);
  expect(result.engineCount).toBeGreaterThanOrEqual(90);
  expect(result.snapshotCount).toBe(result.engineCount);
  expect(result.rendered).toBe(result.engineCount);
  expect(result.text).toContain(result.first);
  expect(result.text).toContain(result.last);
  expect(result.canScroll).toBe(true);
  expect(["auto", "scroll", "overlay"]).toContain(result.overflowY);

  await page.evaluate(() => {
    document.getElementById("journal-lines").scrollTop = 0;
  });
  await expect(page.locator("#journal-lines")).toContainText("Journal history line 1");
  await expect(page.locator("#journal-lines")).toContainText("Journal history line 90");
  await expect(
    page.locator("#journal-lines > div").filter({ hasText: /^Journal history line 1$/ }),
  ).toHaveCount(1);

  const whileReading = await page.evaluate(() => {
    const journal = document.getElementById("journal-lines");
    journal.scrollTop = 0;
    updateLog("Later action while reading older history");
    paint();
    return {
      scrollTop: journal.scrollTop,
      hasLater: journal.innerText.includes("Later action while reading older history"),
      stillHasFirst: journal.innerText.includes("Journal history line 1"),
    };
  });
  expect(whileReading.scrollTop).toBeLessThan(48);
  expect(whileReading.hasLater).toBe(true);
  expect(whileReading.stillHasFirst).toBe(true);
});

test("deep journal history survives save and resume", async ({ page }) => {
  await start(page);
  await page.evaluate(fillJournal, 90);
  await page.locator("#save").click();
  await expect(page.locator("#toast")).toContainText("saved");
  await page.reload();
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await page.locator("#continue").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  const restored = await page.evaluate(() => {
    const journal = document.getElementById("journal-lines");
    return {
      engineCount: LOG.filter((line) => String(line).trim()).length,
      snapshotCount: ularn.snapshot().log.filter((line) => String(line).trim()).length,
      rendered: journal.children.length,
      hasFirst: journal.innerText.includes("Journal history line 1"),
      hasLast: journal.innerText.includes("Journal history line 90"),
      canScroll: journal.scrollHeight > journal.clientHeight + 1,
      logCap: LOG_JOURNAL_CAP,
    };
  });
  expect(restored.engineCount).toBeGreaterThanOrEqual(90);
  expect(restored.engineCount).toBeLessThanOrEqual(restored.logCap);
  expect(restored.snapshotCount).toBe(restored.engineCount);
  expect(restored.rendered).toBe(restored.engineCount);
  expect(restored.hasFirst).toBe(true);
  expect(restored.hasLast).toBe(true);
  expect(restored.canScroll).toBe(true);
});
