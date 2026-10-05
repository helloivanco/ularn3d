import { test, expect } from "@playwright/test";

const desktops = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

const openStart = async (page, viewport) => {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.expedition.v1", "layout-check");
  });
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await expect(page.locator(".class-choice")).toHaveCount(8);
};

for (const viewport of desktops) {
  test(`start screen fits a ${viewport.width}×${viewport.height} window without scrolling`, async ({
    page,
  }) => {
    await openStart(page, viewport);
    await expect(page.locator("#multiplayer")).toBeVisible();
    await expect(page.locator("#continue")).toBeVisible();
    await expect(page.locator("#save-notice")).toContainText(
      "A new expedition replaces your saved expedition.",
    );
    await expect(page.locator("#class-description")).not.toBeEmpty();
    await expect(page.locator("#download-windows")).toContainText("Download for Windows");

    const fit = await page.evaluate(() => {
      const welcome = document.querySelector("#welcome");
      const download = document.querySelector("#download-windows").getBoundingClientRect();
      return {
        overflows: welcome.scrollHeight > welcome.clientHeight + 1,
        scrollbar: welcome.offsetWidth - welcome.clientWidth,
        pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
        downloadTop: download.top,
        downloadBottom: download.bottom,
        innerHeight: window.innerHeight,
      };
    });

    expect(fit.overflows).toBe(false);
    expect(fit.scrollbar).toBe(0);
    expect(fit.pageScrolls).toBe(false);
    expect(fit.downloadTop).toBeGreaterThan(0);
    expect(fit.downloadBottom).toBeLessThanOrEqual(fit.innerHeight);
  });
}

test("narrow phone start screen keeps controls from colliding", async ({ page }) => {
  await openStart(page, { width: 320, height: 700 });
  const issues = await page.evaluate(() => {
    const welcome = document.querySelector("#welcome");
    const nodes = [...welcome.querySelectorAll("button, a, input, select")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    const found = [];
    for (const el of nodes) {
      if (el.scrollWidth > el.clientWidth + 2) {
        found.push(`clipped:${el.id || el.textContent.trim().slice(0, 24)}`);
      }
      const box = el.getBoundingClientRect();
      if (box.left < -1 || box.right > innerWidth + 1) {
        found.push(`offscreen:${el.id || el.textContent.trim().slice(0, 24)}`);
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].getBoundingClientRect();
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].contains(nodes[j]) || nodes[j].contains(nodes[i])) continue;
        const b = nodes[j].getBoundingClientRect();
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 2 && overlapY > 2) {
          found.push(
            `overlap:${nodes[i].id || nodes[i].textContent.trim().slice(0, 16)}/${nodes[j].id || nodes[j].textContent.trim().slice(0, 16)}`,
          );
        }
      }
    }
    return found;
  });
  expect(issues).toEqual([]);
});
