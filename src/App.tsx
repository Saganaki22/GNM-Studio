import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AvatarAppearancePanels } from "./features/avatar/AvatarAppearancePanels";
import { AvatarModelPanel } from "./features/avatar/AvatarModelPanel";
import { useBackgroundImage } from "./features/background/useBackgroundImage";
import { CaptureSidebarContent } from "./features/devices/CaptureSidebarContent";
import { SettingsPopover } from "./features/settings/SettingsPopover";
import { useStudioSettings } from "./features/settings/useStudioSettings";
import { RightSidebar } from "./features/stage/RightSidebar";
import { StudioViewport } from "./features/stage/StudioViewport";
import { useStagePresentation } from "./features/stage/useStagePresentation";
import { DeviceAccessPrompt } from "./features/devices/DeviceAccessPrompt";
import { useCaptureDevices } from "./features/capture/useCaptureDevices";
import { ExpressionPanel } from "./features/expression/ExpressionPanel";
import { useFullscreenControls } from "./features/fullscreen/useFullscreenControls";
import { useGnmRuntime } from "./features/gnm/useGnmRuntime";
import { IdentityPanel } from "./features/identity/IdentityPanel";
import { PresetPanel } from "./features/presets/PresetPanel";
import { usePresets } from "./features/presets/usePresets";
import { useOutputPopout } from "./features/output/useOutputPopout";
import { TransportDock } from "./features/recording/TransportDock";
import { usePlayback } from "./features/recording/usePlayback";
import { useRecordingSession } from "./features/recording/useRecordingSession";
import { useFfmpegEncoder } from "./features/export/useFfmpegEncoder";
import { useSaveFeedback } from "./features/export/useSaveFeedback";
import { useStudioExport } from "./features/export/useStudioExport";
import { LeftSidebar } from "./features/shell/LeftSidebar";
import { StudioFileInputs } from "./features/shell/StudioFileInputs";
import { StudioTopBar } from "./features/shell/StudioTopBar";
import { BackendMenu } from "./features/tracking/BackendMenu";
import { useFaceTracker } from "./features/tracking/useFaceTracker";
import { useNeutralCalibration } from "./features/tracking/useNeutralCalibration";
import { useToasts } from "./features/toasts/useToasts";
import { ToastCenter } from "./components/ToastCenter";
import { avatarProfiles, facecapInfluences } from "./lib/avatarProfiles";
import type { MainToOutputCommand, OutputSnapshot } from "./lib/outputChannel";
import { semanticInfluences } from "./lib/retarget";
import {
  captureRecordedTakeSnapshot, recordingAppearanceSettingKeys,
} from "./lib/recordingAppearance";
import type {
  AppSettings,
  RecordedFrame, RecordedTakeSnapshot, TrackingBackend, TrackingFrame,
} from "./types";
import { trimAndRetimeMotion } from "./lib/motionEdit";
import { applyNeutralBaseline, estimateTrackingQuality } from "./lib/trackingFrames";
import { isDesktopRuntime, isWebEdition, manualJointGroups, type Workspace } from "./app/studioConfig";
import "./App.css";

type OutputStartCommand = Omit<Extract<MainToOutputCommand, { type: "record"; action: "start" }>, "type" | "action">;
type OutputRecordingBridge = {
  isActive(): boolean;
  begin(command: OutputStartCommand): Promise<void>;
  pause(paused: boolean): void;
  stop(): void;
};

