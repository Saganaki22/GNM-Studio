import { useRef, type Dispatch, type SetStateAction } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import type { useFfmpegEncoder } from "../export/useFfmpegEncoder";
import type { usePlayback } from "./usePlayback";
import type { MainToOutputCommand } from "../../lib/outputChannel";
import type {
  AppSettings, CameraViewState, IdentityVertices, RecordedIdentityParameters,
  RecordedTakeSnapshot, TrackingFrame,
} from "../../types";
import { usePresets } from "../presets/usePresets";
import { useOutputPopout } from "../output/useOutputPopout";
import { useStudioExport } from "../export/useStudioExport";
import { useRecordedAppearance } from "./useRecordedAppearance";
import { useRecordingSession } from "./useRecordingSession";
import type { SaveResult } from "../../lib/save";

type OutputStartCommand = Omit<Extract<MainToOutputCommand, { type: "record"; action: "start" }>, "type" | "action">;

interface TakePipelineOptions {
  settings: AppSettings;
  identity: {
    vertices: IdentityVertices | null;
    parameters: RecordedIdentityParameters;
    weights: Float32Array | null;
  };
  expression: {
    gnmWeights: Float32Array | null;
    gnmFrozen: Record<string, number>;
    manual: Record<string, number>;
    frozen: Record<string, number>;
    setManual: Dispatch<SetStateAction<Record<string, number>>>;
    setFrozen: Dispatch<SetStateAction<Record<string, number>>>;
  };
  capture: {
    trackingFrame: TrackingFrame | null;
    neutralFrame: TrackingFrame | null;
    paused: boolean;
    microphoneReady: boolean;
    cloneAudioTrack(): MediaStreamTrack | null;
  };
  background: {
    url: string | null;
    adoptUrl(url: string): void;
  };
  stage: {
    getCanvas(): HTMLCanvasElement | null;
    getViewState(): CameraViewState | null;
    setForcedViewState(viewState: CameraViewState | null): void;
    onViewState(viewState: CameraViewState): void;
  };
  playback: ReturnType<typeof usePlayback>;
  ffmpeg: ReturnType<typeof useFfmpegEncoder>;
  recordingElapsed: number;
  playbackFrame: TrackingFrame | null;
  restoreGnmState(snapshot: RecordedTakeSnapshot): void;
  restoreNeutralFrame(frame: TrackingFrame | null): void;
  setSettings(settings: AppSettings): void;
  updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void;
  openExportWorkspace(): void;
  scheduleTrackerHealthCheck(name: string): void;
  showSaveResult(title: string, description: string, result: SaveResult): void;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
  onError(message: string): void;
}

export function useTakePipeline(options: TakePipelineOptions) {
  const outputRecordingRef = useRef<{
    isActive(): boolean;
    begin(command: OutputStartCommand): Promise<void>;
    pause(paused: boolean): void;
    stop(): void;
  }>({
    isActive: () => false,
    begin: () => Promise.reject<void>(new Error("The output controller is not ready.")),
    pause: () => {},
    stop: () => {},
  });

  const appearance = useRecordedAppearance({
    settings: options.settings,
    identity: options.identity,
    expression: options.expression,
    neutralFrame: options.capture.neutralFrame,
    backgroundImageUrl: options.background.url,
    getViewState: options.stage.getViewState,
    restoreGnmState: options.restoreGnmState,
    restoreNeutralFrame: options.restoreNeutralFrame,
    setSettings: options.setSettings,
    setAvatarKind: (avatarKind) => options.updateSetting("avatarKind", avatarKind),
    setManual: options.expression.setManual,
    setFrozen: options.expression.setFrozen,
    setViewState: options.stage.setForcedViewState,
    adoptBackgroundImageUrl: options.background.adoptUrl,
  });

  const recording = useRecordingSession({
    settings: options.settings,
    trackingFrame: options.capture.trackingFrame,
    neutralFrame: options.capture.neutralFrame,
    capturePaused: options.capture.paused,
    microphoneReady: options.capture.microphoneReady,
    backgroundImageUrl: options.background.url,
    getCanvas: options.stage.getCanvas,
    cloneAudioTrack: options.capture.cloneAudioTrack,
    captureAppearance: appearance.captureCurrent,
    createImportedAppearance: appearance.createImported,
    applyImportedAppearance: appearance.applyImported,
    output: {
      isActive: () => outputRecordingRef.current.isActive(),
      begin: (command) => outputRecordingRef.current.begin(command),
      pause: (paused) => outputRecordingRef.current.pause(paused),
      stop: () => outputRecordingRef.current.stop(),
    },
    playback: {
      reset: options.playback.resetSilently,
      setElapsed: options.playback.setElapsed,
      showFrame: options.playback.showRecordedFrame,
    },
    openExportWorkspace: options.openExportWorkspace,
    onImportedFps: (fps) => options.updateSetting("exportFps", fps),
    onToast: options.onToast,
    onError: options.onError,
  });

  const output = useOutputPopout({
    isRecordingActive: () => recording.getState() !== "idle",
    onRecordingInterrupted: recording.interruptOutput,
    onRecordResult: recording.acceptOutputVideo,
    onRecordError: recording.finishOutputError,
    onViewState: options.stage.onViewState,
    onAvatarMotion: recording.storeAvatarMotion,
    onToast: options.onToast,
    onError: options.onError,
  });
  outputRecordingRef.current = {
    isActive: () => output.popoutState === "active",
    begin: output.beginRecording,
    pause: output.pauseRecording,
    stop: output.stopRecording,
  };

  const exporter = useStudioExport({
    settings: options.settings,
    recordedFrames: recording.frames,
    recordedViewState: recording.viewState,
    lastVideo: recording.lastVideo,
    lastAudio: recording.lastAudio,
    lastVideoQuality: recording.videoQuality,
    captureFinalizing: recording.finalizing,
    manualExpressions: options.expression.manual,
    frozenExpressions: options.expression.frozen,
    neutralFrame: options.capture.neutralFrame,
    trackingFrame: options.capture.trackingFrame,
    identityVertices: options.identity.vertices,
    playbackFrame: options.playbackFrame,
    recordingElapsed: options.recordingElapsed,
    outputOwnerPhase: output.ownerPhase,
    popoutState: output.popoutState,
    recording,
    playback: options.playback,
    output,
    ffmpeg: options.ffmpeg,
    getCanvas: options.stage.getCanvas,
    getCurrentViewState: options.stage.getViewState,
    setForcedViewState: options.stage.setForcedViewState,
    showSaveResult: options.showSaveResult,
    pushToast: options.onToast,
    setDeviceError: options.onError,
    scheduleTrackerHealthCheck: options.scheduleTrackerHealthCheck,
  });

  const presets = usePresets({
    captureSnapshot: appearance.captureCurrent,
    applySnapshot: appearance.applyFullSnapshot,
    onToast: options.onToast,
    onError: options.onError,
    onSaved: (result, count) => options.showSaveResult(
      "Preset bundle exported",
      `${count} named full-state preset${count === 1 ? "" : "s"}`,
      result,
    ),
  });

  return { appearance, recording, output, exporter, presets };
}
