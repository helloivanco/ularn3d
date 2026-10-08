import {test,expect} from '@playwright/test';
for(const width of [1440,390,320])test(`the download card and verification guide work at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:width===1440?900:844});
 await page.goto('/play/');await expect(page.locator('#loading')).toBeHidden();
 const card=page.locator('#download-windows');await card.scrollIntoViewIfNeeded();
 await expect(card).toBeVisible();await expect(card).toHaveAttribute('download','Ularn.windows.exe');
 await expect(card).toContainText('Portable · 64-bit · Offline play');
 const box=await card.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
 await expect(page.locator('.site-links .github-link')).toHaveCount(1);
 await expect(page.getByRole('link',{name:'GitHub',exact:true})).toHaveCount(1);
 await page.getByRole('link',{name:'Verify download',exact:true}).click();
 await expect(page).toHaveURL(/\/about\/#verify-download$/);
 const guide=page.locator('#verify-download');await expect(guide).toBeVisible();
 await expect(guide).toContainText('Get-FileHash .\\Ularn.windows.exe -Algorithm SHA256');
 await expect(guide.getByRole('link',{name:'matching SHA-256 checksum file'})).toHaveAttribute('href','/downloads/SHA256SUMS.txt');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
