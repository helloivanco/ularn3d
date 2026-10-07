import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
await mkdir("docs/screenshots", { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base); await page.locator("#loading").waitFor({ state: "hidden" }); await page.locator("#begin").click();
  await page.evaluate(() => {
    const entrance = ularn.snapshot().tiles.find((tile) => tile.id === 54);
    player.x = Math.max(1, Math.min(65, entrance.x + 2)); player.y = Math.max(1, Math.min(15, entrance.y + 2)); paint();
  });
  await page.locator("#camera-reset").click(); await page.waitForTimeout(500);
  await page.screenshot({ path: "docs/screenshots/feedback-town.png" });
  await page.locator("#map-expand").click(); await page.screenshot({ path: "docs/screenshots/expanded-map.png" });
  await page.getByRole("button", { name: "Close explored map" }).click();
  for (const [level, output] of [[1, "feedback-dungeon"], [16, "volcanic-gameplay"]]) {
    await page.evaluate((depth) => {
      newcavelevel(depth); player.x = 33; player.y = 8;
      for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) { setKnow(x, y, KNOWNOT); setMonster(x, y, null); }
      for (let x = 24; x <= 42; x++) for (let y = 2; y < 16; y++) {
        setKnow(x, y, KNOWALL); setItem(x, y, y === 2 || y === 15 || x === 24 || x === 42 || (x === 30 && y < 7) ? OWALL : OEMPTY);
      }
      setItem(28, 5, OSTAIRSUP); setItem(37, 12, OSTAIRSDOWN); setItem(37, 5, OFOUNTAIN);
      for (const [id, x, y] of depth > 15 ? [[56, 37, 9], [57, 30, 5], [52, 28, 11]] : [[1, 31, 10], [2, 34, 5], [4, 37, 9], [7, 29, 7], [11, 35, 12]]) setMonster(x, y, createMonster(id));
      paint();
    }, level);
    await page.waitForTimeout(400); await page.screenshot({ path: `docs/screenshots/${output}.png` });
  }
  await page.locator("#pause").click(); await page.locator("#graphics-quality").selectOption("cinematic"); await page.locator("#resume-game").click();
  await page.waitForTimeout(500); await page.screenshot({ path: "docs/screenshots/cinematic-volcano.png" });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  await page.screenshot({ path: "docs/screenshots/mobile-graphics.png" });

  await page.route("**/visual-gallery", (route) => route.fulfill({ contentType: "text/html",
    body: '<!doctype html><html><body style="margin:0;background:#112329"><div id="title" style="position:absolute;top:20px;left:28px;font:24px Georgia;color:#ead9b4"></div></body></html>' }));
  for (const kind of ["creatures", "heroes"]) {
    await page.setViewportSize({ width: kind === "creatures" ? 1690 : 1400, height: 1080 });
    await page.goto(`${base}/visual-gallery`);
    await page.evaluate(async (kind) => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const { CREATURES, creature } = await import("/src/creatures.js");
      const { hero } = await import("/src/models.js");
      const { RoomEnvironment } = await import("/node_modules/three/examples/jsm/environments/RoomEnvironment.js");
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x112329);
      const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(innerWidth, innerHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping; document.body.append(renderer.domElement);
      const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
      scene.environment = pmrem.fromScene(room, .04).texture; scene.environmentIntensity = .35;
      room.dispose(); pmrem.dispose();
      scene.add(new THREE.HemisphereLight(0xc3e0e7, 0x344132, 2));
      const sun = new THREE.DirectionalLight(0xffdab0, 3.2); sun.position.set(-8, 20, 12); scene.add(sun);
      const names = ["Adventurer", "Wizard", "Rogue", "Elf", "Dwarf", "Ogre", "Klingon", "Rambo"];
      const entries = kind === "creatures" ? CREATURES : names.map((name) => ({ model: name }));
      const columns = kind === "creatures" ? 13 : 4, rows = Math.ceil(entries.length / columns);
      const width = columns * 3.3 + 2, height = width * innerHeight / innerWidth;
      const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .1, 200);
      camera.position.set(0, 24, 23); camera.lookAt(0, 0, 0);
      entries.forEach((entry, i) => {
        const x = (i % columns - (columns - 1) / 2) * 3.3, z = (Math.floor(i / columns) - (rows - 1) / 2) * 5;
        const model = kind === "creatures" ? creature({ id: entry.id }) : hero(entry.model);
        model.position.set(x, 0, z); model.rotation.y = Math.PI; scene.add(model);
        const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 64;
        const ctx = canvas.getContext("2d"); ctx.fillStyle = "#112329"; ctx.fillRect(0, 0, 320, 64);
        ctx.font = "24px Arial"; ctx.textAlign = "center"; ctx.fillStyle = "#dfcda6";
        ctx.fillText((kind === "creatures" ? `${entry.id}. ` : "") + entry.model.replaceAll("-", " "), 160, 39);
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
        label.position.set(x, .04, z + 1.6); label.scale.set(3.1, .62, 1); scene.add(label);
      });
      document.getElementById("title").textContent = kind === "creatures" ? "ULARN · 65 species in 3D" : "ULARN · Eight class models";
      renderer.render(scene, camera);
    }, kind);
    await page.screenshot({ path: `docs/screenshots/${kind}-gallery.png` });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Captured town, cave, volcano, Cinematic, mobile, expanded-map, and complete creature/hero galleries.");
} finally { await browser.close(); }
