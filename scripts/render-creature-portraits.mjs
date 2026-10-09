import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Cache portraits of the exact species rigs used by World. Hovering needs only
// a local image, without adding a renderer or substituting classic sprites.
const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const output = "public/art/creatures";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  const page = await browser.newPage();
  await page.route("**/creature-portrait-review", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Creature portrait review</title>",
  }));
  await page.goto(new URL("/creature-portrait-review", base).href);
  const portraits = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { CREATURES, creature } = await import("/src/creatures.js");
    const width = 192, height = 252, aspect = width / height;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height); renderer.setClearColor(0, 0);
    // Match the constant ambient lighting and color mapping of Balanced caves.
    renderer.toneMapping = THREE.NoToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xc4e4eb, 0x32422c, 1.7));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 30);
    const point = new THREE.Vector3(), images = [];
    for (const entry of CREATURES) {
      const model = creature(entry);
      model.rotation.y = Math.PI + .2;
      model.getObjectByName("contact-disc")?.removeFromParent();
      model.updateMatrixWorld(true);
      const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
      camera.position.copy(center).add(new THREE.Vector3(0, 2.4, 4));
      camera.lookAt(center); camera.updateMatrixWorld();
      // Frame the actual vertices so horns, wings and coiled tails all fit.
      const bounds = new THREE.Box3();
      model.traverse(part => {
        if (!part.isMesh) return;
        const positions = part.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(part.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
          bounds.expandByPoint(point);
        }
      });
      const halfHeight = Math.max(bounds.max.y - bounds.min.y, (bounds.max.x - bounds.min.x) / aspect) * .57;
      const x = (bounds.min.x + bounds.max.x) / 2, y = (bounds.min.y + bounds.max.y) / 2;
      camera.left = x - halfHeight * aspect; camera.right = x + halfHeight * aspect;
      camera.top = y + halfHeight; camera.bottom = y - halfHeight;
      camera.updateProjectionMatrix();
      scene.add(model); renderer.render(scene, camera);
      images.push({ id: entry.id, data: renderer.domElement.toDataURL("image/webp", .95).split(",")[1] });
      scene.remove(model);
    }
    renderer.dispose(); return images;
  });
  await mkdir(output, { recursive: true });
  for (const portrait of portraits) {
    await writeFile(`${output}/${portrait.id}.webp`, Buffer.from(portrait.data, "base64"));
  }
  console.log(`Rendered ${portraits.length} shared creature models at 192 × 252.`);
} finally {
  await browser.close();
}
