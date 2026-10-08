import { test, expect } from "@playwright/test";

const desktops = [
  { width: 1024, height: 988 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

const openStart = async (page, viewport) => {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.expedition.v1", "layout-check");
  });
  await page.goto("/play/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 15000 });
  await expect(page.locator(".class-choice")).toHaveCount(8);
};

for (const viewport of desktops) {
  test(`start screen fits a ${viewport.width}×${viewport.height} window without scrolling`, async ({
    page,
  }) => {
    await openStart(page, viewport);
    await expect(page.locator("#multiplayer")).toBeVisible();
    await expect(page.locator("#continue")).toBeVisible();
    await expect(page.locator("#save-notice")).toContainText(
      "A new expedition replaces your saved expedition.",
    );
    await expect(page.locator("#class-description")).not.toBeEmpty();
    await expect(page.locator(".class-portrait")).toHaveCount(8);
    await expect.poll(()=>page.locator(".class-portrait").evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0))).toBe(true);
    await expect(page.locator("#download-windows")).toContainText("Download for Windows");
    await expect(page.locator("#welcome")).not.toContainText(/classic reawakened/i);
    await expect(page.locator("#location-name")).toHaveText("");
    await expect(page.locator(".location-dot")).toBeHidden();
    await expect(page.locator("#sound")).toBeHidden();
    await expect(page.locator(".topbar #about-game")).toBeVisible();
    await expect(page.locator(".topbar #whats-new")).toBeVisible();
    await expect(page.locator("#guide")).toContainText("Field guide");
    await expect(page.getByRole("link", { name: "History", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "GitHub", exact: true })).toBeVisible();
    await expect(page.locator(".site-links")).toContainText("Verify download");
    await expect(page.locator(".site-links .github-link")).toBeVisible();
    await expect(page.locator("#welcome")).not.toContainText("Time moves only when you do.");
    await expect(page.locator(".site-version")).toHaveCount(0);
    await expect(page.locator("#download-windows small")).toContainText("Portable · 64-bit · Offline play");

    const titleLine = await page.evaluate(() => {
      const logo = document.querySelector("#title .brand img").getBoundingClientRect();
      const name = document.querySelector("#title .title-name").getBoundingClientRect();
      const sub = document.querySelector("#title em").getBoundingClientRect();
      const nameSize = parseFloat(getComputedStyle(document.querySelector("#title .title-name")).fontSize);
      const subSize = parseFloat(getComputedStyle(document.querySelector("#title em")).fontSize);
      const overlap = Math.min(logo.bottom, name.bottom) - Math.max(logo.top, name.top);
      return {
        overlap,
        logoHeight: logo.height,
        subStartsBelowName: sub.top >= name.bottom - 1,
        subUnderName: Math.abs(sub.left - name.left) < 2,
        subSmaller: subSize < nameSize * 0.6,
        logoClearsSubtitle: logo.bottom <= sub.top + 2,
      };
    });
    expect(titleLine.overlap).toBeGreaterThan(titleLine.logoHeight * 0.8);
    expect(titleLine.subStartsBelowName).toBe(true);
    expect(titleLine.subUnderName).toBe(true);
    expect(titleLine.subSmaller).toBe(true);
    expect(titleLine.logoClearsSubtitle).toBe(true);

    const headerLinks = await page.evaluate(() => {
      const colorOf = (selector, child) =>
        getComputedStyle(document.querySelector(selector).querySelector(child)).color;
      const mid = (box) => box.top + box.height / 2;
      const download = document.querySelector("#download-windows").getBoundingClientRect();
      const verify = document.querySelector(".site-links a[href='/about/#verify-download']").getBoundingClientRect();
      const logo = document.querySelector(".github-link .icon").getBoundingClientRect();
      const github = document.querySelector(".github-word").getBoundingClientRect();
      const order = [...document.querySelector(".topbar nav").children]
        .filter((el) => getComputedStyle(el).display !== "none")
        .map((el) => el.id);
      return {
        order,
        aboutMatch: colorOf("#about-game", ".icon") === colorOf("#about-game", ".button-label"),
        newsMatch: colorOf("#whats-new", ".icon") === colorOf("#whats-new", ".button-label"),
        githubBelow: github.top >= download.bottom - 1,
        sameLine: Math.abs(mid(verify) - mid(github)) < 3 && Math.abs(mid(logo) - mid(github)) < 3,
        wordBesideLogo: github.left >= logo.right - 1 && github.left - logo.right < 24,
        logoAfterVerify: logo.left > verify.left,
      };
    });
    expect(headerLinks.order).toEqual(["about-game", "whats-new", "guide"]);
    expect(headerLinks.aboutMatch).toBe(true);
    expect(headerLinks.newsMatch).toBe(true);
    expect(headerLinks.githubBelow).toBe(true);
    expect(headerLinks.sameLine).toBe(true);
    expect(headerLinks.wordBesideLogo).toBe(true);
    expect(headerLinks.logoAfterVerify).toBe(true);

    const fit = await page.evaluate(() => {
      const welcome = document.querySelector("#welcome");
      const download = document.querySelector("#download-windows").getBoundingClientRect();
      return {
        overflows: welcome.scrollHeight > welcome.clientHeight + 1,
        scrollbar: welcome.offsetWidth - welcome.clientWidth,
        pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
        downloadTop: download.top,
        downloadBottom: download.bottom,
        innerHeight: window.innerHeight,
        welcomeTop: welcome.getBoundingClientRect().top,
        welcomeCenter: (welcome.getBoundingClientRect().top+welcome.getBoundingClientRect().bottom)/2,
        layoutCenter: (()=>{const box=document.querySelector(".entry-layout").getBoundingClientRect();return(box.top+box.bottom)/2;})(),
      };
    });

    expect(fit.overflows).toBe(false);
    expect(fit.scrollbar).toBe(0);
    expect(fit.pageScrolls).toBe(false);
    expect(fit.downloadTop).toBeGreaterThan(0);
    expect(fit.downloadBottom).toBeLessThanOrEqual(fit.innerHeight);
    expect(fit.welcomeTop).toBeGreaterThanOrEqual(60);
    expect(fit.welcomeCenter).toBeCloseTo(fit.layoutCenter,0);
    await expect(page.locator("#scene-caption")).toHaveCount(0);
    await expect(page.locator("#welcome .intro")).toHaveCount(0);
    const actions=await page.evaluate(()=>({
      resume:document.getElementById("continue").getBoundingClientRect().top,
      classes:document.getElementById("classes").getBoundingClientRect().top,
      begin:document.getElementById("begin").getBoundingClientRect(),
      multiplayer:document.getElementById("multiplayer").getBoundingClientRect(),
    }));
    expect(actions.resume).toBeLessThan(actions.classes);
    expect(Math.abs(actions.begin.top-actions.multiplayer.top)).toBeLessThan(1);
  });
}

