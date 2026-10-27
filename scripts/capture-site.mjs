#!/usr/bin/env node
/**
 * Captures the website's gameplay screenshots from the running dev server.
 *
 *   npm run dev                         (in another terminal)
 *   node scripts/capture-site.mjs       every shot
 *   node scripts/capture-site.mjs caves one shot by name
 *
 * Each scene is staged with the engine's own globals, rendered in Cinematic on
 * the machine's GPU at twice the output size, and written as a 1600×900 JPEG
 * (the social card is 1200×630 PNG). The HUD is hidden; nothing is painted over
 * the frame afterwards. `callings` renders the eight heroes for the field guide.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const only = process.argv[2];
const SCALE = 2;

/*
 * Each stage runs in the page. `room(depth, x0, y0, x1, y1)` clears the floor to
 * unknown rock and lays out one known room with its walls; `at(x, y, item)` and
 * `beast(x, y, id)` dress it.
 */
const SCENES = {
  caves: {
    file: "public/screenshots/dungeon.jpg",
    zoom: 7,
    rotate: 4,
    stage: () => {
      // This offset and its niches draw four torches, candles and a barrel along
      // the south wall, which the camera turns to face.
      room(3, 34, 3, 50, 14);
      niche(34, 6); niche(40, 3); niche(50, 9); niche(45, 14);
      at(38, 8, OFOUNTAIN); at(48, 11, OCHEST); at(37, 5, OSTAIRSDOWN);
      at(40, 12, createObject(OGOLDPILE, 240)); at(45, 9, createObject(OPOTION, 3)); at(41, 9, createObject(OSAPPHIRE));
      hero(43, 11);
      beast(44, 11, ZOMBIE); beast(40, 10, JACKAL); beast(47, 9, TROGLODYTE);
    },
    // Mid-swing at the skeleton, after its hit flash.
    act: swing("l"),
  },
  town: {
    file: "public/screenshots/town.jpg",
    zoom: 3,
    rotate: 1,
    stage: () => {
      // The town is laid out anew each game: stand where the most buildings are close.
      const tiles = ularn.snapshot().tiles, stores = tiles.filter((tile) => tile.store);
      const near = (tile) => stores.filter((store) => Math.max(Math.abs(store.x - tile.x), Math.abs(store.y - tile.y)) <= 4).length;
      const open = tiles.filter((tile) => !tile.wall && !tile.store && tile.id === 0);
      const best = open.reduce((a, b) => (near(b) > near(a) ? b : a));
      hero(best.x, best.y);
    },
  },
  halls: {
    file: "public/screenshots/halls.jpg",
    zoom: 6,
    stage: () => {
      // Torches along the north wall and the west wall, a broken table in the north niche.
      room(12, 29, 2, 45, 13);
      niche(29, 5); niche(35, 2); niche(45, 8); niche(40, 13);
      at(33, 4, OTHRONE); at(38, 4, OALTAR); at(42, 4, OSTATUE); at(44, 6, OMIRROR);
      at(31, 8, OTELEPORTER); at(41, 9, createObject(OPOTION, 21));
      hero(37, 6);
      beast(38, 6, VAMPIRE); beast(34, 8, WRAITH); beast(42, 8, CUBE);
    },
    act: swing("l"),
  },
  volcano: {
    file: "public/screenshots/volcano.jpg",
    zoom: 6,
    stage: () => {
      room(16, 23, 2, 39, 13);
      niche(23, 5); niche(29, 2); niche(39, 8); niche(34, 13);
      at(35, 9, OANNIHILATION); at(26, 4, createObject(OGOLDPILE, 900)); at(36, 4, OSTAIRSDOWN);
      hero(30, 8);
      beast(31, 7, REDDRAGON); beast(26, 10, BRONZEDRAGON); beast(34, 5, HELLHOUND);
    },
    act: swing("u"),
  },
  "town-wide": {
    file: "public/screenshots/town-wide.jpg",
    viewport: [1600, 770],
    zoom: -1,
    stage: () => {
      // Stand on the open floor nearest the middle of the buildings.
      const tiles = ularn.snapshot().tiles, stores = tiles.filter((tile) => tile.store);
      const cx = stores.reduce((sum, tile) => sum + tile.x, 0) / stores.length, cy = stores.reduce((sum, tile) => sum + tile.y, 0) / stores.length;
      const open = tiles.filter((tile) => !tile.wall && !tile.store && tile.id === 0);
      const centre = open.reduce((best, tile) => (Math.hypot(tile.x - cx, tile.y - cy) < Math.hypot(best.x - cx, best.y - cy) ? tile : best));
      hero(centre.x, centre.y);
    },
  },
  social: {
    file: "public/social/ularn.png",
    viewport: [1600, 840],
    size: [1200, 630],
    zoom: 7,
    rotate: 4,
    stage: () => {
      room(3, 34, 3, 50, 14);
      niche(34, 6); niche(40, 3); niche(50, 9); niche(45, 14);
      at(38, 8, OFOUNTAIN); at(48, 11, OCHEST);
      at(40, 12, createObject(OGOLDPILE, 240)); at(45, 9, createObject(OPOTION, 3)); at(41, 9, createObject(OSAPPHIRE));
      hero(43, 11);
      beast(44, 11, ZOMBIE); beast(40, 10, JACKAL);
    },
    act: swing("l"),
  },
};

