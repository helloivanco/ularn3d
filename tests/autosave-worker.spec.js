import { test, expect } from "@playwright/test";

async function start(page, worker = "delayed") {
  await page.route("**/rest/v1/ularn_scores**", route => route.request().method() === "POST"
    ? route.fulfill({ status: 201 }) : route.fulfill({ json: [] }));
  await page.addInitScript((kind) => {
    localStorage.setItem("ularn3d.quality", "balanced");
    const NativeWorker = window.Worker;
    window.saveJobs = []; window.saveWorkers = [];
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes("autosaveWorker")) return new NativeWorker(url, options);
        if (kind === "unavailable") throw new Error("Worker unavailable");
        saveWorkers.push(this);
      }
      postMessage(job) { saveJobs.push({ ...job }); }
      terminate() {}
    };
    window.finishSaveJob = (index) => {
      const { sequence, epoch, key, legacy, value } = saveJobs[index];
      saveWorkers[0].onmessage({ data: { sequence, epoch, key, legacy, compressed: LZString.compressToUTF16(value), compressionMs: 1 } });
    };
  }, worker);
  await page.goto("/"); await expect(page.locator("#loading")).toBeHidden(); await page.locator("#begin").click();
  await page.clock.install();
  await page.evaluate(() => {
    player.x = 33; player.y = 8;
    for (let x = 30; x < 40; x++) for (let y = 6; y < 11; y++) { setItem(x, y, OEMPTY); setMonster(x, y, null); setKnow(x, y, KNOWALL); }
    paint(); ularn.save();
  });
}
const saved = (page) => page.evaluate(() => JSON.parse(LZString.decompressFromUTF16(localStorage.getItem("ularn3d.expedition.v1"))));

test("autosave captures immutable stable state and a newer capture wins", async ({ page }) => {
  await start(page); await page.keyboard.press("ArrowRight"); await page.clock.runFor(2000);
  expect(await page.evaluate(() => saveJobs.length)).toBe(1);
  const capture = await page.evaluate(() => JSON.parse(saveJobs[0].value)); expect(capture.state.player.x).toBe(34);
  await page.keyboard.press("ArrowRight"); await page.clock.runFor(2000);
  await page.evaluate(() => finishSaveJob(0));
  expect(await page.evaluate(() => saveJobs.length)).toBe(2);
  expect((await saved(page)).state.player.x).not.toBe(34);
  await page.evaluate(() => finishSaveJob(1)); expect((await saved(page)).state.player.x).toBe(35);
});

test("manual save prevents an older worker result from overwriting current progress", async ({ page }) => {
  await start(page); await page.keyboard.press("ArrowRight"); await page.clock.runFor(2000);
  await page.keyboard.press("ArrowRight"); expect(await page.evaluate(() => ularn.save())).toBe(true);
  await page.evaluate(() => finishSaveJob(0)); expect((await saved(page)).state.player.x).toBe(35);
});

test("death during compression never recreates a resumable expedition", async ({ page }) => {
  await start(page); await page.keyboard.press("ArrowRight"); await page.clock.runFor(2000);
  await page.evaluate(() => { died(GNOME, true); finishSaveJob(0); });
  expect(await page.evaluate(() => ularn.hasSave())).toBe(false);
});

test("victory invalidates pending compression before its worker can return", async ({ page }) => {
  await start(page); await page.keyboard.press("ArrowRight"); await page.clock.runFor(2000);
  await page.evaluate(() => { take(createObject(OPOTION, 21)); moveNear(OHOME, true); paint(); });
  await page.keyboard.press("e"); await page.clock.runFor(10000);
  await expect.poll(() => page.evaluate(() => blocking_callback === win)).toBe(true);
  await page.keyboard.press("Enter"); await page.clock.runFor(1000);
  await expect.poll(() => page.evaluate(() => GAMEOVER)).toBe(true);
  await page.evaluate(() => finishSaveJob(0)); expect(await page.evaluate(() => ularn.hasSave())).toBe(false);
});

test("a worker storage failure is reported and retains the previous valid save", async ({ page }) => {
  await start(page); const previous = await saved(page);
  await page.keyboard.press("ArrowRight"); await page.clock.runFor(2000);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "ularn3d.expedition.v1") throw new DOMException("Storage full", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
    finishSaveJob(0);
  });
  await expect(page.locator("#toast")).toContainText("Saving unavailable");
  expect(await saved(page)).toEqual(previous);
});

test("periodic checkpoints use the worker and retain the classic storage boundary", async ({ page }) => {
  await start(page);
  await page.evaluate(() => { localStorage.setObject("checkpointbackup_ularn", { classic: true }); gtime = 399; });
  await page.keyboard.press(".");
  expect(await page.evaluate(() => saveJobs[0].key)).toBe("ularn3d.legacy.checkpointbackup_ularn");
  await page.evaluate(() => finishSaveJob(0));
  expect(await page.evaluate(() => localStorage.getObject("checkpointbackup_ularn"))).toEqual({ classic: true });
  expect(await page.evaluate(() => localStorage.getObject("ularn3d.legacy.checkpointbackup_ularn").cheat)).toBe(true);
});

test("worker initialization failure falls back to a compatible stable save", async ({ page }) => {
  await start(page, "unavailable"); await page.keyboard.press("ArrowRight"); await page.clock.runFor(2100);
  await expect.poll(async () => (await saved(page)).state.player.x).toBe(34);
  expect(await page.evaluate(() => ularnPersistence.metrics().worker)).toBe(false);
});

test("worker runtime failure retries its stable capture through the fallback", async ({ page }) => {
  await start(page); await page.keyboard.press("ArrowRight"); await page.clock.runFor(2000);
  await page.evaluate(() => saveWorkers[0].onerror({ preventDefault() {} })); await page.clock.runFor(100);
  await expect.poll(async () => (await saved(page)).state.player.x).toBe(34);
});