test("spectator line stays off the title and out of the empty center", async ({ page }) => {
  await openStart(page, { width: 1280, height: 800 });
  await page.evaluate(() => window.ularnOnline.preview("spectator"));
  const placed = await page.evaluate(() => {
    const badge = document.getElementById("spectator-badge");
    const title = document.getElementById("title");
    const badgeBox = badge.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    const overlapX = Math.min(badgeBox.right, titleBox.right) - Math.max(badgeBox.left, titleBox.left);
    const overlapY = Math.min(badgeBox.bottom, titleBox.bottom) - Math.max(badgeBox.top, titleBox.top);
    return {
      text: badge.textContent,
      inNav: Boolean(document.querySelector(".topbar nav #spectator-badge")),
      overlapsTitle: overlapX > 2 && overlapY > 2,
      center: badgeBox.left + badgeBox.width / 2,
      width: window.innerWidth,
    };
  });
  expect(placed.text).toMatch(/^Spectating .+ · \d+ watching$/);
  expect(placed.inNav).toBe(true);
  expect(placed.overlapsTitle).toBe(false);
  expect(Math.abs(placed.center - placed.width / 2)).toBeGreaterThan(80);
});

test("landing content stays readable and its background pauses off-screen", async ({page})=>{
  await page.goto("/");await expect(page.locator("#home-loading")).toBeHidden();
  await expect(page.locator(".home-hero .hero-panel")).toHaveCount(0);
  await expect(page.locator("#home-brand")).toBeVisible();
  await expect(page.locator("#see-title")).toHaveCSS("opacity","1");
  await page.evaluate(()=>scrollTo(0,innerHeight+120));
  await expect(page.locator("#see-title")).toBeVisible();
  await page.waitForTimeout(250);
  const frames=await page.evaluate(()=>ularnGraphics.metrics().renderedFrames);
  await page.waitForTimeout(350);
  expect(await page.evaluate(()=>ularnGraphics.metrics().renderedFrames)).toBe(frames);
  await page.setViewportSize({width:1200,height:800});await page.waitForTimeout(250);
  const resized=await page.evaluate(()=>ularnGraphics.metrics().renderedFrames);
  await page.waitForTimeout(300);
  expect(await page.evaluate(()=>ularnGraphics.metrics().renderedFrames)).toBe(resized);
  await page.evaluate(()=>scrollTo(0,0));
  await expect.poll(()=>page.evaluate(()=>ularnGraphics.metrics().renderedFrames)).toBeGreaterThan(frames);
});

