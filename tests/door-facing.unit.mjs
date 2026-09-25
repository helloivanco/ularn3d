/**
 * Corridor door orientation: slab must block travel along the hall.
 * Run via: node --test tests/door-facing.unit.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { doorPassageFacingFromOpen } from "../src/door-facing.js";

test("N–S corridor door faces to block N/S travel (rotation 0)", () => {
  assert.equal(
    doorPassageFacingFromOpen({
      north: true,
      south: true,
      east: false,
      west: false,
    }),
    0,
  );
});

test("E–W corridor door faces to block E/W travel (rotation π/2)", () => {
  assert.equal(
    doorPassageFacingFromOpen({
      north: false,
      south: false,
      east: true,
      west: true,
    }),
    Math.PI / 2,
  );
});

test("never uses the inverted 1.3.18 NS→π/2 mapping", () => {
  const ns = doorPassageFacingFromOpen({
    north: true,
    south: true,
    east: false,
    west: false,
  });
  const ew = doorPassageFacingFromOpen({
    north: false,
    south: false,
    east: true,
    west: true,
  });
  assert.notEqual(ns, Math.PI / 2);
  assert.notEqual(ew, 0);
  assert.equal(ns, 0);
  assert.equal(ew, Math.PI / 2);
});

test("bridge doorPassageFacing3D stays synced with door-facing.js", () => {
  const bridge = readFileSync("src/bridge.js", "utf8");
  assert.match(bridge, /function doorPassageFacing3D/);
  assert.match(bridge, /Keep in sync with src\/door-facing\.js/);
  /* N–S corridor → 0; E–W corridor → π/2 (not the inverted 1.3.18 mapping). */
  assert.match(
    bridge,
    /north && south && !\(east && west\)\) return 0/,
  );
  assert.match(
    bridge,
    /east && west && !\(north && south\)\) return Math\.PI \/ 2/,
  );
  assert.doesNotMatch(
    bridge,
    /if \(openFloor\(x, y - 1\) && openFloor\(x, y \+ 1\)\) return Math\.PI \/ 2/,
  );
});
