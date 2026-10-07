import { test, expect } from "@playwright/test";

test("all 66 enemy models load in the live world, including the loot goblin", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.audio.v1",JSON.stringify({enabled:false}));
  });
  await page.goto("/play/"); await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await expect(page.locator("#hud")).toHaveJSProperty("hidden",false);
  await page.evaluate(() => {
    newcavelevel(1);player.x=26;player.y=9;player.SEEINVISIBLE=1000;player.HP=player.HPMAX=1000;
    player.inventory[25]=createObject(OLARNEYE);
    for(let x=0;x<MAXX;x++)for(let y=0;y<MAXY;y++){setMonster(x,y,null);setItem(x,y,OEMPTY);setKnow(x,y,KNOWALL);}
    for(let id=1;id<monsterlist.length;id++){
      const monster=createMonster(id);
      // This gallery fixture reveals the mimic's own mesh. Separate visibility
      // tests retain its ordinary disguise and the invisible-creature rules.
      if(id===MIMIC)monster.mimicarg=MIMIC;
      setMonster(3+((id-1)%11)*4,2+Math.floor((id-1)/11)*3,monster);
    }
    paint();
  });
  await expect.poll(()=>page.evaluate(()=>ularnGraphics.creatures().map(monster=>monster.species).sort((a,b)=>a-b)))
    .toEqual(Array.from({length:66},(_,i)=>i+1));
  expect(await page.evaluate(()=>ularnGraphics.creatures().find(monster=>monster.species===66).model)).toBe("loot-goblin");
  for(let i=0;i<10;i++)await page.locator("#zoom-out").click();
  await page.screenshot({path:"test-results/full-cast-in-game.png"});
  expect(errors).toEqual([]);
});
