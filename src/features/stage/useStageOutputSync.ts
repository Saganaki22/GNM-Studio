import { useEffect, useRef } from "react";
import type { OutputSnapshot } from "../../lib/outputChannel";
import type {
  AppSettings, CameraViewState, IdentityVertices, RecordedTakeSnapshot, TrackingFrame,
} from "../../types";

interface StageOutputSyncOptions {
  settings: AppSettings;
  identityVertices: IdentityVertices | null;
  manualExpressions: Record<string, number>;
  frozenExpressions: Record<string, number>;
  neutralFrame: TrackingFrame | null;
  backgroundImageUrl: string | null;
  recordedAppearance: RecordedTakeSnapshot | null;
  recordingState: "idle" | "recording" | "paused";
  captureFinalizing: boolean;
  motionVideoRendering: boolean;
  pngSequenceRendering: boolean;
  playbackFrame: TrackingFrame | null;
  displayedFrame: TrackingFrame | null;
  trackingFrame: TrackingFrame | null;
  capturePaused: boolean;
  resetViewSignal: number;
  popoutState: "idle" | "starting" | "active";
  getCurrentTrackingFrame(): TrackingFrame | null;
  getCurrentViewState(): CameraViewState | null;
  attachVideo(): void;
  sendSnapshot(snapshot: OutputSnapshot): void;
  sendFrame(frame: TrackingFrame | null, trackingReady: boolean): void;
}

export function useStageOutputSync(options: StageOutputSyncOptions) {
  const {
    recordedAppearance, recordingState, captureFinalizing, motionVideoRendering,
    pngSequenceRendering, playbackFrame, displayedFrame, trackingFrame, capturePaused,
    resetViewSignal, popoutState, getCurrentTrackingFrame, getCurrentViewState,
    attachVideo, sendSnapshot, sendFrame,
  } = options;
  const recordedAppearanceActive = Boolean(
    recordedAppearance && (
      recordingState !== "idle" || captureFinalizing || motionVideoRendering
      || pngSequenceRendering || playbackFrame
    ),
  );
  const appearance = recordedAppearanceActive ? recordedAppearance : null;
  const settings = appearance?.settings ?? options.settings;
  const identityVertices = appearance?.identityVertices ?? options.identityVertices;
  const manualExpressions = appearance?.manualExpressions ?? options.manualExpressions;
  const frozenExpressions = appearance?.frozenExpressions ?? options.frozenExpressions;
  const neutralFrame = appearance?.neutralFrame ?? options.neutralFrame;
  const backgroundImageUrl = appearance?.backgroundImageUrl ?? options.backgroundImageUrl;
  const displayedFrameRef = useRef<TrackingFrame | null>(displayedFrame);
  displayedFrameRef.current = displayedFrame;

  useEffect(() => {
    attachVideo();
  }, [attachVideo, popoutState]);

  useEffect(() => {
    if (popoutState !== "active") return;
    sendSnapshot({
      settings,
      frame: displayedFrameRef.current,
      neutralFrame,
      identityVertices,
      manualExpressions,
      frozenExpressions,
      trackingReady: Boolean(getCurrentTrackingFrame()),
      capturePaused,
      recordingActive: motionVideoRendering || pngSequenceRendering || recordingState !== "idle",
      resetViewSignal,
      backgroundImageUrl,
      viewState: appearance?.viewState ?? getCurrentViewState(),
    });
  }, [
    appearance, backgroundImageUrl, captureFinalizing, capturePaused, frozenExpressions,
    getCurrentTrackingFrame, getCurrentViewState, identityVertices, manualExpressions,
    motionVideoRendering, neutralFrame, pngSequenceRendering, popoutState, recordingState,
    resetViewSignal, sendSnapshot, settings,
  ]);

  useEffect(() => {
    if (popoutState !== "active") return;
    sendFrame(displayedFrame, Boolean(trackingFrame));
  }, [displayedFrame, popoutState, sendFrame, trackingFrame]);

  return { appearance, settings, identityVertices, manualExpressions, frozenExpressions, neutralFrame, backgroundImageUrl };
}
