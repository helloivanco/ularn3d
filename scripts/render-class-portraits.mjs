import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Render the actual shared hero models once; the entry screen uses small local
// images, rather than eight additional live WebGL scenes or remote artwork.
const base=process.env.TEST_URL||"http://127.0.0.1:5173";
const names=["Adventurer","Wizard","Rogue","Elf","Dwarf","Ogre","Klingon","Rambo"];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
try {
  const page=await browser.newPage();
  await page.route("**/portrait-review",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><title>Class portrait review</title>"}));
  await page.goto(new URL("/portrait-review",base).href);
  const portraits=await page.evaluate(async names=>{
    const THREE=await import("/node_modules/three/build/three.module.js"),{hero}=await import("/src/models.js");
    const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(160,192);renderer.setClearColor(0,0);renderer.toneMapping=THREE.ACESFilmicToneMapping;
    const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xc8e1dd,0x3a4334,2));
    const sun=new THREE.DirectionalLight(0xffdfb4,3.2);sun.position.set(-8,20,12);scene.add(sun);
    const fill=new THREE.DirectionalLight(0x97bcc7,.8);fill.position.set(10,9,-4);scene.add(fill);
    const camera=new THREE.OrthographicCamera(-.72,.72,.864,-.864,.1,30);camera.position.set(0,2.4,4);camera.lookAt(0,.56,0);
    const images=[];
    for(const name of names){
      const model=hero(name);model.rotation.y=Math.PI+.15;
      model.getObjectByName("contact-disc")?.removeFromParent();scene.add(model);renderer.render(scene,camera);
      images.push({name,data:renderer.domElement.toDataURL("image/webp",.9).split(",")[1]});scene.remove(model);
    }
    renderer.dispose();return images;
  },names);
  await mkdir("public/art/classes",{recursive:true});
  for(const portrait of portraits)await writeFile(`public/art/classes/${portrait.name.toLowerCase()}.webp`,Buffer.from(portrait.data,"base64"));
  console.log(`Rendered ${portraits.length} cached class portraits at 160 × 192.`);
} finally {await browser.close();}
