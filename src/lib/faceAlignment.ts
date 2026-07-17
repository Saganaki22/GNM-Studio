import { projectCoverPoint, type CameraDimensions, type ViewportSize } from "./coverProjection.ts";
import type { FaceAlignment, TrackingFrame } from "../types";

/** Require the detected face to closely match the visible verification oval. */
export function assessFaceAlignment(
  frame: TrackingFrame | null,
  mirror: boolean,
  video: CameraDimensions | null,
  viewport: ViewportSize,
): FaceAlignment {
  if (!frame || frame.landmarks.length < 100) {
    return { status: "missing", message: "No face detected — look toward the camera" };
  }
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const projected = frame.landmarks
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => projectCoverPoint(video, width, height, point.x, point.y, mirror));
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  if (!xs.length || !ys.length) {
    return { status: "missing", message: "No face detected — look toward the camera" };
  }
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const faceWidth = maxX - minX;
  const faceHeight = maxY - minY;
  const guideWidth = Math.min(width * 0.38, 280);
  const guideHeight = guideWidth / 0.74;
  const widthRatio = faceWidth / guideWidth;
  const heightRatio = faceHeight / guideHeight;
  const sizeRatio = (widthRatio + heightRatio) * 0.5;
  const metrics = { centerX: centerX / width, centerY: centerY / height, sizeRatio };

  if (heightRatio < 0.82 || widthRatio < 0.72) return { status: "adjust", message: "Move closer — match your face to the guide", ...metrics };
  if (heightRatio > 1.02 || widthRatio > 0.98) return { status: "adjust", message: "Move farther back — keep your face inside the guide", ...metrics };
  const targetX = width * 0.5;
  const targetY = height * 0.5;
  if (centerX < targetX - guideWidth * 0.12) return { status: "adjust", message: "Move right into the guide", ...metrics };
  if (centerX > targetX + guideWidth * 0.12) return { status: "adjust", message: "Move left into the guide", ...metrics };
  if (centerY < targetY - guideHeight * 0.10) return { status: "adjust", message: "Move down into the guide", ...metrics };
  if (centerY > targetY + guideHeight * 0.10) return { status: "adjust", message: "Move up into the guide", ...metrics };
  return { status: "ready", message: "Face size and position verified — relax and hold still", ...metrics };
}
