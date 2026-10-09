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

test("town and dungeon bases meet floor bottoms without overlapping edge faces",async({page})=>{
  await page.route('**/src/world.js*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace(
      'this.scene = new THREE.Scene();','window.__surfaceWorld = this; this.scene = new THREE.Scene();')});
  });
  await page.goto('/play/');await expect(page.locator('#loading')).toBeHidden();await page.locator('#begin').click();
  const joins=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    return [0,1,16].map(depth=>{
      newcavelevel(depth);paint();
      const world=window.__surfaceWorld;
      const slab=world.terrain.children.find(mesh=>mesh.isMesh&&mesh.material.color.getHex()===(depth===0?0x70806e:depth>15?0x22191a:0x101d24));
      const base=new THREE.Box3().setFromObject(slab);
      const floor=world.floor.count?world.floor:world.grassFloor;
      const matrix=new THREE.Matrix4();floor.getMatrixAt(0,matrix);
      floor.geometry.computeBoundingBox();
      const tile=floor.geometry.boundingBox.clone().applyMatrix4(matrix);
      return {depth,baseTop:base.max.y,floorBottom:tile.min.y};
    });
  });
  for(const join of joins){
    expect(join.baseTop).toBeLessThanOrEqual(join.floorBottom+1e-6);
    expect(join.baseTop).toBeCloseTo(join.floorBottom,6);
  }
});

test("occluding buildings fade as a whole, keep a solid floor and restore their exterior",async({page})=>{
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
  await expect.poll(async()=>(await read()).opacity).toBe(0);
  const cut=await read();
  expect(cut.parts.filter(part=>part.part==='base').every(part=>part.visible&&!part.transparent&&part.opacity===1&&part.depthWrite)).toBe(true);
  expect(cut.parts.filter(part=>part.part==='roof').every(part=>!part.visible&&part.opacity===0)).toBe(true);
  expect(cut.parts.filter(part=>part.part!=='base').every(part=>!part.visible&&part.opacity===0)).toBe(true);
  expect(cut.parts.every(part=>!part.transparent&&part.depthWrite)).toBe(true);
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

test("whole-building fades keep the hero clear from every camera side and settle",async({page})=>{
  await page.setViewportSize({width:720,height:540});
  await page.route('**/src/world.js*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace(
      'this.scene = new THREE.Scene();','window.__surfaceWorld = this; this.scene = new THREE.Scene();')});
  });
  await page.addInitScript(()=>localStorage.setItem('ularn3d.quality','cinematic'));
  await page.goto('/play/');await expect(page.locator('#loading')).toBeHidden();await page.locator('#begin').click();
  const store=await page.evaluate(()=>{
    const tile=ularn.snapshot().tiles.find(tile=>tile.id===12);
    player.x=tile.x;player.y=tile.y;paint();return {x:tile.x,y:tile.y};
  });
  for(const [x,z] of [[0,12],[12,0],[0,-12],[-12,0],[8.5,8.5],[8.5,-8.5],[-8.5,-8.5],[-8.5,8.5]]){
    await page.evaluate(({x,z,store})=>{
      const world=window.__surfaceWorld;
      world.snapFollow();world.controls.target.set(store.x,0,store.y);
      world.camera.position.set(store.x+x,15,store.y+z);world.controls.update();world.invalidate();
    },{x,z,store});
    const read=()=>page.evaluate(store=>ularnGraphics.buildings().find(b=>b.tile.x===store.x&&b.tile.y===store.y),store);
    await expect.poll(async()=>{
      const parts=(await read()).parts;
      return parts.filter(part=>part.part!=='base').every(part=>!part.visible)&&
        parts.filter(part=>part.part==='base').every(part=>part.visible&&part.opacity===1);
    }).toBe(true);
    const before=await page.evaluate(()=>ularnGraphics.metrics().shadowUpdates);
    await page.evaluate(async()=>{
      for(let frame=0;frame<12;frame++) await new Promise(requestAnimationFrame);
    });
    expect(await page.evaluate(()=>ularnGraphics.metrics().shadowUpdates)).toBe(before);
  }
});

test("walking beside the college keeps its roof intact and obstruction leaves no inner walls",async({page})=>{
  await page.route('**/src/world.js*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace(
      'this.scene = new THREE.Scene();','window.__surfaceWorld = this; this.scene = new THREE.Scene();')});
  });
  await page.addInitScript(()=>{
    localStorage.setItem('ularn3d.quality','balanced');
    localStorage.setItem('ularn3d.audio.v1',JSON.stringify({enabled:false}));
  });
  await page.goto('/play/');await expect(page.locator('#loading')).toBeHidden();await page.locator('#begin').click();
  const college=await page.evaluate(()=>{
    const tile=ularn.snapshot().tiles.find(tile=>tile.id===10);
    player.x=tile.x+1;player.y=tile.y;paint();
    const world=window.__surfaceWorld;world.snapFollow();world.yawEase=false;
    world.controls.enableDamping=false;world.controls.target.copy(world.player.position);
    world.camera.position.set(player.x,15,player.y+10);world.controls.update();world.invalidate();
    return {x:tile.x,y:tile.y};
  });
  const read=()=>page.evaluate(tile=>ularnGraphics.buildings().find(b=>b.tile.x===tile.x&&b.tile.y===tile.y),college);
  await expect.poll(async()=>{
    const building=await read();
    return !building.obscuresHero&&building.parts.every(part=>part.visible&&part.opacity===1&&part.depthWrite);
  }).toBe(true);
  for(let step=0;step<4;step++){
    await page.keyboard.press(step%2?'ArrowUp':'ArrowDown');
    await page.waitForTimeout(180);
    const building=await read();
    expect(building.obscuresHero).toBe(false);
    expect(building.parts.every(part=>part.visible&&part.opacity===1)).toBe(true);
  }
  await page.evaluate(tile=>{player.x=tile.x;player.y=tile.y-1;paint();},college);
  await expect.poll(async()=>{
    const building=await read();
    return building.obscuresHero&&building.parts.filter(part=>part.part!=='base').every(part=>!part.visible);
  }).toBe(true);
  expect((await read()).parts.filter(part=>part.part==='base').every(part=>part.visible&&part.depthWrite)).toBe(true);
  await page.evaluate(tile=>{player.x=tile.x+1;player.y=tile.y;paint();},college);
  await expect.poll(async()=>{
    const building=await read();return !building.obscuresHero&&building.parts.every(part=>part.visible&&part.opacity===1);
  }).toBe(true);
});
