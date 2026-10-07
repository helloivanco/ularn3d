import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { HeldMovement } from "../src/navigation.js";
import { CREATURES, creature } from "../src/creatures.js";
import { mapClick } from "./map-helper.js";
import { World } from "../src/world.js";
import { WALK_SETTLE_MS, walkProgress } from "../src/hero-animation.js";
import { GameMap } from "../src/map.js";

async function arena(page) {
  await page.addInitScript(() => localStorage.setItem("ularn3d.quality", "balanced"));
  await page.goto("/"); await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await page.evaluate(() => {
    newcavelevel(1); player.x = 33; player.y = 8; player.HP = player.HPMAX = 1000;
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) {
      setItem(x, y, OEMPTY); setMonster(x, y, null); setKnow(x, y, KNOWALL);
    }
    paint();
  });
}

async function freezeClock(page) {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60000));
}

test("held movement executes immediately, never catches up overdue turns, and cancels", () => {
  let now = 0, id = 0; const tasks = new Map(), sent = [];
  const timers = { setTimeout(callback, delay) { const key = ++id; tasks.set(key, { callback, due: now + delay }); return key; }, clearTimeout(key) { tasks.delete(key); } };
  const advance = (time) => { now = time; const due = [...tasks].filter(([, task]) => task.due <= now); due.forEach(([key, task]) => { tasks.delete(key); task.callback(); }); };
  const held = new HeldMovement((key) => sent.push(key), () => true, timers);
  held.start("right", "ArrowRight"); expect(sent).toEqual(["right"]);
  advance(219); expect(sent).toHaveLength(1);
  advance(220); expect(sent).toHaveLength(2);
  advance(5000); expect(sent).toHaveLength(3);
  held.start("left", "ArrowLeft"); expect(sent.at(-1)).toBe("left");
  held.release("ArrowRight"); expect(held.current.key).toBe("left");
  held.release("ArrowLeft"); advance(10000); expect(sent).toHaveLength(4);
});

test("all 65 species have distinct bounded models and reuse immutable geometry", () => {
  expect(CREATURES).toHaveLength(65); expect(new Set(CREATURES.map((entry) => entry.model)).size).toBe(65);
  for (const entry of CREATURES) {
    const first = creature({ id: entry.id }), second = creature({ id: entry.id });
    const size = new THREE.Box3().setFromObject(first).getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(.1); expect(size.y).toBeGreaterThan(.1); expect(size.z).toBeGreaterThan(.1);
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(3.6);
    if (entry.family === "beast") expect(size.z).toBeLessThan(1.8);
    expect(first.getObjectByName("core").children[0].geometry).toBe(second.getObjectByName("core").children[0].geometry);
    first.position.x = 20; expect(second.position.x).toBe(0);
  }
});

test("adaptive graphics waits for sustained active overload and recovers gradually", () => {
  const renderer = Object.create(World.prototype), changes = [];
  Object.assign(renderer, { quality: "auto", autoTier: 1, frameSamples: [], applyQuality() { changes.push(this.autoTier); } });
  let now = 0;
  const feed = (duration, frame) => {
    for (let elapsed = 0; elapsed < duration; elapsed += frame) {
      now += frame; renderer.frameSamples = Array(20).fill(frame); renderer.adaptQuality(now, frame);
    }
  };
  feed(1000, 35); expect(changes).toEqual([]);
  feed(1200, 35); expect(changes).toEqual([0]);
  now += 60000; expect(renderer.autoTier).toBe(0); // Suspension contributes no observations.
  feed(6000, 16); expect(changes).toEqual([0]);
  feed(4500, 16); expect(changes).toEqual([0, 1]);
  renderer.quality = "cinematic"; feed(5000, 40); expect(changes).toEqual([0, 1]);
});

