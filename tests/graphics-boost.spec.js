import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { bakeWallRelief, featherContact } from "../src/graphics-utils.js";
import { World } from "../src/world.js";

test("baked wall relief and soft contact keep their original topology and bounds", () => {
  const wall=new THREE.BoxGeometry(1,1,1), count=wall.index.count;
  bakeWallRelief(wall);
  expect(wall.index.count).toBe(count);
  const normals=wall.getAttribute("normal"), shades=wall.getAttribute("color");
  for(let i=0;i<normals.count;i++) {
    expect(shades.getX(i)).toBeGreaterThan(.6);expect(shades.getX(i)).toBeLessThanOrEqual(1);
    if(normals.getY(i)>.5)expect(shades.getX(i)).toBe(1);
    if(normals.getY(i)<-.5)expect(shades.getX(i)).toBeCloseTo(.64);
  }
  const disc=new THREE.CircleGeometry(.5,20), vertices=disc.getAttribute("position").array.slice();
  featherContact(disc);expect(disc.index.count).toBe(60);
  expect(disc.getAttribute("position").array).toEqual(vertices);
  expect(disc.getAttribute("color").getW(0)).toBe(1);
  for(let i=1;i<disc.getAttribute("color").count;i++)expect(disc.getAttribute("color").getW(i)).toBe(0);
});

test("Auto high sharpens without turning on Cinematic work, and sustained slow frames back off", () => {
  const world=Object.create(World.prototype);
  Object.assign(world,{quality:"auto",autoTier:2,effectiveTier:2,frameSamples:Array(30).fill(100),applyQuality(){this.effectiveTier=this.autoTier;}});
  expect(world.cinematicRendering()).toBe(false);
  for(let time=0;time<2300;time+=100)world.adaptQuality(time,100);
  expect(world.autoTier).toBe(1);
  world.quality="cinematic";expect(world.cinematicRendering()).toBe(true);
});

test("texture scales align and all regions retain cheap mapped terrain at Auto high", async ({page}) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  // Exercise the actual app renderer at the high Auto tier (remembered from an
  // earlier session) without waiting for GPU headroom in a software-rendered test.
  await page.addInitScript(()=>{
    localStorage.setItem("ularn3d.quality","auto");
    localStorage.setItem("ularn3d.autoTier","2");
    localStorage.setItem("ularn3d.audio.v1",JSON.stringify({enabled:false}));
  });
  await page.goto("/play/");await expect(page.locator("#loading")).toBeHidden();
  const maps=await page.evaluate(async()=>{
    const {texture}=await import("/src/materials.js");
    const values=[];
    for(const kind of ["flags","basalt","stone","grass","wood","roof"]){
      // The color map is the 512 relief source itself; a 128 draw still lands on the same pattern.
      if(texture(kind).image!==texture(kind,512).image||texture(kind).image.width!==512)values.push({kind,cached:false,error:Infinity});
      const small=texture(kind,128).image, large=texture(kind,512).image;
      const sample=document.createElement("canvas");sample.width=sample.height=128;
      sample.getContext("2d").drawImage(large,0,0,128,128);
      const a=small.getContext("2d").getImageData(0,0,128,128).data,b=sample.getContext("2d").getImageData(0,0,128,128).data;
      let error=0;for(let i=0;i<a.length;i++)if(i%4!==3)error+=Math.abs(a[i]-b[i]);
      values.push({kind,error:error/(128*128*3),cached:texture(kind)===texture(kind)});
    }
    return values;
  });
  for(const map of maps){expect(map.cached).toBe(true);expect(map.error).toBeLessThan(15);}
  await page.locator("#begin").click();
  const scenes=await page.evaluate(()=>[0,1,16].map(depth=>{newcavelevel(depth);paint();return ularnGraphics.metrics();}));
  for(const scene of scenes){
    expect(scene.effectiveQuality).toBe("high");expect(scene.pixelRatio).toBe(1);expect(scene.antialiasing).toBe("MSAA");
    expect(scene.composer).toBe(false);expect(scene.shadowMapEnabled).toBe(false);
    expect(scene.pointLights).toBe(0);expect(scene.floorMapped&&scene.wallMapped&&scene.wallRelief).toBe(true);
  }
  await page.locator("#pause").click();await page.locator("#graphics-quality").selectOption("cinematic");
  await page.locator("#resume-game").click();
  await expect.poll(()=>page.evaluate(()=>ularnGraphics.metrics().composer)).toBe(true);
  expect(await page.evaluate(()=>ularnGraphics.metrics().antialiasing)).toBe("SMAA");
  expect(await page.evaluate(()=>ularnGraphics.metrics().shadowMapEnabled)).toBe(true);
  await page.locator("#pause").click();await page.locator("#graphics-quality").selectOption("auto");
  await page.locator("#resume-game").click();
  await expect.poll(()=>page.evaluate(()=>ularnGraphics.metrics().composer)).toBe(false);
  expect(errors).toEqual([]);
});

test("Auto on a 2x screen climbs to native resolution with MSAA and no Cinematic work", async ({browser}) => {
  const context=await browser.newContext({deviceScaleFactor:2,viewport:{width:1280,height:800}});
  const page=await context.newPage();
  await page.addInitScript(()=>{
    localStorage.setItem("ularn3d.quality","auto");
    // A remembered tier above this screen's density is clamped to it.
    localStorage.setItem("ularn3d.autoTier","9");
    localStorage.setItem("ularn3d.audio.v1",JSON.stringify({enabled:false}));
  });
  await page.goto("/play/");await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  const scene=await page.evaluate(()=>{newcavelevel(1);paint();return ularnGraphics.metrics();});
  expect(scene.autoTierLimit).toBe(4);
  expect(scene.effectiveQuality).toBe("native");expect(scene.pixelRatio).toBe(2);
  expect(scene.antialiasing).toBe("MSAA");
  expect(scene.composer).toBe(false);expect(scene.shadowMapEnabled).toBe(false);expect(scene.pointLights).toBe(0);
  await context.close();
});

test("Cinematic caves glow around the hero while Auto caves stay flat and unlit", async ({page}) => {
  await page.addInitScript(()=>{
    localStorage.setItem("ularn3d.quality","cinematic");
    localStorage.setItem("ularn3d.audio.v1",JSON.stringify({enabled:false}));
  });
  await page.goto("/play/");await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await page.evaluate(()=>{newcavelevel(1);paint();});
  await expect.poll(()=>page.evaluate(()=>ularnGraphics.metrics().playerLight)).toBe(true);
  const cave=await page.evaluate(()=>ularnGraphics.metrics());
  expect(cave.caveGlow).toBe(true);expect(cave.caveRelief).toBe(true);expect(cave.vignette).toBe(true);expect(cave.pointLights).toBe(1);
  // The glow keeps the unlit, mapped cave materials.
  expect(cave.floorMaterial).toBe("MeshBasicMaterial");expect(cave.floorMapped&&cave.wallMapped).toBe(true);
  await page.locator("#pause").click();await page.locator("#graphics-quality").selectOption("auto");
  await page.locator("#resume-game").click();
  await expect.poll(()=>page.evaluate(()=>ularnGraphics.metrics().composer)).toBe(false);
  const flat=await page.evaluate(()=>ularnGraphics.metrics());
  expect(flat.caveGlow).toBe(false);expect(flat.caveRelief).toBe(false);expect(flat.vignette).toBe(false);
  expect(flat.playerLight).toBe(false);expect(flat.pointLights).toBe(0);expect(flat.ambient).toBeGreaterThanOrEqual(1.4);
});
