import type { RecordedFrame, TrackingFrame } from "../types";

export function estimateTrackingQuality(frame: TrackingFrame | null) {
  if (!frame?.landmarks.length) return 0;
  const valid = frame.landmarks.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
  if (valid.length < 100) return 0;
  const xs = valid.map((point) => point.x);
  const ys = valid.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const faceHeight = maxY - minY;
  const finiteScore = valid.length / frame.landmarks.length;
  const visibleScore = valid.filter((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1).length / valid.length;
  const sizeScore = 1 - Math.min(1, Math.abs(faceHeight - 0.46) / 0.42);
  const centerScore = 1 - Math.min(1, Math.hypot(centerX - 0.5, centerY - 0.5) / 0.65);
  let facingScore = 1;
  if (frame.matrix.length === 16) {
    const forwardLength = Math.hypot(frame.matrix[8], frame.matrix[9], frame.matrix[10]);
    if (forwardLength > 0.001) facingScore = Math.min(1, Math.max(0, Math.abs(frame.matrix[10]) / forwardLength));
  }
  return Math.round(100 * (
    0.38 * finiteScore
    + 0.22 * visibleScore
    + 0.14 * sizeScore
    + 0.12 * centerScore
    + 0.14 * facingScore
  ));
}

export function applyNeutralBaseline(frame: TrackingFrame | null, neutral: TrackingFrame | null) {
  if (!frame || !neutral) return frame;
  const neutralScores = new Map(neutral.blendshapes.map((shape) => [shape.name, shape.score]));
  return {
    ...frame,
    blendshapes: frame.blendshapes.map((shape) => ({
      name: shape.name,
      score: Math.min(1, Math.max(0, shape.score - (neutralScores.get(shape.name) ?? 0))),
    })),
  };
}

export function playbackTrackingFrame(frame: RecordedFrame, landmarks: TrackingFrame["landmarks"]): TrackingFrame {
  return {
    timestamp: performance.now(),
    landmarks,
    blendshapes: Object.entries(frame.blendshapes).map(([name, score]) => ({ name, score })),
    matrix: frame.matrix,
    avatarMotion: frame.avatarMotion,
    mouthOpen: frame.mouthOpen,
  };
}

export function recordedFrameAtTime(frames: RecordedFrame[], timestamp: number) {
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return frames[low];
}
