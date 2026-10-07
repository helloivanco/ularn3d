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
  await page.addInitScript(()=>{
    localStorage.setItem("ularn3d.quality","auto");
    localStorage.setItem("ularn3d.audio.v1",JSON.stringify({enabled:false}));
  });
  // Exercise the actual app renderer at the high Auto tier without waiting
  // for ten seconds of GPU headroom in a software-rendered functional test.
  await page.route("**/src/world.js*",async route=>{
    const response=await route.fetch(),body=await response.text();
    await route.fulfill({response,body:body.replace("this.autoTier = 1;","this.autoTier = 2;")});
  });
  await page.goto("/play/");await expect(page.locator("#loading")).toBeHidden();
  const maps=await page.evaluate(async()=>{
    const {texture}=await import("/src/materials.js");
    const values=[];
    for(const kind of ["stone","grass","wood","roof"]){
      const small=texture(kind).image, large=texture(kind,512).image;
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
    expect(scene.effectiveQuality).toBe("high");expect(scene.pixelRatio).toBe(1);
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
