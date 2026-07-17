import * as THREE from "three";
import type { TrackingFrame } from "../types";

/**
 * Convert MediaPipe's calibrated canonical-face transform into a stable,
 * neutral-relative scene translation. Values are normalized by neutral camera
 * depth so different webcams and resolutions produce comparable motion.
 */
export function neutralRelativeMatrixPosition(
  frame: TrackingFrame,
  neutralFrame: TrackingFrame | null,
  mirror: boolean,
): [number, number, number] | null {
  if (frame.matrix.length !== 16 || neutralFrame?.matrix.length !== 16) return null;
  const neutralMatrix = new THREE.Matrix4().fromArray(neutralFrame.matrix);
  const currentMatrix = new THREE.Matrix4().fromArray(frame.matrix);
  const neutralPosition = new THREE.Vector3();
  neutralMatrix.decompose(neutralPosition, new THREE.Quaternion(), new THREE.Vector3());
  const relativePosition = new THREE.Vector3();
  neutralMatrix.clone().invert().multiply(currentMatrix).decompose(
    relativePosition,
    new THREE.Quaternion(),
    new THREE.Vector3(),
  );
  const normalizer = Math.max(1, Math.abs(neutralPosition.z));
  const normalized = relativePosition.multiplyScalar(2 / normalizer);
  if (mirror) normalized.x *= -1;
  return [
    THREE.MathUtils.clamp(normalized.x, -1.5, 1.5),
    THREE.MathUtils.clamp(normalized.y, -1.5, 1.5),
    THREE.MathUtils.clamp(normalized.z, -1.5, 1.5),
  ];
}
