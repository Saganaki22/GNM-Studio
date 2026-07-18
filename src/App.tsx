import { useCallback, useRef, useState } from "react";
import { StudioShell } from "./app/StudioShell";
import { useBackgroundImage } from "./features/background/useBackgroundImage";
import { useStudioSettings } from "./features/settings/useStudioSettings";
import { useStagePresentation } from "./features/stage/useStagePresentation";
import { useStageOutputSync } from "./features/stage/useStageOutputSync";
import { useFullscreenControls } from "./features/fullscreen/useFullscreenControls";
import { useGnmRuntime } from "./features/gnm/useGnmRuntime";
import { useTakePipeline } from "./features/recording/useTakePipeline";
import { useFfmpegEncoder } from "./features/export/useFfmpegEncoder";
import { useSaveFeedback } from "./features/export/useSaveFeedback";
import { useStudioMetadata } from "./features/shell/useStudioMetadata";
import { useStudioDerivedState } from "./features/shell/useStudioDerivedState";
import { useStudioControls } from "./features/shell/useStudioControls";
import { useCaptureTrackingPipeline } from "./features/tracking/useCaptureTrackingPipeline";
import { useToasts } from "./features/toasts/useToasts";
import { recordingAppearanceSettingKeys } from "./lib/recordingAppearance";
import type {
  AppSettings,
  RecordedFrame, RecordedTakeSnapshot, TrackingBackend,
} from "./types";
import { isWebEdition, type Workspace } from "./app/studioConfig";
import "./App.css";

