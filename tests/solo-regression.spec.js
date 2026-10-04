/**
 * Browser run of the same seeded script. The checksum must match the
 * headless golden lock in tests/solo-regression.unit.mjs.
 */
import { test, expect } from "@playwright/test";

const SEED = 2;
const TURNS = 500;
const GOLDEN = "3a3d396ee8c6a463";

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