test("keyboard hold cadence, browser repeat, reversal, release and prompts are safe", async ({ page }) => {
  await arena(page); await freezeClock(page);
  await page.keyboard.down("ArrowRight"); expect(await page.evaluate(() => player.x)).toBe(34);
  await page.clock.runFor(219); expect(await page.evaluate(() => player.x)).toBe(34);
  await page.clock.runFor(1); expect(await page.evaluate(() => player.x)).toBe(35);
  await page.keyboard.down("ArrowRight"); expect(await page.evaluate(() => player.x)).toBe(35);
  await page.keyboard.down("ArrowLeft"); expect(await page.evaluate(() => player.x)).toBe(34);
  await page.keyboard.up("ArrowRight"); await page.clock.runFor(220); expect(await page.evaluate(() => player.x)).toBe(33);
  await page.keyboard.up("ArrowLeft"); await page.clock.runFor(500); expect(await page.evaluate(() => player.x)).toBe(33);
  await page.keyboard.down("ArrowRight");
  await page.evaluate(() => { blocking_callback = () => false; paint(); });
  const turns = await page.evaluate(() => player.MOVESMADE);
  await page.keyboard.down("ArrowRight"); await page.clock.runFor(800);
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(turns);
  await page.keyboard.up("ArrowRight");
});

test("direction pad holds without a duplicate click, and blur stops input", async ({ page }) => {
  await arena(page); await freezeClock(page);
  const bounds = await page.getByRole("button", { name: "Move east", exact: true }).boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  expect(await page.evaluate(() => player.x)).toBe(34);
  await page.clock.runFor(360); expect(await page.evaluate(() => player.x)).toBe(36);
  await page.mouse.up(); await page.clock.runFor(500); expect(await page.evaluate(() => player.x)).toBe(36);
  await page.keyboard.down("ArrowLeft"); await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.clock.runFor(500); expect(await page.evaluate(() => player.x)).toBe(35);
  await page.keyboard.up("ArrowLeft");
});

test("click travel runs without route lines, revalidates obstacles, and clears on arrival", async ({ page }) => {
  await arena(page); await freezeClock(page);
  await mapClick(page, 38, 8);
  expect(await page.evaluate(() => player.x)).toBe(34);
  expect((await page.evaluate(() => ularnGraphics.metrics())).routePoints).toBe(5);
  expect((await page.evaluate(() => ularnGraphics.metrics())).routeVisible).toBe(false);
  await page.clock.runFor(140); expect(await page.evaluate(() => player.x)).toBe(35);
  await page.evaluate(() => { setItem(36, 8, OCLOSEDDOOR); paint(); });
  await page.clock.runFor(500); expect(await page.evaluate(() => player.x)).toBe(35);
  expect((await page.evaluate(() => ularnGraphics.metrics())).routePoints).toBe(0);
  await page.evaluate(() => { setItem(36, 8, OEMPTY); paint(); });
  await mapClick(page, 38, 8); await page.clock.runFor(280);
  expect(await page.evaluate(() => player.x)).toBe(38);
  expect((await page.evaluate(() => ularnGraphics.metrics())).routePoints).toBe(0);
});

test("the earlier glide responds immediately and has a bounded, exact finish", () => {
  expect(walkProgress(0)).toBe(0);
  expect(walkProgress(16)).toBeGreaterThan(.12);
  expect(walkProgress(16)).toBeLessThan(.22);
  let previous = 0;
  for (let time = 0; time <= WALK_SETTLE_MS; time += 10) {
    const progress = walkProgress(time);
    expect(progress).toBeGreaterThanOrEqual(previous);
    expect(progress).toBeLessThanOrEqual(1);
    previous = progress;
  }
  expect(walkProgress(WALK_SETTLE_MS)).toBe(1);
  expect(walkProgress(10000)).toBe(1);
});

test("symbol map overlays show the player without drawing a route or destination", () => {
  const map = Object.create(GameMap.prototype), player = [], lines = [];
  map.state = { x: 1, y: 2 };
  map.route = [{ x: 1, y: 2 }, { x: 2, y: 2 }]; // Old callers cannot re-enable a path overlay.
  const context = {
    fillRect() {}, fillText(text) { player.push(text); },
    beginPath() { lines.push("path"); }, lineTo() { lines.push("line"); },
    stroke() { lines.push("stroke"); }, strokeRect() { lines.push("destination"); },
  };
  map.overlay(context);
  expect(player).toEqual(["@"]);
  expect(lines).toEqual([]);
});

