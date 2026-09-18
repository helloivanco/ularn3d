import { test, expect } from "@playwright/test";

const faults = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  faults.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() =>
    localStorage.setItem("ularn3d.quality", "balanced"),
  );
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

async function start(page) {
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
}

for (const difficulty of [0, 1, 3, 10]) {
  test(`difficulty ${difficulty} preserves monster strength across repeated resumes`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.locator("#difficulty").selectOption(String(difficulty));
    await start(page);
    const readStrength = () =>
      page.evaluate(() => {
        const stats = ({
          hitpoints,
          damage,
          armorclass,
          gold,
          experience,
        }) => ({ hitpoints, damage, armorclass, gold, experience });
        return {
          difficulty: getDifficulty(),
          templates: monsterlist.map(stats),
          spawned: [GNOME, REDDRAGON, DEMONLORD].map((id) =>
            stats(createMonster(id)),
          ),
        };
      });
    const original = await readStrength();
    expect(original.difficulty).toBe(difficulty);
    const persisted = await page.evaluate(() => {
      newcavelevel(1);
      const m = createMonster(GNOME);
      m.hitpoints = 1; // A wounded, existing creature must not get scaled again.
      setMonster(20, 8, m);
      paint();
      return JSON.stringify(m);
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator("#save").click();
      await expect(page.locator("#toast")).toContainText("saved");
      await page.reload();
      await page.locator("#continue").click();
      await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
      expect(await readStrength()).toEqual(original);
      expect(await page.evaluate(() => JSON.stringify(monsterAt(20, 8)))).toBe(
        persisted,
      );
    }
  });
}

test("focused interface controls activate with Enter and Space without spending turns", async ({
  page,
}) => {
  await start(page);
  const turns = await page.evaluate(() => player.MOVESMADE);
  await page.locator("#guide").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#guide-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close field guide" }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#guide-dialog")).not.toBeVisible();
  await page.locator("#sound").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#sound")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#pause").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#pause-dialog")).toBeVisible();
  await page.locator("#resume-game").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#pause-dialog")).not.toBeVisible();
  await page.locator('.actionbar [data-key="i"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#engine-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("#save").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#toast")).toContainText("saved");
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(turns);
  await page
    .getByRole("button", { name: "Wait one turn", exact: true })
    .focus();
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(turns + 1);
});

test("door clicks resolve one action without leaving queued direction input", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 100;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setItem(x, y, OEMPTY);
        setMonster(x, y, null);
        setKnow(x, y, KNOWALL);
      }
    setItem(11, 8, OCLOSEDDOOR);
    paint();
  });
  const clickDoor = async () => {
    const box = await page.locator("#minimap").boundingBox();
    const view = await page.locator("#minimap").evaluate((el) => ({
      x0: +el.dataset.x0,
      y0: +el.dataset.y0,
      cols: +el.dataset.cols,
      rows: +el.dataset.rows,
    }));
    await page.mouse.click(
      box.x + ((11 - view.x0 + 0.5) / view.cols) * box.width,
      box.y + ((8 - view.y0 + 0.5) / view.rows) * box.height,
    );
  };
  const before = await page.evaluate(() => player.MOVESMADE);
  await clickDoor();
  expect(
    await page.evaluate(() => ({
      prompt: !!blocking_callback,
      moves: player.MOVESMADE,
      x: player.x,
      y: player.y,
    })),
  ).toEqual({ prompt: false, moves: before + 1, x: 10, y: 8 });
  await page.locator('.actionbar [data-key="i"]').click();
  await expect(page.locator("#engine-modal")).toBeVisible();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(before + 1);
  await page.keyboard.press("Escape");
  // When the original rules reject Open, no stray direction may become a move.
  await page.evaluate(() => {
    setItem(11, 8, OCLOSEDDOOR);
    player.CONFUSE = 10;
    paint();
  });
  await clickDoor();
  expect(
    await page.evaluate(() => ({
      moves: player.MOVESMADE,
      x: player.x,
      y: player.y,
    })),
  ).toEqual({ moves: before + 2, x: 10, y: 8 });
  await expect(page.locator("#journal-lines")).toContainText("confused");
});

