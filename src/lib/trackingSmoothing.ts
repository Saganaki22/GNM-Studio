import type { TrackingFrame } from "../types";

function adaptiveValue(
  previous: number,
  previousRaw: number,
  current: number,
  deltaSeconds: number,
  strength: number,
  motionScale: number,
  jitterFloor: number,
  twitchLimit: number,
) {
  if (strength <= 0) return current;
  if (!Number.isFinite(current)) return previous;
  const distance = Math.abs(current - previous);
  const deadband = jitterFloor * (0.35 + 1.65 * strength);
  if (distance <= deadband) return previous;

  // A genuine movement normally remains present in the following sample. Hold
  // a small first-frame jump for one sample; if it persists, previousRaw moves
  // outside the deadband and the adaptive filter opens immediately. This drops
  // isolated tracking spikes with only one frame of latency for subtle motion.
  const previousRawDistance = Math.abs(previousRaw - previous);
  const shortTransient = deltaSeconds <= 0.06
    && distance <= twitchLimit * (0.45 + 0.55 * strength)
    && previousRawDistance <= deadband * 1.35;
  if (shortTransient) return previous;

  // Strong low-speed damping removes micro-jitter. The speed term opens the
  // filter during deliberate motion, avoiding the lag of a fixed EMA.
  const baseRate = 24 - 22.5 * strength ** 0.8;
  const baseAlpha = 1 - Math.exp(-baseRate * deltaSeconds);
  const speed = Math.abs(current - previous) / Math.max(0.001, deltaSeconds);
  const deliberateMotion = Math.min(1, speed / motionScale) ** 0.65;
  const alpha = baseAlpha + (1 - baseAlpha) * deliberateMotion;
  return previous + (current - previous) * alpha;
}

export class AdaptiveTrackingSmoother {
  private previous: TrackingFrame | null = null;
  private previousRaw: TrackingFrame | null = null;

  reset() {
    this.previous = null;
    this.previousRaw = null;
  }

  smooth(frame: TrackingFrame, requestedFacialStrength: number, requestedMotionStrength = 0) {
    const facialStrength = Math.min(1, Math.max(0, requestedFacialStrength));
    const motionStrength = Math.min(1, Math.max(0, requestedMotionStrength));
    const previous = this.previous;
    const elapsed = previous ? frame.timestamp - previous.timestamp : Number.POSITIVE_INFINITY;
    if (!previous || elapsed <= 0 || elapsed > 250 || previous.landmarks.length !== frame.landmarks.length) {
      const seeded = { ...frame, poseLandmarks: frame.poseLandmarks ?? frame.landmarks };
      this.previous = seeded;
      this.previousRaw = seeded;
      return seeded;
    }
    if (facialStrength <= 0 && motionStrength <= 0) {
      this.previous = frame;
      this.previousRaw = frame;
      return frame;
    }

    const deltaSeconds = Math.min(0.1, Math.max(0.001, elapsed / 1_000));
    const previousBlendshapes = new Map(previous.blendshapes.map((shape) => [shape.name, shape.score]));
    const rawPrevious = this.previousRaw ?? previous;
    const rawPreviousBlendshapes = new Map(rawPrevious.blendshapes.map((shape) => [shape.name, shape.score]));
    const rawPoseLandmarks = frame.poseLandmarks ?? frame.landmarks;
    const previousPoseLandmarks = previous.poseLandmarks ?? previous.landmarks;
    const rawPreviousPoseLandmarks = rawPrevious.poseLandmarks ?? rawPrevious.landmarks;
    const smoothed: TrackingFrame = {
      timestamp: frame.timestamp,
      landmarks: frame.landmarks.map((point, index) => {
        const old = previous.landmarks[index];
        return {
          x: adaptiveValue(old.x, rawPrevious.landmarks[index]?.x ?? old.x, point.x, deltaSeconds, facialStrength, 0.7, 0.00045, 0.014),
          y: adaptiveValue(old.y, rawPrevious.landmarks[index]?.y ?? old.y, point.y, deltaSeconds, facialStrength, 0.7, 0.00045, 0.014),
          z: adaptiveValue(old.z, rawPrevious.landmarks[index]?.z ?? old.z, point.z, deltaSeconds, facialStrength, 1.1, 0.0007, 0.022),
        };
      }),
      poseLandmarks: rawPoseLandmarks.map((point, index) => {
        const old = previousPoseLandmarks[index] ?? point;
        return {
          x: adaptiveValue(old.x, rawPreviousPoseLandmarks[index]?.x ?? old.x, point.x, deltaSeconds, motionStrength, 0.85, 0.00035, 0.011),
          y: adaptiveValue(old.y, rawPreviousPoseLandmarks[index]?.y ?? old.y, point.y, deltaSeconds, motionStrength, 0.85, 0.00035, 0.011),
          z: adaptiveValue(old.z, rawPreviousPoseLandmarks[index]?.z ?? old.z, point.z, deltaSeconds, motionStrength, 1.25, 0.0006, 0.018),
        };
      }),
      blendshapes: frame.blendshapes.map((shape) => ({
        name: shape.name,
        score: adaptiveValue(
          previousBlendshapes.get(shape.name) ?? shape.score,
          rawPreviousBlendshapes.get(shape.name) ?? shape.score,
          shape.score,
          deltaSeconds,
          facialStrength,
          1.8,
          0.0035,
          0.065,
        ),
      })),
      matrix: frame.matrix.map((value, index) => adaptiveValue(
        previous.matrix[index] ?? value,
        rawPrevious.matrix[index] ?? previous.matrix[index] ?? value,
        value,
        deltaSeconds,
        motionStrength,
        1.35,
        0.001,
        0.028,
      )),
    };
    this.previous = smoothed;
    this.previousRaw = { ...frame, poseLandmarks: rawPoseLandmarks };
    return smoothed;
  }
}
