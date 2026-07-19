import { flattenIdentityVertices } from "./identityVertices.ts";
import type {
  AppSettings, CameraViewState, IdentityVertices, RecordedIdentityParameters, RecordedTakeSnapshot, TrackingFrame,
} from "../types";

export const recordingAppearanceSettingKeys = new Set<keyof AppSettings>([
  "avatarKind",
  "showWebcam",
  "showAvatar",
  "showLandmarks",
  "mirror",
  "avatarOpacity",
  "wireframe",
  "skinTextureEnabled",
  "skinTone",
  "skinTextureScale",
  "skinTextureRotation",
  "skinTextureFeather",
  "eyeShaderEnabled",
  "eyeColor",
  "backgroundMode",
  "backgroundColor",
  "backgroundImageZoom",
  "mouseLightEnabled",
  "mouseLightIntensity",
  "headRotationEnabled",
  "headYawStrength",
  "headPitchStrength",
  "headRollStrength",
  "headRotationDeadZone",
  "headRotationSmoothing",
  "mouthDeadZone",
  "recordingMode",
]);

function cloneIdentity(vertices: IdentityVertices | null) {
  return vertices ? new Float32Array(flattenIdentityVertices(vertices)) : null;
}

function cloneTrackingFrame(frame: TrackingFrame | null) {
  if (!frame) return null;
  return {
    timestamp: frame.timestamp,
    landmarks: frame.landmarks.map((point) => ({ ...point })),
    poseLandmarks: frame.poseLandmarks?.map((point) => ({ ...point })),
    blendshapes: frame.blendshapes.map((shape) => ({ ...shape })),
    matrix: [...frame.matrix],
    avatarMotion: frame.avatarMotion
      ? {
          ...frame.avatarMotion,
          position: frame.avatarMotion.position ? [...frame.avatarMotion.position] as [number, number, number] : undefined,
          scale: frame.avatarMotion.scale ? [...frame.avatarMotion.scale] as [number, number, number] : undefined,
          quaternion: [...frame.avatarMotion.quaternion] as [number, number, number, number],
          gnmJoints: frame.avatarMotion.gnmJoints
            ? {
                neck: [...frame.avatarMotion.gnmJoints.neck] as [number, number, number, number],
                head: [...frame.avatarMotion.gnmJoints.head] as [number, number, number, number],
                leftEye: [...frame.avatarMotion.gnmJoints.leftEye] as [number, number, number, number],
                rightEye: [...frame.avatarMotion.gnmJoints.rightEye] as [number, number, number, number],
              }
            : undefined,
        }
      : undefined,
    mouthOpen: frame.mouthOpen,
  } satisfies TrackingFrame;
}

function cloneViewState(viewState: CameraViewState | null) {
  if (!viewState) return null;
  return {
    position: [...viewState.position],
    target: [...viewState.target],
    up: [...viewState.up],
    zoom: viewState.zoom,
  } as CameraViewState;
}

export type CaptureRecordedTakeInput = {
  settings: AppSettings;
  identityVertices: IdentityVertices | null;
  identityParameters: RecordedIdentityParameters;
  identityWeights?: Float32Array | null;
  gnmExpressionWeights?: Float32Array | null;
  gnmFrozenExpressionComponents?: Record<number, number>;
  manualExpressions: Record<string, number>;
  frozenExpressions: Record<string, number>;
  neutralFrame: TrackingFrame | null;
  viewState: CameraViewState | null;
  backgroundImageUrl: string | null;
};

export function captureRecordedTakeSnapshot(input: CaptureRecordedTakeInput): RecordedTakeSnapshot {
  return {
    version: 2,
    capturedAt: new Date().toISOString(),
    settings: { ...input.settings },
    identityVertices: cloneIdentity(input.identityVertices),
    identityParameters: { ...input.identityParameters },
    identityWeights: input.identityWeights?.slice() ?? null,
    gnmExpressionWeights: input.gnmExpressionWeights?.slice() ?? null,
    gnmFrozenExpressionComponents: { ...(input.gnmFrozenExpressionComponents ?? {}) },
    manualExpressions: { ...input.manualExpressions },
    frozenExpressions: { ...input.frozenExpressions },
    neutralFrame: cloneTrackingFrame(input.neutralFrame),
    viewState: cloneViewState(input.viewState),
    backgroundImageUrl: input.backgroundImageUrl,
  };
}

export function cloneRecordedTakeSnapshot(snapshot: RecordedTakeSnapshot): RecordedTakeSnapshot {
  const cloned = captureRecordedTakeSnapshot({
    settings: snapshot.settings,
    identityVertices: snapshot.identityVertices,
    identityParameters: snapshot.identityParameters,
    identityWeights: snapshot.identityWeights,
    gnmExpressionWeights: snapshot.gnmExpressionWeights,
    gnmFrozenExpressionComponents: snapshot.gnmFrozenExpressionComponents,
    manualExpressions: snapshot.manualExpressions,
    frozenExpressions: snapshot.frozenExpressions,
    neutralFrame: snapshot.neutralFrame,
    viewState: snapshot.viewState,
    backgroundImageUrl: snapshot.backgroundImageUrl,
  });
  cloned.capturedAt = snapshot.capturedAt;
  cloned.version = snapshot.version;
  return cloned;
}

export async function serializableRecordedTakeSnapshot(snapshot: RecordedTakeSnapshot): Promise<RecordedTakeSnapshot> {
  const cloned = cloneRecordedTakeSnapshot(snapshot);
  if (!cloned.backgroundImageUrl || cloned.backgroundImageUrl.startsWith("data:")) return cloned;
  let response: Response;
  try {
    response = await fetch(cloned.backgroundImageUrl);
  } catch (error) {
    throw new Error(`The recorded custom background could not be read for JSON export: ${String(error)}`);
  }
  if (!response.ok) throw new Error(`The recorded custom background returned HTTP ${response.status} during JSON export.`);
  const blob = await response.blob();
  cloned.backgroundImageUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The recorded custom background could not be converted to an embedded data URL."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  return cloned;
}
