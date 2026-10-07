export async function mapClick(page, x, y) {
  const local = await page.locator("#minimap").evaluate((canvas) => ({ ...canvas.dataset }));
  let selector = "#minimap", originX = Number(local.originX), originY = Number(local.originY), columns = Number(local.columns), rows = Number(local.rows);
  if (x < originX || y < originY || x >= originX + columns || y >= originY + rows) {
    await page.locator("#map-expand").click();
    await page.locator("#map-fit").click();
    selector = "#expanded-map"; originX = originY = 0;
    const full = await page.locator(selector).evaluate(canvas => ({...canvas.dataset}));
    columns = Number(full.columns); rows = Number(full.rows);
  }
  const bounds = await page.locator(selector).boundingBox();
  await page.mouse.click(bounds.x + (x - originX + .5) / columns * bounds.width,
    bounds.y + (y - originY + .5) / rows * bounds.height);
}
