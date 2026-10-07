import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const output = process.env.CHARACTER_OUTPUT || "docs/screenshots";
const names = ["Adventurer", "Wizard", "Rogue", "Elf", "Dwarf", "Ogre", "Klingon", "Rambo"];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [], metrics = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/character-review", route => route.fulfill({ contentType: "text/html", body:
    '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#102126"><div id="title" style="position:absolute;top:22px;left:30px;color:#ead8b0;font:24px Georgia"></div></body></html>' }));
  for (const kind of ["heroes", "creatures"]) {
    for (const angle of ["front", "overhead", "back"]) {
      const viewport = kind === "heroes" ? { width: 1440, height: 1050 } : { width: 1800, height: 3000 };
      await page.setViewportSize(viewport);
      await page.goto(new URL("/character-review", base).href);
      const info = await page.evaluate(async ({ kind, angle, names }) => {
        const THREE = await import("/node_modules/three/build/three.module.js");
        const { hero } = await import("/src/models.js");
        const { CREATURES, creature } = await import("/src/creatures.js");
        const entries = kind === "heroes" ? names.map(model => ({ model })) : CREATURES;
        const columns = kind === "heroes" ? 4 : 6, rows = Math.ceil(entries.length / columns);
        const pitch = kind === "heroes" ? 2.4 : 3.25, rowPitch = kind === "heroes" ? 4.1 : angle === "front" ? 4.4 : 3.55;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(innerWidth,innerHeight); renderer.setPixelRatio(1); renderer.toneMapping = THREE.ACESFilmicToneMapping;
        document.body.append(renderer.domElement);
        const scene = new THREE.Scene(); scene.background = new THREE.Color(0x102126);
        scene.add(new THREE.HemisphereLight(0xc8e1dd,0x3a4334,2));
        const sun = new THREE.DirectionalLight(0xffdfb4,3.2);sun.position.set(-8,20,12);scene.add(sun);
        const fill = new THREE.DirectionalLight(0x97bcc7,.8);fill.position.set(10,9,-4);scene.add(fill);
        const width = columns * pitch + (kind === "heroes" ? .7 : 1.7), height = width * innerHeight / innerWidth;
        const camera = new THREE.OrthographicCamera(-width/2,width/2,height/2,-height/2,.1,200);
        // The overhead view matches the real 15.5 / 8.95 gameplay elevation.
        camera.position.set(0,angle === "front" ? 29 : 31,angle === "front" ? 35 : 17.9);
        camera.lookAt(0,.3,0);
        const measurements = [];
        for (const [i,entry] of entries.entries()) {
          const x = (i%columns-(columns-1)/2)*pitch, z = (Math.floor(i/columns)-(rows-1)/2)*rowPitch;
          const model = kind === "heroes" ? hero(entry.model) : creature(entry);
          model.rotation.y = angle === "back" ? 0 : Math.PI + (angle === "front" ? .2 : 0);
          const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
          let triangles = 0, meshes = 0;
          model.traverse(part => { if(part.isMesh){meshes++;triangles+=(part.geometry.index?.count??part.geometry.attributes.position.count)/3;} });
          measurements.push({id:entry.id,name:entry.model,family:entry.family,size:size.toArray(),triangles,meshes});
          model.position.set(x,0,z);scene.add(model);
          const canvas = document.createElement("canvas");canvas.width=512;canvas.height=80;
          const context=canvas.getContext("2d");context.fillStyle="#102126";context.fillRect(0,0,512,80);
          context.font="26px Arial";context.fillStyle="#e0cfaa";context.textAlign="center";
          context.fillText(`${entry.id ? entry.id+". " : ""}${entry.model.replaceAll("-"," ")}`,256,49);
          const map = new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
          const label=new THREE.Sprite(new THREE.SpriteMaterial({map,depthTest:false}));
          label.position.set(x,.02,z+(kind === "heroes" ? 1.65 : 1.28));label.scale.set(pitch*.94,.44,1);scene.add(label);
        }
        document.getElementById("title").textContent=`ULARN · ${kind === "heroes" ? "Eight player classes" : "All 66 enemies"} · ${angle === "front" ? "Three-quarter view" : angle === "back" ? "Back view" : "Gameplay camera"}`;
        renderer.render(scene,camera);
        return { kind,angle,drawCalls:renderer.info.render.calls,measurements };
      }, { kind,angle,names });
      metrics.push(info);
      const suffix = angle === "overhead" ? "gallery" : angle;
      await page.screenshot({ path: `${output}/${kind}-${suffix}.png` });
    }
  }
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality","balanced");
    localStorage.setItem("ularn3d.audio.v1",JSON.stringify({enabled:false}));
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(new URL("/play/",base).href);await page.locator("#loading").waitFor({state:"hidden"});
  await page.getByRole("button",{name:"Rogue",exact:true}).click();await page.locator("#begin").click();
  await page.evaluate(() => {
    newcavelevel(1);player.x=28;player.y=9;
    for(let x=0;x<MAXX;x++)for(let y=0;y<MAXY;y++){
      setMonster(x,y,null);setItem(x,y,OWALL);setKnow(x,y,KNOWNOT);
    }
    for(let x=21;x<=35;x++)for(let y=3;y<=15;y++){
      setItem(x,y,x===21||x===35||y===3||y===15?OWALL:OEMPTY);setKnow(x,y,KNOWALL);
    }
    for(const[id,x,y]of[[2,26,6],[4,31,6],[7,24,8],[8,30,12],[12,30,7],[25,33,10],[32,25,12],[44,24,11],[66,26,8]])setMonster(x,y,createMonster(id));
    paint();
  });
  await page.locator("#camera-reset").click();await page.waitForTimeout(350);
  await page.screenshot({path:`${output}/characters-desktop.png`});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);
  await page.screenshot({path:`${output}/characters-mobile.png`});
  if (errors.length) throw new Error(errors.join("\n"));
  await writeFile(`${output}/character-review.json`, JSON.stringify(metrics,null,2)+"\n");
  console.log("Rendered all eight players and 66 enemies from front, gameplay and back cameras.");
} finally { await browser.close(); }
