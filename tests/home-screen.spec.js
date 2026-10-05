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
    await expect(page.locator("#welcome")).not.toContainText(/classic reawakened/i);
    await expect(page.locator("#location-name")).toHaveText("");
    await expect(page.locator(".location-dot")).toBeHidden();
    await expect(page.locator("#sound")).toBeVisible();
    await expect(page.locator("#guide")).toContainText("Field guide");

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
        welcomeTop: welcome.getBoundingClientRect().top,
        titleTop: document.querySelector("#title").getBoundingClientRect().top,
      };
    });

    expect(fit.overflows).toBe(false);
    expect(fit.scrollbar).toBe(0);
    expect(fit.pageScrolls).toBe(false);
    expect(fit.downloadTop).toBeGreaterThan(0);
    expect(fit.downloadBottom).toBeLessThanOrEqual(fit.innerHeight);
    expect(fit.welcomeTop).toBeLessThan(24);
    expect(fit.titleTop).toBeLessThan(40);
  });
}

test("spectator line stays off the title and out of the empty center", async ({ page }) => {
  await openStart(page, { width: 1280, height: 800 });
  await page.evaluate(() => window.ularnOnline.preview("spectator"));
  const placed = await page.evaluate(() => {
    const badge = document.getElementById("spectator-badge");
    const title = document.getElementById("title");
    const badgeBox = badge.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    const overlapX = Math.min(badgeBox.right, titleBox.right) - Math.max(badgeBox.left, titleBox.left);
    const overlapY = Math.min(badgeBox.bottom, titleBox.bottom) - Math.max(badgeBox.top, titleBox.top);
    return {
      text: badge.textContent,
      inNav: Boolean(document.querySelector(".topbar nav #spectator-badge")),
      overlapsTitle: overlapX > 2 && overlapY > 2,
      center: badgeBox.left + badgeBox.width / 2,
      width: window.innerWidth,
    };
  });
  expect(placed.text).toMatch(/^Spectating .+ · \d+ watching$/);
  expect(placed.inNav).toBe(true);
  expect(placed.overlapsTitle).toBe(false);
  expect(Math.abs(placed.center - placed.width / 2)).toBeGreaterThan(80);
});

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
