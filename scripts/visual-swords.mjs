import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
await mkdir("docs/screenshots", { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/sword-gallery", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#12252b"><div style="position:absolute;top:26px;left:34px;color:#eadcba;font:26px Georgia">ULARN · Forged blades & sword motion</div></body></html>' }));
  await page.goto(`${base}/sword-gallery`);
  await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { hero, equipHero, weaponModel } = await import("/src/models.js");
    const { HeroAnimation } = await import("/src/hero-animation.js");
    const { RoomEnvironment } = await import("/node_modules/three/examples/jsm/environments/RoomEnvironment.js");
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x12252b);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; document.body.append(renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, .04).texture; scene.environmentIntensity = .7; room.dispose(); pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xc1dbe9, 0x27362a, 2));
    const sun = new THREE.DirectionalLight(0xffe3b9, 3); sun.position.set(-5, 8, 7); scene.add(sun);
    const fill = new THREE.DirectionalLight(0x84c3e3, 1.4); fill.position.set(4, 3, -4); scene.add(fill);
    const width = 15.2, height = width * innerHeight / innerWidth;
    const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .1, 100);
    camera.position.set(0, 7, 10); camera.lookAt(0, .9, 0);
    function label(text, x, z, small = false) {
      const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 80;
      const ctx = canvas.getContext("2d"); ctx.font = `${small ? 26 : 29}px Georgia`; ctx.textAlign = "center"; ctx.fillStyle = "#decda9"; ctx.fillText(text, 200, 47);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
      sprite.position.set(x, .04, z); sprite.scale.set(2.25, .45, 1); scene.add(sprite);
    }
    [[31, "Dagger"], [28, "Sunsword"], [58, "Longsword"], [29, "Two-handed"], [26, "Slashing"], [90, "Vorpal"], [91, "Slayer"]].forEach(([id, name], i) => {
      const x = (i - 3) * 1.85, model = weaponModel({ id, type: id === 31 ? "dagger" : "sword" });
      model.position.set(x, .56, -2.4); model.scale.setScalar(1.7); model.rotation.y = Math.PI; scene.add(model);
      label(name, x, -1.5);
    });
    [[0, "Ready"], [55, "Wind-up · 55 ms"], [105, "Strike · 105 ms"], [170, "Follow-through"]].forEach(([time, name], i) => {
      const x = (i - 1.5) * 3.1, model = hero();
      equipHero(model, { type: "sword", id: 58 }); model.position.set(x, 0, 2); model.rotation.y = Math.PI; model.scale.setScalar(1.45); scene.add(model);
      const animation = new HeroAnimation(scene, model);
      if (time) {
        animation.start({ kind: "weapon", weapon: { type: "sword" }, hit: true, to: { x, y: 3.45 } }, 0);
        for (let t = 0; t < time; t += 16) animation.update(t);
        animation.update(time);
      }
      label(name, x, 3.7, true);
    });
    renderer.render(scene, camera);
  });
  await page.screenshot({ path: "docs/screenshots/sword-designs.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base); await page.locator("#loading").waitFor({ state: "hidden" }); await page.locator("#begin").click();
  await page.evaluate(() => {
    newcavelevel(1); player.x = 10; player.y = 8; player.HP = player.HPMAX = 1000;
    const sword = createObject(OLONGSWORD);
    player.inventory[player.inventory.indexOf(player.WIELD)] = sword;
    player.WIELD = sword;
    recalc();
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) { setMonster(x, y, null); setItem(x, y, OWALL); setKnow(x, y, KNOWNOT); }
    for (let x = 5; x < 16; x++) for (let y = 3; y < 14; y++) { setItem(x, y, OEMPTY); setKnow(x, y, KNOWALL); }
    setMonster(11, 8, ORC); paint();
  });
  for (let i = 0; i < 6; i++) await page.locator("#zoom-in").click();
  await page.waitForTimeout(400); await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 60000));
  await page.keyboard.press("ArrowRight"); await page.clock.runFor(110);
  await page.screenshot({ path: "docs/screenshots/sword-gameplay.png" });
  await page.setViewportSize({ width: 390, height: 844 }); await page.clock.runFor(450);
  await page.locator("#camera-reset").click(); await page.clock.runFor(100);
  await page.screenshot({ path: "docs/screenshots/sword-mobile.png" });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Captured all blade variants, sword poses, gameplay strike and mobile presentation.");
} finally { await browser.close(); }
