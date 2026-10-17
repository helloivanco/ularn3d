import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Real Chrome GPU, isolated profiles, identical seeded scenes. Do not run other
// graphics tests concurrently: software-rendered CI checks do not measure FPS.
const urls = process.argv.slice(2);
if (!urls.length) urls.push(process.env.TEST_URL || "http://127.0.0.1:5173");
const output = process.env.GRAPHICS_OUTPUT || "test-results/graphics-scenes";
const steps = Number(process.env.GRAPHICS_STEPS) || 96;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const reports = [];
// "explore-caves" holds a direction through fog, so every step reveals tiles
// and takes the structure-rebuild path that a fully known floor skips.
const SCENES = [
  { name: "town", depth: 0 }, { name: "caves", depth: 1 }, { name: "volcano", depth: 16 },
  { name: "phone-caves", depth: 1, phone: true }, { name: "explore-caves", depth: 1, explore: true },
];
await mkdir(output, { recursive: true });
try {
  for (const [build, url] of urls.entries()) {
    for (const entry of SCENES) {
      const context = await browser.newContext({ viewport: entry.phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: entry.phone ? 2 : 1 });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("ularn3d.quality", "auto");
        window.sceneSamples = []; window.previousRenderedAt = null;
        const raf = requestAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => raf(time => {
          const before = window.ularnGraphics?.metrics().renderedFrames, start = performance.now();
          callback(time);
          const after = window.ularnGraphics?.metrics();
          if (before !== undefined && after.renderedFrames > before) {
            const interval = previousRenderedAt === null ? null : start - previousRenderedAt;
            previousRenderedAt = start;
            sceneSamples.push({ interval, cost: performance.now() - start, draws: after.drawCalls, tier: after.effectiveQuality });
          }
        });
      });
      await page.goto(new URL("/play/", url).href); await page.locator("#loading").waitFor({ state: "hidden" });
      // Seed the first start: a second start is intentionally ignored by the
      // adapter once an expedition exists, so it cannot seed the scene.
      await page.evaluate(()=>{
        const start=ularn.start.bind(ularn);
        ularn.start=options=>start({...options,seed:0x1a2b3c4d});
      });
      await page.locator("#begin").click();
      const fixture = await page.evaluate(({ depth, explore }) => {
        newcavelevel(depth);
        player.x=explore?3:33; player.y=8; player.HP=player.HPMAX=100000;
        for(let x=0;x<MAXX;x++)for(let y=0;y<MAXY;y++){setMonster(x,y,null);setKnow(x,y,explore?0:KNOWALL);}
        for(let x=explore?2:31;x<=(explore?MAXX-3:36);x++)for(let y=7;y<=9;y++)setItem(x,y,OEMPTY);
        // Keep representative different rigs in the scene, while the native
        // engine continues to own movement, combat, arrivals and all turns.
        for(const [id,x,y] of [[2,39,8],[4,29,9],[7,38,6],[11,28,6],[15,40,10],[48,27,11]]) {
          setItem(x,y,OEMPTY);setMonster(x,y,createMonster(id));
        }
        if(!explore)player.inventory[25]=createObject(OLARNEYE);
        paint();
        return ularn.snapshot().tiles.map(({x,y,id,monster})=>`${x},${y}:${id}:${monster?.id||0}`).join("|");
      }, { depth: entry.depth, explore: !!entry.explore });
      await page.locator("#camera-reset").click(); await page.waitForTimeout(600);
      await page.screenshot({ path: `${output}/${build}-${entry.name}-start.png` });
      const start = await page.evaluate(() => {
        sceneSamples.length=0;previousRenderedAt=null;
        return { at:performance.now(), moves:player.MOVESMADE, metrics:ularnGraphics.metrics() };
      });
      if(entry.explore){await page.keyboard.down("ArrowRight");await page.waitForTimeout(Math.min(steps,48)*140);await page.keyboard.up("ArrowRight");await page.waitForTimeout(300);}
      else for(let i=0;i<steps;i++){await page.keyboard.press(i%2?"ArrowLeft":"ArrowRight");await page.waitForTimeout(140);}
      const report = await page.evaluate(start => {
        const stats = values => {
          const sorted=values.slice().sort((a,b)=>a-b);
          return {mean:values.reduce((sum,v)=>sum+v,0)/Math.max(1,values.length),p95:sorted[Math.floor(sorted.length*.95)]||0,samples:values.length};
        };
        const samples=sceneSamples.filter(sample=>sample.interval!==null&&sample.interval<150), metrics=ularnGraphics.metrics();
        const gl=document.querySelector("#world canvas").getContext("webgl2"), debug=gl.getExtension("WEBGL_debug_renderer_info");
        return {gpu:debug&&gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),seconds:(performance.now()-start.at)/1000,
          actualTurns:player.MOVESMADE-start.moves,frames:stats(samples.map(s=>s.interval)),render:stats(samples.map(s=>s.cost)),
          drawCalls:stats(samples.map(s=>s.draws)),tiers:[...new Set(sceneSamples.map(s=>s.tier))],
          inputP95:metrics.inputLatencyP95,updateP95:metrics.updateP95,stepJitter:metrics.stepJitter,longTasks:metrics.longTasks-start.metrics.longTasks,start:start.metrics,end:metrics,
          audio:ularnAudio.metrics()};
      },start);
      await page.screenshot({ path: `${output}/${build}-${entry.name}-end.png` });
      reports.push({build,url,scene:entry.name,fixture:createHash("sha256").update(fixture).digest("hex"),...report,errors});
      console.log(JSON.stringify({build,scene:entry.name,frameP95:report.frames.p95,inputP95:report.inputP95,renderP95:report.render.p95,updateP95:report.updateP95,stepJitter:report.stepJitter,longTasks:report.longTasks,drawCalls:report.drawCalls.mean,tiers:report.tiers,errors}));
      await context.close();
    }
  }
  await writeFile(`${output}/measurements.json`,JSON.stringify({steps,reports},null,2)+"\n");
  if(urls.length===2)for(let i=0;i<SCENES.length;i++){
    if(reports[i].fixture!==reports[i+SCENES.length].fixture||reports[i].actualTurns!==reports[i+SCENES.length].actualTurns)
      throw new Error(`Unmatched ${reports[i].scene} fixture/actions; comparison is invalid`);
  }
  if(reports.some(report=>report.errors.length))process.exitCode=1;
} finally { await browser.close(); }
