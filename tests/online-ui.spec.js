import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const media = "/cursor/stores/bc-466ce274-7861-4488-8dab-cd9c1768b330/media";

test.beforeAll(() => {
  mkdirSync(media, { recursive: true });
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
});
