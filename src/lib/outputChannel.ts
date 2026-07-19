import type { AppSettings, AvatarMotionSample, CameraViewState, IdentityVertices, TrackingFrame } from "../types";

export const outputChannelName = "gnm-studio-output-v2";

export type OutputOwnerPhase =
  | "studio"
  | "connecting"
  | "popout-ready"
  | "popout-recording"
  | "popout-encoding"
  | "closing"
  | "restoring"
  | "failed";

export type OutputSnapshot = {
  settings: AppSettings;
  frame: TrackingFrame | null;
  neutralFrame: TrackingFrame | null;
  identityVertices: IdentityVertices | null;
  manualExpressions: Record<string, number>;
  frozenExpressions: Record<string, number>;
  trackingReady: boolean;
  capturePaused: boolean;
  recordingActive: boolean;
  resetViewSignal: number;
  backgroundImageUrl: string | null;
  viewState: CameraViewState | null;
};

export type MainToOutputCommand =
  | { type: "snapshot"; snapshot: OutputSnapshot }
  | { type: "frame"; frame: TrackingFrame | null; trackingReady: boolean }
  | { type: "focus" }
  | { type: "close" }
  | { type: "shutdown" }
  | { type: "capture-png"; requestId: string; width: number; height: number }
  | { type: "record"; action: "start"; requestId: string; fps: number; videoBitrate: number; audioBitrate: number; retainedAudio?: Blob; useLiveMicrophone: boolean; forceWebm?: boolean; width?: number; height?: number }
  | { type: "record"; action: "pause" | "resume" | "stop"; requestId: string };

export type MainToOutputMessage = MainToOutputCommand & { ownerId: string };

export type OutputToMainEvent =
  | { type: "ready" }
  | { type: "heartbeat"; timestamp: number; phase: "ready" | "recording" | "encoding" | "closing" }
  | { type: "closed" }
  | { type: "shutdown-ready" }
  | { type: "record-state"; requestId: string; state: "recording" | "paused" | "encoding" | "ready" }
  | { type: "record-result"; requestId: string; blob: Blob; mimeType: string }
  | { type: "png-result"; requestId: string; blob: Blob }
  | { type: "view-state"; viewState: CameraViewState }
  | { type: "avatar-motion"; sample: AvatarMotionSample; frameTimestamp: number }
  | { type: "error"; operation: string; message: string };

export type OutputToMainMessage = OutputToMainEvent & { ownerId: string };
