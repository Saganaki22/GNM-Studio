import * as THREE from "three";
import type { HeadPoseSettings, TrackingFrame } from "../types";

const landmark = (frame: TrackingFrame, index: number) => frame.landmarks[index];

function angleDelta(value: number, baseline: number) {
  return THREE.MathUtils.euclideanModulo(value - baseline + Math.PI, Math.PI * 2) - Math.PI;
}

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
    // Landmark Y grows down the camera image while Three.js Y grows up. Negate
    // the image-space eye-line angle so roll follows the visible head tilt.
    const roll = -Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
    return new THREE.Euler(pitch, yaw, roll, "XYZ");
  };
  const current = solve(frame);
  if (!neutral) return current;
  const baseline = solve(neutral);
  return new THREE.Euler(
    angleDelta(current.x, baseline.x),
    angleDelta(current.y, baseline.y),
    angleDelta(current.z, baseline.z),
    "XYZ",
  );
}

function matrixEuler(frame: TrackingFrame, neutral: TrackingFrame | null) {
  if (frame.matrix.length !== 16) return null;
  const decompose = (matrix: number[]) => {
    const quaternion = new THREE.Quaternion();
    new THREE.Matrix4().fromArray(matrix).decompose(
      new THREE.Vector3(), quaternion, new THREE.Vector3(),
    );
    return new THREE.Euler().setFromQuaternion(quaternion.normalize(), "XYZ");
  };
  const source = decompose(frame.matrix);
  if (neutral?.matrix.length === 16) {
    const baseline = decompose(neutral.matrix);
    // Remove calibration in MediaPipe's own axes before remapping them. A
    // quaternion delta in display space couples source Z yaw into another
    // axis and was the reason calibrated left/right turns disappeared.
    source.set(
      angleDelta(source.x, baseline.x),
      angleDelta(source.y, baseline.y),
      angleDelta(source.z, baseline.z),
      "XYZ",
    );
  }
  // MediaPipe facial matrix axes: X = pitch, Z = yaw, -Y = roll.
  return new THREE.Euler(source.x, source.z, -source.y, "XYZ");
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
  const matrixPose = matrixEuler(frame, neutral);
  const fallbackEuler = landmarkEuler(frame, neutral);
  const hasNeutralMatrix = neutral?.matrix.length === 16;
  // MediaPipe's uncalibrated matrix contains its camera/model coordinate-basis
  // rotation. Treating that as a user pose can put the first target more than
  // 75 degrees from identity, causing the old jump guard to reject every frame.
  // Landmarks provide a stable face-only pose until a neutral matrix exists.
  let sourceEuler = matrixPose && hasNeutralMatrix
    ? matrixPose
    : fallbackEuler;

  if (matrixPose && hasNeutralMatrix) {
    const safeAxis = (matrixValue: number, fallbackValue: number) => {
      if (!Number.isFinite(matrixValue)) return fallbackValue;
      const fallbackActive = Math.abs(fallbackValue) > THREE.MathUtils.degToRad(2);
      if (!fallbackActive) return matrixValue;
      const oppositeDirection = Math.abs(matrixValue) > THREE.MathUtils.degToRad(1)
        && Math.sign(matrixValue) !== Math.sign(fallbackValue);
      const alignedMatrix = oppositeDirection ? -matrixValue : matrixValue;
      return Math.abs(alignedMatrix) < Math.abs(fallbackValue) * 0.45
        ? fallbackValue
        : alignedMatrix;
    };
    const responsivePitch = (matrixValue: number, fallbackValue: number) => {
      if (!Number.isFinite(matrixValue)) return fallbackValue;
      const fallbackActive = Math.abs(fallbackValue) > THREE.MathUtils.degToRad(2);
      if (!fallbackActive) return matrixValue;
      const oppositeDirection = Math.abs(matrixValue) > THREE.MathUtils.degToRad(1)
        && Math.sign(matrixValue) !== Math.sign(fallbackValue);
      const matrixUnderResponding = Math.abs(matrixValue) < Math.abs(fallbackValue) * 0.9;
      // Some MediaPipe delegates keep calibrated matrix pitch close to zero or
      // expose it on a different basis axis. The smoothed nose/forehead/chin
      // landmarks still carry a clear up/down signal, so never let a weak or
      // contradictory matrix value suppress deliberate pitch.
      return oppositeDirection || matrixUnderResponding ? fallbackValue : matrixValue;
    };
    sourceEuler = new THREE.Euler(
      responsivePitch(sourceEuler.x, fallbackEuler.x),
      safeAxis(sourceEuler.y, fallbackEuler.y),
      safeAxis(sourceEuler.z, fallbackEuler.z),
      "XYZ",
    );
  }

  const threshold = THREE.MathUtils.degToRad(settings.deadZone);
  const axisLimit = THREE.MathUtils.degToRad(75);
  const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.clamp(deadZone(sourceEuler.x, threshold) * settings.pitchStrength, -axisLimit, axisLimit),
    THREE.MathUtils.clamp(deadZone(mirror ? -sourceEuler.y : sourceEuler.y, threshold) * settings.yawStrength, -axisLimit, axisLimit),
    THREE.MathUtils.clamp(deadZone(mirror ? -sourceEuler.z : sourceEuler.z, threshold) * settings.rollStrength, -axisLimit, axisLimit),
    "XYZ",
  ));
  if (!previous) return target;
  const responsiveness = Math.max(0.04, 1 - settings.smoothing * 0.9);
  const next = previous.clone().slerp(target, responsiveness).normalize();
  const maximumStep = THREE.MathUtils.degToRad(24);
  if (previous.angleTo(next) <= maximumStep) return next;
  return previous.clone().rotateTowards(next, maximumStep).normalize();
}