test("reduced-motion landing renders a still scene and updates once after resize",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});await page.goto("/");
  await expect(page.locator("#home-loading")).toBeHidden();await page.waitForTimeout(250);
  const frames=await page.evaluate(()=>ularnGraphics.metrics().renderedFrames);
  await page.waitForTimeout(300);expect(await page.evaluate(()=>ularnGraphics.metrics().renderedFrames)).toBe(frames);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
  const resized=await page.evaluate(()=>ularnGraphics.metrics().renderedFrames);
  expect(resized).toBeGreaterThan(frames);
  await page.waitForTimeout(300);expect(await page.evaluate(()=>ularnGraphics.metrics().renderedFrames)).toBe(resized);
});

test("landing links and content are usable without JavaScript",async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,baseURL:test.info().project.use.baseURL}),page=await context.newPage();
  try{
    await page.goto("/");
    await expect(page.locator("#see-title")).toBeVisible();
    await expect(page.getByRole("link",{name:/Play in your browser/}).first()).toBeVisible();
  }finally{await context.close();}
});

test("narrow phone start screen keeps controls from colliding", async ({ page }) => {
  await openStart(page, { width: 320, height: 700 });
  const issues = await page.evaluate(() => {
    const welcome = document.querySelector("#welcome");
    const nodes = [...welcome.querySelectorAll("button, a, input, select")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    const found = [];
    for (const el of nodes) {
      if (el.scrollWidth > el.clientWidth + 2) {
        found.push(`clipped:${el.id || el.textContent.trim().slice(0, 24)}`);
      }
      const box = el.getBoundingClientRect();
      if (box.left < -1 || box.right > innerWidth + 1) {
        found.push(`offscreen:${el.id || el.textContent.trim().slice(0, 24)}`);
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i].getBoundingClientRect();
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].contains(nodes[j]) || nodes[j].contains(nodes[i])) continue;
        const b = nodes[j].getBoundingClientRect();
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > 2 && overlapY > 2) {
          found.push(
            `overlap:${nodes[i].id || nodes[i].textContent.trim().slice(0, 16)}/${nodes[j].id || nodes[j].textContent.trim().slice(0, 16)}`,
          );
        }
      }
    }
    return found;
  });
  expect(issues).toEqual([]);
});

test("short windows scroll the centered panel and keep the primary action reachable",async({page})=>{
  await openStart(page,{width:844,height:390});
  const limits=await page.locator("#welcome").evaluate(element=>({
    top:element.getBoundingClientRect().top,bottom:element.getBoundingClientRect().bottom,height:innerHeight,
    scrolls:element.scrollHeight>element.clientHeight,
  }));
  expect(limits.top).toBeGreaterThanOrEqual(50);expect(limits.bottom).toBeLessThanOrEqual(limits.height);
  expect(limits.scrolls).toBe(true);
  await page.locator("#begin").scrollIntoViewIfNeeded();await expect(page.locator("#begin")).toBeInViewport();
});
