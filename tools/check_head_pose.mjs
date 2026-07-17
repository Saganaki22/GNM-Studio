import assert from "node:assert/strict";
import * as THREE from "three";
import { resolveHeadPose } from "../src/lib/headPose.ts";

const settings = {
  enabled: true,
  yawStrength: 1,
  pitchStrength: 1,
  rollStrength: 1,
  deadZone: 0,
  smoothing: 0,
};

function frame(overrides = {}, matrix = []) {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[33] = { x: 0.4, y: 0.44, z: 0 };
  landmarks[263] = { x: 0.6, y: 0.44, z: 0 };
  landmarks[1] = { x: 0.5, y: 0.51, z: -0.03 };
  landmarks[10] = { x: 0.5, y: 0.25, z: 0 };
  landmarks[152] = { x: 0.5, y: 0.75, z: 0 };
  landmarks[234] = { x: 0.3, y: 0.5, z: 0 };
  landmarks[454] = { x: 0.7, y: 0.5, z: 0 };
  for (const [index, point] of Object.entries(overrides)) landmarks[Number(index)] = { ...landmarks[Number(index)], ...point };
  return { timestamp: 1, landmarks, blendshapes: [], matrix };
}

const neutral = frame();
const turned = frame({ 1: { x: 0.57 } });
const yaw = new THREE.Euler().setFromQuaternion(resolveHeadPose(turned, null, false, settings));
assert.ok(Math.abs(yaw.y) > THREE.MathUtils.degToRad(8), "uncalibrated landmark yaw must rotate the head");

const mirroredYaw = new THREE.Euler().setFromQuaternion(resolveHeadPose(turned, null, true, settings));
assert.ok(Math.sign(mirroredYaw.y) === -Math.sign(yaw.y), "mirroring must reverse yaw");

const lookedDown = frame({ 1: { y: 0.58 } });
const pitch = new THREE.Euler().setFromQuaternion(resolveHeadPose(lookedDown, null, false, settings));
const mirroredPitch = new THREE.Euler().setFromQuaternion(resolveHeadPose(lookedDown, null, true, settings));
assert.ok(pitch.x > THREE.MathUtils.degToRad(5), "looking down must produce positive pitch");
assert.ok(Math.abs(mirroredPitch.x - pitch.x) < 1e-6, "mirroring must not reverse pitch");

const rolled = frame({ 33: { y: 0.48 }, 263: { y: 0.40 } });
const roll = new THREE.Euler().setFromQuaternion(resolveHeadPose(rolled, neutral, false, settings));
assert.ok(roll.z > THREE.MathUtils.degToRad(5), "image-space counter-clockwise tilt must produce positive Three.js roll");

const mirroredRoll = new THREE.Euler().setFromQuaternion(resolveHeadPose(rolled, neutral, true, settings));
assert.ok(mirroredRoll.z < -THREE.MathUtils.degToRad(5), "mirroring must reverse roll exactly once");
assert.ok(Math.abs(Math.abs(mirroredRoll.z) - Math.abs(roll.z)) < 1e-6, "mirroring must preserve roll magnitude");

const identityMatrix = new THREE.Matrix4().identity().toArray();
const contradictoryMatrix = new THREE.Matrix4().makeRotationZ(-0.35).toArray();
const calibratedRoll = new THREE.Euler().setFromQuaternion(resolveHeadPose(
  frame({ 33: { y: 0.48 }, 263: { y: 0.40 } }, contradictoryMatrix),
  frame({}, identityMatrix),
  false,
  settings,
));
assert.ok(calibratedRoll.z > 0, "calibrated matrix conventions must not override stable eye-line roll");

const cameraBasis = new THREE.Matrix4().makeRotationY(Math.PI).toArray();
const bounded = resolveHeadPose(frame({}, cameraBasis), null, false, settings, new THREE.Quaternion());
assert.ok(bounded.angleTo(new THREE.Quaternion()) < THREE.MathUtils.degToRad(30), "uncalibrated camera-basis rotation must not lock or flip the avatar");

console.log("Head pose verified: yaw, pitch convention, single-inversion mirrored roll, neutral roll, and bounded matrix basis.");
