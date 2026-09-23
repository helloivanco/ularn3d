import { test, expect } from "@playwright/test";

const faults = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  faults.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden", false);
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

test("trap landmarks and special-item ground hover work in play", async ({ page }) => {
  test.setTimeout(90000);
  await page.evaluate(() => {
    newcavelevel(1);
    player.x = 10;
    player.y = 8;
    player.HP = player.HPMAX = 500;
    for (let x = 0; x < MAXX; x++)
      for (let y = 0; y < MAXY; y++) {
        setMonster(x, y, null);
        setItem(x, y, OWALL);
        setKnow(x, y, KNOWNOT);
      }
    for (let x = 5; x < 18; x++)
      for (let y = 4; y < 13; y++) {
        setItem(x, y, OEMPTY);
        setKnow(x, y, KNOWALL);
      }
    setItem(8, 7, OPIT);
    setItem(9, 7, ODARTRAP);
    setItem(10, 7, OELEVATORUP);
    setItem(11, 7, OELEVATORDOWN);
    setItem(8, 9, OLARNEYE);
    setItem(9, 9, createObject(OPOTION, 0));
    setItem(10, 9, createObject(OSCROLL, 0));
    setItem(11, 9, OLEATHER);
    setItem(12, 9, ODAGGER);
    setItem(13, 9, OSWORDofSLASHING);
    setMazeMode(true);
    paint();
  });

  await expect
    .poll(() =>
      page.evaluate(() =>
        ularnGraphics
          .landmarks()
          .filter((entry) => entry.trapKind)
          .map((entry) => entry.trapKind)
          .sort(),
      ),
    )
    .toEqual(["dart", "elevator-down", "elevator-up", "pit"]);

  const hover = await page.evaluate(async () => {
    const { groundHoverInfo } = await import("/src/item-tooltips.js");
    const tiles = ularn.snapshot().tiles;
    const at = (x, y) => tiles.find((tile) => tile.x === x && tile.y === y);
    return {
      eye: groundHoverInfo(at(8, 9)),
      potion: groundHoverInfo(at(9, 9)),
      scroll: groundHoverInfo(at(10, 9)),
      armor: groundHoverInfo(at(11, 9)),
      dagger: groundHoverInfo(at(12, 9)),
      slash: groundHoverInfo(at(13, 9)),
    };
  });

  expect(hover.eye).toMatchObject({ kind: "special", title: "Eye of Larn" });
  expect(hover.eye.body).toContain("God of Hellfire");
  expect(hover.slash).toMatchObject({
    kind: "special",
    title: "Sword of Slashing",
  });
  expect(hover.potion).toBeNull();
  expect(hover.scroll).toBeNull();
  expect(hover.armor).toBeNull();
  expect(hover.dagger).toBeNull();

  // Drive the live hover UI over the Eye and a quiet potion.
  const pointFor = async (x, y) =>
    page.evaluate(([tx, ty]) => {
      const s = ularn.snapshot();
      const offset = ularnGraphics.metrics().cameraOffset;
      const [ox, oy, oz] = offset;
      const length = Math.hypot(...offset);
      const horizontal = Math.hypot(ox, oz);
      const relative = [tx - s.x - ox, 1.6 - oy, ty + 0.5 - s.y - oz];
      const dot = (a, b) => a.reduce((v, n, i) => v + n * b[i], 0);
      const depth = -dot(
        relative,
        offset.map((n) => n / length),
      );
      const right = [oz / horizontal, 0, -ox / horizontal];
      const up = [
        (-ox * oy) / (horizontal * length),
        horizontal / length,
        (-oz * oy) / (horizontal * length),
      ];
      const scale = 1000 / (2 * Math.tan((37 * Math.PI) / 360));
      const canvas = document.querySelector("#world canvas");
      const box = canvas.getBoundingClientRect();
      const cx = 0.5 + (dot(relative, right) / depth) * (scale / box.width);
      const cy = 0.5 - (dot(relative, up) / depth) * (scale / box.height);
      return { x: box.left + cx * box.width, y: box.top + cy * box.height };
    }, [x, y]);

  const eyePoint = await pointFor(8, 9);
  await page.mouse.move(eyePoint.x, eyePoint.y);
  await expect(page.locator("#tile-label")).toBeVisible();
  await expect(page.locator("#tile-label .tile-label-title")).toHaveText(
    "Eye of Larn",
  );
  await expect(page.locator("#tile-label")).toContainText("God of Hellfire");

  const potionPoint = await pointFor(9, 9);
  await page.mouse.move(potionPoint.x, potionPoint.y);
  await expect(page.locator("#tile-label")).toBeHidden();
});
