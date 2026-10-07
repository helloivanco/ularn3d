import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { hero, equipHero, weaponModel } from "../src/models.js";
import { HeroAnimation } from "../src/hero-animation.js";
import { GameAudio } from "../src/audio.js";

const hit = { kind: "weapon", weapon: { type: "sword", id: 58 }, hit: true, to: { x: 0, y: -1 } };

test("all blade variants have bounded detailed shapes, shared resources and a real hand pivot", () => {
  const identities = new Set();
  for (const id of [31, 28, 29, 58, 26, 90, 91]) {
    const weapon = { type: id === 31 ? "dagger" : "sword", id };
    const first = weaponModel(weapon), second = weaponModel(weapon);
    const size = new THREE.Box3().setFromObject(first).getSize(new THREE.Vector3());
    identities.add(first.userData.weaponModel);
    expect(size.y).toBeGreaterThan(.65);
    expect(size.y).toBeLessThan(1.6);
    expect(size.x).toBeGreaterThan(.2);
    expect(first.children.length).toBeLessThanOrEqual(6);
    expect(first.children[0].geometry).toBe(second.children[0].geometry);
    first.traverse((part) => {
      if (!part.geometry) return;
      for (const attribute of Object.values(part.geometry.attributes))
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    });
  }
  expect(identities.size).toBe(7);
  for (const character of ["Adventurer", "Wizard", "Rogue", "Elf", "Dwarf", "Ogre", "Klingon", "Rambo"]) {
    const model = hero(character);
    expect(model.getObjectByName("weapon").parent.name).toBe("right-forearm");
    equipHero(model, { type: "sword", id: 90 });
    expect(model.getObjectByName("weapon").userData.weaponModel).toBe("vorpal");
    equipHero(model, { type: "sword", id: 91 });
    expect(model.getObjectByName("weapon").userData.weaponModel).toBe("slayer");
    equipHero(model, null);
    expect(model.getObjectByName("weapon").userData.weaponModel).toBe("unarmed");
    expect(model.getObjectByName("weapon").children).toHaveLength(0);
  }
});

test("a swing has contact feedback, retargets the displayed pose and settles without a queue", () => {
  const animation = new HeroAnimation(new THREE.Scene(), hero());
  const buffer = animation.trail.geometry.attributes.position.array;
  animation.start(hit, 0);
  for (const time of [0, 35, 55, 80, 105]) animation.update(time);
  expect(animation.metrics()).toMatchObject({ attackPhase: "strike", impactVisible: true, weaponImpacts: 1 });
  expect(animation.metrics().bladeTrailPoints).toBeGreaterThan(1);
  const displayed = animation.pose.slice();
  animation.start(hit, 140);
  expect(animation.pose).toEqual(displayed);
  expect(animation.side).toBe(-1);
  for (const time of [175, 195, 220, 245, 300, 470, 2000]) animation.update(time);
  expect(animation.active).toBe(false);
  expect(animation.metrics()).toMatchObject({ attackPhase: "idle", bladeTrailPoints: 0, impactVisible: false, attackSequence: 2 });
  expect(animation.weapon.rotation.x).toBe(animation.rest[6]);
  expect(animation.body.rotation.y).toBe(0);
  expect(animation.body.position.z).toBe(0);
  expect(animation.trail.geometry.attributes.position.array).toBe(buffer);
  animation.start(hit, 3000); animation.update(3090); animation.clear();
  expect(animation.metrics()).toMatchObject({ attackPhase: "idle", bladeTrailPoints: 0, impactVisible: false });
  animation.dispose();
});

test("misses, unseen targets and reduced motion never show a false impact", () => {
  const animation = new HeroAnimation(new THREE.Scene(), hero());
  for (const [detail, reduced, visible] of [[{ ...hit, hit: false }, false, true], [hit, false, false], [hit, true, true]]) {
    animation.start(detail, 0, reduced, visible);
    for (const time of [35, 55, 80, 105, 170]) animation.update(time);
    expect(animation.sparks.visible).toBe(false);
  }
  expect(animation.metrics().weaponImpacts).toBe(0);
  expect(animation.metrics().attackPhase).toBe("idle");
  expect(animation.trail.visible).toBe(false);
  animation.dispose();
});

