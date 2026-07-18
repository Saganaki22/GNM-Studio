import { useCallback, useRef } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import type { Workspace } from "../../app/studioConfig";
import type { ViewportSize } from "../../lib/coverProjection";
import { trimAndRetimeMotion } from "../../lib/motionEdit";
import type {
  AppSettings, RecordedFrame, RecordedTakeSnapshot, TrackingBackend, TrackingFrame,
} from "../../types";
import { useCaptureDevices } from "../capture/useCaptureDevices";
import { usePlayback } from "../recording/usePlayback";
import { useFaceTracker } from "./useFaceTracker";
import { useNeutralCalibration } from "./useNeutralCalibration";

interface CaptureTrackingPipelineOptions {
  settings: AppSettings;
  stageSize: ViewportSize;
  workspace: Workspace;
  isRecordingIdle(): boolean;
  getRecordedFrames(): RecordedFrame[];
  getRecordedAppearance(): RecordedTakeSnapshot | null;
  getExportEdit(): { trimStartMs: number; trimEndMs: number; playbackSpeed: number };
  resolveDeviceSelection(cameras: { id: string }[], microphones: { id: string }[]): void;
  changeTrackingBackend(backend: TrackingBackend): void;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
  onError(message: string): void;
}

export function useCaptureTrackingPipeline(options: CaptureTrackingPipelineOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const neutralFrameRef = useRef<TrackingFrame | null>(null);
  const trackedFrameRef = useRef<TrackingFrame | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const capture = useCaptureDevices({
    videoRef,
    cameraId: options.settings.cameraId,
    microphoneId: options.settings.microphoneId,
    cameraFps: options.settings.cameraFps,
    muted: options.settings.muted,
    resolveSelection: options.resolveDeviceSelection,
    onToast: options.onToast,
    onError: options.onError,
  });

  const getPlaybackFrames = useCallback(() => {
    const current = optionsRef.current;
    const frames = current.getRecordedFrames();
    const edit = current.getExportEdit();
    return current.workspace === "export"
      ? trimAndRetimeMotion(
        frames,
        edit.trimStartMs,
        edit.trimEndMs || (frames.at(-1)?.timestamp ?? 0),
        edit.playbackSpeed,
        current.settings.exportFps,
      )
      : frames;
  }, []);
  const getPlaybackLandmarks = useCallback(() => (
    optionsRef.current.getRecordedAppearance()?.neutralFrame?.landmarks
      ?? neutralFrameRef.current?.landmarks
      ?? trackedFrameRef.current?.landmarks
      ?? []
  ), []);
  const playback = usePlayback({
    isRecordingIdle: options.isRecordingIdle,
    cameraReady: capture.cameraAccess === "ready",
    getFrames: getPlaybackFrames,
    getLandmarks: getPlaybackLandmarks,
    onToast: options.onToast,
  });

  const getNeutralFrame = useCallback(() => neutralFrameRef.current, []);
  const tracker = useFaceTracker({
    cameraReady: capture.cameraAccess === "ready",
    videoRef,
    paused: capture.paused,
    backend: options.settings.trackingBackend,
    fps: options.settings.trackingFps,
    trackingSmoothing: options.settings.trackingSmoothingEnabled ? options.settings.trackingSmoothing : 0,
    motionSmoothing: options.settings.motionSmoothingEnabled ? options.settings.motionSmoothing : 0,
    getNeutralFrame,
    mouthDeadZone: options.settings.mouthDeadZone,
    onBackendChange: options.changeTrackingBackend,
    onBeforeReload: playback.resetSilently,
    onToast: options.onToast,
    onError: options.onError,
  });
  trackedFrameRef.current = tracker.frame;

  const calibration = useNeutralCalibration({
    videoRef,
    stageSize: options.stageSize,
    mirror: options.settings.mirror,
    cameraReady: capture.cameraAccess === "ready",
    isRecordingIdle: options.isRecordingIdle,
    frame: tracker.frame,
    getCurrentFrame: tracker.getCurrentFrame,
    onNeutralChanged: tracker.resetFilters,
    onToast: options.onToast,
  });
  neutralFrameRef.current = calibration.neutralFrame;

  return { videoRef, capture, playback, tracker, calibration };
}
