import type {
  AppSettings, AvatarKind, AvatarMotionSample, CameraViewState, RecordedFrame,
  RecordedIdentityParameters, RecordedTakeSnapshot, TrackingFrame,
} from "../types";

export type MotionFile = {
  version: 1 | 2;
  fps: number;
  avatarKind?: AvatarKind;
  manualExpressions: Record<string, number>;
  frozenExpressions: Record<string, number>;
  neutral: TrackingFrame | null;
  frames: RecordedFrame[];
  viewState: CameraViewState | null;
  appearance: RecordedTakeSnapshot | null;
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
  const parseLandmarks = (entries: unknown[], field: string) => entries.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`${field}[${index}] must be an object.`);
    }
    const point = entry as Record<string, unknown>;
    return {
      x: finiteNumber(point.x, `${field}[${index}].x`),
      y: finiteNumber(point.y, `${field}[${index}].y`),
      z: finiteNumber(point.z, `${field}[${index}].z`),
    };
  });
  const landmarks = parseLandmarks(frame.landmarks, "neutral.landmarks");
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
    poseLandmarks: frame.poseLandmarks === undefined
      ? undefined
      : Array.isArray(frame.poseLandmarks)
        ? parseLandmarks(frame.poseLandmarks, "neutral.poseLandmarks")
        : (() => { throw new Error("neutral.poseLandmarks must be an array."); })(),
    blendshapes,
    matrix: matrix(frame.matrix, "neutral.matrix"),
    avatarMotion: avatarMotion(frame.avatarMotion, "neutral.avatarMotion"),
    mouthOpen: frame.mouthOpen === undefined
      ? undefined
      : Math.min(1, Math.max(0, finiteNumber(frame.mouthOpen, "neutral.mouthOpen"))),
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
    const minimum = name.startsWith("joint_") ? -1 : 0;
    result[name] = Math.min(1, Math.max(minimum, finiteNumber(score, `${field}.${name}`)));
  }
  return result;
}

const settingBooleanFields = [
  "trackingSmoothingEnabled", "motionSmoothingEnabled", "showWebcam", "showAvatar", "showLandmarks", "mirror", "muted",
  "wireframe", "skinTextureEnabled", "eyeShaderEnabled", "mouseLightEnabled", "headRotationEnabled", "outputAutoHideEnabled",
  "outputAlwaysHideControls",
] as const satisfies readonly (keyof AppSettings)[];
const settingNumberFields = [
  "cameraFps", "trackingFps", "trackingSmoothing", "motionSmoothing", "mouthDeadZone", "exportFps", "exportWidth", "exportHeight", "videoBitrateMbps", "audioBitrateKbps",
  "avatarOpacity", "skinTextureScale", "skinTextureRotation", "skinTextureFeather", "backgroundImageZoom", "mouseLightIntensity",
  "headYawStrength", "headPitchStrength", "headRollStrength", "headRotationDeadZone", "headRotationSmoothing", "outputAutoHideDelay",
] as const satisfies readonly (keyof AppSettings)[];
const settingStringFields = ["cameraId", "microphoneId", "ffmpegPath", "backgroundColor"] as const satisfies readonly (keyof AppSettings)[];

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function appSettings(value: unknown): AppSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("appearance.settings must be an object.");
  const source = value as Record<string, unknown>;
  for (const key of settingBooleanFields) if (typeof source[key] !== "boolean") throw new Error(`appearance.settings.${key} must be a boolean.`);
  for (const key of settingNumberFields) finiteNumber(source[key], `appearance.settings.${key}`);
  for (const key of settingStringFields) if (typeof source[key] !== "string") throw new Error(`appearance.settings.${key} must be a string.`);
  enumValue(source.avatarKind, ["gnm", "facecap"], "appearance.settings.avatarKind");
  enumValue(source.trackingBackend, ["auto", "gpu", "cpu"], "appearance.settings.trackingBackend");
  enumValue(source.videoEncoderBackend, ["auto", "webcodecs", "ffmpeg"], "appearance.settings.videoEncoderBackend");
  enumValue(source.skinTone, ["neutral", "light", "warm", "medium", "deep", "rich"], "appearance.settings.skinTone");
  enumValue(source.eyeColor, ["green", "blue", "light_brown", "dark_brown"], "appearance.settings.eyeColor");
  enumValue(source.backgroundMode, ["studio", "solid", "image", "transparent"], "appearance.settings.backgroundMode");
  enumValue(source.recordingMode, ["motion", "avatar", "composite"], "appearance.settings.recordingMode");
  return { ...source } as AppSettings;
}