test("duplicate equipment keeps the exact equipped slots across reloads", async ({
  page,
}) => {
  await start(page);
  const slots = await page.evaluate(() => {
    take(createObject(player.WIELD));
    take(createObject(player.WEAR));
    take(createObject(OSHIELD));
    take(createObject(OSHIELD));
    player.SHIELD = player.inventory.find((item) => item?.matches(OSHIELD));
    recalc();
    paint();
    return Object.fromEntries(
      ["WIELD", "WEAR", "SHIELD"].map((field) => [
        field,
        player.inventory.indexOf(player[field]),
      ]),
    );
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator("#save").click();
    await page.reload();
    await page.locator("#continue").click();
    await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
    expect(
      await page.evaluate(() =>
        Object.fromEntries(
          ["WIELD", "WEAR", "SHIELD"].map((field) => [
            field,
            player.inventory.indexOf(player[field]),
          ]),
        ),
      ),
    ).toEqual(slots);
  }
  // Existing version-one saves without the optional slot metadata still load.
  await page.evaluate(() => {
    const key = "ularn3d.expedition.v1";
    const data = JSON.parse(
      LZString.decompressFromUTF16(localStorage.getItem(key)),
    );
    delete data.equipment;
    window.legacySave = LZString.compressToUTF16(JSON.stringify(data));
  });
  const legacy = await page.evaluate(() => window.legacySave);
  await page.goto("/");
  await page.evaluate(
    (value) => localStorage.setItem("ularn3d.expedition.v1", value),
    legacy,
  );
  await page.reload();
  await page.locator("#continue").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
  expect(await page.evaluate(() => ularn.snapshot().hp)).toBeGreaterThan(0);
});

test("compact portrait and landscape keep essential HUD and controls reachable", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 568, height: 320 });
  await page.locator("#hero-name").fill("A very long hero name");
  await start(page);
  for (const [width, height] of [
    [320, 568],
    [360, 640],
    [568, 320],
    [844, 390],
    [900, 700],
  ]) {
    await page.setViewportSize({ width, height });
    const clipped = await page
      .locator(
        ".topbar button, .camera-tools button, .dpad button, .actionbar button, #health-text, #mana-text, #time-left, #destination",
      )
      .evaluateAll((elements) =>
        elements
          .filter((element) => element.checkVisibility())
          .filter((element) => {
            const r = element.getBoundingClientRect();
            const points = [
              [0.5, 0.5],
              [0.1, 0.1],
              [0.9, 0.1],
              [0.1, 0.9],
              [0.9, 0.9],
            ];
            const covered = points.some(([x, y]) => {
              const hit = document.elementFromPoint(
                r.x + r.width * x,
                r.y + r.height * y,
              );
              return !(hit === element || element.contains(hit));
            });
            return (
              r.left < 0 ||
              r.top < 0 ||
              r.right > innerWidth ||
              r.bottom > innerHeight ||
              covered
            );
          })
          .map(
            (element) => element.id || element.ariaLabel || element.textContent,
          ),
      );
    expect(
      clipped,
      `${width} × ${height}: no covered or clipped controls`,
    ).toEqual([]);
    const moves = await page.evaluate(() => player.MOVESMADE);
    await page
      .getByRole("button", { name: "Wait one turn", exact: true })
      .click();
    expect(await page.evaluate(() => player.MOVESMADE)).toBe(moves + 1);
    await page.locator("#pause").click();
    await expect(page.locator("#pause-dialog")).toBeVisible();
    await page.locator("#resume-game").click();
    await page.screenshot({
      path: `test-results/compact-${width}-${height}.png`,
    });
  }
});

test.describe("Retina graphics", () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 900, height: 700 } });
  test("repeated context recovery supports resizing, quality and level changes", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await start(page);
    for (let cycle = 0; cycle < 2; cycle++) {
      const before = await page.evaluate(() => ({
        moves: player.MOVESMADE,
        hp: player.HP,
        level,
      }));
      await page.evaluate(() => {
        window.lossExtension = document
          .querySelector("#world canvas")
          .getContext("webgl2")
          .getExtension("WEBGL_lose_context");
        lossExtension.loseContext();
      });
      await expect(page.locator("#graphics-status")).toBeVisible();
      await page.evaluate(() => ularn.key("."));
      await page.evaluate(() => lossExtension.restoreContext());
      await expect(page.locator("#graphics-status")).toBeHidden({
        timeout: 20000,
      });
      expect(
        await page.evaluate(() => ({
          moves: player.MOVESMADE,
          hp: player.HP,
          level,
        })),
      ).toEqual(before);
      await page.locator("#pause").click();
      await page
        .locator("#graphics-quality")
        .selectOption(cycle ? "balanced" : "cinematic");
      await page.locator("#resume-game").click();
      await page.setViewportSize({
        width: 800 + cycle * 100,
        height: 600 + cycle * 100,
      });
      await page.evaluate((cycle) => {
        newcavelevel(cycle ? 0 : 1);
        paint();
      }, cycle);
      await page.screenshot({
        path: `test-results/recovered-retina-${cycle}.png`,
      });
      const metrics = await page.evaluate(() => ularnGraphics.metrics());
      expect(metrics.contextLost).toBe(false);
      expect(metrics.drawCalls).toBeGreaterThan(0);
      expect(metrics.triangles).toBeGreaterThan(1000);
      expect(await page.evaluate(() => ularn.save())).toBe(true);
    }
  });
});
