/** Opt-in live browser flow: TEST_URL=https://preview... node tests/multiplayer-browser.live.mjs */
import { chromium, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
if (process.env.PREVIEW_ENV_PATH) {
  const token = readFileSync(process.env.PREVIEW_ENV_PATH, 'utf8').match(/^VERCEL_OIDC_TOKEN=(.*)$/m)?.[1];
  if (token) process.env.VERCEL_OIDC_TOKEN = token.trim().replace(/^["']|["']$/g, '');
}
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const root = process.env.TEST_URL || 'http://localhost:5173';
const pages = [], errors = []; let roomId;
try {
  for (let i=0;i<5;i++) {
    const page=await browser.newPage({ viewport:{width:1280,height:900} });pages.push(page);
    if (process.env.VERCEL_OIDC_TOKEN) await page.context().route(`${new URL(root).origin}/**`, route => route.continue({ headers: { ...route.request().headers(), 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN } }));
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',async response=>{if(response.url().endsWith('/rpc/create_room_as'))roomId=(await response.json()).room_id;});
    await page.goto(`${root}/play/`);await page.waitForFunction(()=>window.ularnOnline);
  }
  const [host,a,b,c,watch]=pages;
  await host.locator('#multiplayer').click();await host.getByRole('button',{name:'Host a room',exact:true}).click();await host.locator('#host-name').fill('LiveHost');await host.locator('#host-public').uncheck();await host.getByRole('button',{name:'Create lobby',exact:true}).click();await expect(host.locator('#lobby-ready')).toBeVisible({timeout:30000});const code=await host.locator('.room-code strong').innerText();console.log('private test room',roomId,code);
  for(const [page,name,character] of [[a,'LiveMage','Wizard'],[b,'LiveScout','Rogue'],[c,'LiveDwarf','Dwarf']]){
    await page.goto(`${root}/play/?room=${code}`);await expect(page.locator('#join-code')).toBeVisible({timeout:15000});await page.locator('#join-name').fill(name);await page.locator('#join-character').selectOption(character);await page.getByRole('button',{name:'Join room',exact:true}).click();await expect(page.locator('#lobby-ready')).toBeVisible({timeout:30000});
  }
  for(const page of [host,a,b,c])await page.locator('#lobby-ready').click();await expect(host.locator('#lobby-start')).toBeEnabled({timeout:15000});await host.locator('#lobby-start').click();for(const page of [host,a,b,c])await page.waitForFunction(()=>ularnOnline.inMatch(),{timeout:30000});
  await watch.locator('#multiplayer').click();await watch.getByRole('button',{name:'Watch',exact:true}).click();await watch.locator('#watch-code').fill(code);await watch.getByRole('button',{name:'Watch room',exact:true}).click();await watch.waitForFunction(()=>ularnOnline.inMatch(),{timeout:30000});
  for(const page of pages)await expect.poll(()=>page.evaluate(()=>ularnOnline.diagnostics().notifications),{timeout:20000}).toBe('SUBSCRIBED');
  const names=[];for(const page of [host,a,b,c])names.push(await page.evaluate(()=>ularn.snapshot().name));expect(names).toEqual(['LiveHost','LiveMage','LiveScout','LiveDwarf']);
  const send=(page,key)=>page.evaluate(key=>ularnOnline.sendInput(key),key);
  await send(host,'right');await send(a,'down');await send(b,'right');await send(c,'down');await send(a,'loot:on');await send(host,'q');await expect.poll(()=>a.evaluate(()=>ularnOnline.acceptsInput())).toBe(false);await send(host,'escape');await expect.poll(()=>a.evaluate(()=>ularnOnline.acceptsInput())).toBe(true);
  const sync=async()=>{const seq=await host.evaluate(()=>ularnOnline.diagnostics().seq);for(const page of pages)await expect.poll(()=>page.evaluate(()=>ularnOnline.diagnostics().seq)).toBe(seq);const expected=await host.evaluate(()=>ularnOnline.diagnostics().checksum);for(const page of pages)expect(await page.evaluate(()=>ularnOnline.diagnostics().checksum)).toBe(expected);return{seq,checksum:expected};};
  console.log('five synchronized browsers',await sync());
  await a.reload();await a.waitForFunction(()=>window.ularnOnline?.inMatch(),{timeout:30000});expect(await a.evaluate(()=>ularn.snapshot().name)).toBe('LiveMage');await sync();
  await a.context().setOffline(true);await expect.poll(()=>a.evaluate(()=>ularnOnline.diagnostics().healthy),{timeout:20000}).toBe(false);await send(host,'down');await a.context().setOffline(false);await expect.poll(()=>a.evaluate(()=>ularnOnline.diagnostics().healthy),{timeout:20000}).toBe(true);await sync();
  await watch.locator('#chat-quick button[data-message="Nice move!"]').click();await expect(watch.locator('#chat-status')).toHaveText('Sent to Spectators: Nice move!');await host.locator('[data-channel="spectators"]').click();await expect(host.locator('#chat-log')).toContainText('Nice move!');
  await watch.keyboard.press('Tab');expect(await watch.evaluate(()=>ularnOnline.acceptsInput())).toBe(false);
  await host.locator('#room-menu').click();await host.getByRole('button',{name:'Make LiveMage the host',exact:true}).click();await expect.poll(()=>a.evaluate(()=>ularnOnline.diagnostics().role)).toBe('host');await host.locator('dialog[open] .dialog-x').click();
  await a.locator('#room-menu').click();await a.getByRole('button',{name:'Remove Cid from room',exact:true}).click();await expect(watch.locator('dialog[open] .online-status')).toContainText('removed',{timeout:20000});
  await a.locator('dialog[open] .dialog-x').click();await expect(a.locator('#room-exit')).toBeVisible();await a.locator('#room-exit').click();await expect(a.locator('#welcome')).toBeVisible({timeout:20000});await expect.poll(()=>host.evaluate(()=>ularnOnline.diagnostics().role)).toBe('host');expect(await a.evaluate(()=>localStorage.getItem('ularn.online.room.v2'))).toBeNull();
  await host.screenshot({path:'test-results/multiplayer/live-four-player-flow.png'});console.log(JSON.stringify({ok:true,room_id:roomId,errors,checks:['4 separate characters','private database notifications','same state in 5 browsers','prompt ownership','reload','offline recovery','spectator chat','host transfer','remove','leave']}));expect(errors).toEqual([]);
} catch(error){console.error(error.stack||error);process.exitCode=1;}
finally{for(const page of pages)if(!page.isClosed()){try{await page.evaluate(async()=>{if(window.ularnOnline?.inRoom()) await ularnOnline.leave();});}catch{}}await browser.close();}
