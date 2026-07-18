import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import { avatarProfiles, facecapInfluences } from "../../lib/avatarProfiles";
import { semanticInfluences } from "../../lib/retarget";
import { applyNeutralBaseline, estimateTrackingQuality } from "../../lib/trackingFrames";
import type { Workspace } from "../../app/studioConfig";
import type { AppSettings, RecordedFrame, TrackingFrame } from "../../types";

interface StudioDerivedStateOptions {
  settings: AppSettings;
  trackerStatus: string;
  trackingFrame: TrackingFrame | null;
  neutralFrame: TrackingFrame | null;
  playbackFrame: TrackingFrame | null;
  recordedFrames: RecordedFrame[];
  recordingElapsed: number;
  workspace: Workspace;
  trimStartMs: number;
  trimEndMs: number;
  playbackSpeed: number;
  cameraReady: boolean;
  microphoneReady: boolean;
  manualExpressions: Record<string, number>;
  setManualExpressions: Dispatch<SetStateAction<Record<string, number>>>;
  setFrozenExpressions: Dispatch<SetStateAction<Record<string, number>>>;
}

export function useStudioDerivedState(options: StudioDerivedStateOptions) {
  const { manualExpressions, setManualExpressions, setFrozenExpressions } = options;
  const faceConfidence = useMemo(() => estimateTrackingQuality(options.trackingFrame), [options.trackingFrame]);
  const trackingQualityLabel = options.trackerStatus === "error"
    ? "Needs retry"
    : options.trackerStatus === "loading"
      ? "Starting"
      : !options.trackingFrame
        ? "No face"
        : faceConfidence >= 90
          ? "Excellent"
          : faceConfidence >= 76
            ? "Good"
            : faceConfidence >= 58
              ? "Fair"
              : "Weak";
  const recordedDuration = options.recordedFrames.at(-1)?.timestamp ?? 0;
  const editedPreviewDuration = Math.max(0, (
    Math.min(recordedDuration, options.trimEndMs || recordedDuration)
      - Math.min(recordedDuration, options.trimStartMs)
  ) / options.playbackSpeed);
  const playbackDuration = options.workspace === "export" && options.recordedFrames.length
    ? editedPreviewDuration
    : recordedDuration;
  const timelineDuration = options.recordedFrames.length
    ? Math.max(1, playbackDuration)
    : Math.max(10_000, options.recordingElapsed);
  const timelinePosition = Math.min(timelineDuration, Math.max(0, options.recordingElapsed));
  const timelinePercent = Math.min(100, Math.max(0, (timelinePosition / timelineDuration) * 100));
  const connectedCaptureCount = Number(options.cameraReady) + Number(options.microphoneReady);
  const captureStatusTitle = `Camera: ${options.cameraReady ? "ready" : "not connected"}. Microphone: ${options.microphoneReady ? "ready" : "not connected"}. Right-click to choose the tracking backend.`;
  const displayedFrame = options.playbackFrame ?? applyNeutralBaseline(options.trackingFrame, options.neutralFrame);
  const liveSemantic = useMemo(
    () => semanticInfluences(Object.fromEntries((displayedFrame?.blendshapes ?? []).map(({ name, score }) => [name, score]))),
    [displayedFrame],
  );
  const liveFacecap = useMemo(
    () => facecapInfluences(Object.fromEntries((displayedFrame?.blendshapes ?? []).map(({ name, score }) => [name, score]))),
    [displayedFrame],
  );
  const activeProfile = avatarProfiles[options.settings.avatarKind];
  const activeLiveExpressions = useMemo<Record<string, number>>(() => (
    options.settings.avatarKind === "facecap"
      ? liveFacecap
      : { ...liveSemantic, jaw_open: displayedFrame?.mouthOpen ?? 0 }
  ), [displayedFrame?.mouthOpen, liveFacecap, liveSemantic, options.settings.avatarKind]);

  const toggleExpressionFreeze = useCallback((name: string) => {
    setFrozenExpressions((current) => {
      if (name in current) {
        const next = { ...current };
        delete next[name];
        return next;
      }
      return {
        ...current,
        [name]: Math.min(1, (activeLiveExpressions[name] ?? 0) + (manualExpressions[name] ?? 0)),
      };
    });
  }, [activeLiveExpressions, manualExpressions, setFrozenExpressions]);

  const resetActiveExpressions = useCallback(() => {
    const activeNames = new Set(activeProfile.expressionNames);
    setManualExpressions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !activeNames.has(name))));
    setFrozenExpressions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !activeNames.has(name))));
  }, [activeProfile.expressionNames, setFrozenExpressions, setManualExpressions]);

  return {
    faceConfidence,
    trackingQualityLabel,
    recordedDuration,
    playbackDuration,
    timelineDuration,
    timelinePosition,
    timelinePercent,
    connectedCaptureCount,
    captureStatusTitle,
    displayedFrame,
    activeProfile,
    toggleExpressionFreeze,
    resetActiveExpressions,
  };
}
