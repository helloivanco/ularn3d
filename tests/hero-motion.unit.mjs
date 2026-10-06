import test from "node:test";
import assert from "node:assert/strict";
import {
  attackPose,
  attackStyle,
  CAPE_REST,
  FOREARM_REST,
  stepPose,
} from "../src/hero-motion.js";

const planted = (value) => assert.ok(Math.abs(value) < 1e-6, String(value));

test("a step plants at both ends and strides in the middle", () => {
  const start = stepPose(0, true);
  const mid = stepPose(0.5, true);
  const end = stepPose(1, false);
  planted(start.bodyY);
  planted(start.leftLeg);
  planted(start.rightLeg);
  planted(end.bodyY);
  planted(end.leftLeg);
  assert.equal(end.capeX, CAPE_REST);
  assert.equal(end.forearmX, FOREARM_REST);
  assert.ok(mid.bodyY > 0.1);
  assert.ok(mid.rightLeg < -0.8, "lead foot reaches forward");
  assert.ok(mid.leftLeg > 0.6, "trail foot stays back");
  assert.ok(mid.leftArm < -0.4, "opposite arm swings forward");
  assert.ok(mid.rightLift > 0.05);
  const other = stepPose(0.5, false);
  assert.ok(other.leftLeg < -0.8);
  assert.ok(other.rightLeg > 0.6);
});

test("a slash rises overhead and an empty hand only jabs", () => {
  const raised = attackPose(0.2, "slash");
  const cut = attackPose(0.46, "slash");
  const rest = attackPose(0, "slash");
  const done = attackPose(1, "slash");
  assert.ok(raised.arm.x > 1.2, "wind-up lifts the blade overhead");
  assert.ok(raised.forearmX < -1, "the elbow cocks on the wind-up");
  assert.ok(cut.arm.x < -0.8, "the cut drives downward");
  assert.ok(cut.forearmX > raised.forearmX, "the elbow extends through the cut");
  assert.equal(rest.arm.x, 0);
  assert.equal(rest.arm.z, 0);
  assert.equal(done.arm.x, 0);
  assert.equal(done.forearmX, FOREARM_REST);
  assert.equal(done.lunge, 0);
  const punch = attackPose(0.42, "punch");
  assert.ok(punch.arm.x < -0.8);
  assert.ok(Math.abs(punch.arm.z) < 0.4, "a fist does not travel a sword arc");
  const thrust = attackPose(0.46, "thrust");
  assert.ok(thrust.arm.x > 0.5, "a spear drives forward");
  assert.ok(Math.abs(thrust.arm.z) < 0.25);
  assert.equal(attackStyle({ id: null, type: "unarmed" }), "punch");
  assert.equal(attackStyle({ type: "unarmed" }), "punch");
  assert.equal(attackStyle(null), "punch");
  assert.equal(attackStyle({ id: 31, type: "dagger" }), "slash");
  assert.equal(attackStyle({ id: 58, type: "sword" }), "slash");
  assert.equal(attackStyle({ id: 30, type: "spear" }), "thrust");
  assert.equal(attackStyle({ id: 65, type: "lance" }), "thrust");
  assert.equal(attackStyle({ id: 89, type: "staff" }), "thrust");
});