function identityParameters(value: unknown): RecordedIdentityParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("appearance.identityParameters must be an object.");
  const source = value as Record<string, unknown>;
  if (typeof source.seed !== "string" || source.seed.length > 1_024) throw new Error("appearance.identityParameters.seed must be a string up to 1,024 characters.");
  return {
    seed: source.seed,
    presentation: enumValue(source.presentation, ["female", "male", "blend"], "appearance.identityParameters.presentation"),
    population: enumValue(source.population, ["middle_eastern", "asian", "white", "black", "blend"], "appearance.identityParameters.population"),
    presentationStrength: Math.min(1, Math.max(-1, finiteNumber(source.presentationStrength, "appearance.identityParameters.presentationStrength"))),
    populationWeights: source.populationWeights === undefined
      ? undefined
      : tuple(source.populationWeights, 4, "appearance.identityParameters.populationWeights").map((value) => Math.min(1, Math.max(0, value))) as [number, number, number, number],
  };
}

function identityVertices(value: unknown): Float32Array | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new Error("appearance.identityVertices must be a flat numeric array or null.");
  if (value.length > 1_000_000) throw new Error("appearance.identityVertices is too large to load safely.");
  return Float32Array.from(value.map((entry, index) => finiteNumber(entry, `appearance.identityVertices[${index}]`)));
}

function fixedFloatArray(value: unknown, length: number, field: string): Float32Array | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${field} must contain exactly ${length} numeric values or be null.`);
  return Float32Array.from(value.map((entry, index) => finiteNumber(entry, `${field}[${index}]`)));
}

function frozenExpressionComponents(value: unknown): Record<number, number> {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("appearance.gnmFrozenExpressionComponents must be an object.");
  const result: Record<number, number> = {};
  for (const [rawIndex, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= 383) throw new Error(`appearance.gnmFrozenExpressionComponents has invalid index ${rawIndex}.`);
    result[index] = Math.min(2, Math.max(-2, finiteNumber(rawValue, `appearance.gnmFrozenExpressionComponents.${rawIndex}`)));
  }
  return result;
}

function recordedTakeSnapshot(value: unknown): RecordedTakeSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("appearance must be an object.");
  const source = value as Record<string, unknown>;
  if (source.version !== 1 && source.version !== 2) throw new Error(`Unsupported appearance snapshot version: ${String(source.version ?? "missing")}.`);
  if (typeof source.capturedAt !== "string" || Number.isNaN(Date.parse(source.capturedAt))) throw new Error("appearance.capturedAt must be an ISO date string.");
  const backgroundImageUrl = source.backgroundImageUrl;
  if (backgroundImageUrl !== null && backgroundImageUrl !== undefined
    && (typeof backgroundImageUrl !== "string" || !backgroundImageUrl.startsWith("data:image/"))) {
    throw new Error("appearance.backgroundImageUrl must be an embedded image data URL or null.");
  }
  return {
    version: source.version,
    capturedAt: source.capturedAt,
    settings: appSettings(source.settings),
    identityVertices: identityVertices(source.identityVertices),
    identityParameters: identityParameters(source.identityParameters),
    identityWeights: source.version >= 2 ? fixedFloatArray(source.identityWeights, 253, "appearance.identityWeights") : null,
    gnmExpressionWeights: source.version >= 2 ? fixedFloatArray(source.gnmExpressionWeights, 383, "appearance.gnmExpressionWeights") : null,
    gnmFrozenExpressionComponents: source.version >= 2 ? frozenExpressionComponents(source.gnmFrozenExpressionComponents) : {},
    manualExpressions: expressionRecord(source.manualExpressions, "appearance.manualExpressions"),
    frozenExpressions: expressionRecord(source.frozenExpressions, "appearance.frozenExpressions"),
    neutralFrame: neutralFrame(source.neutralFrame),
    viewState: cameraView(source.viewState),
    backgroundImageUrl: backgroundImageUrl as string | null | undefined ?? null,
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
  if (payload.version !== 1 && payload.version !== 2) {
    throw new Error(`Unsupported motion version: ${String(payload.version ?? "missing")}. This build supports versions 1 and 2.`);
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
      mouthOpen: frame.mouthOpen === undefined
        ? undefined
        : Math.min(1, Math.max(0, finiteNumber(frame.mouthOpen, `frames[${frameIndex}].mouthOpen`))),
    };
  });

  return {
    version: payload.version,
    fps: Math.round(fps),
    avatarKind: payload.avatarKind === "gnm" || payload.avatarKind === "facecap" ? payload.avatarKind : undefined,
    manualExpressions: expressionRecord(payload.manualExpressions, "manualExpressions"),
    frozenExpressions: expressionRecord(payload.frozenExpressions, "frozenExpressions"),
    neutral: neutralFrame(payload.neutral),
    frames,
    viewState: cameraView(payload.viewState),
    appearance: payload.version === 2 ? recordedTakeSnapshot(payload.appearance) : null,
  };
}
