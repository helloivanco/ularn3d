import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Render the rigged heroes once, as play shows them; the entry screen and the
// run recap use these small local images rather than eight live WebGL scenes.
// Needs the dev server (npm run dev) for scripts/hero-art.page.js.
const base=process.env.TEST_URL||"http://127.0.0.1:5173";
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
try {
  const page=await browser.newPage();
  await page.route("**/portrait-review",route=>route.fulfill({contentType:"text/html",body:"<!doctype html><title>Class portrait review</title>"}));
  await page.goto(new URL("/portrait-review",base).href);
  const portraits=await page.evaluate(async()=>(await import("/scripts/hero-art.page.js"))
    .renderCallings({width:160,height:192,scale:1,clip:"Idle",at:0.4,fill:0.78}));
  await mkdir("public/art/classes",{recursive:true});
  for(const portrait of portraits)await writeFile(`public/art/classes/${portrait.name.toLowerCase()}.webp`,Buffer.from(portrait.data,"base64"));
  console.log(`Rendered ${portraits.length} cached class portraits at 160 × 192.`);
} finally {await browser.close();}
