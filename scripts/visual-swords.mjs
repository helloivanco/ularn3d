import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const output = process.env.SWORD_OUTPUT || "docs/screenshots";
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/sword-gallery", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#12252b"><div style="position:absolute;top:26px;left:34px;color:#eadcba;font:26px Georgia">ULARN · Forged blades & sword motion</div></body></html>' }));
  await page.goto(`${base}/sword-gallery`);
  await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { hero, fillWieldedWeapon, weaponModel } = await import("/src/models.js");
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
      fillWieldedWeapon(model.getObjectByName("weapon"), { type: "sword", id: 58 }); model.position.set(x, 0, 2); model.rotation.y = Math.PI; model.scale.setScalar(1.45); scene.add(model);
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
  await page.screenshot({ path: `${output}/sword-designs.png` });
  // Inspect the actual starting grips too: weaponModel() alone used to miss
  // the legacy box tips left on the Adventurer and Rogue in the live game.
  await page.route("**/blade-tip-review", route => route.fulfill({ contentType: "text/html", body:
    '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#12252b"><div id="title" style="position:absolute;top:24px;left:30px;color:#eadcba;font:26px Georgia">ULARN · In-hand blade tips</div></body></html>' }));
  await page.goto(`${base}/blade-tip-review`);
  await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { hero } = await import("/src/models.js"), { creature } = await import("/src/creatures.js");
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; document.body.append(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x12252b);
    scene.add(new THREE.HemisphereLight(0xc8e1dd, 0x3a4334, 2));
    const sun = new THREE.DirectionalLight(0xffdfb4, 3.2); sun.position.set(-8, 20, 12); scene.add(sun);
    const fill = new THREE.DirectionalLight(0x97bcc7, .8); fill.position.set(10, 9, -4); scene.add(fill);
    const width = 6.6, height = width * innerHeight / innerWidth;
    const camera = new THREE.OrthographicCamera(-width/2, width/2, height/2, -height/2, .1, 100);
    camera.position.set(0, 8, 10); camera.lookAt(0, .3, 0);
    const entries = [["Adventurer", hero("Adventurer")], ["Rogue", hero("Rogue")],
      ["Hobgoblin", creature({id:3})], ["Orc", creature({id:6})],
      ["Enemy elf", creature({id:26})], ["Xvart", creature({id:51})]];
    for (const [i, [name, model]] of entries.entries()) {
      const x = (i%3-1)*2.2, z = (Math.floor(i/3)-.5)*2.8;
      model.position.set(x, 0, z); model.rotation.y = Math.PI+.9; scene.add(model);
      const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 80;
      const ctx = canvas.getContext("2d"); ctx.font = "28px Georgia"; ctx.textAlign = "center";
      ctx.fillStyle = "#decda9"; ctx.fillText(name, 200, 47);
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({map, depthTest:false}));
      label.position.set(x, .02, z+.9); label.scale.set(1.9, .38, 1); scene.add(label);
    }
    renderer.render(scene, camera);
    window.bladeTipReview = { renderer, scene, camera, entries };
  });
  await page.screenshot({ path: `${output}/blade-tip-review.png` });
  await page.setViewportSize({width:640, height:760});
  await page.evaluate(() => {
    const { renderer, scene, camera, entries } = bladeTipReview;
    for (const child of [...scene.children]) if (!child.isLight) scene.remove(child);
    const model = entries[0][1]; model.position.set(0,0,0); scene.add(model);
    camera.left=-.6; camera.right=.6; camera.top=.7125; camera.bottom=-.7125;
    camera.position.set(0, 2.8, 4); camera.lookAt(0, .56, 0); camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight); renderer.render(scene,camera);
    document.getElementById("title").remove();
  });
  await page.screenshot({ path: `${output}/adventurer-blade.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(new URL("/play/", base).href); await page.locator("#loading").waitFor({ state: "hidden" }); await page.locator("#begin").click();
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
  await page.screenshot({ path: `${output}/sword-gameplay.png` });
  await page.setViewportSize({ width: 390, height: 844 }); await page.clock.runFor(450);
  await page.locator("#camera-reset").click(); await page.clock.runFor(100);
  await page.screenshot({ path: `${output}/sword-mobile.png` });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Captured all blade variants, sword poses, gameplay strike and mobile presentation.");
} finally { await browser.close(); }
