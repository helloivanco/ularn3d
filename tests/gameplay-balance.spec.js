import { test, expect } from "@playwright/test";

async function start(page) {
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "performance"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
}

test("town buildings never share edges and keep one empty square around each", async ({
  page,
}) => {
  await start(page);
  for (let attempt = 0; attempt < 8; attempt++) {
    const spacing = await page.evaluate(() => {
      newcavelevel(0);
      paint();
      const buildings = [];
      for (let y = 0; y < MAXY; y++) {
        for (let x = 0; x < MAXX; x++) {
          const item = itemAt(x, y);
          if (item.isStore()) buildings.push({ x, y, id: item.id });
        }
      }
      let minChebyshev = Infinity;
      for (let i = 0; i < buildings.length; i++) {
        for (let j = i + 1; j < buildings.length; j++) {
          const d = Math.max(
            Math.abs(buildings[i].x - buildings[j].x),
            Math.abs(buildings[i].y - buildings[j].y),
          );
          minChebyshev = Math.min(minChebyshev, d);
        }
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = buildings[i].x + dx;
            const ny = buildings[i].y + dy;
            const neighbor = itemAt(nx, ny);
            if (neighbor.isStore()) {
              return { ok: false, reason: "adjacent-store", buildings };
            }
            if (!neighbor.matches(OEMPTY)) {
              return { ok: false, reason: "occupied-ring", buildings, nx, ny };
            }
          }
        }
      }
      return {
        ok: minChebyshev >= 2,
        minChebyshev,
        count: buildings.length,
        buildings,
      };
    });
    expect(spacing.count).toBeGreaterThanOrEqual(8);
    expect(spacing.ok).toBe(true);
    expect(spacing.minChebyshev).toBeGreaterThanOrEqual(2);
  }
});

test("minimap paints stairs going down red and stairs going up green", async ({
  page,
}) => {
  await start(page);
  const colors = await page.evaluate(() => {
    newcavelevel(2);
    player.x = 10;
    player.y = 8;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setItem(x, y, x < 7 || x > 14 || y < 5 || y > 11 ? OWALL : OEMPTY);
        setKnow(x, y, KNOWALL);
      }
    setItem(9, 8, OSTAIRSDOWN);
    setItem(11, 8, OSTAIRSUP);
    paint();
    const map = document.getElementById("minimap");
    const ctx = map.getContext("2d");
    const x0 = +map.dataset.x0;
    const y0 = +map.dataset.y0;
    const cols = +map.dataset.cols;
    const cell = map.width / cols / Math.min(1.25, devicePixelRatio || 1);
    const dpr = Math.min(1.25, devicePixelRatio || 1);
    const sample = (gx, gy) => {
      const px = Math.round(((gx - x0) * cell + cell / 2) * dpr);
      const py = Math.round(((gy - y0) * cell + cell / 2) * dpr);
      const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
      return { r, g, b };
    };
    return { down: sample(9, 8), up: sample(11, 8) };
  });
  expect(colors.down.r).toBeGreaterThan(colors.down.g);
  expect(colors.down.r).toBeGreaterThan(140);
  expect(colors.up.g).toBeGreaterThan(colors.up.r);
  expect(colors.up.g).toBeGreaterThan(140);
});

test("self-cast haste does not stack while heroism potions do", async ({ page }) => {
  await start(page);
  const result = await page.evaluate(() => {
    player.HASTESELF = 0;
    player.HERO = 0;
    const hasteBefore = player.HASTESELF;
    player.updateHasteSelf = ((original) => {
      return function patched(n) {
        return original.call(this, n);
      };
    })(player.updateHasteSelf);
    refreshSelfSpell(() => player.HASTESELF, (n) => player.updateHasteSelf(n), 20);
    const afterFirst = player.HASTESELF;
    refreshSelfSpell(() => player.HASTESELF, (n) => player.updateHasteSelf(n), 20);
    const afterSecond = player.HASTESELF;
    player.HERO = 0;
    quaffpotion(createObject(OPOTION, 15), true);
    const heroAfterOne = player.HERO;
    quaffpotion(createObject(OPOTION, 15), true);
    const heroAfterTwo = player.HERO;
    return {
      hasteBefore,
      afterFirst,
      afterSecond,
      heroAfterOne,
      heroAfterTwo,
    };
  });
  expect(result.afterFirst).toBe(20);
  expect(result.afterSecond).toBe(20);
  expect(result.heroAfterOne).toBe(250);
  expect(result.heroAfterTwo).toBe(500);
});

test("centipede strength drain rolls at 20 percent", async ({ page }) => {
  await start(page);
  const counts = await page.evaluate(() => {
    let drained = 0;
    let rolls = 0;
    const originalRnd = rnd;
    const originalSetStrength = player.setStrength.bind(player);
    player.setStrength = (value) => {
      drained++;
      return originalSetStrength(value);
    };
    try {
      for (let i = 0; i < 100; i++) {
        player.STRENGTH = 12;
        rnd = (limit) => {
          if (limit === 100) {
            rolls++;
            return i < 20 ? 1 : 50;
          }
          return originalRnd(limit);
        };
        spattack(createMonster(CENTIPEDE), 4, player.x, player.y);
      }
    } finally {
      rnd = originalRnd;
      player.setStrength = originalSetStrength;
    }
    return { drained, rolls };
  });
  expect(counts.rolls).toBe(100);
  expect(counts.drained).toBe(20);
});
