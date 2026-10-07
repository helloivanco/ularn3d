import { test, expect } from "@playwright/test";

test("footfalls follow the plant; blocked moves, teleports and paused steps stay quiet", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.audio.v1", JSON.stringify({ enabled: false }));
  });
  // Capture RAF before the renderer starts. Installing the clock after loading
  // can leave its first frame on the real scheduler, outside runFor's control.
  await page.clock.install();
  await page.goto("/play/"); await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await page.evaluate(() => {
    newcavelevel(1); player.x = 33; player.y = 8; player.HP = player.HPMAX = 1000;
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) {
      setItem(x, y, OEMPTY); setMonster(x, y, null); setKnow(x, y, KNOWALL);
    }
    paint(); window.walkContacts = [];
    window.addEventListener("ularn:footstep", event => walkContacts.push({ ...event.detail, time: performance.now() }));
  });
  await page.clock.pauseAt(new Date(Date.now() + 60000));
  await page.keyboard.press("ArrowRight");
  await page.clock.runFor(64);
  const mid = await page.evaluate(() => ({ pose: ularnGraphics.heroMotion(), count: walkContacts.length }));
  expect(mid.count).toBe(0); expect(mid.pose.bodyY).toBeGreaterThan(.005); expect(mid.pose.bodyY).toBeLessThan(.03);
  expect(Math.max(mid.pose.leftKneeX, mid.pose.rightKneeX)).toBeGreaterThan(.3);
  await page.clock.runFor(96);
  expect(await page.evaluate(() => walkContacts.length)).toBe(1);
  expect(await page.evaluate(() => ularnGraphics.metrics().heroPosition)).toEqual([34, 0, 8]);
  await page.keyboard.press("ArrowRight"); await page.clock.runFor(160);
  expect(await page.evaluate(() => walkContacts.map(step => step.right))).toEqual([true, false]);
  await page.evaluate(() => { setItem(36, 8, OWALL); paint(); });
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("."); await page.clock.runFor(300);
  expect(await page.evaluate(() => walkContacts.length)).toBe(2);
  await page.evaluate(() => { player.x = 30; paint(); }); await page.clock.runFor(160);
  expect(await page.evaluate(() => walkContacts.length)).toBe(2);
  await page.keyboard.press("ArrowRight"); await page.clock.runFor(32); await page.locator("#pause").click();
  await page.clock.runFor(300); await page.locator("#resume-game").click(); await page.clock.runFor(300);
  expect(await page.evaluate(() => walkContacts.length)).toBe(2);
  const rest = await page.evaluate(() => ularnGraphics.heroMotion());
  expect(rest.leftKneeX).toBeCloseTo(0, 5); expect(rest.rightKneeX).toBeCloseTo(0, 5);
});