test("the hero glide settles at its actual tile after a step and a rapid reversal", async ({ page }) => {
  await arena(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  expect(await page.evaluate(() => player.x)).toBe(33);
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().heroPosition)).toEqual([33, 0, 8]);
  expect((await page.evaluate(() => ularnGraphics.metrics())).routeVisible).toBe(false);
});

test("expanded map pauses travel, pans without moving, and uses full-floor coordinates", async ({ page }) => {
  await arena(page);
  const before = await page.evaluate(() => player.MOVESMADE);
  await page.locator("#map-expand").click(); await page.locator("#map-zoom-in").click();
  const box = await page.locator("#map-viewport").boundingBox();
  await page.mouse.move(box.x + 150, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 100, { steps: 5 }); await page.mouse.up();
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(before);
  await page.locator("#map-fit").click();
  const full = await page.locator("#expanded-map").boundingBox();
  await page.mouse.click(full.x + 35.5 / 67 * full.width, full.y + 8.5 / 17 * full.height);
  await expect(page.locator("#map-dialog")).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => player.x)).toBe(35);
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().routePoints)).toBe(0);
});

test("actor motion settles at the exact tile without rebuilding unchanged terrain", async ({ page }) => {
  await arena(page);
  await page.evaluate(() => { setMonster(40, 8, createMonster(GNOME)); paint(); });
  const before = await page.evaluate(() => ularnGraphics.metrics().terrainRebuilds);
  await page.evaluate(() => { mmove(40, 8, 41, 8); paint(); });
  await expect.poll(() => page.evaluate(() => ularnGraphics.creatures()[0].position)).toEqual([41, 0, 8]);
  const actor = (await page.evaluate(() => ularnGraphics.creatures()))[0];
  expect(actor.position).toEqual([41, 0, 8]);
  expect((await page.evaluate(() => ularnGraphics.metrics())).terrainRebuilds).toBe(before);
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(180);
  expect((await page.evaluate(() => ularnGraphics.metrics())).terrainRebuilds).toBe(before);
});

test("a displaced route cancels and camera reset during a step stays centered", async ({ page }) => {
  await arena(page); await freezeClock(page);
  await page.keyboard.press("ArrowRight"); await page.clock.runFor(50);
  await page.locator("#camera-reset").click(); await page.clock.runFor(150);
  const metrics = await page.evaluate(() => ularnGraphics.metrics());
  expect(metrics.heroScreen.x).toBeCloseTo((metrics.viewport.left + metrics.viewport.right) / 2, 0);
  expect(metrics.heroScreen.y).toBeCloseTo((metrics.viewport.top + metrics.viewport.bottom) / 2, 0);
  await page.evaluate(() => {
    const key = ularn.key;
    ularn.key = (...args) => { key(...args); player.x = 50; paint(); };
  });
  await mapClick(page, 38, 8); await page.clock.runFor(1000);
  expect(await page.evaluate(() => player.x)).toBe(50);
  expect((await page.evaluate(() => ularnGraphics.metrics())).routePoints).toBe(0);
});

for (const dimensions of [[1440, 1000], [390, 844], [844, 390]]) {
  test(`hero is framed outside controls at ${dimensions.join("x")}`, async ({ page }) => {
    await page.setViewportSize({ width: dimensions[0], height: dimensions[1] }); await arena(page);
    await page.waitForTimeout(250);
    const { heroScreen, viewport } = await page.evaluate(() => ularnGraphics.metrics());
    expect(heroScreen.x).toBeGreaterThan(viewport.left); expect(heroScreen.x).toBeLessThan(viewport.right);
    expect(heroScreen.y).toBeGreaterThan(viewport.top); expect(heroScreen.y).toBeLessThan(viewport.bottom);
    await page.screenshot({ path: `test-results/fluidity-${dimensions.join("x")}.png` });
  });
}