function App() {
  const [gnmInfo, setGnmInfo] = useState<{ vertices: number; identityDimensions: number; expressionDimensions: number } | null>(null);
  const [manualExpressions, setManualExpressions] = useState<Record<string, number>>({});
  const [frozenExpressions, setFrozenExpressions] = useState<Record<string, number>>({});
  const {
    settings, setSettings, settingsOpen, setSettingsOpen, theme, setTheme, accent, setAccent,
    uiScale, setUiScale, leftSidebarCollapsed, setLeftSidebarCollapsed,
    rightSidebarCollapsed, setRightSidebarCollapsed,
  } = useStudioSettings();
  const [deviceError, setDeviceError] = useState("");
  const stage = useStagePresentation(setDeviceError);
  const {
    size: stageSize, forcedViewState, resetViewSignal, setForcedViewState,
    resetView, handleCanvas: handleCompositeCanvas, handleResize: handleViewportResize,
    handleViewState: handleViewStateChange, handleError: handleStageError,
    getCanvas: getStageCanvas, getCurrentViewState,
  } = stage;
  const [activePanel, setActivePanel] = useState<"avatar" | "capture">(isWebEdition ? "capture" : "avatar");
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>(isWebEdition ? "capture" : "create");
  const { fullscreen, controlsHidden: outputControlsHidden, scheduleControls: scheduleOutputControls, toggle: toggleFullscreen } = useFullscreenControls(settings, setDeviceError);
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);
  const { toasts, pushToast, dismissToast } = useToasts();
  const recordingStateGetterAdapterRef = useRef<() => "idle" | "recording" | "paused">(() => "idle");
  const isRecordingIdle = useCallback(() => recordingStateGetterAdapterRef.current() === "idle", []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resolveCaptureDeviceSelection = useCallback((cameraOptions: { id: string }[], microphoneOptions: { id: string }[]) => {
    setSettings((current) => ({
      ...current,
      cameraId: cameraOptions.some((device) => device.id === current.cameraId)
        ? current.cameraId : cameraOptions[0]?.id ?? "",
      microphoneId: microphoneOptions.some((device) => device.id === current.microphoneId)
        ? current.microphoneId : microphoneOptions[0]?.id ?? "",
    }));
  }, [setSettings]);
  const captureDevices = useCaptureDevices({
    videoRef,
    cameraId: settings.cameraId,
    microphoneId: settings.microphoneId,
    cameraFps: settings.cameraFps,
    muted: settings.muted,
    resolveSelection: resolveCaptureDeviceSelection,
    onToast: pushToast,
    onError: setDeviceError,
  });
  const {
    cameras, microphones, permissionState, cameraAccess, microphoneAccess, devicePromptDismissed,
    paused: capturePaused, monitoring, audioLevel, audioPeak,
  } = captureDevices;
  const { identity, expression, restoreState: restoreGnmState } = useGnmRuntime({
    avatarKind: settings.avatarKind,
    isRecordingIdle,
    onToast: pushToast,
    onError: setDeviceError,
  });
  const {
    seed: identitySeed, presentation: identityGender, population: identityEthnicity,
    presentationStrength: identityPresentationStrength, populationWeights: identityPopulationWeights,
    vertices: identityVertices, weights: identityWeights, status: identityStatus,
    webBackend: webIdentityBackend,
  } = identity;
  const {
    ready: expressionDecoderReady, status: gnmExpressionStatus, weights: gnmExpressionWeights,
    frozen: gnmFrozenExpressionComponents, semanticA: gnmExpressionA, semanticB: gnmExpressionB,
    seedA: gnmExpressionSeedA, seedB: gnmExpressionSeedB, blend: gnmExpressionBlend,
  } = expression;
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const motionInputRef = useRef<HTMLInputElement>(null);
  const presetInputRef = useRef<HTMLInputElement>(null);
  const capturePausedRef = useRef(capturePaused);
  const neutralFrameGetterAdapterRef = useRef<() => TrackingFrame | null>(() => null);
  const playbackLandmarkGetterAdapterRef = useRef<() => { x: number; y: number; z: number }[]>(() => []);
  const recordingFinalizingGetterAdapterRef = useRef<() => boolean>(() => false);
  const recordedAppearanceGetterAdapterRef = useRef<() => RecordedTakeSnapshot | null>(() => null);
  const recordedFramesGetterAdapterRef = useRef<() => RecordedFrame[]>(() => []);
  const exportEditAdapterRef = useRef({ trimStartMs: 0, trimEndMs: 0, playbackSpeed: 1 });
  const exportBusyAdapterRef = useRef<() => boolean>(() => false);
  const outputRecordingAdapterRef = useRef<OutputRecordingBridge>({
    isActive: () => false,
    begin: (_command) => Promise.reject<void>(new Error("The output controller is not ready.")),
    pause: (_paused) => {},
    stop: () => {},
  });

  capturePausedRef.current = capturePaused;

  const getPlaybackFrames = useCallback(() => {
    const currentFrames = recordedFramesGetterAdapterRef.current();
    const edit = exportEditAdapterRef.current;
    return activeWorkspace === "export"
      ? trimAndRetimeMotion(
        currentFrames,
        edit.trimStartMs,
        edit.trimEndMs || (currentFrames.at(-1)?.timestamp ?? 0),
        edit.playbackSpeed,
        settings.exportFps,
      )
      : currentFrames;
  }, [activeWorkspace, settings.exportFps]);
  const getPlaybackLandmarks = useCallback(() => playbackLandmarkGetterAdapterRef.current(), []);
  const playback = usePlayback({
    isRecordingIdle,
    cameraReady: cameraAccess === "ready",
    getFrames: getPlaybackFrames,
    getLandmarks: getPlaybackLandmarks,
    onToast: pushToast,
  });
  const { playing, frame: playbackFrame, elapsed: recordingElapsed } = playback;
  const prepareTrackerReload = playback.resetSilently;
  const changeTrackingBackend = useCallback((backend: TrackingBackend) => {
    setSettings((current) => ({ ...current, trackingBackend: backend }));
  }, [setSettings]);
  const getNeutralFrameForTracking = useCallback(() => neutralFrameGetterAdapterRef.current(), []);
  const tracker = useFaceTracker({
    cameraReady: cameraAccess === "ready",
    videoRef,
    paused: capturePaused,
    backend: settings.trackingBackend,
    fps: settings.trackingFps,
    trackingSmoothing: settings.trackingSmoothingEnabled ? settings.trackingSmoothing : 0,
    motionSmoothing: settings.motionSmoothingEnabled ? settings.motionSmoothing : 0,
    getNeutralFrame: getNeutralFrameForTracking,
    mouthDeadZone: settings.mouthDeadZone,
    onBackendChange: changeTrackingBackend,
    onBeforeReload: prepareTrackerReload,
    onToast: pushToast,
    onError: setDeviceError,
  });
  const {
    frame: trackingFrame, status: trackerStatus, delegate: trackerDelegate,
    fallbackReason: trackerFallbackReason, gpuProbe, cpuProbe, backendMenu,
  } = tracker;
  const getCurrentTrackingFrame = tracker.getCurrentFrame;
  const calibration = useNeutralCalibration({
    videoRef,
    stageSize,
    mirror: settings.mirror,
    cameraReady: cameraAccess === "ready",
    isRecordingIdle,
    frame: trackingFrame,
    getCurrentFrame: getCurrentTrackingFrame,
    onNeutralChanged: tracker.resetFilters,
    onToast: pushToast,
  });
  const {
    neutralFrame, calibrating, complete: calibrationComplete, countdown,
    faceAlignment: calibrationFaceAlignment, readiness: calibrationReadiness,
  } = calibration;
  neutralFrameGetterAdapterRef.current = calibration.getNeutralFrame;
  playbackLandmarkGetterAdapterRef.current = () => (
    recordedAppearanceGetterAdapterRef.current()?.neutralFrame?.landmarks ?? neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? []
  );

  useEffect(() => {
    const suppressContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", suppressContextMenu);
    return () => window.removeEventListener("contextmenu", suppressContextMenu);
  }, []);

  useEffect(() => {
    if (!deviceError) return;
    pushToast({
      type: "error",
      title: "GNM Studio needs attention",
      message: "The last operation could not be completed. Review the details below and retry.",
      detail: deviceError,
      duration: 0,
    });
  }, [deviceError, pushToast]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<{ vertices: number; identityDimensions: number; expressionDimensions: number }>("gnm_model_info"))
      .then(setGnmInfo)
      .catch((error) => setDeviceError(`GNM runtime: ${String(error)}`));
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch((error) => setDeviceError(`App manifest version: ${String(error)}`));
  }, []);

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
  const { showSaveResult, openExternal } = saveFeedback;
  const { status: ffmpegStatus, version: ffmpegVersion } = ffmpeg;

  const { backgroundImageUrl, backgroundImageName, chooseBackgroundImage, clearBackgroundImage, adoptBackgroundImageUrl } = useBackgroundImage({
    getRetainedUrl: () => recordedAppearanceGetterAdapterRef.current()?.backgroundImageUrl ?? null,
    setImageMode: () => updateSetting("backgroundMode", "image"),
    setStudioMode: () => updateSetting("backgroundMode", "studio"),
    onSuccess: (title, message) => pushToast({ type: "success", title, message }),
    onInfo: (title, message) => pushToast({ type: "info", title, message }),
    onError: setDeviceError,
  });

  const recording = useRecordingSession({
    settings,
    trackingFrame,
    neutralFrame,
    capturePaused,
    microphoneReady: microphoneAccess === "ready",
    backgroundImageUrl,
    getCanvas: getStageCanvas,
    cloneAudioTrack: captureDevices.cloneAudioTrack,
    captureAppearance: () => captureRecordedTakeSnapshot({
      settings,
      identityVertices,
      identityParameters: {
        seed: identitySeed,
        presentation: identityGender,
        population: identityEthnicity,
        presentationStrength: identityPresentationStrength,
        populationWeights: identityPopulationWeights,
      },
      identityWeights,
      gnmExpressionWeights,
      gnmFrozenExpressionComponents,
      manualExpressions,
      frozenExpressions,
      neutralFrame,
      viewState: getCurrentViewState(),
      backgroundImageUrl,
    }),
    createImportedAppearance: (motion) => captureRecordedTakeSnapshot({
      settings: {
        ...settings,
        avatarKind: motion.avatarKind ?? settings.avatarKind,
        exportFps: motion.fps,
      },
      identityVertices,
      identityParameters: {
        seed: identitySeed,
        presentation: identityGender,
        population: identityEthnicity,
        presentationStrength: identityPresentationStrength,
        populationWeights: identityPopulationWeights,
      },
      identityWeights,
      gnmExpressionWeights,
      gnmFrozenExpressionComponents,
      manualExpressions: motion.manualExpressions,
      frozenExpressions: motion.frozenExpressions,
      neutralFrame: motion.neutral,
      viewState: motion.viewState,
      backgroundImageUrl,
    }),
    applyImportedAppearance: (importedAppearance) => {
      calibration.restoreNeutralFrame(importedAppearance.neutralFrame);
      updateSetting("avatarKind", importedAppearance.settings.avatarKind);
      setManualExpressions(importedAppearance.manualExpressions);
      setFrozenExpressions(importedAppearance.frozenExpressions);
      restoreGnmState(importedAppearance);
    },
    output: {
      isActive: () => outputRecordingAdapterRef.current.isActive(),
      begin: (command) => outputRecordingAdapterRef.current.begin(command),
      pause: (paused) => outputRecordingAdapterRef.current.pause(paused),
      stop: () => outputRecordingAdapterRef.current.stop(),
    },
    playback: {
      reset: playback.resetSilently,
      setElapsed: playback.setElapsed,
      showFrame: playback.showRecordedFrame,
    },
    openExportWorkspace: () => setActiveWorkspace("export"),
    onImportedFps: (fps) => updateSetting("exportFps", fps),
    onToast: pushToast,
    onError: setDeviceError,
  });
  const {
    state: recordingState,
    frames: recordedFrames,
    lastVideo,
    lastAudio,
    finalizing: captureFinalizing,
    appearance: recordedAppearance,
    viewState: recordedViewState,
    videoQuality: lastVideoQuality,
  } = recording;
  recordingStateGetterAdapterRef.current = recording.getState;
  recordingFinalizingGetterAdapterRef.current = () => recording.finalizing;
  recordedAppearanceGetterAdapterRef.current = recording.getAppearance;
  recordedFramesGetterAdapterRef.current = () => recording.frames;

  const output = useOutputPopout({
    isRecordingActive: () => recording.getState() !== "idle",
    onRecordingInterrupted: recording.interruptOutput,
    onRecordResult: recording.acceptOutputVideo,
    onRecordError: recording.finishOutputError,
    onViewState: handleViewStateChange,
    onAvatarMotion: recording.storeAvatarMotion,
    onToast: pushToast,
    onError: setDeviceError,
  });
  const { ownerPhase: outputOwnerPhase, popoutState } = output;
  const sendOutputSnapshot = output.sendSnapshot;
  const sendOutputFrame = output.sendFrame;
  outputRecordingAdapterRef.current = {
    isActive: () => output.popoutState === "active",
    begin: output.beginRecording,
    pause: output.pauseRecording,
    stop: output.stopRecording,
  };

  const exporter = useStudioExport({
    settings,
    recordedFrames,
    recordedViewState,
    lastVideo,
    lastAudio,
    lastVideoQuality,
    captureFinalizing,
    manualExpressions,
    frozenExpressions,
    neutralFrame,
    trackingFrame,
    identityVertices,
    playbackFrame,
    recordingElapsed,
    outputOwnerPhase,
    popoutState,
    recording,
    playback,
    output,
    ffmpeg,
    getCanvas: getStageCanvas,
    getCurrentViewState,
    setForcedViewState,
    showSaveResult,
    pushToast,
    setDeviceError,
    scheduleTrackerHealthCheck: tracker.scheduleHealthCheck,
  });
  const {
    videoExportProgress, videoExportBackend, motionVideoRendering, pngSequenceRendering,
    pngExportProgress, exportTrimStartMs, exportTrimEndMs,
    exportPlaybackSpeed, setExportTrimStartMs, setExportTrimEndMs, setExportPlaybackSpeed,
    exportMotion, captureStill, exportWebm, exportPngSequence, exportVideo, exportWebmSource, exportGlb,
  } = exporter;
  exportEditAdapterRef.current = {
    trimStartMs: exportTrimStartMs,
    trimEndMs: exportTrimEndMs,
    playbackSpeed: exportPlaybackSpeed,
  };
  exportBusyAdapterRef.current = () => motionVideoRendering || pngSequenceRendering;

  const presetController = usePresets({
    captureSnapshot: () => captureRecordedTakeSnapshot({
      settings,
      identityVertices,
      identityParameters: { seed: identitySeed, presentation: identityGender, population: identityEthnicity, presentationStrength: identityPresentationStrength, populationWeights: identityPopulationWeights },
      identityWeights,
      gnmExpressionWeights,
      gnmFrozenExpressionComponents,
      manualExpressions,
      frozenExpressions,
      neutralFrame,
      viewState: getCurrentViewState(),
      backgroundImageUrl,
    }),
    applySnapshot: (snapshot) => {
      setSettings(snapshot.settings);
      restoreGnmState(snapshot);
      setManualExpressions({ ...snapshot.manualExpressions });
      setFrozenExpressions({ ...snapshot.frozenExpressions });
      calibration.restoreNeutralFrame(snapshot.neutralFrame);
      setForcedViewState(snapshot.viewState);
      if (snapshot.backgroundImageUrl) adoptBackgroundImageUrl(snapshot.backgroundImageUrl);
    },
    onToast: pushToast,
    onError: setDeviceError,
    onSaved: (result, count) => showSaveResult("Preset bundle exported", `${count} named full-state preset${count === 1 ? "" : "s"}`, result),
  });
  const { presets: fullStatePresets, selectedId: selectedPresetId, name: presetName } = presetController;

  const setCaptureProcessingPaused = (paused: boolean, synchronizeRecording: boolean) => {
    if (calibrating || captureFinalizing) return;
    if (synchronizeRecording && recordingState !== "idle") {
      recording.setPaused(paused);
    }
    capturePausedRef.current = paused;
    captureDevices.setPaused(paused);
    pushToast({
      type: paused ? "warning" : "success",
      title: paused ? "Capture paused" : "Capture resumed",
      message: paused
        ? `Face tracking and microphone processing are paused. The avatar will hold its last tracked pose${synchronizeRecording && recordingState !== "idle" ? " and the active take timeline is paused" : ""}.`
        : `Face tracking and microphone processing have resumed on the selected devices${synchronizeRecording && recordingState !== "idle" ? " with the active take" : ""}.`,
    });
  };

  const toggleCaptureProcessing = () => {
    setCaptureProcessingPaused(!capturePausedRef.current, recordingState !== "idle");
  };

  useEffect(() => {
    const toggleFromKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key.toLowerCase() !== "p") return;
      if (calibrating || captureFinalizing || (cameraAccess !== "ready" && microphoneAccess !== "ready")) return;
      event.preventDefault();
      toggleCaptureProcessing();
    };
    window.addEventListener("keydown", toggleFromKeyboard);
    return () => window.removeEventListener("keydown", toggleFromKeyboard);
  });

  const activateWorkspace = (workspace: Workspace) => {
    setActiveWorkspace(workspace);
    if (workspace === "capture") setActivePanel("capture");
    if (workspace === "create" || workspace === "edit") setActivePanel("avatar");
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-workspace-target="${workspace}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      target?.classList.remove("workspace-highlight");
      requestAnimationFrame(() => target?.classList.add("workspace-highlight"));
      if (workspace === "export") {
        target?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus({ preventScroll: true });
      }
    }, 0);
  };

  const togglePause = () => {
    if (recordingState === "recording") {
      setCaptureProcessingPaused(true, true);
    } else if (recordingState === "paused") {
      setCaptureProcessingPaused(false, true);
    } else if (recordedFrames.length) playback.toggle();
  };

  const faceConfidence = useMemo(() => estimateTrackingQuality(trackingFrame), [trackingFrame]);
  const trackingQualityLabel = trackerStatus === "error"
    ? "Needs retry"
    : trackerStatus === "loading"
      ? "Starting"
      : !trackingFrame
        ? "No face"
        : faceConfidence >= 90
          ? "Excellent"
          : faceConfidence >= 76
            ? "Good"
            : faceConfidence >= 58
              ? "Fair"
              : "Weak";
  const recordedDuration = recordedFrames.at(-1)?.timestamp ?? 0;
  const editedPreviewDuration = Math.max(0, (Math.min(recordedDuration, exportTrimEndMs || recordedDuration) - Math.min(recordedDuration, exportTrimStartMs)) / exportPlaybackSpeed);
  const playbackDuration = activeWorkspace === "export" && recordedFrames.length ? editedPreviewDuration : recordedDuration;
  const timelineDuration = recordedFrames.length
    ? Math.max(1, playbackDuration)
    : Math.max(10_000, recordingElapsed);
  const timelinePosition = Math.min(timelineDuration, Math.max(0, recordingElapsed));
  const timelinePercent = Math.min(100, Math.max(0, (timelinePosition / timelineDuration) * 100));
  const connectedCaptureCount = Number(cameraAccess === "ready") + Number(microphoneAccess === "ready");
  const captureStatusTitle = `Camera: ${cameraAccess === "ready" ? "ready" : "not connected"}. Microphone: ${microphoneAccess === "ready" ? "ready" : "not connected"}. Right-click to choose the tracking backend.`;
  const displayedFrame = playbackFrame ?? applyNeutralBaseline(trackingFrame, neutralFrame);
  const displayedFrameRef = useRef<TrackingFrame | null>(displayedFrame);
  displayedFrameRef.current = displayedFrame;
  const liveSemantic = useMemo(
    () => semanticInfluences(Object.fromEntries((displayedFrame?.blendshapes ?? []).map(({ name, score }) => [name, score]))),
    [displayedFrame],
  );
  const liveFacecap = useMemo(
    () => facecapInfluences(Object.fromEntries((displayedFrame?.blendshapes ?? []).map(({ name, score }) => [name, score]))),
    [displayedFrame],
  );
  const activeProfile = avatarProfiles[settings.avatarKind];
  const activeLiveExpressions: Record<string, number> = settings.avatarKind === "facecap"
    ? liveFacecap
    : { ...liveSemantic, jaw_open: displayedFrame?.mouthOpen ?? 0 };
  const toggleExpressionFreeze = (name: string) => {
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
  };

  const resetActiveExpressions = () => {
    const activeNames = new Set(activeProfile.expressionNames);
    setManualExpressions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !activeNames.has(name))));
    setFrozenExpressions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !activeNames.has(name))));
  };

  const recordedAppearanceActive = Boolean(
    recordedAppearance && (recordingState !== "idle" || captureFinalizing || motionVideoRendering || pngSequenceRendering || playbackFrame),
  );
  const stageAppearance = recordedAppearanceActive ? recordedAppearance : null;
  const stageSettings = stageAppearance?.settings ?? settings;
  const stageIdentityVertices = stageAppearance?.identityVertices ?? identityVertices;
  const stageManualExpressions = stageAppearance?.manualExpressions ?? manualExpressions;
  const stageFrozenExpressions = stageAppearance?.frozenExpressions ?? frozenExpressions;
  const stageNeutralFrame = stageAppearance?.neutralFrame ?? neutralFrame;
  const stageBackgroundImageUrl = stageAppearance?.backgroundImageUrl ?? backgroundImageUrl;
  useEffect(() => {
    captureDevices.attachVideo();
  }, [captureDevices, popoutState]);

  useEffect(() => {
    if (popoutState !== "active") return;
    const snapshot: OutputSnapshot = {
      settings: stageSettings,
      frame: displayedFrameRef.current,
      neutralFrame: stageNeutralFrame,
      identityVertices: stageIdentityVertices,
      manualExpressions: stageManualExpressions,
      frozenExpressions: stageFrozenExpressions,
      trackingReady: Boolean(getCurrentTrackingFrame()),
      capturePaused,
      recordingActive: motionVideoRendering || pngSequenceRendering || recordingState !== "idle",
      resetViewSignal,
      backgroundImageUrl: stageBackgroundImageUrl,
      viewState: stageAppearance?.viewState ?? getCurrentViewState(),
    };
    sendOutputSnapshot(snapshot);
  }, [captureFinalizing, capturePaused, getCurrentTrackingFrame, getCurrentViewState, motionVideoRendering, pngSequenceRendering, popoutState, recordingState, resetViewSignal, sendOutputSnapshot, stageAppearance, stageBackgroundImageUrl, stageFrozenExpressions, stageIdentityVertices, stageManualExpressions, stageNeutralFrame, stageSettings]);

  useEffect(() => {
    if (popoutState !== "active") return;
    sendOutputFrame(displayedFrame, Boolean(trackingFrame));
  }, [displayedFrame, popoutState, sendOutputFrame, trackingFrame]);

  return (
    <>
    <main
      className={`app-shell ${isWebEdition ? "web-edition" : "desktop-edition"} ${leftSidebarCollapsed ? "left-sidebar-collapsed" : ""} ${rightSidebarCollapsed ? "right-sidebar-collapsed" : ""} ${recordingState === "recording" ? "is-recording" : ""} ${fullscreen ? "viewport-focus" : ""} ${outputControlsHidden ? "output-controls-hidden" : ""}`}
      style={{ "--ui-scale": (uiScale / 100).toFixed(2) } as React.CSSProperties}
      onPointerMove={fullscreen ? scheduleOutputControls : undefined}
    >
      <StudioTopBar
        web={isWebEdition}
        workspace={activeWorkspace}
        activateWorkspace={activateWorkspace}
        capture={{ paused: capturePaused, calibrating, finalizing: captureFinalizing, cameraAccess, microphoneAccess, statusTitle: captureStatusTitle, connectedCount: connectedCaptureCount, toggle: toggleCaptureProcessing }}
        backend={{ menuOpen: Boolean(backendMenu), trackerStatus, delegate: trackerDelegate, openMenu: (x, y) => { setSettingsOpen(false); tracker.openBackendMenu(x, y); } }}
        recording={{ state: recordingState, elapsed: recordingElapsed }}
        settings={{ open: settingsOpen, toggle: () => setSettingsOpen((value) => !value) }}
      />

      <LeftSidebar
        collapsed={leftSidebarCollapsed}
        activePanel={activePanel}
        toggleCollapsed={() => setLeftSidebarCollapsed((value) => !value)}
        showAvatar={() => { setActivePanel("avatar"); setActiveWorkspace("create"); }}
        showCapture={() => { setActivePanel("capture"); setActiveWorkspace("capture"); }}
        avatarContent={<>
          <AvatarModelPanel avatarKind={settings.avatarKind} gnmInfo={gnmInfo} select={(avatarKind) => { updateSetting("avatarKind", avatarKind); pushToast({ type: "info", title: `${avatarProfiles[avatarKind].label} selected`, message: avatarKind === "facecap" ? "MediaPipe now drives all 52 FaceCap morph targets directly." : "GNM semantic deformation and seeded desktop identities are active." }); }} />
          {activeProfile.supportsIdentity && <IdentityPanel seed={identitySeed} presentation={identityGender} population={identityEthnicity} presentationStrength={identityPresentationStrength} populationWeights={identityPopulationWeights} status={identityStatus} recordingIdle={recordingState === "idle"} web={isWebEdition} webBackend={webIdentityBackend} setSeed={identity.setSeed} setPresentation={identity.choosePresentation} setPopulation={identity.choosePopulation} setPresentationStrength={identity.setPresentationStrength} setPopulationWeight={identity.updatePopulationWeight} randomize={identity.randomize} comparePresentation={identity.comparePresentation} generate={() => void identity.generate()} />}
          <PresetPanel presets={fullStatePresets} selectedId={selectedPresetId} name={presetName} recordingIdle={recordingState === "idle"} inputRef={presetInputRef} select={presetController.select} setName={presetController.setName} save={presetController.save} load={presetController.load} update={presetController.update} rename={presetController.rename} remove={presetController.remove} exportBundle={() => void presetController.exportBundle()} />
          <AvatarAppearancePanels settings={settings} updateSetting={updateSetting} />
          <ExpressionPanel avatarKind={settings.avatarKind} avatarLabel={activeProfile.shortLabel} expressionCount={activeProfile.expressionCount} manual={manualExpressions} frozen={frozenExpressions} disabled={recordingState !== "idle" || captureFinalizing} setManual={(name, value) => setManualExpressions((current) => ({ ...current, [name]: value }))} toggleFreeze={toggleExpressionFreeze} resetExpressions={resetActiveExpressions} resetJoints={() => { const names = new Set<string>(manualJointGroups.flatMap((group) => group.controls.map(([name]) => name))); setManualExpressions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !names.has(name)))); setFrozenExpressions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !names.has(name)))); }} gnm={{ semanticA: gnmExpressionA, semanticB: gnmExpressionB, seedA: gnmExpressionSeedA, seedB: gnmExpressionSeedB, blend: gnmExpressionBlend, weights: gnmExpressionWeights, frozen: gnmFrozenExpressionComponents, ready: expressionDecoderReady, busy: gnmExpressionStatus === "evaluating", backend: isDesktopRuntime ? "Native Rust" : webIdentityBackend === "webgpu" ? "WebGPU worker" : "CPU worker", setSemanticA: expression.setSemanticA, setSemanticB: expression.setSemanticB, setSeedA: expression.setSeedA, setSeedB: expression.setSeedB, resampleA: expression.resampleA, resampleB: expression.resampleB, setBlend: expression.setBlend, setWeight: expression.setWeight, toggleFreeze: expression.toggleFreeze, mirror: expression.mirror, reset: expression.reset }} />
        </>}
        captureContent={<CaptureSidebarContent web={isWebEdition} settings={settings} cameras={cameras} cameraReady={cameraAccess === "ready"} permissionAsking={permissionState === "asking"} ffmpegStatus={ffmpegStatus} ffmpegVersion={ffmpegVersion} updateSetting={updateSetting} enumerateDevices={() => void captureDevices.enumerateDevices()} requestAccess={() => void captureDevices.requestAccess()} checkFfmpeg={() => void ffmpeg.check()} chooseFfmpeg={() => void ffmpeg.choose()} openFfmpegDownload={() => void openExternal("https://ffmpeg.org/download.html")} />}
      />
      <StudioViewport
        workspace={activeWorkspace}
        settings={settings}
        updateSetting={updateSetting}
        calibrating={calibrating}
        exportBusy={videoExportProgress !== null}
        pngBusy={pngSequenceRendering}
        fullscreen={fullscreen}
        popout={{ state: popoutState, recordingIdle: recordingState === "idle", open: () => void output.open(activeProfile.label), close: output.close, focus: output.focus }}
        captureStill={() => void captureStill()}
        resetView={resetView}
        toggleFullscreen={() => void toggleFullscreen()}
        stageProps={{
          avatarKind: stageSettings.avatarKind,
          videoRef,
          frame: displayedFrame,
          neutralFrame: stageNeutralFrame,
          showWebcam: calibrating || stageSettings.showWebcam,
          showAvatar: !calibrating && (motionVideoRendering || pngSequenceRendering || stageSettings.showAvatar),
          showLandmarks: !calibrating && stageSettings.showLandmarks,
          mirror: stageSettings.mirror,
          opacity: stageSettings.avatarOpacity,
          wireframe: stageSettings.wireframe,
          skinTextureEnabled: stageSettings.skinTextureEnabled,
          skinTone: stageSettings.skinTone,
          skinTextureScale: stageSettings.skinTextureScale,
          skinTextureRotation: stageSettings.skinTextureRotation,
          skinTextureFeather: stageSettings.skinTextureFeather,
          eyeShaderEnabled: stageSettings.eyeShaderEnabled,
          eyeColor: stageSettings.eyeColor,
          backgroundMode: stageSettings.backgroundMode,
          backgroundColor: stageSettings.backgroundColor,
          backgroundImageUrl: stageBackgroundImageUrl,
          backgroundImageZoom: stageSettings.backgroundImageZoom,
          mouseLightEnabled: stageSettings.mouseLightEnabled,
          mouseLightIntensity: stageSettings.mouseLightIntensity,
          headPoseSettings: { enabled: stageSettings.headRotationEnabled, yawStrength: stageSettings.headYawStrength, pitchStrength: stageSettings.headPitchStrength, rollStrength: stageSettings.headRollStrength, deadZone: stageSettings.headRotationDeadZone, smoothing: stageSettings.headRotationSmoothing },
          calibrating,
          calibrationComplete,
          faceAlignment: calibrationFaceAlignment,
          countdown,
          trackingReady: Boolean(trackingFrame),
          identityVertices: stageIdentityVertices,
          manualExpressions: stageManualExpressions,
          frozenExpressions: stageFrozenExpressions,
          recordingMode: motionVideoRendering || pngSequenceRendering ? "avatar" : stageSettings.recordingMode,
          recordingActive: motionVideoRendering || pngSequenceRendering || recordingState !== "idle",
          resetViewSignal,
          viewStateOverride: forcedViewState,
          onCancelCalibration: calibration.cancel,
          onCompositeCanvas: handleCompositeCanvas,
          onStageError: handleStageError,
          onViewportResize: handleViewportResize,
          onViewStateChange: handleViewStateChange,
          onAvatarMotion: recording.storeAvatarMotion,
        }}
        exportProps={{
          hasTake: recordedFrames.length > 0,
          hasVideo: Boolean(lastVideo),
          durationMs: recordedDuration,
          frameCount: recordedFrames.length,
          width: settings.exportWidth,
          height: settings.exportHeight,
          fps: settings.exportFps,
          trimStartMs: exportTrimStartMs,
          trimEndMs: exportTrimEndMs || recordedDuration,
          speed: exportPlaybackSpeed,
          busy: captureFinalizing || videoExportProgress !== null || pngSequenceRendering,
          progress: pngExportProgress ?? videoExportProgress,
          onWidthChange: (value) => updateSetting("exportWidth", Math.min(7680, Math.max(64, Math.round(value / 2) * 2))),
          onHeightChange: (value) => updateSetting("exportHeight", Math.min(4320, Math.max(64, Math.round(value / 2) * 2))),
          onFpsChange: (value) => updateSetting("exportFps", Math.min(120, Math.max(1, Math.round(value)))),
          onTrimStartChange: (value) => { setExportTrimStartMs(Math.min(exportTrimEndMs || recordedDuration, Math.max(0, value))); playback.setElapsed(0); playback.setFrame(null); },
          onTrimEndChange: (value) => { setExportTrimEndMs(Math.min(recordedDuration, Math.max(exportTrimStartMs, value))); playback.setElapsed(0); playback.setFrame(null); },
          onSpeedChange: (value) => { setExportPlaybackSpeed(Math.min(4, Math.max(0.1, value))); playback.setElapsed(0); playback.setFrame(null); },
          onExportMp4: () => void exportVideo(),
          onExportWebm: () => void exportWebm(),
          onExportPng: () => void exportPngSequence(),
          onReturn: () => activateWorkspace("capture"),
        }}
        accessPrompt={activeWorkspace !== "export" && permissionState !== "ready" && !devicePromptDismissed ? <DeviceAccessPrompt permissionState={permissionState} error={deviceError} requestAccess={() => void captureDevices.requestAccess()} continueWithoutCapture={captureDevices.continueWithoutCapture} /> : undefined}
      />
      <RightSidebar
        collapsed={rightSidebarCollapsed}
        toggleCollapsed={() => setRightSidebarCollapsed((value) => !value)}
        tracking={{ status: trackerStatus, score: faceConfidence, label: trackingQualityLabel, fallbackReason: trackerFallbackReason, delegate: trackerDelegate, cameraReady: cameraAccess === "ready", reload: () => tracker.reload() }}
        settings={settings}
        updateSetting={updateSetting}
        avatarLabel={activeProfile.shortLabel}
        calibrating={calibrating}
        calibration={{ neutralFrame, readiness: calibrationReadiness, recordingIdle: recordingState === "idle", trackerReady: trackerStatus === "ready", hasFrame: Boolean(trackingFrame), start: () => void calibration.calibrate() }}
        background={{ url: backgroundImageUrl, name: backgroundImageName, inputRef: backgroundInputRef, clear: () => void clearBackgroundImage() }}
      />
      <TransportDock
        audio={{ devices: microphones, selectedId: settings.microphoneId, level: audioLevel, peak: audioPeak, muted: settings.muted, monitoring, select: (id) => updateSetting("microphoneId", id), toggleMute: () => updateSetting("muted", !settings.muted), toggleMonitoring: () => captureDevices.setMonitoring((value) => !value), refresh: () => void captureDevices.enumerateDevices() }}
        recording={{ state: recordingState, elapsed: recordingElapsed, frameCount: recordedFrames.length, draftFrameCount: recording.draftFrameCount, playing, playbackActive: Boolean(playbackFrame || playing), calibrating, finalizing: captureFinalizing, videoBusy: videoExportProgress !== null, popoutStarting: popoutState === "starting", motionNeedsFace: !trackingFrame && settings.recordingMode === "motion", start: () => void recording.start(), stop: recording.stop, togglePause, returnLive: playback.returnToLive }}
        timeline={{ percent: timelinePercent, duration: timelineDuration, position: timelinePosition, recordedDuration, playbackDuration, seek: playback.seek }}
        exports={{ fps: settings.exportFps, motionInputRef, hasTake: recordedFrames.length > 0, hasVideo: Boolean(lastVideo), sourceIsWebm: Boolean(lastVideo && !lastVideo.type.includes("mp4")), videoProgress: videoExportProgress, backend: videoExportBackend, setFps: (value) => updateSetting("exportFps", value), useCurrentLook: recording.useCurrentAppearance, exportMotion: () => void exportMotion(), exportGlb: () => void exportGlb(), exportWebmSource: () => void exportWebmSource(), exportVideo: () => void exportVideo() }}
      />
      <ToastCenter
        toasts={toasts}
        onDismiss={dismissToast}
      />
      <StudioFileInputs motionRef={motionInputRef} backgroundRef={backgroundInputRef} presetRef={presetInputRef} importMotion={(file) => void recording.importMotionJson(file)} chooseBackground={(file) => void chooseBackgroundImage(file)} importPresets={(file) => void presetController.importBundle(file)} />
    </main>
    {backendMenu && createPortal(<BackendMenu position={backendMenu} backend={settings.trackingBackend} gpuProbe={gpuProbe} cpuProbe={cpuProbe} close={tracker.closeBackendMenu} select={tracker.selectBackend} />, document.body)}
    {settingsOpen && createPortal(<SettingsPopover web={isWebEdition} theme={theme} accent={accent} uiScale={uiScale} settings={settings} appVersion={appVersion} close={() => setSettingsOpen(false)} setTheme={setTheme} setAccent={setAccent} setUiScale={setUiScale} updateSetting={updateSetting} openExternal={(url) => void openExternal(url)} />, document.body)}
    </>
  );
}

export default App;
