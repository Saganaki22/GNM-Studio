import type { RecordedFrame, TrackingFrame } from "../types";

export type MotionFile = {
  fps: number;
  neutral: TrackingFrame | null;
  frames: RecordedFrame[];
};

function finiteNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }
  return value;
}

function matrix(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length !== 16) {
    throw new Error(`${field} must contain exactly 16 matrix values.`);
  }
  return value.map((entry, index) => finiteNumber(entry, `${field}[${index}]`));
}

function neutralFrame(value: unknown): TrackingFrame | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("neutral must be an object or null.");
  const frame = value as Record<string, unknown>;
  if (!Array.isArray(frame.landmarks) || frame.landmarks.length < 3) {
    throw new Error("neutral.landmarks is missing or incomplete.");
  }
  const landmarks = frame.landmarks.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`neutral.landmarks[${index}] must be an object.`);
    }
    const point = entry as Record<string, unknown>;
    return {
      x: finiteNumber(point.x, `neutral.landmarks[${index}].x`),
      y: finiteNumber(point.y, `neutral.landmarks[${index}].y`),
      z: finiteNumber(point.z, `neutral.landmarks[${index}].z`),
    };
  });
  if (!Array.isArray(frame.blendshapes)) throw new Error("neutral.blendshapes must be an array.");
  const blendshapes = frame.blendshapes.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`neutral.blendshapes[${index}] must be an object.`);
    }
    const shape = entry as Record<string, unknown>;
    if (typeof shape.name !== "string" || !shape.name) {
      throw new Error(`neutral.blendshapes[${index}].name must be a non-empty string.`);
    }
    return {
      name: shape.name,
      score: Math.min(1, Math.max(0, finiteNumber(shape.score, `neutral.blendshapes[${index}].score`))),
    };
  });
  return {
    timestamp: finiteNumber(frame.timestamp, "neutral.timestamp"),
    landmarks,
    blendshapes,
    matrix: matrix(frame.matrix, "neutral.matrix"),
  };
}

export function parseMotionFile(value: unknown): MotionFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The selected file does not contain a GNM Studio motion object.");
  }
  const payload = value as Record<string, unknown>;
  if (payload.format !== "gnm-studio-motion") {
    throw new Error(`Unsupported motion format: ${String(payload.format ?? "missing")}.`);
  }
  if (payload.version !== 1) {
    throw new Error(`Unsupported motion version: ${String(payload.version ?? "missing")}. This build supports version 1.`);
  }
  const fps = finiteNumber(payload.fps, "fps");
  if (fps < 1 || fps > 120) throw new Error("fps must be between 1 and 120.");
  if (!Array.isArray(payload.frames) || !payload.frames.length) {
    throw new Error("The motion file contains no recorded frames.");
  }
  if (payload.frames.length > 2_000_000) {
    throw new Error("The motion file contains more than 2,000,000 frames and is too large to load safely.");
  }

  let previousTimestamp = -1;
  const frames = payload.frames.map((entry, frameIndex): RecordedFrame => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`frames[${frameIndex}] must be an object.`);
    }
    const frame = entry as Record<string, unknown>;
    const timestamp = finiteNumber(frame.timestamp, `frames[${frameIndex}].timestamp`);
    if (timestamp < 0 || timestamp < previousTimestamp) {
      throw new Error(`frames[${frameIndex}].timestamp must be non-negative and ordered.`);
    }
    previousTimestamp = timestamp;
    if (typeof frame.blendshapes !== "object" || frame.blendshapes === null || Array.isArray(frame.blendshapes)) {
      throw new Error(`frames[${frameIndex}].blendshapes must be an object.`);
    }
    const entries = Object.entries(frame.blendshapes);
    if (entries.length > 256) throw new Error(`frames[${frameIndex}] contains too many blendshape channels.`);
    const blendshapes: Record<string, number> = {};
    for (const [name, score] of entries) {
      blendshapes[name] = Math.min(1, Math.max(0, finiteNumber(score, `frames[${frameIndex}].blendshapes.${name}`)));
    }
    return {
      timestamp,
      blendshapes,
      matrix: matrix(frame.matrix, `frames[${frameIndex}].matrix`),
    };
  });

  return {
    fps: Math.round(fps),
    neutral: neutralFrame(payload.neutral),
    frames,
  };
}
