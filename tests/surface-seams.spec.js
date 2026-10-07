import {test,expect} from "@playwright/test";
import * as THREE from "three";
import {World} from "../src/world.js";
import {WALL_BASE_Y,WALL_FULL,WALL_CUT,wallLip} from "../src/wall-cut.js";

const bounds = (mesh,index) => {
  const matrix=new THREE.Matrix4();mesh.getMatrixAt(index,matrix);
  return new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5)).applyMatrix4(matrix);
};

test("the actual world wall matrices close neighboring seams and meet the floor/caps",()=>{
  const world=Object.create(World.prototype),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial();
  Object.assign(world,{
    state:{x:10,y:6,level:1},camera:{position:new THREE.Vector3(10,20,20)},controls:{target:new THREE.Vector3(10,0,6)},
    wallLayout:42,wallCells:[{x:8,y:8},{x:9,y:8}],wallHeightAt:[],
    scratchOffset:new THREE.Vector3(),scratchPosition:new THREE.Vector3(),scratchScale:new THREE.Vector3(),
    scratchMatrix:new THREE.Matrix4(),scratchColor:new THREE.Color(),spinQ:new THREE.Quaternion(),
    walls:new THREE.InstancedMesh(geometry,material,2),caps:new THREE.InstancedMesh(geometry,material,2),
    ambientRats:{enabled:true,setLayout(){}},markShadowUpdate(){},
  });
  for(const level of [0,1,16])for(const y of [6,7]){
    world.state={x:8,y,level};world.wallView=null;world.wallLayoutKey=null;world.updateWalls();
    const a=bounds(world.walls,0),b=bounds(world.walls,1),ca=bounds(world.caps,0),cb=bounds(world.caps,1);
    expect(a.max.x).toBeCloseTo(b.min.x,6);expect(ca.max.x).toBeCloseTo(cb.min.x,6);
    expect(a.min.y).toBeCloseTo(WALL_BASE_Y,6);expect(ca.min.y).toBeCloseTo(a.max.y,6);
    expect(cb.min.y).toBeCloseTo(b.max.y,6);
  }
  for(const height of [WALL_CUT,WALL_FULL]){
    const lip=wallLip(height);expect(lip.y-lip.thickness/2).toBeCloseTo(WALL_BASE_Y+height,10);
  }
});

test("town roof surfaces write depth when opaque and recover after hiding the hero",async({page})=>{
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  await page.addInitScript(()=>{localStorage.setItem("ularn3d.quality","balanced");localStorage.setItem("ularn3d.audio.v1",JSON.stringify({enabled:false}));});
  await page.goto("/play/");await expect(page.locator("#loading")).toBeHidden();await page.locator("#begin").click();
  const store=await page.evaluate(()=>{
    const store=ularn.snapshot().tiles.find(tile=>tile.id===12);
    player.x=store.x-8;player.y=store.y;paint();return {x:store.x,y:store.y};
  });
  const read=()=>page.evaluate(store=>ularnGraphics.buildings().find(b=>b.tile.x===store.x&&b.tile.y===store.y),store);
  await expect.poll(async()=>{const b=await read();return b?.opacity===1&&b.depthWrite;}).toBe(true);
  await page.evaluate(store=>{player.x=store.x;player.y=store.y-1;paint();},store);
  await expect.poll(async()=>(await read()).opacity).toBeLessThan(.3);
  expect((await read()).depthWrite).toBe(false);
  await page.evaluate(store=>{player.x=store.x-8;player.y=store.y;paint();},store);
  await expect.poll(async()=>{const b=await read();return b.opacity===1&&b.depthWrite;}).toBe(true);
  expect(errors).toEqual([]);
});

test("roof mip filtering blends LODs while retaining the existing terrain maps",async({page})=>{
  await page.goto("/play/");
  const filters=await page.evaluate(async()=>{
    const {texture}=await import("/src/materials.js"),THREE=await import("/node_modules/three/build/three.module.js");
    return {roof:texture("roof").minFilter,stone:texture("stone").minFilter,
      linear:THREE.LinearMipmapLinearFilter,crisp:THREE.LinearMipmapNearestFilter};
  });
  expect(filters.roof).toBe(filters.linear);expect(filters.stone).toBe(filters.crisp);
});
