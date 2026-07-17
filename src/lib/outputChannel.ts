import type { AppSettings, AvatarMotionSample, CameraViewState, IdentityVertices, TrackingFrame } from "../types";

export const outputChannelName = "gnm-studio-output-v1";

export type OutputSnapshot = {
  settings: AppSettings;
  frame: TrackingFrame | null;
  neutralFrame: TrackingFrame | null;
  identityVertices: IdentityVertices | null;
  manualExpressions: Record<string, number>;
  frozenExpressions: Record<string, number>;
  trackingReady: boolean;
  recordingActive: boolean;
  resetViewSignal: number;
  backgroundImageUrl: string | null;
  viewState: CameraViewState | null;
};

export type MainToOutputMessage =
  | { type: "snapshot"; snapshot: OutputSnapshot }
  | { type: "frame"; frame: TrackingFrame | null; trackingReady: boolean }
  | { type: "focus" }
  | { type: "close" }
  | { type: "record"; action: "start"; fps: number; videoBitrate: number; audioBitrate: number }
  | { type: "record"; action: "pause" | "resume" | "stop" };

export type OutputToMainMessage =
  | { type: "ready" }
  | { type: "heartbeat"; timestamp: number }
  | { type: "closed" }
  | { type: "record-result"; blob: Blob; mimeType: string }
  | { type: "view-state"; viewState: CameraViewState }
  | { type: "avatar-motion"; sample: AvatarMotionSample; frameTimestamp: number }
  | { type: "error"; operation: string; message: string };
