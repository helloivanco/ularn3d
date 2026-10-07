import { test, expect } from "@playwright/test";
import * as THREE from "three";
import { TorchLighting, stabilizeShadow } from "../src/lighting.js";
import { TerrainGrid } from "../src/terrain-grid.js";
import { compact } from "../src/graphics-utils.js";

test("shadow texels retain their phase as the camera follows fractional positions", () => {
  const light = new THREE.DirectionalLight();
  Object.assign(light.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
  light.shadow.camera.updateProjectionMatrix(); light.shadow.mapSize.set(1024, 1024);
  const point = new THREE.Vector3(3.25, 0, 5.75), phases = [];
  for (let i = 0; i < 30; i++) {
    stabilizeShadow(light, new THREE.Vector3(10 + i * .027, 0, 8 + i * .013));
    const camera = light.shadow.camera;
    camera.position.copy(light.position); camera.lookAt(light.target.position); camera.updateMatrixWorld();
    const projection = point.clone().project(camera);
    phases.push([(projection.x * .5 + .5) * 1024, (projection.y * .5 + .5) * 1024].map((n) => n - Math.floor(n)));
  }
  for (const phase of phases) {
    expect(phase[0]).toBeCloseTo(phases[0][0], 8);
    expect(phase[1]).toBeCloseTo(phases[0][1], 8);
  }
});

test("torch identities survive nearest-distance ties and new sources move only at zero intensity", () => {
  const light = new THREE.PointLight(), system = new TorchLighting([light]);
  const lamps = [new THREE.Vector3(-1, 1, 0), new THREE.Vector3(1, 1, 0)];
  system.assign(lamps, new THREE.Vector3(), 1);
  for (let i = 0; i < 30; i++) system.update(1 / 60, i / 60);
  const source = light.position.clone(), initialChanges = system.reassignments, powers = [];
  for (let i = 0; i < 120; i++) {
    system.assign(lamps, new THREE.Vector3(i % 2 ? -.01 : .01, 0, 0), 1);
    system.update(1 / 60, i / 60); powers.push(light.intensity);
    expect(light.position.equals(source)).toBe(true);
  }
  expect(system.reassignments).toBe(initialChanges);
  expect(Math.max(...powers) - Math.min(...powers)).toBeLessThan(.13);
  system.assign([new THREE.Vector3(20, 1, 0)], new THREE.Vector3(20, 0, 0), 1);
  for (let i = 0; i < 30; i++) {
    const previous = light.position.clone(); system.update(1 / 60, i / 60);
    if (!previous.equals(light.position)) expect(light.intensity).toBe(0);
  }
  expect(light.position.x).toBe(20);
});

function gridFixture() {
  const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshBasicMaterial();
  const grid = new TerrainGrid(new THREE.Scene(), geometry, geometry);
  const chunk = { wallCells: [{ x: 1, y: 0 }, { x: 2, y: 0 }], wallView: null,
    heights: new Float32Array([NaN, NaN]), targets: new Float32Array([1.15, 1.15]), dirtyWalls: true,
    walls: new THREE.InstancedMesh(geometry, material, 2), caps: new THREE.InstancedMesh(geometry, material, 2) };
  grid.chunks.set("0,0", chunk);
  return { grid, chunk };
}

test("neighboring caps meet without overlapping area and cutaways settle smoothly", () => {
  const { grid, chunk } = gridFixture(), toward = new THREE.Vector3(1, 0, 0), matrix = new THREE.Matrix4();
  grid.walls({ x: 10, y: 10 }, toward);
  const bounds = [];
  for (let i = 0; i < 2; i++) {
    chunk.caps.getMatrixAt(i, matrix);
    bounds.push(new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5)).applyMatrix4(matrix));
  }
  expect(bounds[0].max.x).toBeCloseTo(bounds[1].min.x,6);
  grid.walls({ x: 0, y: 0 }, toward, 1 / 60);
  expect(chunk.heights[0]).toBeLessThan(1.15);
  expect(chunk.heights[0]).toBeGreaterThan(.36);
  for (let i = 0; i < 60; i++) grid.walls({ x: 0, y: 0 }, toward, 1 / 60);
  expect(grid.animating).toBe(false);
  expect(chunk.heights[0]).toBeCloseTo(.36, 5);
  grid.walls({ x: 10, y: 10 }, toward, 1 / 60);
  expect(chunk.heights[0]).toBeLessThan(1.15);
  expect(chunk.heights[0]).toBeGreaterThan(.36);
  for (let i = 0; i < 60; i++) grid.walls({ x: 10, y: 10 }, toward, 1 / 60);
  expect(grid.animating).toBe(false);
  expect(chunk.heights[0]).toBeCloseTo(1.15, 5);
});

test("batching preserves shadow and depth flags rather than turning glowing details into casters", () => {
  const group = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const opaque = new THREE.Mesh(geometry, material), glow = opaque.clone();
  opaque.castShadow = opaque.receiveShadow = true; glow.castShadow = glow.receiveShadow = false;
  group.add(opaque, glow); compact(group);
  expect(group.children).toHaveLength(2);
  expect(group.children.filter((mesh) => mesh.castShadow)).toHaveLength(1);
  expect(group.children.filter((mesh) => mesh.receiveShadow)).toHaveLength(1);
});

test("repeated damage highlights health without restarting a whole-scene flash", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem("ularn3d.quality", "balanced");
    localStorage.setItem("ularn3d.audio.v1", JSON.stringify({ enabled: false }));
  });
  await page.goto("/play/"); await expect(page.locator("#loading")).toBeHidden();
  await page.locator("#begin").click();
  await page.evaluate(() => { player.HP--; paint(); });
  await page.clock.runFor(300);
  await page.evaluate(() => { player.HP--; paint(); });
  await page.clock.runFor(200);
  expect(await page.evaluate(() => document.body.classList.contains("damage"))).toBe(true);
  expect(await page.locator("#world").evaluate((element) => getComputedStyle(element).filter)).toBe("none");
  await page.clock.runFor(260);
  expect(await page.evaluate(() => document.body.classList.contains("damage"))).toBe(false);
});
