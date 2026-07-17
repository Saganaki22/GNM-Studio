import type { AvatarKind, AvatarMotionSample, CameraViewState, RecordedFrame, TrackingFrame } from "../types";

export type MotionFile = {
  fps: number;
  avatarKind?: AvatarKind;
  manualExpressions: Record<string, number>;
  frozenExpressions: Record<string, number>;
  neutral: TrackingFrame | null;
  frames: RecordedFrame[];
  viewState: CameraViewState | null;
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

function tuple(value: unknown, length: number, field: string) {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${field} must contain exactly ${length} values.`);
  return value.map((entry, index) => finiteNumber(entry, `${field}[${index}]`));
}

function avatarMotion(value: unknown, field: string): AvatarMotionSample | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  const sample = value as Record<string, unknown>;
  const quaternion = tuple(sample.quaternion, 4, `${field}.quaternion`);
  return {
    centerX: finiteNumber(sample.centerX, `${field}.centerX`),
    centerY: finiteNumber(sample.centerY, `${field}.centerY`),
    faceHeight: Math.max(0.001, finiteNumber(sample.faceHeight, `${field}.faceHeight`)),
    position: sample.position === undefined
      ? undefined
      : tuple(sample.position, 3, `${field}.position`) as [number, number, number],
    scale: sample.scale === undefined
      ? undefined
      : tuple(sample.scale, 3, `${field}.scale`).map((entry) => Math.max(0.001, entry)) as [number, number, number],
    quaternion: quaternion as [number, number, number, number],
  };
}

function cameraView(value: unknown): CameraViewState | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("viewState must be an object or null.");
  const view = value as Record<string, unknown>;
  return {
    position: tuple(view.position, 3, "viewState.position") as [number, number, number],
    target: tuple(view.target, 3, "viewState.target") as [number, number, number],
    up: tuple(view.up, 3, "viewState.up") as [number, number, number],
    zoom: Math.max(0.01, finiteNumber(view.zoom, "viewState.zoom")),
  };
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

function expressionRecord(value: unknown, field: string) {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  const result: Record<string, number> = {};
  const entries = Object.entries(value);
  if (entries.length > 256) throw new Error(`${field} contains too many channels.`);
  for (const [name, score] of entries) {
    result[name] = Math.min(1, Math.max(0, finiteNumber(score, `${field}.${name}`)));
  }
  return result;
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
      avatarMotion: avatarMotion(frame.avatarMotion, `frames[${frameIndex}].avatarMotion`),
    };
  });

  return {
    fps: Math.round(fps),
    avatarKind: payload.avatarKind === "gnm" || payload.avatarKind === "facecap" ? payload.avatarKind : undefined,
    manualExpressions: expressionRecord(payload.manualExpressions, "manualExpressions"),
    frozenExpressions: expressionRecord(payload.frozenExpressions, "frozenExpressions"),
    neutral: neutralFrame(payload.neutral),
    frames,
    viewState: cameraView(payload.viewState),
  };
}
