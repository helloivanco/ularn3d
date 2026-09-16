import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE", m.text());
});
await page.goto(process.env.TEST_URL || "http://localhost:5173");
await page.waitForTimeout(1800);
await page.screenshot({ path: "/tmp/ularn-title.png" });
await page.getByRole("button", { name: "Begin expedition" }).click();
await page.waitForTimeout(1000);
console.log(
  "STATE",
  await page.evaluate(() => {
    const s = ularn.snapshot();
    return {
      character: s.character,
      level: s.level,
      hp: s.hp,
      tiles: s.tiles.length,
      graphics: ularnGraphics.metrics(),
    };
  }),
);
await page.screenshot({ path: "/tmp/ularn-game.png" });
await browser.close();
