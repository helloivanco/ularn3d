import test from "node:test";
import assert from "node:assert/strict";
import {
  attackPose,
  blendStep,
  STEP_CONTACT,
  attackStyle,
  CAPE_REST,
  dampStep,
  FOREARM_REST,
  HERO_STEP_RADIUS,
  pointEntersWall,
  pointOnRoute,
  STEP_MS,
  stepPose,
  stepRoute,
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
  assert.ok(mid.bodyY > 0 && mid.bodyY < .03, "weight shifts without a hop");
  assert.ok(mid.rightLeg < -.25 && mid.rightLeg > -.5, "lead foot reaches forward");
  assert.ok(mid.leftLeg > .15 && mid.leftLeg < .35, "trail foot stays back");
  assert.ok(mid.leftArm < -.08 && mid.leftArm > -.25, "opposite arm swings forward");
  assert.ok(mid.rightLift > .015 && mid.rightLift < .04);
  const other = stepPose(0.5, false);
  assert.ok(other.leftLeg < -.25);
  assert.ok(other.rightLeg > .15);
});

test("a step is clearly faster than a 200ms follow and still plants", () => {
  assert.ok(STEP_MS < 200, `step is ${STEP_MS}ms`);
  assert.ok(STEP_MS >= 80, `step is ${STEP_MS}ms`);
  const plantedPose = dampStep(stepPose(0.5, true), 0);
  planted(plantedPose.bodyY);
  planted(plantedPose.leftLeg);
  planted(plantedPose.rightLeg);
  assert.equal(plantedPose.forearmX, FOREARM_REST);
  assert.equal(plantedPose.capeX, CAPE_REST);
});

const samplesStayOnFloor = (route, solid) => {
  for (let i = 0; i <= 20; i++) {
    const point = pointOnRoute(route, i / 20);
    assert.equal(
      pointEntersWall(point.x, point.z, solid, HERO_STEP_RADIUS),
      false,
      `t=${i / 20} at ${point.x},${point.z}`,
    );
  }
};

test("a clear step stays straight and a diagonal goes around rock", () => {
  const open = () => false;
  const straight = stepRoute({ x: 2, z: 4 }, { x: 3, z: 4 }, open);
  assert.equal(straight.length, 2);
  assert.deepEqual(pointOnRoute(straight, 0.5), { x: 2.5, z: 4 });

  const shoulder = (x, z) => x === 6 && z === 5;
  const around = stepRoute({ x: 5, z: 5 }, { x: 6, z: 6 }, shoulder);
  assert.ok(around.some((point) => point.x === 5 && point.z === 6));
  samplesStayOnFloor(around, shoulder);

  const both = (x, z) => (x === 6 && z === 5) || (x === 5 && z === 6);
  const held = stepRoute({ x: 5, z: 5 }, { x: 6, z: 6 }, both);
  samplesStayOnFloor(held, both);
  for (let i = 0; i <= 20; i++) {
    const point = pointOnRoute(held, i / 20);
    assert.ok(Math.hypot(point.x - 5, point.z - 5) < 0.05, "a walled corner does not draw the body through rock");
  }

  const beside = (x, z) => x === 1 && z === 0;
  const leaving = stepRoute({ x: 0.1, z: 0 }, { x: 1, z: 1 }, beside);
  samplesStayOnFloor(leaving, beside);
  assert.ok(leaving.some((point) => point.z === 1 && point.x === 0));
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

test("knees flex on the swing, ankles counter-rotate, and a carried weapon stays steady", () => {
  const pose=stepPose(.5,true,true),empty=stepPose(.5,true,false);
  assert.ok(pose.rightKnee>.3 && pose.leftKnee<.1);
  assert.ok(pose.rightFoot<0 && pose.leftFoot<0);
  assert.ok(Math.abs(pose.rightArm)<Math.abs(empty.rightArm));
  const contact=stepPose(STEP_CONTACT,true,true);
  assert.ok(contact.rightLift<.012 && contact.bodyY<.005);
  const from=stepPose(.6,true,true),to=stepPose(0,false,true);
  assert.deepEqual(blendStep(from,to,0),from);
  assert.deepEqual(blendStep(from,to,.22),to);
});
