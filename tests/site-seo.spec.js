import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

const origin = "https://ularn-3d.vercel.app";
const routes = ["/", "/play/", "/about/", "/credits/"];
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const downloadName = `Ularn-${version}.windows.exe`;
test.use({ javaScriptEnabled: false });

test("indexable pages expose unique metadata, headings and canonical URLs without JavaScript", async ({ page }) => {
  const titles = [], descriptions = [];
  for (const route of routes) {
    const response = await page.goto(route);
    expect(response.status()).toBe(200);
    titles.push(await page.title());
    descriptions.push(await page.locator('meta[name="description"]').getAttribute("content"));
    expect(titles.at(-1)).toContain("Ularn");
    expect(descriptions.at(-1).length).toBeGreaterThan(40);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText(/Ularn/i);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${origin}${route}`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `${origin}${route}`);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", `${origin}/social/ularn.png`);
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", /\S+/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.length).toBeGreaterThan(0);
    const nodes = blocks.flatMap((text) => {
      const value = JSON.parse(text);
      return value["@graph"] || (Array.isArray(value) ? value : [value]);
    });
    expect(nodes.every((node) => !!node["@type"])).toBe(true);
    if (route === "/") {
      expect(nodes.some((node) => [node["@type"]].flat().includes("SoftwareApplication"))).toBe(true);
      expect(nodes.some((node) => node.softwareVersion === version)).toBe(true);
    }
    if (route === "/play/") {
      const entity = nodes.find((node) => node.mainEntity)?.mainEntity;
      expect([entity?.["@type"]].flat().includes("SoftwareApplication")).toBe(true);
      expect(entity?.softwareVersion).toBe(version);
    }
    expect(await page.locator("img:not([alt])").count()).toBe(0);
    await expect(page.locator('link[rel="icon"][href="/favicon.svg"]')).toHaveCount(1);
  }
  expect(new Set(titles).size).toBe(routes.length);
  expect(new Set(descriptions).size).toBe(routes.length);
  await page.goto("/?utm_source=seo-regression");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${origin}/`);
});

