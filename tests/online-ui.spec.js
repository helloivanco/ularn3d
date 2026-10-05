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
  const panelBox = await page.locator("#chat-panel").boundingBox();
  const pickerBox = await picker.boundingBox();
  const x = Math.max(0, Math.floor(Math.min(panelBox.x, pickerBox.x) - 16));
  const y = Math.max(0, Math.floor(Math.min(panelBox.y, pickerBox.y) - 16));
  const right = Math.ceil(Math.max(panelBox.x + panelBox.width, pickerBox.x + pickerBox.width) + 16);
  const bottom = Math.ceil(Math.max(panelBox.y + panelBox.height, pickerBox.y + pickerBox.height) + 16);
  await page.screenshot({
    path: `${media}/chat-emoji.png`,
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