/** Strike toward a neighbour and catch the blade after the target's hit flash. */
function swing(direction) {
  return async (page) => {
    await page.evaluate((key) => ularn.key(key), direction);
    await page.waitForTimeout(330);
  };
}

const pageHelpers = () => {
  window.room = (depth, x0, y0, x1, y1) => {
    newcavelevel(depth);
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) { setMonster(x, y, null); setItem(x, y, OWALL); setKnow(x, y, KNOWNOT); }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      setKnow(x, y, KNOWALL);
      if (x > x0 && x < x1 && y > y0 && y < y1) setItem(x, y, OEMPTY);
    }
  };
  window.at = (x, y, item) => { setItem(x, y, item); setKnow(x, y, KNOWALL); };
  /** A one-tile recess in a room wall, its back wall known too. */
  window.niche = (x, y) => {
    setItem(x, y, OEMPTY);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) setKnow(x + dx, y + dy, KNOWALL);
  };
  window.beast = (x, y, id) => { setMonster(x, y, createMonster(id)); };
  window.hero = (x, y) => { player.x = x; player.y = y; player.HP = player.HPMAX = 400; };
};

async function capture(browser, name, scene) {
  const [vw, vh] = scene.viewport || [1600, 900];
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: SCALE });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "cinematic");
    localStorage.setItem("ularn3d.inventoryPinned", "false");
  });
  await page.goto(new URL("/play/", base).href);
  await page.locator("#loading").waitFor({ state: "hidden" });
  await page.locator("#begin").click();
  await page.waitForFunction(() => !document.getElementById("hud").hidden);
  // The HUD stays in the layout, since framing sits the hero between the top bar
  // and the dock, but the floating side panels leave it so framing need not
  // keep clear of them.
  await page.addStyleTag({ content: [
    "#app > :not(#world), #notice-stack, .feedback-layer, #tile-label { visibility: hidden !important; }",
    ".map-panel, #inventory-panel, #effects-panel { display: none !important; }",
  ].join("\n") });
  await page.evaluate(pageHelpers);
  await page.evaluate(`(${scene.stage.toString()})(); paint();`);
  // Let the floor veil lift, rigged bodies and props load and the camera settle.
  await page.waitForTimeout(2500);
  const canvas = await page.locator("#world canvas").boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  for (let i = 0; i < Math.abs(scene.zoom || 0); i++) { await page.mouse.wheel(0, scene.zoom > 0 ? -240 : 240); await page.waitForTimeout(60); }
  for (let i = 0; i < Math.abs(scene.rotate || 0); i++) {
    await page.evaluate((id) => document.getElementById(id).click(), scene.rotate > 0 ? "rotate-right" : "rotate-left");
    await page.waitForTimeout(250);
  }
  await page.mouse.move(2, 2);
  await page.waitForTimeout(1500);
  if (scene.act) await scene.act(page);
  const raw = join(tmpdir(), `ularn-${name}.png`);
  // SHOTS_DIR writes the frame somewhere else, for comparing looks without touching the site.
  const file = process.env.SHOTS_DIR ? join(process.env.SHOTS_DIR, scene.file.split("/").pop()) : scene.file;
  await page.screenshot({ path: raw });
  const [width, height] = scene.size || [vw, vh];
  const format = file.endsWith(".png") ? "png" : "jpeg";
  execFileSync("sips", ["-z", String(height), String(width), "-s", "format", format, ...(format === "jpeg" ? ["-s", "formatOptions", "86"] : []), raw, "--out", file], { stdio: "ignore" });
  await rm(raw);
  await page.close();
  if (errors.length) console.warn(`${name}: page errors`, errors);
  console.log(`${name} → ${file}`);
}

/** Portraits of the eight callings for the field guide, from scripts/hero-art.page.js. */
async function renderCallings(browser) {
  const page = await browser.newPage();
  await page.route("**/calling-art", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Callings</title>" }));
  await page.goto(new URL("/calling-art", base).href);
  const images = await page.evaluate(async () => (await import("/scripts/hero-art.page.js")).renderCallings());
  await mkdir("public/art/heroes", { recursive: true });
  for (const { name, data } of images) await writeFile(`public/art/heroes/${name.toLowerCase()}.webp`, Buffer.from(data, "base64"));
  await page.close();
  console.log(`callings → public/art/heroes/ (${images.length})`);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  await mkdir("public/screenshots", { recursive: true });
  for (const [name, scene] of Object.entries(SCENES)) if (!only || only === name) await capture(browser, name, scene);
  if (!only || only === "callings") await renderCallings(browser);
} finally {
  await browser.close();
}
