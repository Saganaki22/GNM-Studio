import * as THREE from "three";
import type { GnmJointPose, QuaternionTuple, TrackingFrame } from "../types";

const identityTuple = (): QuaternionTuple => [0, 0, 0, 1];
const tuple = (quaternion: THREE.Quaternion) => quaternion.toArray() as QuaternionTuple;

export type GazeControl = {
  horizontal: number;
  vertical: number;
  confidence: number;
};

export type IrisGaze = {
  left: GazeControl;
  right: GazeControl;
};

type EyeLandmarks = {
  iris: number;
  outer: number;
  inner: number;
  upper: number;
  lower: number;
};

const eyeLandmarks = {
  // MediaPipe names left/right from the tracked person's perspective.
  left: { iris: 473, outer: 263, inner: 362, upper: 386, lower: 374 },
  right: { iris: 468, outer: 33, inner: 133, upper: 159, lower: 145 },
} satisfies Record<"left" | "right", EyeLandmarks>;

function measuredEye(frame: TrackingFrame | null, indices: EyeLandmarks) {
  if (!frame) return null;
  const iris = frame.landmarks[indices.iris];
  const outer = frame.landmarks[indices.outer];
  const inner = frame.landmarks[indices.inner];
  const upper = frame.landmarks[indices.upper];
  const lower = frame.landmarks[indices.lower];
  if (![iris, outer, inner, upper, lower].every(Boolean)) return null;
  const centerX = (outer.x + inner.x) * 0.5;
  const centerY = (upper.y + lower.y) * 0.5;
  const width = Math.hypot(inner.x - outer.x, inner.y - outer.y);
  const height = Math.hypot(lower.x - upper.x, lower.y - upper.y);
  if (width < 1e-5 || height < 1e-5) return null;
  return {
    horizontal: (iris.x - centerX) / (width * 0.5),
    vertical: (iris.y - centerY) / (height * 0.5),
    confidence: THREE.MathUtils.clamp(Math.min(width / 0.04, height / 0.012), 0, 1),
  };
}

function eyeControl(frame: TrackingFrame, neutral: TrackingFrame | null, indices: EyeLandmarks): GazeControl {
  const current = measuredEye(frame, indices);
  if (!current) return { horizontal: 0, vertical: 0, confidence: 0 };
  const baseline = measuredEye(neutral, indices) ?? { horizontal: 0, vertical: 0 };
  const horizontal = THREE.MathUtils.clamp(-(current.horizontal - baseline.horizontal) / 0.72, -1, 1);
  const vertical = THREE.MathUtils.clamp((current.vertical - baseline.vertical) / 0.72, -1, 1);
  const deadZone = 0.045;
  const clean = (value: number) => Math.abs(value) < deadZone
    ? 0
    : Math.sign(value) * (Math.abs(value) - deadZone) / (1 - deadZone);
  return {
    horizontal: clean(horizontal),
    vertical: clean(vertical),
    confidence: current.confidence,
  };
}

export function resolveIrisGaze(frame: TrackingFrame, neutral: TrackingFrame | null): IrisGaze {
  return {
    left: eyeControl(frame, neutral, eyeLandmarks.left),
    right: eyeControl(frame, neutral, eyeLandmarks.right),
  };
}

/** Split an exact tracked head orientation over GNM's neck/head hierarchy. */
export function splitGnmHeadPose(total: THREE.Quaternion): GnmJointPose {
  const euler = new THREE.Euler().setFromQuaternion(total, "YXZ");
  const neck = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    euler.x * 0.32,
    euler.y * 0.46,
    euler.z * 0.40,
    "YXZ",
  ));
  // Preserve the exact requested world-space head orientation despite the
  // axis-specific neck distribution and non-commuting Euler rotations.
  const head = neck.clone().invert().multiply(total).normalize();
  return {
    neck: tuple(neck),
    head: tuple(head),
    leftEye: identityTuple(),
    rightEye: identityTuple(),
  };
}

export function eyeQuaternion(control: GazeControl, fallbackHorizontal: number, fallbackVertical: number) {
  const confidence = control.confidence;
  const horizontal = THREE.MathUtils.lerp(fallbackHorizontal, control.horizontal, confidence * 0.82);
  const vertical = THREE.MathUtils.lerp(fallbackVertical, control.vertical, confidence * 0.82);
  const limit = THREE.MathUtils.degToRad(28);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    vertical * limit,
    horizontal * limit,
    0,
    "YXZ",
  ));
}

export function withGnmEyePose(
  pose: GnmJointPose,
  left: THREE.Quaternion,
  right: THREE.Quaternion,
): GnmJointPose {
  return { ...pose, leftEye: tuple(left), rightEye: tuple(right) };
}
