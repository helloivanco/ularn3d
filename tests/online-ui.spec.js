import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const media = "/cursor/stores/bc-466ce274-7861-4488-8dab-cd9c1768b330/media";

test.beforeAll(() => {
  mkdirSync(media, { recursive: true });
});

test("chat emoji picker inserts at the cursor and enter still sends", async ({ page }) => {
  await page.goto("/play/");
  await page.waitForFunction(() => window.ularnOnline && typeof window.ularnOnline.preview === "function");
  await page.evaluate(() => window.ularnOnline.preview("chat"));
  const input = page.locator("#chat-input");
  const picker = page.locator("#chat-emoji-picker");
  await input.fill("Hi");
  await input.evaluate((element) => element.setSelectionRange(1, 1));
  await page.locator("#chat-emoji").click();
  await expect(picker).toBeVisible();
  const row = await page.evaluate(() => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        border: style.borderTopWidth,
        borderColor: style.borderTopColor,
        radius: style.borderTopLeftRadius,
      };
    };
    const form = document.querySelector("#chat-form");
    return {
      input: box(form.querySelector("#chat-input")),
      emoji: box(form.querySelector("#chat-emoji")),
      send: box(form.querySelector("button[type=submit]")),
      picker: box(form.querySelector("#chat-emoji-picker")),
    };
  });
  const tops = [row.input.top, row.emoji.top, row.send.top];
  const bottoms = [row.input.bottom, row.emoji.bottom, row.send.bottom];
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(0.5);
  expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(row.emoji.width - row.emoji.height)).toBeLessThanOrEqual(0.5);
  expect(Math.abs((row.emoji.left - row.input.right) - 8)).toBeLessThanOrEqual(0.5);
  expect(Math.abs((row.send.left - row.emoji.right) - 8)).toBeLessThanOrEqual(0.5);
  expect(row.input.border).toBe(row.emoji.border);
  expect(row.send.border).toBe(row.emoji.border);
  expect(row.input.borderColor).toBe(row.emoji.borderColor);
  expect(row.send.borderColor).toBe(row.emoji.borderColor);
  expect(row.input.radius).toBe(row.emoji.radius);
  expect(row.send.radius).toBe(row.emoji.radius);
  expect(Math.abs(row.picker.left - row.input.left)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(row.picker.right - row.send.right)).toBeLessThanOrEqual(0.5);
  expect(row.picker.bottom).toBeLessThanOrEqual(row.input.top - 7);
  const x = Math.max(0, Math.floor(Math.min(row.input.left, row.picker.left) - 12));
  const y = Math.max(0, Math.floor(row.picker.top - 12));
  const right = Math.ceil(Math.max(row.send.right, row.picker.right) + 12);
  const bottom = Math.ceil(row.input.bottom + 12);
  await page.screenshot({
    path: "/cursor/stores/self/media/chat-emoji-aligned.png",
    clip: { x, y, width: right - x, height: bottom - y },
  });
  await expect(input).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.ularnOnline.blocksGameKeys())).toBe(true);
  await picker.locator("button", { hasText: "😀" }).click();
  await expect(input).toHaveValue("H😀i");
  await expect(picker).toBeHidden();
  await expect(input).toBeFocused();
  await input.press("Enter");
  await expect(page.locator("#chat-log")).toContainText("H😀i");
  await input.fill("shit");
  await input.press("Enter");
  await expect(page.locator("#chat-log")).not.toContainText("shit");
  await input.fill("x".repeat(279));
  await page.locator("#chat-emoji").click();
  await picker.locator("button", { hasText: "😀" }).click();
  await expect(input).toHaveValue("x".repeat(279));
});

test("online panels can be shown", async ({ page }) => {
  await page.goto("/play/");
  await page.waitForFunction(() => window.ularnOnline && typeof window.ularnOnline.preview === "function");
  await page.evaluate(() => window.ularnOnline.preview("menu"));
  await page.screenshot({ path: `${media}/lobby.png` });
  await page.evaluate(() => {
    document.querySelector("dialog[open]")?.close();
    window.ularnOnline.preview("lobby");
  });
  await page.screenshot({ path: `${media}/lobby.png` });
  await page.evaluate(() => window.ularnOnline.preview("leaderboard"));
  await page.screenshot({ path: `${media}/leaderboard.png` });
});

test("two adventurers show the turn strip", async ({ page }) => {
  await page.goto("/play/");
  await page.waitForFunction(() => window.ularn && typeof window.ularn.start === "function");
  await page.evaluate(async () => {
    await window.ularn.start({
      name: "Ada",
      character: "Adventurer",
      difficulty: 0,
      seed: 2,
    });
    document.getElementById("welcome").hidden = true;
    document.getElementById("scene-caption").hidden = true;
    document.getElementById("hud").hidden = false;
    document.getElementById("pause").hidden = false;
    document.body.classList.add("playing");
    newcavelevel(1);
    addAdventurer("Bea");
    const ally = ADVENTURERS[1];
    let spot = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) {
      const x = player.x + dx;
      const y = player.y + dy;
      if (typeof inBounds === "function" && !inBounds(x, y)) continue;
      const item = itemAt(x, y);
      if (item && item.matches && item.matches(OWALL)) continue;
      spot = { x, y };
      break;
    }
    ally.level = level;
    ally.player.x = spot ? spot.x : player.x;
    ally.player.y = spot ? spot.y : player.y;
    showcell(player.x, player.y);
    window.dispatchEvent(new Event("ularn:update"));
    window.ularnGraphics?.beginExpeditionCamera();
  });
  await page.waitForFunction(() => {
    const strip = document.getElementById("turn-strip");
    const party = document.getElementById("party-hud");
    return strip && party && !strip.hidden && !party.hidden && /Bea/.test(strip.textContent);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${media}/two-aura-encounter.png` });
  await page.evaluate(() => {
    document.querySelector("dialog[open]")?.close();
    window.ularnOnline.preview("spectator");
  });
  await page.screenshot({ path: `${media}/spectator.png` });
  await page.evaluate(() => {
    document.querySelector("dialog[open]")?.close();
    window.ularnOnline.preview("chat");
  });
  await page.screenshot({ path: `${media}/chat.png` });
  const before = await page.evaluate(() => ({ x: player.x, y: player.y }));
  await page.locator("#chat-input").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  const after = await page.evaluate(() => ({ x: player.x, y: player.y }));
  expect(after).toEqual(before);
});
