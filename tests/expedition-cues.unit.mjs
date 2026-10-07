import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bedForLevel, createCueReader } from "../src/expedition-cues.js";

const place = ({ x = 2, y = 2, level = 1, tiles = [] } = {}) => ({ x, y, level, tiles });

test("town, caves, and the volcano pick one bed each", () => {
  assert.equal(bedForLevel(0), "town");
  assert.equal(bedForLevel(1), "cave");
  assert.equal(bedForLevel(15), "cave");
  assert.equal(bedForLevel(16), "volcano");
});

test("the first look is silent and a later move steps once", () => {
  const read = createCueReader();
  assert.deepEqual(read(place({ x: 2, y: 2 })), []);
  assert.deepEqual(read(place({ x: 3, y: 2 })), ["step"]);
  assert.deepEqual(read(place({ x: 3, y: 2 })), []);
});

test("stairs play once from the tile you leave, not on a pit", () => {
  const stairs = createCueReader();
  stairs(place({ x: 4, y: 4, level: 1, tiles: [{ x: 4, y: 4, id: 13 }] }));
  assert.deepEqual(
    stairs(place({ x: 1, y: 1, level: 2, tiles: [{ x: 1, y: 1, id: 0 }] })),
    ["stairs"],
  );
  const pit = createCueReader();
  pit(place({ x: 4, y: 4, level: 1, tiles: [{ x: 4, y: 4, id: 4 }] }));
  assert.deepEqual(pit(place({ x: 1, y: 1, level: 2, tiles: [{ x: 1, y: 1, id: 0 }] })), []);
});

test("a door sounds when it opens or closes, not when it is merely seen", () => {
  const read = createCueReader();
  read(place({ tiles: [{ x: 3, y: 2, id: 20 }] }));
  assert.deepEqual(read(place({ tiles: [{ x: 3, y: 2, id: 20 }, { x: 8, y: 8, id: 20 }] })), []);
  assert.deepEqual(read(place({ tiles: [{ x: 3, y: 2, id: 19 }, { x: 8, y: 8, id: 20 }] })), ["door"]);
  assert.deepEqual(read(place({ tiles: [{ x: 3, y: 2, id: 19 }, { x: 8, y: 8, id: 20 }] })), []);
  assert.deepEqual(read(place({ tiles: [{ x: 3, y: 2, id: 20 }, { x: 8, y: 8, id: 20 }] })), ["door"]);
});

test("a new floor does not slam every door", () => {
  const read = createCueReader();
  read(place({ level: 1, tiles: [{ x: 3, y: 2, id: 20 }] }));
  assert.deepEqual(
    read(place({ x: 1, y: 1, level: 2, tiles: [{ x: 1, y: 1, id: 0 }, { x: 5, y: 5, id: 20 }] })),
    [],
  );
});

test("bundled audio stays local and small", () => {
  const audio = readFileSync("src/audio.js", "utf8");
  assert.equal(audio.includes("http://"), false);
  assert.equal(audio.includes("https://"), false);
  assert.equal(audio.includes("prefers-reduced-motion"), false);
  const files = {
    "public/audio/town.mp3": 260_000,
    "public/audio/cave.mp3": 260_000,
    "public/audio/step.mp3": 20_000,
    "public/audio/swing.mp3": 20_000,
    "public/audio/hit.mp3": 20_000,
    "public/audio/door.mp3": 20_000,
    "public/audio/stairs.mp3": 20_000,
    "public/audio/spell.mp3": 20_000,
  };
  for (const [file, limit] of Object.entries(files)) {
    const size = readFileSync(file).length;
    assert.ok(size > 500, `${file} is empty`);
    assert.ok(size < limit, `${file} is ${size} bytes`);
  }
});

test("a teleport does not pretend to be a footstep", () => {
  const read=createCueReader();read(place({x:2,y:2}));
  assert.deepEqual(read(place({x:12,y:2})),[]);
  assert.deepEqual(read(place({x:13,y:3})),["step"]);
});
