import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { resolveHeadPose } from "../src/lib/headPose.ts";
import { resolveIrisGaze, splitGnmHeadPose } from "../src/lib/gnmPose.ts";

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
  landmarks[362] = { x: 0.53, y: 0.44, z: 0 };
  landmarks[386] = { x: 0.565, y: 0.425, z: 0 };
  landmarks[374] = { x: 0.565, y: 0.455, z: 0 };
  landmarks[473] = { x: 0.565, y: 0.44, z: 0 };
  landmarks[133] = { x: 0.47, y: 0.44, z: 0 };
  landmarks[159] = { x: 0.435, y: 0.425, z: 0 };
  landmarks[145] = { x: 0.435, y: 0.455, z: 0 };
  landmarks[468] = { x: 0.435, y: 0.44, z: 0 };
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

const identityMatrix = new THREE.Matrix4().identity().toArray();
const calibratedMatrixSilentPitch = new THREE.Euler().setFromQuaternion(resolveHeadPose(
  frame({ 1: { y: 0.58 } }, identityMatrix),
  frame({}, identityMatrix),
  false,
  settings,
));
assert.ok(
  calibratedMatrixSilentPitch.x > THREE.MathUtils.degToRad(5),
  "a near-zero calibrated matrix must not suppress clear landmark pitch",
);
const calibratedMatrixSilentLookUp = new THREE.Euler().setFromQuaternion(resolveHeadPose(
  frame({ 1: { y: 0.44 } }, identityMatrix),
  frame({}, identityMatrix),
  true,
  settings,
));
assert.ok(
  calibratedMatrixSilentLookUp.x < -THREE.MathUtils.degToRad(5),
  "a near-zero calibrated matrix must preserve looking up in mirror mode",
);
const contradictoryPitchMatrix = new THREE.Matrix4().makeRotationX(-0.18).toArray();
const calibratedContradictoryPitch = new THREE.Euler().setFromQuaternion(resolveHeadPose(
  frame({ 1: { y: 0.58 } }, contradictoryPitchMatrix),
  frame({}, identityMatrix),
  false,
  settings,
));
assert.ok(calibratedContradictoryPitch.x > 0, "a contradictory matrix axis must not invert deliberate pitch");

const calibratedYaw = new THREE.Euler().setFromQuaternion(resolveHeadPose(
  frame({ 1: { x: 0.57 } }, new THREE.Matrix4().makeRotationZ(0.4).toArray()),
  frame({}, identityMatrix),
  false,
  settings,
));
assert.ok(calibratedYaw.y > 0.3, "MediaPipe source Z must drive calibrated avatar yaw");
assert.ok(Math.abs(calibratedYaw.x) < 0.05, "calibrated yaw must not leak into pitch");

const calibratedPitch = new THREE.Euler().setFromQuaternion(resolveHeadPose(
  frame({ 1: { y: 0.58 } }, new THREE.Matrix4().makeRotationX(0.32).toArray()),
  frame({}, identityMatrix),
  false,
  settings,
));
assert.ok(calibratedPitch.x > 0.25, "MediaPipe source X must drive calibrated avatar pitch");
assert.ok(Math.abs(calibratedPitch.y) < 0.05, "calibrated pitch must not leak into yaw");

const calibratedMatrixRoll = new THREE.Euler().setFromQuaternion(resolveHeadPose(
  frame({}, new THREE.Matrix4().makeRotationY(-0.28).toArray()),
  frame({}, identityMatrix),
  false,
  settings,
));
assert.ok(calibratedMatrixRoll.z > 0.2, "negative MediaPipe source Y must drive positive avatar roll");

const rolled = frame({ 33: { y: 0.48 }, 263: { y: 0.40 } });
const roll = new THREE.Euler().setFromQuaternion(resolveHeadPose(rolled, neutral, false, settings));
assert.ok(roll.z > THREE.MathUtils.degToRad(5), "image-space counter-clockwise tilt must produce positive Three.js roll");

const mirroredRoll = new THREE.Euler().setFromQuaternion(resolveHeadPose(rolled, neutral, true, settings));
assert.ok(mirroredRoll.z < -THREE.MathUtils.degToRad(5), "mirroring must reverse roll exactly once");
assert.ok(Math.abs(Math.abs(mirroredRoll.z) - Math.abs(roll.z)) < 1e-6, "mirroring must preserve roll magnitude");

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

const requestedPose = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.24, -0.38, 0.17, "YXZ"));
const distributed = splitGnmHeadPose(requestedPose);
const recomposed = new THREE.Quaternion().fromArray(distributed.neck)
  .multiply(new THREE.Quaternion().fromArray(distributed.head));
assert.ok(recomposed.angleTo(requestedPose) < 1e-6, "neck/head distribution must preserve exact final orientation");
assert.ok(new THREE.Quaternion().fromArray(distributed.neck).angleTo(new THREE.Quaternion()) > 0.04, "tracked pose must visibly move the neck");
assert.ok(new THREE.Quaternion().fromArray(distributed.head).angleTo(new THREE.Quaternion()) > 0.1, "tracked pose must retain local head motion");

const pitchDistribution = splitGnmHeadPose(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0, "YXZ")));
const neckPitch = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(pitchDistribution.neck), "YXZ");
assert.ok(neckPitch.x > 0.08 && neckPitch.x < 0.1, "neck must support pitch without taking over the head motion");
const yawDistribution = splitGnmHeadPose(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.4, 0, "YXZ")));
const neckYaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(yawDistribution.neck), "YXZ");
assert.ok(neckYaw.y > 0.07 && neckYaw.y < 0.09, "neck must support yaw without folding sideways");
const rollDistribution = splitGnmHeadPose(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.4, "YXZ")));
const neckRoll = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(rollDistribution.neck), "YXZ");
assert.ok(neckRoll.z > 0.04 && neckRoll.z < 0.06, "neck roll must stay subtle while the head carries the tilt");

const gaze = resolveIrisGaze(frame({ 473: { x: 0.58 }, 468: { y: 0.45 } }), neutral);
assert.ok(gaze.left.horizontal < -0.2, "left iris displacement must produce a directional gaze control");
assert.ok(gaze.right.vertical > 0.2, "right iris displacement must produce a directional vertical gaze control");
const overlaySource = readFileSync(new URL("../src/lib/trackingOverlay.ts", import.meta.url), "utf8");
for (const marker of ["473", "468", "drawTrackingVectors", "mouth width", "arrow(context"]) {
  assert.ok(overlaySource.includes(marker), `tracking vector overlay is missing ${marker}`);
}

console.log("Head pose verified: yaw/pitch/roll, exact neck/head distribution, iris gaze controls, and directional debug vectors.");
