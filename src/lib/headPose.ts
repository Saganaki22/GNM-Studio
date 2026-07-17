import * as THREE from "three";
import type { HeadPoseSettings, TrackingFrame } from "../types";

const landmark = (frame: TrackingFrame, index: number) => frame.landmarks[index];

function landmarkEuler(frame: TrackingFrame, neutral: TrackingFrame | null) {
  const solve = (value: TrackingFrame) => {
    const leftEye = landmark(value, 33);
    const rightEye = landmark(value, 263);
    const nose = landmark(value, 1);
    const forehead = landmark(value, 10);
    const chin = landmark(value, 152);
    const leftSide = landmark(value, 234);
    const rightSide = landmark(value, 454);
    if (![leftEye, rightEye, nose, forehead, chin, leftSide, rightSide].every(Boolean)) return new THREE.Euler();
    const faceWidth = Math.max(1e-4, Math.hypot(rightSide.x - leftSide.x, rightSide.y - leftSide.y));
    const faceHeight = Math.max(1e-4, Math.hypot(chin.x - forehead.x, chin.y - forehead.y));
    const eyeMidX = (leftEye.x + rightEye.x) * 0.5;
    const centerY = (forehead.y + chin.y) * 0.5;
    const yaw = THREE.MathUtils.clamp((nose.x - eyeMidX) / faceWidth * 2.2, -1.1, 1.1);
    const pitch = THREE.MathUtils.clamp((nose.y - centerY) / faceHeight * 1.75, -0.9, 0.9);
    const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
    return new THREE.Euler(pitch, yaw, roll, "XYZ");
  };
  const current = solve(frame);
  if (!neutral) return current;
  const baseline = solve(neutral);
  return new THREE.Euler(current.x - baseline.x, current.y - baseline.y, current.z - baseline.z, "XYZ");
}

function matrixQuaternion(frame: TrackingFrame, neutral: TrackingFrame | null) {
  if (frame.matrix.length !== 16) return null;
  const quaternion = new THREE.Quaternion();
  new THREE.Matrix4().fromArray(frame.matrix).decompose(new THREE.Vector3(), quaternion, new THREE.Vector3());
  if (neutral?.matrix.length === 16) {
    const neutralQuaternion = new THREE.Quaternion();
    new THREE.Matrix4().fromArray(neutral.matrix).decompose(new THREE.Vector3(), neutralQuaternion, new THREE.Vector3());
    quaternion.premultiply(neutralQuaternion.invert());
  }
  return quaternion.normalize();
}

function deadZone(value: number, threshold: number) {
  if (Math.abs(value) <= threshold) return 0;
  return Math.sign(value) * (Math.abs(value) - threshold);
}

export function resolveHeadPose(
  frame: TrackingFrame,
  neutral: TrackingFrame | null,
  mirror: boolean,
  settings: HeadPoseSettings,
  previous?: THREE.Quaternion | null,
) {
  if (!settings.enabled) return new THREE.Quaternion();
  const matrixPose = matrixQuaternion(frame, neutral);
  const fallbackEuler = landmarkEuler(frame, neutral);
  let sourceEuler = matrixPose
    ? new THREE.Euler().setFromQuaternion(matrixPose, "XYZ")
    : fallbackEuler;

  if (matrixPose) {
    const matrixYaw = sourceEuler.y;
    const disagreement = Math.abs(THREE.MathUtils.euclideanModulo(matrixYaw - fallbackEuler.y + Math.PI, Math.PI * 2) - Math.PI);
    if (disagreement > THREE.MathUtils.degToRad(50) && Math.abs(fallbackEuler.y) > 0.08) {
      sourceEuler = new THREE.Euler(sourceEuler.x, fallbackEuler.y, sourceEuler.z, "XYZ");
    }
  }

  const threshold = THREE.MathUtils.degToRad(settings.deadZone);
  const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    deadZone(sourceEuler.x, threshold) * settings.pitchStrength,
    deadZone(mirror ? -sourceEuler.y : sourceEuler.y, threshold) * settings.yawStrength,
    deadZone(mirror ? -sourceEuler.z : sourceEuler.z, threshold) * settings.rollStrength,
    "XYZ",
  ));
  const maxAngle = THREE.MathUtils.degToRad(75);
  if (previous && previous.angleTo(target) > maxAngle) return previous.clone();
  if (!previous) return target;
  const responsiveness = Math.max(0.04, 1 - settings.smoothing * 0.9);
  return previous.clone().slerp(target, responsiveness).normalize();
}