test("field guide and optional Windows download are reachable through normal links", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#download-windows")).toHaveAttribute("href", "/downloads/Ularn.windows.exe");
  await expect(page.locator("#download-windows")).toHaveAttribute("download", downloadName);
  await expect(page.locator("#download-windows")).toContainText(new RegExp(`v${version}`));
  await expect(page.locator(".footer-version")).toHaveText(`v${version}`);
  await expect(page.getByRole("link", { name: /Play in your browser/i }).first()).toHaveAttribute("href", "/play/");
  await page.goto("/play/");
  await expect(page.locator("#about-game")).toHaveAttribute("href", "/about/");
  await expect(page.locator("#download-windows")).toHaveAttribute("href", "/downloads/Ularn.windows.exe");
  await expect(page.locator("#download-windows")).toHaveAttribute("download", downloadName);
  await expect(page.locator("#download-windows")).toContainText(new RegExp(`v${version}`));
  await expect(page.locator(".site-version")).toHaveText(`v${version}`);
  await expect(page.locator("#begin")).toHaveAttribute("type", "submit");
  await page.goto("/about/");
  await expect(page.getByRole("link", { name: "Play in your browser" })).toHaveAttribute("href", "/play/");
  await expect(page.locator('a[href="/downloads/Ularn.windows.exe"]')).toBeVisible();
  await expect(page.locator('a[href="/downloads/Ularn.windows.exe"]')).toHaveAttribute("download", downloadName);
  await expect(page.locator('a[href="/downloads/Ularn.windows.exe"]')).toContainText(new RegExp(`v${version}`));
  await expect(page.locator('a[href="/downloads/SHA256SUMS.txt"]')).toBeVisible();
  await expect(page.locator(".footer-version")).toHaveText(`v${version}`);
  await expect(page.locator(".class-grid article")).toHaveCount(8);
  await expect(page.locator("#controls")).toContainText("F2");
  await expect(page.locator("#controls")).toContainText("F3");
  await expect(page.locator("#windows")).toContainText(/separate from browser saves/);
  await expect(page.locator("#windows")).toContainText(downloadName);
  await page.goto("/credits/");
  await expect(page.locator("h1")).toContainText(/Ularn/i);
  await expect(page.getByText("Noah Morgan")).toBeVisible();
  await expect(page.getByText("Phil Cordier")).toBeVisible();
  await expect(page.getByText(/Ultra-Larn/i).first()).toBeVisible();
  await expect(page.locator(".footer-version")).toHaveText(`v${version}`);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("robots and sitemap advertise only canonical public pages", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const rules = await robots.text();
  expect(rules).toMatch(/^Sitemap:\s*https:\/\/ularn-3d\.vercel\.app\/sitemap\.xml\s*$/im);
  expect(rules).not.toMatch(/^Disallow:\s*\/(?:engine\/)?\s*$/im);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(locations.sort()).toEqual(routes.map((route) => `${origin}${route}`).sort());
  const image = await request.get("/social/ularn.png");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
  expect((await image.body()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const favicon = await request.get("/favicon.svg");
  expect(favicon.status()).toBe(200);
  const touch = await request.get("/apple-touch-icon.png");
  expect(touch.status()).toBe(200);
  const manifest = await request.get("/site.webmanifest");
  expect(manifest.status()).toBe(200);
});

test("published Windows link serves a real executable and its checksum", async ({ request }) => {
  test.skip(process.env.DOWNLOAD_AVAILABLE !== "1", "Enable after the optional Windows artifact has been published.");
  const path = "/downloads/Ularn.windows.exe";
  const redirect = await request.head(path, { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(new URL(redirect.headers().location).href).toBe(`https://github.com/helloivanco/ularn3d/releases/download/v${version}/${downloadName}`);
  const head = await request.head(path);
  expect(head.status()).toBe(200);
  expect(head.headers()["content-type"]).not.toContain("text/html");
  expect(Number(head.headers()["content-length"])).toBeGreaterThan(65536);
  if (head.headers()["accept-ranges"]?.includes("bytes")) {
    const prefix = await request.get(path, { headers: { Range: "bytes=0-1" } });
    expect(prefix.status()).toBe(206);
    expect((await prefix.body()).toString()).toBe("MZ");
  }
  const checksum = await request.get("/downloads/SHA256SUMS.txt");
  expect(checksum.status()).toBe(200);
  const checksumName = downloadName.replaceAll(".", "\\.");
  expect(await checksum.text()).toMatch(new RegExp(`^[a-f\\d]{64}\\s+\\*?${checksumName}\\s*$`, "im"));
});

test("deployed utility pages stay out of search and unknown routes are real 404s", async ({ request }) => {
  test.skip(process.env.SEO_DEPLOYED !== "1", "Vercel response headers and 404 routing are deployment checks.");
  for (const route of routes) {
    const page = await request.get(route);
    expect(page.status()).toBe(200);
    expect(page.headers()["x-robots-tag"] || "").not.toContain("noindex");
  }
  for (const [duplicate, canonical] of [
    ["/index.html", "/"],
    ["/play", "/play/"],
    ["/play/index.html", "/play/"],
    ["/about", "/about/"],
    ["/about/index.html", "/about/"],
    ["/credits", "/credits/"],
    ["/credits/index.html", "/credits/"],
  ]) {
    const redirect = await request.get(duplicate, { maxRedirects: 0 });
    expect(redirect.status()).toBe(308);
    expect(new URL(redirect.headers().location, origin).pathname).toBe(canonical);
  }
  const utility = await request.get("/engine/larn_local.html");
  expect(utility.headers()["x-robots-tag"]).toContain("noindex");
  const missing = await request.get("/seo-regression-page-that-does-not-exist");
  expect(missing.status()).toBe(404);
});

test("vercel download points at the GitHub Release for this package version", async () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  const disposition = vercel.headers
    .flatMap((entry) => entry.headers)
    .find((header) => header.key === "Content-Disposition")
    ?.value;
  expect(disposition).toBe(`attachment; filename="${downloadName}"`);
  const exeRedirect = vercel.redirects.find((entry) => entry.source === "/downloads/Ularn.windows.exe");
  expect(exeRedirect?.destination).toBe(`https://github.com/helloivanco/ularn3d/releases/download/v${version}/${downloadName}`);
  expect(exeRedirect?.permanent).toBe(false);
  const checksumRedirect = vercel.redirects.find((entry) => entry.source === "/downloads/SHA256SUMS.txt");
  expect(checksumRedirect?.destination).toBe(`https://github.com/helloivanco/ularn3d/releases/download/v${version}/SHA256SUMS.txt`);
});