function App() {
  const [manualExpressions, setManualExpressions] = useState<Record<string, number>>({});
  const [frozenExpressions, setFrozenExpressions] = useState<Record<string, number>>({});
  const settingsController = useStudioSettings();
  const { settings, setSettings } = settingsController;
  const [deviceError, setDeviceError] = useState("");
  const stage = useStagePresentation(setDeviceError);
  const {
    size: stageSize, setForcedViewState, handleViewState: handleViewStateChange,
    getCanvas: getStageCanvas, getCurrentViewState,
  } = stage;
  const [activePanel, setActivePanel] = useState<"avatar" | "capture">(isWebEdition ? "capture" : "avatar");
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>(isWebEdition ? "capture" : "create");
  const fullscreenController = useFullscreenControls(settings, setDeviceError);
  const notifications = useToasts();
  const { pushToast } = notifications;
  const metadata = useStudioMetadata({ deviceError, onToast: pushToast, onError: setDeviceError });
  const recordingStateGetterAdapterRef = useRef<() => "idle" | "recording" | "paused">(() => "idle");
  const isRecordingIdle = useCallback(() => recordingStateGetterAdapterRef.current() === "idle", []);
  const recordingFinalizingGetterAdapterRef = useRef<() => boolean>(() => false);
  const recordedAppearanceGetterAdapterRef = useRef<() => RecordedTakeSnapshot | null>(() => null);
  const recordedFramesGetterAdapterRef = useRef<() => RecordedFrame[]>(() => []);
  const exportEditAdapterRef = useRef({ trimStartMs: 0, trimEndMs: 0, playbackSpeed: 1 });
  const resolveCaptureDeviceSelection = useCallback((cameraOptions: { id: string }[], microphoneOptions: { id: string }[]) => {
    setSettings((current) => ({
      ...current,
      cameraId: cameraOptions.some((device) => device.id === current.cameraId)
        ? current.cameraId : cameraOptions[0]?.id ?? "",
      microphoneId: microphoneOptions.some((device) => device.id === current.microphoneId)
        ? current.microphoneId : microphoneOptions[0]?.id ?? "",
    }));
  }, [setSettings]);
  const changeTrackingBackend = useCallback((backend: TrackingBackend) => {
    setSettings((current) => ({ ...current, trackingBackend: backend }));
  }, [setSettings]);
  const captureTracking = useCaptureTrackingPipeline({
    settings,
    stageSize,
    workspace: activeWorkspace,
    isRecordingIdle,
    getRecordedFrames: () => recordedFramesGetterAdapterRef.current(),
    getRecordedAppearance: () => recordedAppearanceGetterAdapterRef.current(),
    getExportEdit: () => exportEditAdapterRef.current,
    resolveDeviceSelection: resolveCaptureDeviceSelection,
    changeTrackingBackend,
    onToast: pushToast,
    onError: setDeviceError,
  });
  const { capture: captureDevices, playback, tracker, calibration } = captureTracking;
  const {
    cameraAccess, microphoneAccess, paused: capturePaused,
  } = captureDevices;
  const { frame: playbackFrame, elapsed: recordingElapsed } = playback;
  const { frame: trackingFrame, status: trackerStatus } = tracker;
  const getCurrentTrackingFrame = tracker.getCurrentFrame;
  const { neutralFrame, calibrating } = calibration;
  const gnm = useGnmRuntime({
    avatarKind: settings.avatarKind,
    isRecordingIdle,
    onToast: pushToast,
    onError: setDeviceError,
  });
  const { identity, expression, restoreState: restoreGnmState } = gnm;
  const {
    seed: identitySeed, presentation: identityGender, population: identityEthnicity,
    presentationStrength: identityPresentationStrength, populationWeights: identityPopulationWeights,
    vertices: identityVertices, weights: identityWeights,
  } = identity;
  const {
    weights: gnmExpressionWeights, frozen: gnmFrozenExpressionComponents,
  } = expression;
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const motionInputRef = useRef<HTMLInputElement>(null);
  const presetInputRef = useRef<HTMLInputElement>(null);
  const exportBusyAdapterRef = useRef<() => boolean>(() => false);
  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if ((recordingStateGetterAdapterRef.current() !== "idle" || recordingFinalizingGetterAdapterRef.current() || exportBusyAdapterRef.current()) && recordingAppearanceSettingKeys.has(key)) {
      pushToast({
        type: "warning",
        title: "Take appearance is locked",
        message: "Stop recording or wait for the offline render to finish before changing avatar, material, background, layer, or pose settings.",
      });
      return;
    }
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const saveFeedback = useSaveFeedback({ onToast: pushToast, onError: setDeviceError });
  const ffmpeg = useFfmpegEncoder({
    path: settings.ffmpegPath,
    backend: settings.videoEncoderBackend,
    setPath: (path) => updateSetting("ffmpegPath", path),
    onToast: pushToast,
    onError: setDeviceError,
  });
  const { showSaveResult } = saveFeedback;

  const background = useBackgroundImage({
    getRetainedUrl: () => recordedAppearanceGetterAdapterRef.current()?.backgroundImageUrl ?? null,
    setImageMode: () => updateSetting("backgroundMode", "image"),
    setStudioMode: () => updateSetting("backgroundMode", "studio"),
    onSuccess: (title, message) => pushToast({ type: "success", title, message }),
    onInfo: (title, message) => pushToast({ type: "info", title, message }),
    onError: setDeviceError,
  });
  const { backgroundImageUrl, adoptBackgroundImageUrl } = background;

  const take = useTakePipeline({
    settings,
    identity: {
      vertices: identityVertices,
      parameters: {
        seed: identitySeed,
        presentation: identityGender,
        population: identityEthnicity,
        presentationStrength: identityPresentationStrength,
        populationWeights: identityPopulationWeights,
      },
      weights: identityWeights,
    },
    expression: {
      gnmWeights: gnmExpressionWeights,
      gnmFrozen: gnmFrozenExpressionComponents,
      manual: manualExpressions,
      frozen: frozenExpressions,
      setManual: setManualExpressions,
      setFrozen: setFrozenExpressions,
    },
    capture: {
      trackingFrame,
      neutralFrame,
      paused: capturePaused,
      microphoneReady: microphoneAccess === "ready",
      cloneAudioTrack: captureDevices.cloneAudioTrack,
    },
    background: { url: backgroundImageUrl, adoptUrl: adoptBackgroundImageUrl },
    stage: {
      getCanvas: getStageCanvas,
      getViewState: getCurrentViewState,
      setForcedViewState,
      onViewState: handleViewStateChange,
    },
    playback,
    ffmpeg,
    recordingElapsed,
    playbackFrame,
    restoreGnmState,
    restoreNeutralFrame: calibration.restoreNeutralFrame,
    setSettings,
    updateSetting,
    openExportWorkspace: () => setActiveWorkspace("export"),
    scheduleTrackerHealthCheck: tracker.scheduleHealthCheck,
    showSaveResult,
    onToast: pushToast,
    onError: setDeviceError,
  });
  const { recording, output, exporter } = take;
  const {
    state: recordingState, frames: recordedFrames, finalizing: captureFinalizing,
    appearance: recordedAppearance,
  } = recording;
  const { popoutState } = output;
  const {
    motionVideoRendering, pngSequenceRendering, exportTrimStartMs, exportTrimEndMs,
    exportPlaybackSpeed,
  } = exporter;
  recordingStateGetterAdapterRef.current = recording.getState;
  recordingFinalizingGetterAdapterRef.current = () => recording.finalizing;
  recordedAppearanceGetterAdapterRef.current = recording.getAppearance;
  recordedFramesGetterAdapterRef.current = () => recording.frames;
  exportEditAdapterRef.current = {
    trimStartMs: exportTrimStartMs,
    trimEndMs: exportTrimEndMs,
    playbackSpeed: exportPlaybackSpeed,
  };
  exportBusyAdapterRef.current = () => motionVideoRendering || pngSequenceRendering;
  const studioControls = useStudioControls({
    capturePaused,
    calibrating,
    captureFinalizing,
    cameraReady: cameraAccess === "ready",
    microphoneReady: microphoneAccess === "ready",
    recordingState,
    hasRecordedFrames: recordedFrames.length > 0,
    setCapturePaused: captureDevices.setPaused,
    setRecordingPaused: recording.setPaused,
    togglePlayback: playback.toggle,
    setActivePanel,
    setActiveWorkspace,
    onToast: pushToast,
  });
  const derived = useStudioDerivedState({
    settings,
    trackerStatus,
    trackingFrame,
    neutralFrame,
    playbackFrame,
    recordedFrames,
    recordingElapsed,
    workspace: activeWorkspace,
    trimStartMs: exportTrimStartMs,
    trimEndMs: exportTrimEndMs,
    playbackSpeed: exportPlaybackSpeed,
    cameraReady: cameraAccess === "ready",
    microphoneReady: microphoneAccess === "ready",
    manualExpressions,
    setManualExpressions,
    setFrozenExpressions,
  });
  const { displayedFrame } = derived;
  const stageOutput = useStageOutputSync({
    settings,
    identityVertices,
    manualExpressions,
    frozenExpressions,
    neutralFrame,
    backgroundImageUrl,
    recordedAppearance,
    recordingState,
    captureFinalizing,
    motionVideoRendering,
    pngSequenceRendering,
    playbackFrame,
    displayedFrame,
    trackingFrame,
    capturePaused,
    resetViewSignal: stage.resetViewSignal,
    popoutState,
    getCurrentTrackingFrame,
    getCurrentViewState,
    attachVideo: captureDevices.attachVideo,
    sendSnapshot: output.sendSnapshot,
    sendFrame: output.sendFrame,
  });
  return <StudioShell
    settingsController={settingsController}
    fullscreenController={fullscreenController}
    metadata={metadata}
    captureTracking={captureTracking}
    gnm={gnm}
    take={take}
    controls={studioControls}
    derived={derived}
    stage={stage}
    stageOutput={stageOutput}
    background={background}
    ffmpeg={ffmpeg}
    saveFeedback={saveFeedback}
    notifications={notifications}
    activePanel={activePanel}
    activeWorkspace={activeWorkspace}
    manualExpressions={manualExpressions}
    frozenExpressions={frozenExpressions}
    setManualExpressions={setManualExpressions}
    setFrozenExpressions={setFrozenExpressions}
    backgroundInputRef={backgroundInputRef}
    motionInputRef={motionInputRef}
    presetInputRef={presetInputRef}
    deviceError={deviceError}
    updateSetting={updateSetting}
  />;
}

export default App;
