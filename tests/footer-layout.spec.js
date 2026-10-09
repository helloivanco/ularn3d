import { test, expect } from "@playwright/test";

for (const width of [1440, 768, 390, 320]) test(`shared footers align and fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  for (const path of ["/", "/about/", "/changelog/"]) {
    await page.goto(path);
    const footer = page.locator(".site-footer"); await footer.scrollIntoViewIfNeeded();
    await expect(footer.getByRole("link", { name: "Windows", exact: true })).toHaveCount(0);
    const github = footer.getByRole("link", { name: "GitHub", exact: true });
    await expect(github).toHaveAttribute("href", "https://github.com/helloivanco/ularn3d");
    await expect(github.locator("svg")).toBeVisible();
    await expect(github).toHaveText("");
    await github.focus(); await expect(github).toBeFocused();
    await expect(github).toHaveCSS("outline-style", "solid");
    const bounds = await footer.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const centers = await footer.locator(":scope > *").evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(); return rect.y + rect.height / 2;
    }));
    if (width > 740) expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
    else expect(centers[0]).toBeCloseTo(centers[2], 0);
  }
});
