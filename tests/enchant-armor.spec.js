import { test, expect } from "@playwright/test";

async function start(page) {
  await page.addInitScript(() =>
    localStorage.setItem("ularn3d.quality", "performance"),
  );
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
}

test("scrolls of enchant armor always pick worn armor over a shield", async ({
  page,
}) => {
  await start(page);
  const result = await page.evaluate(() => {
    const originalRund = rund;
    // Old Ularn pick: rund(100) < 50 chose the shield. Force that roll.
    rund = () => 0;

    const armor = createObject(OLEATHER, 0);
    const shield = createObject(OSHIELD, 4);
    take(armor);
    take(shield);
    player.WEAR = armor;
    player.SHIELD = shield;

    const both = [];
    for (let i = 0; i < 8; i++) {
      read_scroll(createObject(OSCROLL, 0));
      both.push({
        armor: player.WEAR.arg,
        shield: player.SHIELD.arg,
        stillWorn: player.WEAR === armor,
        stillShield: player.SHIELD === shield,
      });
    }

    player.WEAR = null;
    const shieldOnlyStart = player.SHIELD.arg;
    read_scroll(createObject(OSCROLL, 0));
    const shieldOnly = player.SHIELD.arg;

    player.WEAR = armor;
    player.SHIELD = shield;
    armor.arg = 1;
    shield.arg = 1;
    enchantarmor(ENCH_ALTAR);
    const altar = { armor: player.WEAR.arg, shield: player.SHIELD.arg };

    rund = originalRund;
    return { both, shieldOnlyStart, shieldOnly, altar };
  });

  expect(result.both).toHaveLength(8);
  for (const [index, step] of result.both.entries()) {
    expect(step, `scroll ${index + 1}`).toEqual({
      armor: index + 1,
      shield: 4,
      stillWorn: true,
      stillShield: true,
    });
  }
  expect(result.shieldOnly).toBe(result.shieldOnlyStart + 1);
  expect(result.altar).toEqual({ armor: 1, shield: 2 });
});
