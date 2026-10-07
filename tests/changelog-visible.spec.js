import { test, expect } from "@playwright/test";

test("changelog notes become visible when the list is taller than the window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/changelog/");
  const recent = page.locator("section.reveal").first();
  const box = await recent.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(800);
  await expect(recent).toHaveClass(/is-visible/);
  await expect(recent).toHaveCSS("opacity", "1");
  await expect(page.locator(".changelog-list h3").first()).toContainText("Joined walls and stable rooftops");
  await expect(page.locator("h1")).toContainText(/What’s new/i);
});