test("sword sound places metal contact at the visual strike and misses keep only the swish", () => {
  const audio = new GameAudio();
  const voices = [];
  audio.prepare = audio.combat = audio.duck = () => {};
  audio.voice = (voice) => voices.push(voice);
  audio.renderFX("weapon", hit);
  expect(voices[0].delay).toBe(.025);
  expect(voices.slice(1).every((voice) => voice.delay === .105)).toBe(true);
  voices.length = 0;
  audio.renderFX("weapon", { ...hit, hit: false });
  expect(voices).toHaveLength(1);
});

async function arena(page) {
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.audio.v1", JSON.stringify({ enabled: false }));
  });
  await page.goto("/play/"); await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  const frames = await page.evaluate(() => {
    newcavelevel(1); player.x = 10; player.y = 8;
    player.HP = player.HPMAX = 1000;
    player.WIELD = createObject(OLONGSWORD);
    for (let x = 0; x < MAXX; x++) for (let y = 0; y < MAXY; y++) {
      setMonster(x, y, null); setItem(x, y, OEMPTY); setKnow(x, y, KNOWALL);
    }
    setMonster(11, 8, LEMMING); paint();
    return ularnGraphics.metrics().renderedFrames;
  });
  // Functional software rendering can take longer than an animation. Wait for
  // actual uploads; deterministic pose timing is checked above without a GPU.
  await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().renderedFrames)).toBeGreaterThan(frames);
}

test("engine damage is immediate, waiting does not swing, and pause clears the visual action", async ({ page }) => {
  await arena(page);
  const before = await page.evaluate(() => ({ moves: player.MOVESMADE, sequence: ularnGraphics.metrics().attackSequence }));
  await page.keyboard.press(".");
  expect((await page.evaluate(() => ularnGraphics.metrics())).attackSequence).toBe(before.sequence);
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => monsterAt(11, 8))).toBe(null);
  const attack = await page.evaluate(() => ularnGraphics.metrics());
  expect(attack.weaponModel).toBe("longsword");
  expect(attack.attackSequence).toBe(before.sequence + 1);
  expect(await page.evaluate(() => player.MOVESMADE)).toBe(before.moves + 2);
  await page.locator("#pause").click();
  expect((await page.evaluate(() => ularnGraphics.metrics())).attackPhase).toBe("idle");
  expect((await page.evaluate(() => ularnGraphics.metrics())).bladeTrailPoints).toBe(0);
});

test("rapid sword swaps and attacks reuse buffers and hidden windows discard the pose", async ({ page }) => {
  await arena(page);
  const baseline = await page.evaluate(() => ularnGraphics.metrics());
  for (const id of [28, 29, 58, 26, 90, 91]) {
    const frames = await page.evaluate((id) => { player.WIELD = createObject(itemlist[id]); paint(); return ularnGraphics.metrics().renderedFrames; }, id);
    await expect.poll(() => page.evaluate(() => ularnGraphics.metrics().renderedFrames)).toBeGreaterThan(frames);
  }
  const warmed = await page.evaluate(() => ularnGraphics.metrics());
  await page.evaluate(() => {
    for (let i = 0; i < 80; i++) {
      player.WIELD = createObject(itemlist[[28, 29, 58, 26, 90, 91][i % 6]]);
      paint();
      setMonster(11, 8, LEMMING);
      hitmonster(11, 8);
    }
    paint();
  });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ularnGraphics.metrics());
  expect(after.attackSequence).toBeGreaterThan(baseline.attackSequence);
  expect(after.geometries).toBeLessThanOrEqual(warmed.geometries + 6);
  expect(after.bladeTrailPoints).toBeLessThanOrEqual(8);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect((await page.evaluate(() => ularnGraphics.metrics())).attackPhase).toBe("idle");
  await page.evaluate(() => {
    delete document.hidden; document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(500);
  expect((await page.evaluate(() => ularnGraphics.metrics())).impactVisible).toBe(false);
});
