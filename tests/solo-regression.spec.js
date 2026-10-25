/**
 * Browser run of the same seeded script. The checksum must match the
 * headless golden lock in tests/solo-regression.unit.mjs.
 */
import { test, expect } from "@playwright/test";
import { COMBAT_SEED, COMBAT_TURNS, COMBAT_GOLDEN, stageCombat } from "./lib/combat-fixture.mjs";

const SEED = 2;
const TURNS = 500;
const GOLDEN = "33508677da7ad518";

test("browser replay matches the headless solo checksum", async ({ page }) => {
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  const result = await page.evaluate(async ({ seed, turns }) => {
    await window.ularn.start({
      name: "Adventurer",
      character: "Adventurer",
      difficulty: 0,
      seed,
      skipPaint: true,
    });
    const inputs = [];
    for (let seq = 0; seq < turns; seq++) {
      pushInput({ actor: 0, turn: gtime, action: ".", seq });
      mainloop(null, ".");
      inputs.push({ actor: 0, turn: gtime, action: ".", seq });
    }
    const state = captureGameState();
    state.party = null;
    return {
      checksum: checksumGameState(state),
      gtime,
      hp: player.HP,
      x: player.x,
      y: player.y,
      level,
      inputs,
    };
  }, { seed: SEED, turns: TURNS });
  expect(result.gtime).toBe(TURNS);
  expect(result.hp).toBeGreaterThan(0);
  expect(result.checksum).toBe(GOLDEN);
  expect(result.inputs).toHaveLength(TURNS);
});

// The browser runs the bridge and every feedback listener; the golden comes
// from the bridge-less engine, so a match proves the presentation only observes.
test("browser melee with feedback listeners matches the headless combat golden", async ({ page }) => {
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 20000 });
  const result = await page.evaluate(async ({ seed, turns, stage }) => {
    const events = { hurt: 0, damage: 0, kills: 0 };
    addEventListener("ularn:hurt", () => events.hurt++);
    addEventListener("ularn:damage", (event) => { events.damage++; if (event.detail.killed) events.kills++; });
    // Headless replay never auto-loots; match it so the slain troll's drop stays put.
    localStorage.setItem("ularn3d.autoLoot", "false");
    await window.ularn.start({ name: "Adventurer", character: "Adventurer", difficulty: 0, seed, skipPaint: true });
    const key = new Function("g", `return (${stage})(g);`)(window);
    for (let seq = 0; seq < turns; seq++) {
      pushInput({ actor: 0, turn: gtime, action: key, seq });
      mainloop(null, key);
    }
    const state = captureGameState();
    state.party = null;
    return { checksum: checksumGameState(state), events };
  }, { seed: COMBAT_SEED, turns: COMBAT_TURNS, stage: stageCombat.toString() });
  expect(result.events.hurt).toBeGreaterThan(0);
  expect(result.checksum).toBe(COMBAT_GOLDEN);
});
