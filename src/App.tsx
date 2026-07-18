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
import { LeftSidebar } from "./features/shell/LeftSidebar";
import { StudioFileInputs } from "./features/shell/StudioFileInputs";
import { StudioTopBar } from "./features/shell/StudioTopBar";
import { BackendMenu } from "./features/tracking/BackendMenu";
import { useFaceTracker } from "./features/tracking/useFaceTracker";
import { useNeutralCalibration } from "./features/tracking/useNeutralCalibration";
import { useToasts } from "./features/toasts/useToasts";
import { ToastCenter } from "./components/ToastCenter";
import { saveBlob, saveBytes, type SaveResult } from "./lib/save";
import { createAnimatedGlb } from "./lib/glbExport";
import { avatarProfiles, facecapInfluences } from "./lib/avatarProfiles";
import type { OutputSnapshot } from "./lib/outputChannel";
import { parseMotionFile } from "./lib/motionFile";
import { mouthOpenInfluence, semanticInfluences } from "./lib/retarget";
import type { ViewportSize } from "./lib/coverProjection";
import { inspectRecordedMedia } from "./lib/mediaInspection";
import { preferredAudioRecorderMimeType, preferredVideoRecorderMimeType, preferredWebmRecorderMimeType } from "./lib/recordingMedia";
import {
  captureRecordedTakeSnapshot, recordingAppearanceSettingKeys, serializableRecordedTakeSnapshot,
} from "./lib/recordingAppearance";
import type {
  AppSettings, AvatarMotionSample, CameraViewState,
  RecordedFrame, RecordedTakeSnapshot, TrackingBackend, TrackingFrame,
} from "./types";
import { canvasPngBlob } from "./lib/canvasCapture";
import { createStoredZip } from "./lib/zipStore";
import { trimAndRetimeMotion } from "./lib/motionEdit";
import { afterBrowserPaint, formatTime, timestampedFilename } from "./lib/studioFormat";
import { applyNeutralBaseline, estimateTrackingQuality, playbackTrackingFrame, recordedFrameAtTime } from "./lib/trackingFrames";
import { isDesktopRuntime, isWebEdition, manualJointGroups, type FfmpegProbe, type Workspace } from "./app/studioConfig";
import "./App.css";

function App() {
  const [gnmInfo, setGnmInfo] = useState<{ vertices: number; identityDimensions: number; expressionDimensions: number } | null>(null);
  const [manualExpressions, setManualExpressions] = useState<Record<string, number>>({});
  const [frozenExpressions, setFrozenExpressions] = useState<Record<string, number>>({});
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const {
    settings, setSettings, settingsOpen, setSettingsOpen, theme, setTheme, accent, setAccent,
    uiScale, setUiScale, leftSidebarCollapsed, setLeftSidebarCollapsed,
    rightSidebarCollapsed, setRightSidebarCollapsed,
  } = useStudioSettings();
  const [deviceError, setDeviceError] = useState("");
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "paused">("idle");
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [recordedFrames, setRecordedFrames] = useState<RecordedFrame[]>([]);
  const [lastVideo, setLastVideo] = useState<Blob | null>(null);
  const [lastAudio, setLastAudio] = useState<Blob | null>(null);
  const [captureFinalizing, setCaptureFinalizing] = useState(false);
  const [recordedViewState, setRecordedViewState] = useState<CameraViewState | null>(null);
  const [recordedAppearance, setRecordedAppearance] = useState<RecordedTakeSnapshot | null>(null);
  const [forcedViewState, setForcedViewState] = useState<CameraViewState | null>(null);
  const [lastVideoQuality, setLastVideoQuality] = useState({ videoBitrate: 12_000_000, audioBitrate: 192_000 });
  const [videoExportProgress, setVideoExportProgress] = useState<number | null>(null);
  const [videoExportBackend, setVideoExportBackend] = useState<"webcodecs" | "ffmpeg" | null>(null);
  const [motionVideoRendering, setMotionVideoRendering] = useState(false);
  const [pngSequenceRendering, setPngSequenceRendering] = useState(false);
  const [pngExportProgress, setPngExportProgress] = useState<number | null>(null);
  const [exportTrimStartMs, setExportTrimStartMs] = useState(0);
  const [exportTrimEndMs, setExportTrimEndMs] = useState(0);
  const [exportPlaybackSpeed, setExportPlaybackSpeed] = useState(1);
  const [ffmpegStatus, setFfmpegStatus] = useState<"unknown" | "checking" | "available" | "unavailable">("unknown");
  const [ffmpegVersion, setFfmpegVersion] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playbackFrame, setPlaybackFrame] = useState<TrackingFrame | null>(null);
  const [activePanel, setActivePanel] = useState<"avatar" | "capture">(isWebEdition ? "capture" : "avatar");
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>(isWebEdition ? "capture" : "create");
  const { fullscreen, controlsHidden: outputControlsHidden, scheduleControls: scheduleOutputControls, toggle: toggleFullscreen } = useFullscreenControls(settings, setDeviceError);
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);
  const { toasts, pushToast, dismissToast } = useToasts();
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
    recordingIdle: recordingState === "idle",
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
  const [stageSize, setStageSize] = useState<ViewportSize>({ width: 640, height: 480 });
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const motionInputRef = useRef<HTMLInputElement>(null);
  const presetInputRef = useRef<HTMLInputElement>(null);
  const capturePausedRef = useRef(capturePaused);
  const recordingFramesRef = useRef<RecordedFrame[]>([]);
  const recordedAppearanceRef = useRef<RecordedTakeSnapshot | null>(null);
  const recordingStartedAtRef = useRef(0);
  const recordingPausedAtRef = useRef<number | null>(null);
  const recordingPausedDurationRef = useRef(0);
  const latestAvatarMotionRef = useRef<{ timestamp: number; sample: AvatarMotionSample } | null>(null);
  const pendingAvatarMotionFramesRef = useRef(new Map<number, number>());
  const currentViewStateRef = useRef<CameraViewState | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const avatarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordingTickerRef = useRef<number | null>(null);
  const playbackAnimationRef = useRef<number | null>(null);
  const neutralFrameGetterAdapterRef = useRef<() => TrackingFrame | null>(() => null);

  capturePausedRef.current = capturePaused;

  const prepareTrackerReload = useCallback(() => {
    if (playbackAnimationRef.current) cancelAnimationFrame(playbackAnimationRef.current);
    playbackAnimationRef.current = null;
    setPlaying(false);
    setPlaybackFrame(null);
  }, []);
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
    recordingIdle: recordingState === "idle",
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

  const storeAvatarMotion = useCallback((sample: AvatarMotionSample, frameTimestamp: number) => {
    latestAvatarMotionRef.current = { timestamp: frameTimestamp, sample };
    const pendingFrameIndex = pendingAvatarMotionFramesRef.current.get(frameTimestamp);
    if (pendingFrameIndex !== undefined) {
      const pendingFrame = recordingFramesRef.current[pendingFrameIndex];
      if (pendingFrame) pendingFrame.avatarMotion = sample;
      pendingAvatarMotionFramesRef.current.delete(frameTimestamp);
    }
  }, []);

  const interruptOutputRecording = useCallback(() => {
    if (recordingTickerRef.current) window.clearInterval(recordingTickerRef.current);
    setRecordedFrames([...recordingFramesRef.current]);
    setRecordingState("idle");
    setCaptureFinalizing(false);
  }, []);
  const output = useOutputPopout({
    isRecordingActive: () => recordingState !== "idle",
    onRecordingInterrupted: interruptOutputRecording,
    onRecordResult: (blob) => {
      setLastVideo(blob);
      setCaptureFinalizing(false);
    },
    onRecordError: () => setCaptureFinalizing(false),
    onViewState: (viewState) => { currentViewStateRef.current = viewState; },
    onAvatarMotion: storeAvatarMotion,
    onToast: pushToast,
    onError: setDeviceError,
  });
  const { ownerPhase: outputOwnerPhase, popoutState } = output;
  const sendOutputSnapshot = output.sendSnapshot;
  const sendOutputFrame = output.sendFrame;

  useEffect(() => {
    if (!isDesktopRuntime || settings.videoEncoderBackend === "webcodecs") {
      setFfmpegStatus("unknown");
      setFfmpegVersion("");
      return;
    }
    let cancelled = false;
    setFfmpegStatus("checking");
    const timer = window.setTimeout(() => {
      import("./lib/systemFfmpeg")
        .then(({ probeSystemFfmpeg }) => probeSystemFfmpeg(settings.ffmpegPath))
        .then((probe) => {
          if (cancelled) return;
          setFfmpegStatus(probe.available ? "available" : "unavailable");
          setFfmpegVersion(probe.version ?? probe.error ?? "");
        })
        .catch((error) => {
          if (cancelled) return;
          setFfmpegStatus("unavailable");
          setFfmpegVersion(String(error));
        });
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [settings.ffmpegPath, settings.videoEncoderBackend]);

  useEffect(() => {
    const duration = recordedFrames.at(-1)?.timestamp ?? 0;
    setExportTrimStartMs(0);
    setExportTrimEndMs(duration);
    setExportPlaybackSpeed(1);
  }, [recordedFrames]);

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
    if ((recordingState !== "idle" || captureFinalizing || motionVideoRendering || pngSequenceRendering) && recordingAppearanceSettingKeys.has(key)) {
      pushToast({
        type: "warning",
        title: "Take appearance is locked",
        message: "Stop recording or wait for the offline render to finish before changing avatar, material, background, layer, or pose settings.",
      });
      return;
    }
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const { backgroundImageUrl, backgroundImageName, chooseBackgroundImage, clearBackgroundImage, adoptBackgroundImageUrl } = useBackgroundImage({
    getRetainedUrl: () => recordedAppearanceRef.current?.backgroundImageUrl ?? null,
    setImageMode: () => updateSetting("backgroundMode", "image"),
    setStudioMode: () => updateSetting("backgroundMode", "studio"),
    onSuccess: (title, message) => pushToast({ type: "success", title, message }),
    onInfo: (title, message) => pushToast({ type: "info", title, message }),
    onError: setDeviceError,
  });

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
      viewState: currentViewStateRef.current,
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
      const recordingMode = recordedAppearanceRef.current?.settings.recordingMode ?? settings.recordingMode;
      if (popoutState === "active" && recordingMode !== "motion") {
        output.pauseRecording(paused);
      } else if (mediaRecorderRef.current) {
        if (paused && mediaRecorderRef.current.state === "recording") mediaRecorderRef.current.pause();
        if (!paused && mediaRecorderRef.current.state === "paused") mediaRecorderRef.current.resume();
      }
      if (paused) {
        recordingPausedAtRef.current = performance.now();
        setRecordingState("paused");
      } else {
        const now = performance.now();
        if (recordingPausedAtRef.current !== null) {
          const pausedFor = now - recordingPausedAtRef.current;
          recordingPausedDurationRef.current += pausedFor;
        }
        recordingPausedAtRef.current = null;
        setRecordingState("recording");
      }
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

  const openExternal = async (url: string) => {
    try {
      if ("__TAURI_INTERNALS__" in window) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setDeviceError(`Open link: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const checkFfmpeg = async (path = settings.ffmpegPath, notify = true): Promise<FfmpegProbe> => {
    setFfmpegStatus("checking");
    try {
      const { probeSystemFfmpeg } = await import("./lib/systemFfmpeg");
      const probe = await probeSystemFfmpeg(path);
      setFfmpegStatus(probe.available ? "available" : "unavailable");
      setFfmpegVersion(probe.version ?? probe.error ?? "");
      if (notify) {
        pushToast(probe.available ? {
          type: "success",
          title: "System FFmpeg detected",
          message: probe.version ?? `${path} is ready for MP4 conversion.`,
        } : {
          type: "warning",
          title: "System FFmpeg was not found",
          message: "Choose ffmpeg.exe, add FFmpeg to PATH, install it from the official download page, or select WebCodecs.",
          detail: probe.error,
          duration: 9_000,
        });
      }
      return probe;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFfmpegStatus("unavailable");
      setFfmpegVersion(message);
      if (notify) pushToast({ type: "warning", title: "FFmpeg check failed", message: "The app could not inspect the configured FFmpeg executable.", detail: message, duration: 9_000 });
      return { available: false, error: message };
    }
  };

  const chooseFfmpegExecutable = async () => {
    try {
      if (!("__TAURI_INTERNALS__" in window)) throw new Error("Choosing ffmpeg.exe is available in the desktop build.");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose ffmpeg.exe",
        filters: [{ name: "FFmpeg executable", extensions: ["exe"] }],
      });
      if (typeof selected !== "string") return;
      updateSetting("ffmpegPath", selected);
      await checkFfmpeg(selected);
    } catch (error) {
      setDeviceError(`Choose FFmpeg executable: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const revealSavedFile = async (path: string) => {
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(path);
    } catch (error) {
      setDeviceError(`Show saved file: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const showSaveResult = (title: string, description: string, result: SaveResult) => {
    if (result.status === "cancelled") {
      pushToast({ type: "info", title: "Export cancelled", message: "The save dialog was closed. No file was written.", duration: 3_000 });
      return;
    }
    const location = result.path ?? "your browser Downloads folder";
    pushToast({
      type: "success",
      title,
      message: `${description} was saved to ${location}.`,
      duration: 9_000,
      action: result.path ? { label: "Show in folder", onClick: () => revealSavedFile(result.path!) } : undefined,
    });
  };

  useEffect(() => {
    if (!trackingFrame || recordingState !== "recording") return;
    const calibratedFrame = applyNeutralBaseline(trackingFrame, neutralFrame) ?? trackingFrame;
    const latestAvatarMotion = latestAvatarMotionRef.current;
    const avatarMotion = latestAvatarMotion?.timestamp === calibratedFrame.timestamp
      ? latestAvatarMotion.sample
      : undefined;
    const captured: RecordedFrame = {
      timestamp: calibratedFrame.timestamp - recordingStartedAtRef.current - recordingPausedDurationRef.current,
      blendshapes: Object.fromEntries(calibratedFrame.blendshapes.map(({ name, score }) => [name, score])),
      matrix: calibratedFrame.matrix,
      avatarMotion,
      mouthOpen: calibratedFrame.mouthOpen ?? mouthOpenInfluence(
        Object.fromEntries(calibratedFrame.blendshapes.map(({ name, score }) => [name, score])), calibratedFrame.landmarks,
      ),
    };
    recordingFramesRef.current.push(captured);
    if (!avatarMotion) {
      pendingAvatarMotionFramesRef.current.set(calibratedFrame.timestamp, recordingFramesRef.current.length - 1);
    }
  }, [neutralFrame, recordingState, trackingFrame]);

  const startRecording = async () => {
    if (capturePausedRef.current) {
      pushToast({
        type: "warning",
        title: "Resume capture before recording",
        message: "Press the header Play button so face tracking and microphone processing are live before starting a take.",
      });
      return;
    }
    if (popoutState === "active" && settings.recordingMode !== "motion" && !settings.showAvatar) {
      pushToast({
        type: "warning",
        title: "Popout avatar layer is disabled",
        message: "The clean popout intentionally excludes webcam pixels. Enable the avatar before recording there, or bring the canvas back for a camera composite.",
      });
      return;
    }
    if (!trackingFrame && settings.recordingMode === "motion") {
      pushToast({
        type: "warning",
        title: "Tracker not ready",
        message: "Motion recording needs a detected face. Enable the camera, wait for Face linked, or choose Avatar video to record manual controls.",
      });
      return;
    }
    if (settings.recordingMode === "avatar" && !settings.showAvatar) {
      pushToast({
        type: "warning",
        title: "Avatar layer is disabled",
        message: `Avatar video mode records only enabled avatar content. Turn on the ${avatarProfiles[settings.avatarKind].shortLabel} avatar or choose Camera + avatar mode.`,
      });
      return;
    }
    if (settings.recordingMode === "composite" && !settings.showAvatar && !settings.showWebcam) {
      pushToast({
        type: "warning",
        title: "No visual layers are enabled",
        message: `Enable Webcam, the ${avatarProfiles[settings.avatarKind].shortLabel} avatar, or both before recording a composite video.`,
      });
      return;
    }
    let captureStream: MediaStream | null = null;
    let recordingIncludesAudio = false;
    try {
    if (playbackAnimationRef.current) cancelAnimationFrame(playbackAnimationRef.current);
    setPlaying(false);
    setPlaybackFrame(null);
    recordingFramesRef.current = [];
    pendingAvatarMotionFramesRef.current.clear();
    latestAvatarMotionRef.current = null;
    setRecordedFrames([]);
    setLastVideo(null);
    setLastAudio(null);
    setCaptureFinalizing(false);
    const appearance = captureRecordedTakeSnapshot({
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
      viewState: currentViewStateRef.current,
      backgroundImageUrl,
    });
    const previousBackgroundUrl = recordedAppearanceRef.current?.backgroundImageUrl;
    if (previousBackgroundUrl && previousBackgroundUrl !== backgroundImageUrl) URL.revokeObjectURL(previousBackgroundUrl);
    recordedAppearanceRef.current = appearance;
    setRecordedAppearance(appearance);
    setRecordedViewState(appearance.viewState);
    const started = performance.now();
    recordingStartedAtRef.current = started;
    recordingPausedAtRef.current = null;
    recordingPausedDurationRef.current = 0;
    setRecordingElapsed(0);

    const videoBitrate = settings.videoBitrateMbps * 1_000_000;
    const audioBitrate = settings.audioBitrateKbps * 1_000;
    setLastVideoQuality({ videoBitrate, audioBitrate });
    if (settings.recordingMode === "motion") {
      const audioTrack = captureDevices.cloneAudioTrack();
      if (audioTrack) {
        recordingIncludesAudio = true;
        const stream = new MediaStream([audioTrack]);
        captureStream = stream;
        const mimeType = preferredAudioRecorderMimeType();
        const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: audioBitrate });
        mediaChunksRef.current = [];
        recorder.ondataavailable = (event) => { if (event.data.size) mediaChunksRef.current.push(event.data); };
        recorder.onstop = async () => {
          try {
            if (!mediaChunksRef.current.length) throw new Error("The microphone recorder produced no audio data.");
            const audio = new Blob(mediaChunksRef.current, { type: recorder.mimeType || mimeType });
            const tracks = await inspectRecordedMedia(audio);
            if (!tracks.hasAudio) throw new Error("The selected browser codec omitted the microphone track.");
            setLastAudio(audio);
          } catch (audioError) {
            setDeviceError(`Motion microphone capture failed: ${audioError instanceof Error ? audioError.message : String(audioError)} The motion frames remain usable.`);
          } finally {
            stream.getTracks().forEach((track) => track.stop());
            mediaRecorderRef.current = null;
            setCaptureFinalizing(false);
          }
        };
        recorder.onerror = (event) => {
          setCaptureFinalizing(false);
          setDeviceError(`Motion microphone recorder failed: ${event.type}. Motion capture will remain available without audio.`);
        };
        recorder.start(250);
        mediaRecorderRef.current = recorder;
      } else if (!settings.muted && microphoneAccess === "ready") {
        pushToast({ type: "warning", title: "Microphone track is not ready", message: "Motion capture will continue, but this take cannot include audio. Refresh the microphone and retry if audio is required." });
      }
    } else {
      if (popoutState === "active") {
        recordingIncludesAudio = !settings.muted;
        const requestId = crypto.randomUUID?.() ?? `record-${Date.now()}`;
        await output.beginRecording({
          requestId,
          fps: settings.exportFps,
          videoBitrate,
          audioBitrate,
          useLiveMicrophone: !settings.muted,
        });
        if (settings.recordingMode === "composite") {
          pushToast({ type: "info", title: "Recording clean popout output", message: "The output window is canvas-only, so this take contains the avatar/background and microphone but not the webcam layer." });
        }
      } else {
        const canvas = avatarCanvasRef.current;
        if (!canvas) throw new Error("The rendered capture surface is not ready yet.");
        const stream = canvas.captureStream(settings.exportFps);
        captureStream = stream;
        const audioTrack = captureDevices.cloneAudioTrack();
        if (audioTrack) stream.addTrack(audioTrack);
        const expectedAudio = Boolean(audioTrack);
        recordingIncludesAudio = expectedAudio;
        const mimeType = preferredVideoRecorderMimeType(expectedAudio);
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: videoBitrate, audioBitsPerSecond: audioBitrate });
        mediaChunksRef.current = [];
        recorder.ondataavailable = (event) => { if (event.data.size) mediaChunksRef.current.push(event.data); };
        recorder.onstop = async () => {
          try {
            if (!mediaChunksRef.current.length) throw new Error("Video recorder stopped without producing media data. Try recording a slightly longer take or use a different export FPS.");
            const video = new Blob(mediaChunksRef.current, { type: recorder.mimeType || mimeType });
            const tracks = await inspectRecordedMedia(video);
            if (!tracks.hasVideo) throw new Error("The recorder output does not contain a video track.");
            if (expectedAudio && !tracks.hasAudio) {
              throw new Error("The selected recorder codec omitted the microphone track. Retry with the portable WebCodecs backend or update WebView2.");
            }
            setLastVideo(video);
          } catch (recordError) {
            setDeviceError(`Video finalization failed: ${recordError instanceof Error ? recordError.message : String(recordError)}`);
          } finally {
            stream.getTracks().forEach((track) => track.stop());
            mediaRecorderRef.current = null;
            setCaptureFinalizing(false);
          }
        };
        recorder.onerror = (event) => {
          setCaptureFinalizing(false);
          setDeviceError(`Video recorder failed: ${event.type}`);
        };
        recorder.start(250);
        mediaRecorderRef.current = recorder;
      }
    }
    setRecordingState("recording");
    recordingTickerRef.current = window.setInterval(() => {
      const now = recordingPausedAtRef.current ?? performance.now();
      setRecordingElapsed(Math.max(0, now - recordingStartedAtRef.current - recordingPausedDurationRef.current));
    }, 100);
    pushToast({
      type: "info",
      title: "Recording started",
      message: settings.recordingMode === "motion"
        ? `Capturing timestamped face, neutral-relative XYZ, scale, and head-pose controls at up to ${settings.trackingFps} FPS${recordingIncludesAudio ? " with retained microphone audio" : " without microphone audio"}.`
        : `Capturing ${settings.recordingMode === "avatar" ? "avatar" : "composite"} video at ${settings.exportFps} FPS${recordingIncludesAudio ? " with microphone audio" : " without microphone audio"}.`,
    });
    } catch (error) {
      captureStream?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      if (recordingTickerRef.current) clearInterval(recordingTickerRef.current);
      setRecordingState("idle");
      setDeviceError(`Recording setup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const seekPlayback = (requestedTime: number) => {
    if (recordingState !== "idle" || !recordedFrames.length) return;
    const playbackFrames = activeWorkspace === "export" ? editedFramesForExport() : recordedFrames;
    if (playbackAnimationRef.current) cancelAnimationFrame(playbackAnimationRef.current);
    playbackAnimationRef.current = null;
    setPlaying(false);
    const duration = playbackFrames.at(-1)?.timestamp ?? 0;
    const elapsed = Math.min(duration, Math.max(0, requestedTime));
    const recorded = recordedFrameAtTime(playbackFrames, elapsed);
    const landmarks = recordedAppearanceRef.current?.neutralFrame?.landmarks ?? neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
    setPlaybackFrame(playbackTrackingFrame(recorded, landmarks));
    setRecordingElapsed(elapsed);
  };

  const returnToLiveTracking = () => {
    if (recordingState !== "idle") return;
    if (playbackAnimationRef.current) cancelAnimationFrame(playbackAnimationRef.current);
    playbackAnimationRef.current = null;
    setPlaying(false);
    setPlaybackFrame(null);
    setRecordingElapsed(0);
    pushToast({
      type: "info",
      title: "Live tracking restored",
      message: cameraAccess === "ready"
        ? "Playback is closed and the avatar is responding to the active camera again. The recorded take is still available."
        : "Playback is closed and the avatar has returned to its live/manual state. The recorded take is still available.",
    });
  };

  const togglePause = () => {
    if (recordingState === "recording") {
      setCaptureProcessingPaused(true, true);
    } else if (recordingState === "paused") {
      setCaptureProcessingPaused(false, true);
    } else if (recordedFrames.length) {
      if (playing) {
        if (playbackAnimationRef.current) cancelAnimationFrame(playbackAnimationRef.current);
        playbackAnimationRef.current = null;
        setPlaying(false);
      } else {
        const playbackFrames = activeWorkspace === "export" ? editedFramesForExport() : recordedFrames;
        const duration = playbackFrames.at(-1)?.timestamp ?? 0;
        const resumeFrom = recordingElapsed >= duration ? 0 : Math.min(duration, Math.max(0, recordingElapsed));
        const started = performance.now() - resumeFrom;
        const landmarks = recordedAppearanceRef.current?.neutralFrame?.landmarks ?? neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
        const initialFrame = recordedFrameAtTime(playbackFrames, resumeFrom);
        setPlaybackFrame(playbackTrackingFrame(initialFrame, landmarks));
        setRecordingElapsed(resumeFrom);
        setPlaying(true);
        const tick = (now: number) => {
          const elapsed = Math.min(duration, now - started);
          const recorded = recordedFrameAtTime(playbackFrames, elapsed);
          setPlaybackFrame(playbackTrackingFrame(recorded, landmarks));
          setRecordingElapsed(elapsed);
          if (elapsed < duration) {
            playbackAnimationRef.current = requestAnimationFrame(tick);
          } else {
            setPlaying(false);
            setPlaybackFrame(null);
            playbackAnimationRef.current = null;
          }
        };
        playbackAnimationRef.current = requestAnimationFrame(tick);
      }
    }
  };

  const stopRecording = () => {
    const recordingMode = recordedAppearanceRef.current?.settings.recordingMode ?? settings.recordingMode;
    if (popoutState === "active" && recordingMode !== "motion") {
      setCaptureFinalizing(true);
      output.stopRecording();
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      setCaptureFinalizing(true);
      mediaRecorderRef.current.stop();
    } else {
      setCaptureFinalizing(false);
    }
    if (recordingTickerRef.current) clearInterval(recordingTickerRef.current);
    setRecordedFrames([...recordingFramesRef.current]);
    setRecordingElapsed(recordingFramesRef.current.at(-1)?.timestamp ?? recordingElapsed);
    setRecordingState("idle");
    pushToast({
      type: "success",
      title: "Take recorded",
      message: settings.recordingMode === "motion"
        ? `${recordingFramesRef.current.length.toLocaleString()} motion frames are ready${mediaRecorderRef.current ? "; microphone audio is finalizing" : ""}.`
        : `The ${avatarProfiles[settings.avatarKind].shortLabel} video take is finalizing and will be ready for MP4 export momentarily${recordingFramesRef.current.length ? `; ${recordingFramesRef.current.length.toLocaleString()} motion frames were also retained` : ""}.`,
    });
  };

  const importMotionJson = async (file?: File) => {
    if (!file) return;
    if (recordingState !== "idle") {
      pushToast({
        type: "warning",
        title: "Stop recording before importing",
        message: "The current recording must be stopped before another motion take can replace it.",
      });
      return;
    }
    if (file.size > 256 * 1024 * 1024) {
      setDeviceError(`Motion JSON import failed: ${file.name} is larger than the 256 MB safety limit.`);
      return;
    }
    try {
      const motion = parseMotionFile(JSON.parse(await file.text()));
      if (playbackAnimationRef.current) cancelAnimationFrame(playbackAnimationRef.current);
      playbackAnimationRef.current = null;
      setPlaying(false);
      setDeviceError("");
      const importedAppearance = motion.appearance ?? captureRecordedTakeSnapshot({
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
      });
      calibration.restoreNeutralFrame(importedAppearance.neutralFrame);
      updateSetting("avatarKind", importedAppearance.settings.avatarKind);
      setManualExpressions(importedAppearance.manualExpressions);
      setFrozenExpressions(importedAppearance.frozenExpressions);
      restoreGnmState(importedAppearance);
      const previousBackgroundUrl = recordedAppearanceRef.current?.backgroundImageUrl;
      if (previousBackgroundUrl && previousBackgroundUrl !== backgroundImageUrl) URL.revokeObjectURL(previousBackgroundUrl);
      recordedAppearanceRef.current = importedAppearance;
      setRecordedAppearance(importedAppearance);
      recordingFramesRef.current = motion.frames;
      setRecordedFrames(motion.frames);
      setLastVideo(null);
      setLastAudio(null);
      setRecordedViewState(importedAppearance.viewState);
      setRecordingElapsed(0);
      updateSetting("exportFps", importedAppearance.settings.exportFps);
      const firstFrame = motion.frames[0];
      const landmarks = importedAppearance.neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
      setPlaybackFrame(playbackTrackingFrame(firstFrame, landmarks));
      setActiveWorkspace("export");
      const duration = motion.frames.at(-1)?.timestamp ?? 0;
      pushToast({
        type: "success",
        title: "Motion JSON imported",
        message: `${motion.frames.length.toLocaleString()} frames from ${file.name} are ready to scrub, play, and export as GLB.`,
        detail: `Duration: ${formatTime(duration)} · FPS: ${motion.fps} · Neutral calibration: ${importedAppearance.neutralFrame ? "restored" : "not included"} · Appearance snapshot: ${motion.version === 2 ? "restored" : "rebuilt from current settings"}. JSON contains no MP4/WebM camera or microphone source.`,
        duration: 9_000,
      });
    } catch (error) {
      setDeviceError(`Motion JSON import failed for ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const editedFramesForExport = () => trimAndRetimeMotion(
    recordedFrames,
    exportTrimStartMs,
    exportTrimEndMs || (recordedFrames.at(-1)?.timestamp ?? 0),
    exportPlaybackSpeed,
    settings.exportFps,
  );

  const exportMotion = async () => {
    try {
      const appearance = recordedAppearanceRef.current;
      const exportSettings = appearance?.settings ?? settings;
      const serializedAppearance = appearance ? await serializableRecordedTakeSnapshot(appearance) : null;
      const payload = {
        format: "gnm-studio-motion", version: 2, fps: settings.exportFps,
        avatarKind: exportSettings.avatarKind,
        retargetProfile: avatarProfiles[exportSettings.avatarKind].label,
        manualExpressions: appearance?.manualExpressions ?? manualExpressions,
        frozenExpressions: appearance?.frozenExpressions ?? frozenExpressions,
        neutral: appearance?.neutralFrame ?? neutralFrame,
        frames: editedFramesForExport(),
        viewState: appearance?.viewState ?? recordedViewState,
        appearance: serializedAppearance,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(
        payload,
        (_key, value) => value instanceof Float32Array ? Array.from(value) : value,
        2,
      ));
      const result = await saveBytes(bytes, timestampedFilename("json", "_motion"), "application/json");
      showSaveResult("Motion export complete", "The editable JSON capture", result);
    } catch (error) {
      setDeviceError(`Motion JSON export failed: ${String(error)}`);
    } finally {
      tracker.scheduleHealthCheck("JSON export");
    }
  };

  const useCurrentAppearanceForTake = () => {
    if (!recordedFrames.length) return;
    const appearance = captureRecordedTakeSnapshot({
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
      viewState: currentViewStateRef.current,
      backgroundImageUrl,
    });
    recordedAppearanceRef.current = appearance;
    setRecordedAppearance(appearance);
    setRecordedViewState(appearance.viewState);
    pushToast({
      type: "success",
      title: "Recorded take restyled",
      message: lastVideo
        ? "Playback, JSON, and GLB now use the current appearance. The directly recorded video remains unchanged because its pixels are already baked."
        : "Playback and future JSON, GLB, and MP4 renders now use the current appearance. The recorded motion frames were not changed.",
      duration: 8_000,
    });
  };

  const renderRecordedMotionVideo = async ({ forceWebm = false }: { forceWebm?: boolean } = {}) => {
    if (!recordedFrames.length) throw new Error("There is no recorded motion take to render.");
    const renderFrames = editedFramesForExport();
    if (!renderFrames.length) throw new Error("The current trim range contains no motion frames.");
    const restoreViewState = currentViewStateRef.current;
    const appearance = recordedAppearanceRef.current;
    const quality = {
      videoBitrate: settings.videoBitrateMbps * 1_000_000,
      audioBitrate: settings.audioBitrateKbps * 1_000,
    };
    let duration = Math.max(renderFrames.at(-1)?.timestamp ?? 0, 500);
    const editedAudio = lastAudio
      ? await import("./lib/audioEdit").then(({ trimAndRetimeAudio }) => trimAndRetimeAudio(lastAudio, exportTrimStartMs, exportTrimEndMs, exportPlaybackSpeed))
      : null;
    const landmarks = appearance?.neutralFrame?.landmarks ?? neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
    const renderInPopout = outputOwnerPhase === "popout-ready";
    let canvas = avatarCanvasRef.current;
    let stream: MediaStream | null = null;
    let renderAudioContext: AudioContext | null = null;
    let renderAudioSource: AudioBufferSourceNode | null = null;
    let recorder: MediaRecorder | null = null;
    let animation = 0;

    setForcedViewState(appearance?.viewState ?? recordedViewState ?? restoreViewState);
    if (renderInPopout) {
      let audioDuration = 0;
      if (editedAudio) {
        const context = new AudioContext();
        try {
          audioDuration = (await context.decodeAudioData(await editedAudio.arrayBuffer())).duration * 1_000;
        } finally {
          await context.close();
        }
      }
      duration = Math.max(duration, audioDuration);
      const requestId = crypto.randomUUID?.() ?? `render-${Date.now()}`;
      try {
        if (playbackAnimationRef.current) cancelAnimationFrame(playbackAnimationRef.current);
        playbackAnimationRef.current = null;
        setPlaying(false);
        setMotionVideoRendering(true);
        setPlaybackFrame(playbackTrackingFrame(renderFrames[0], landmarks));
        setRecordingElapsed(0);
        setLastVideoQuality(quality);
        await afterBrowserPaint();
        await output.beginRecording({
          requestId,
          fps: settings.exportFps,
          videoBitrate: quality.videoBitrate,
          audioBitrate: quality.audioBitrate,
          retainedAudio: editedAudio ?? undefined,
          useLiveMicrophone: false,
          forceWebm,
        });
        const completed = output.waitForRecordingResult(requestId);
        const started = performance.now();
        await new Promise<void>((resolve) => {
          const tick = (now: number) => {
            const elapsed = Math.min(duration, now - started);
            const recorded = recordedFrameAtTime(renderFrames, elapsed);
            setPlaybackFrame(playbackTrackingFrame(recorded, landmarks));
            setRecordingElapsed(elapsed);
            setVideoExportProgress(Math.min(0.45, (elapsed / duration) * 0.45));
            if (elapsed < duration) animation = requestAnimationFrame(tick);
            else requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          };
          animation = requestAnimationFrame(tick);
        });
        output.stopRecording();
        const rendered = await completed;
        if (editedAudio) {
          const tracks = await inspectRecordedMedia(rendered);
          if (!tracks.hasAudio) throw new Error("The popout motion renderer omitted the retained microphone track.");
        }
        setLastVideo(rendered);
        return { video: rendered, quality };
      } finally {
        if (animation) cancelAnimationFrame(animation);
        setMotionVideoRendering(false);
        setPlaybackFrame(null);
        setRecordingElapsed(duration);
        setForcedViewState(restoreViewState);
        await afterBrowserPaint();
        setForcedViewState(null);
      }
    }
    if (!canvas) throw new Error("The rendered capture surface is not ready yet.");
    if (typeof canvas.captureStream !== "function") {
      throw new Error("This browser cannot capture the rendered avatar canvas. Use a current Chromium-based browser.");
    }
    try {
      await afterBrowserPaint();
      stream = canvas.captureStream(settings.exportFps);
      if (editedAudio) {
        try {
          renderAudioContext = new AudioContext();
          const audioBuffer = await renderAudioContext.decodeAudioData(await editedAudio.arrayBuffer());
          const destination = renderAudioContext.createMediaStreamDestination();
          renderAudioSource = renderAudioContext.createBufferSource();
          renderAudioSource.buffer = audioBuffer;
          renderAudioSource.connect(destination);
          destination.stream.getAudioTracks().forEach((track) => stream?.addTrack(track));
          duration = Math.max(duration, audioBuffer.duration * 1_000);
        } catch (audioError) {
          throw new Error(`The retained microphone audio could not be decoded: ${audioError instanceof Error ? audioError.message : String(audioError)}`);
        }
      }
      const hasAudio = stream.getAudioTracks().length > 0;
      const mimeType = forceWebm ? preferredWebmRecorderMimeType(hasAudio) : preferredVideoRecorderMimeType(hasAudio);
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: quality.videoBitrate,
        audioBitsPerSecond: quality.audioBitrate,
      });
      const activeRecorder = recorder;
      const chunks: Blob[] = [];
      let recorderFailure: Error | null = null;

      const completed = new Promise<Blob>((resolve, reject) => {
        activeRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        activeRecorder.onerror = (event) => {
          recorderFailure = new Error(`The browser recorder failed while rendering motion (${event.type}).`);
        };
        activeRecorder.onstop = () => {
          if (recorderFailure) {
            reject(recorderFailure);
          } else if (!chunks.length) {
            reject(new Error("The browser recorder completed without producing video data."));
          } else {
            resolve(new Blob(chunks, { type: activeRecorder.mimeType || mimeType }));
          }
        };
      });

      if (playbackAnimationRef.current) cancelAnimationFrame(playbackAnimationRef.current);
      playbackAnimationRef.current = null;
      setPlaying(false);
      setMotionVideoRendering(true);
      setPlaybackFrame(playbackTrackingFrame(renderFrames[0], landmarks));
      setRecordingElapsed(0);
      setLastVideoQuality(quality);
      await afterBrowserPaint();

      if (renderAudioContext?.state === "suspended") await renderAudioContext.resume();
      activeRecorder.start(250);
      renderAudioSource?.start();
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          const elapsed = Math.min(duration, now - started);
          const recorded = recordedFrameAtTime(renderFrames, elapsed);
          setPlaybackFrame(playbackTrackingFrame(recorded, landmarks));
          setRecordingElapsed(elapsed);
          setVideoExportProgress(Math.min(0.45, (elapsed / duration) * 0.45));
          if (elapsed < duration && !recorderFailure) {
            animation = requestAnimationFrame(tick);
          } else {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }
        };
        animation = requestAnimationFrame(tick);
      });
      if (activeRecorder.state !== "inactive") activeRecorder.stop();
      const rendered = await completed;
      if (hasAudio) {
        const tracks = await inspectRecordedMedia(rendered);
        if (!tracks.hasAudio) throw new Error("The motion renderer omitted the retained microphone track.");
      }
      setLastVideo(rendered);
      return { video: rendered, quality };
    } finally {
      if (animation) cancelAnimationFrame(animation);
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stream?.getTracks().forEach((track) => track.stop());
      try { renderAudioSource?.stop(); } catch { /* The source may have ended naturally. */ }
      if (renderAudioContext) await renderAudioContext.close();
      setMotionVideoRendering(false);
      setPlaybackFrame(null);
      setRecordingElapsed(duration);
      setForcedViewState(restoreViewState);
      await afterBrowserPaint();
      setForcedViewState(null);
    }
  };

  const renderRecordedMotionMp4Deterministic = async () => {
    const renderFrames = editedFramesForExport();
    if (!renderFrames.length) throw new Error("The current trim range contains no motion frames.");
    if (renderFrames.length > 20_000) throw new Error(`The edited take contains ${renderFrames.length.toLocaleString()} frames, above the 20,000-frame deterministic-render safety limit.`);
    const restoreFrame = playbackFrame;
    const restoreElapsed = recordingElapsed;
    const restoreView = currentViewStateRef.current;
    const appearance = recordedAppearanceRef.current;
    const landmarks = appearance?.neutralFrame?.landmarks ?? neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
    const editedAudio = lastAudio
      ? await import("./lib/audioEdit").then(({ trimAndRetimeAudio }) => trimAndRetimeAudio(lastAudio, exportTrimStartMs, exportTrimEndMs, exportPlaybackSpeed))
      : null;
    const quality = {
      videoBitrate: settings.videoBitrateMbps * 1_000_000,
      audioBitrate: settings.audioBitrateKbps * 1_000,
    };
    const { createOfflineMp4Encoder } = await import("./lib/offlineVideoExport");
    const encoder = await createOfflineMp4Encoder({
      width: settings.exportWidth,
      height: settings.exportHeight,
      fps: settings.exportFps,
      videoBitrate: quality.videoBitrate,
      audioBitrate: quality.audioBitrate,
      audio: editedAudio,
    });
    let completed = false;
    const remoteCanvas = document.createElement("canvas");
    remoteCanvas.width = settings.exportWidth;
    remoteCanvas.height = settings.exportHeight;
    const remoteContext = remoteCanvas.getContext("2d");
    try {
      setPlaying(false);
      setMotionVideoRendering(true);
      setForcedViewState(appearance?.viewState ?? recordedViewState ?? restoreView);
      setLastVideoQuality(quality);
      setPlaybackFrame(playbackTrackingFrame(renderFrames[0], landmarks));
      setRecordingElapsed(0);
      await afterBrowserPaint();
      for (let index = 0; index < renderFrames.length; index += 1) {
        const frame = renderFrames[index];
        setPlaybackFrame(playbackTrackingFrame(frame, landmarks));
        setRecordingElapsed(frame.timestamp);
        await afterBrowserPaint();
        let sourceCanvas = avatarCanvasRef.current;
        if (!sourceCanvas) {
          if (!remoteContext) throw new Error("Could not create the popout frame transfer surface.");
          const blob = await captureCurrentCanvasPng(settings.exportWidth, settings.exportHeight);
          const bitmap = await createImageBitmap(blob);
          remoteContext.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
          remoteContext.drawImage(bitmap, 0, 0, remoteCanvas.width, remoteCanvas.height);
          bitmap.close();
          sourceCanvas = remoteCanvas;
        }
        await encoder.addCanvasFrame(sourceCanvas, index);
        setVideoExportProgress((index + 1) / renderFrames.length * 0.92);
      }
      const video = await encoder.finalize();
      completed = true;
      setVideoExportProgress(1);
      setLastVideo(video);
      return { video, quality };
    } finally {
      if (!completed) await encoder.cancel().catch(() => undefined);
      setMotionVideoRendering(false);
      setPlaybackFrame(restoreFrame);
      setRecordingElapsed(restoreElapsed);
      setForcedViewState(restoreView);
      await afterBrowserPaint();
      setForcedViewState(null);
    }
  };

  const captureCurrentCanvasPng = async (width = settings.exportWidth, height = settings.exportHeight) => {
    const canvas = avatarCanvasRef.current;
    if (!canvas) {
      if (outputOwnerPhase === "popout-ready" || outputOwnerPhase === "popout-recording" || outputOwnerPhase === "popout-encoding") {
        return output.capturePng(width, height);
      }
      if (popoutState !== "idle") throw new Error("The output renderer is currently changing owners. Wait for the handoff to finish and retry.");
      throw new Error("The rendered canvas is not ready yet.");
    }
    await afterBrowserPaint();
    return canvasPngBlob(canvas, width, height);
  };

  const captureStill = async () => {
    try {
      const png = await captureCurrentCanvasPng();
      const result = await saveBlob(png, timestampedFilename("png", "_still"));
      showSaveResult("Canvas photo saved", "The exact visible canvas PNG", result);
    } catch (error) {
      setDeviceError(`Canvas photo failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const exportWebm = async () => {
    if (!lastVideo && !recordedFrames.length) {
      pushToast({ type: "warning", title: "Record a take before exporting", message: "WebM export needs a recorded video or editable motion take." });
      return;
    }
    if (videoExportProgress !== null || pngSequenceRendering) return;
    try {
      const sourceDuration = recordedFrames.at(-1)?.timestamp ?? 0;
      const editApplied = recordedFrames.length > 0 && (exportTrimStartMs > 0.5 || exportTrimEndMs < sourceDuration - 0.5 || Math.abs(exportPlaybackSpeed - 1) > 1e-4);
      let webm = !editApplied && lastVideo?.type.includes("webm") ? lastVideo : null;
      if (!webm) {
        if (!recordedFrames.length) throw new Error("This take only has an MP4 pixel recording and no motion frames that can be rendered to WebM.");
        setVideoExportProgress(0);
        const rendered = await renderRecordedMotionVideo({ forceWebm: true });
        webm = rendered.video;
      }
      if (!webm.type.includes("webm")) throw new Error(`The available browser encoder returned ${webm.type || "an unknown container"} instead of WebM.`);
      const result = await saveBlob(webm, timestampedFilename("webm"));
      showSaveResult("WebM export complete", "The WebM recording", result);
    } catch (error) {
      setDeviceError(`WebM export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setVideoExportProgress(null);
      tracker.scheduleHealthCheck("WebM export");
    }
  };

  const exportPngSequence = async () => {
    if (!recordedFrames.length) {
      pushToast({ type: "warning", title: "Motion frames are required", message: "A PNG sequence needs an editable motion take. A baked video-only take cannot be sampled losslessly yet." });
      return;
    }
    if (videoExportProgress !== null || pngSequenceRendering) return;
    const appearance = recordedAppearanceRef.current;
    const fps = settings.exportFps;
    const renderFrames = editedFramesForExport();
    const duration = renderFrames.at(-1)?.timestamp ?? 0;
    const frameCount = renderFrames.length;
    if (frameCount > 20_000) {
      setDeviceError(`PNG sequence export would create ${frameCount.toLocaleString()} frames. Trim or retime the take below the 20,000-frame safety limit first.`);
      return;
    }
    const restoreFrame = playbackFrame;
    const restoreElapsed = recordingElapsed;
    const restoreView = currentViewStateRef.current;
    const landmarks = appearance?.neutralFrame?.landmarks ?? neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
    const entries: { name: string; bytes: Uint8Array }[] = [];
    setPlaying(false);
    setPngSequenceRendering(true);
    setPngExportProgress(0);
    setForcedViewState(appearance?.viewState ?? recordedViewState ?? restoreView);
    try {
      pushToast({ type: "info", title: "Rendering PNG sequence", message: `${frameCount.toLocaleString()} frames will be rendered at ${fps} FPS and packed into one ZIP.`, duration: 7_000 });
      await afterBrowserPaint();
      const digits = Math.max(4, String(frameCount).length);
      for (let index = 0; index < frameCount; index += 1) {
        const frame = renderFrames[index];
        const timestamp = frame.timestamp;
        setPlaybackFrame(playbackTrackingFrame(frame, landmarks));
        setRecordingElapsed(timestamp);
        await afterBrowserPaint();
        const png = await captureCurrentCanvasPng(settings.exportWidth, settings.exportHeight);
        entries.push({
          name: `frames/GNM_Studio_${String(index + 1).padStart(digits, "0")}.png`,
          bytes: new Uint8Array(await png.arrayBuffer()),
        });
        setPngExportProgress((index + 1) / frameCount);
      }
      entries.push({
        name: "sequence.json",
        bytes: new TextEncoder().encode(JSON.stringify({
          format: "gnm-studio-png-sequence", version: 1, width: settings.exportWidth,
          height: settings.exportHeight, fps, frames: frameCount, durationMs: duration,
          alpha: (appearance?.settings.backgroundMode ?? settings.backgroundMode) === "transparent",
        }, null, 2)),
      });
      const zip = createStoredZip(entries);
      const result = await saveBytes(zip, timestampedFilename("zip", "_png_sequence"), "application/zip");
      showSaveResult("PNG sequence saved", `${frameCount.toLocaleString()} numbered PNG frames in one ZIP`, result);
    } catch (error) {
      setDeviceError(`PNG sequence export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPngSequenceRendering(false);
      setPngExportProgress(null);
      setPlaybackFrame(restoreFrame);
      setRecordingElapsed(restoreElapsed);
      setForcedViewState(restoreView);
      await afterBrowserPaint();
      setForcedViewState(null);
      tracker.scheduleHealthCheck("PNG sequence export");
    }
  };

  const exportVideo = async () => {
    if (captureFinalizing) {
      pushToast({ type: "info", title: "Recording is still finalizing", message: "Wait for the microphone/video container to finish before exporting. The completed take will be used directly; no re-recording is needed." });
      return;
    }
    if (!lastVideo && !recordedFrames.length) {
      pushToast({
        type: "warning",
        title: "Record a take before exporting",
        message: "Motion data can be rendered as an avatar MP4, while Avatar video and Camera + avatar modes preserve their directly recorded video source.",
      });
      return;
    }
    if (videoExportProgress !== null) return;
    try {
      const sourceDuration = recordedFrames.at(-1)?.timestamp ?? 0;
      const editApplied = recordedFrames.length > 0 && (exportTrimStartMs > 0.5 || exportTrimEndMs < sourceDuration - 0.5 || Math.abs(exportPlaybackSpeed - 1) > 1e-4);
      let video = editApplied ? null : lastVideo;
      let quality = lastVideoQuality;
      let renderedFromMotion = false;
      if (!video) {
        renderedFromMotion = true;
        setVideoExportProgress(0);
        setVideoExportBackend("webcodecs");
        if (settings.videoEncoderBackend !== "ffmpeg") {
          pushToast({
            type: "info",
            title: "Rendering deterministic MP4",
            message: `Encoding ${settings.exportWidth} × ${settings.exportHeight} at exactly ${settings.exportFps} FPS. Frames are sampled by timestamp rather than screen speed, so a slow UI cannot make the video choppy.`,
            duration: 9_000,
          });
          try {
            const rendered = await renderRecordedMotionMp4Deterministic();
            video = rendered.video;
            quality = rendered.quality;
          } catch (error) {
            if (settings.videoEncoderBackend === "webcodecs" || isWebEdition) throw error;
            pushToast({ type: "warning", title: "Portable H.264 unavailable", message: "Auto is falling back to the system-FFmpeg path for this device.", duration: 7_000 });
          }
        }
        if (!video) {
          const rendered = await renderRecordedMotionVideo();
          video = rendered.video;
          quality = rendered.quality;
        }
      }
      if (!video.type.includes("mp4")) {
        if (!renderedFromMotion) setVideoExportProgress(0);
        let useSystemFfmpeg = false;
        if (settings.videoEncoderBackend !== "webcodecs" && "__TAURI_INTERNALS__" in window) {
          const probe = await checkFfmpeg(settings.ffmpegPath, false);
          useSystemFfmpeg = probe.available;
          if (!probe.available && settings.videoEncoderBackend === "ffmpeg") {
            throw new Error(`System FFmpeg is selected but unavailable: ${probe.error ?? settings.ffmpegPath}. Choose ffmpeg.exe, add it to PATH, or switch the encoder to Auto/WebCodecs.`);
          }
        }
        if (useSystemFfmpeg) {
          setVideoExportBackend("ffmpeg");
          pushToast({
            type: "info",
            title: "Rendering MP4 with system FFmpeg",
            message: `Using ${settings.ffmpegPath} with H.264 at ${Math.round(lastVideoQuality.videoBitrate / 1_000_000)} Mbps and AAC at ${Math.round(lastVideoQuality.audioBitrate / 1_000)} kbps.`,
            duration: 7_000,
          });
          const { convertWithSystemFfmpeg } = await import("./lib/systemFfmpeg");
          video = await convertWithSystemFfmpeg(video, settings.ffmpegPath, quality, setVideoExportProgress);
        } else {
          setVideoExportBackend("webcodecs");
          pushToast({
            type: "info",
            title: "Rendering MP4 with WebCodecs",
            message: "The portable local encoder is converting the WebM source to H.264/AAC. Recording timestamps are preserved.",
            duration: 7_000,
          });
          const { convertToMp4 } = await import("./lib/mp4Export");
          video = await convertToMp4(
            video,
            quality,
            renderedFromMotion
              ? (progress) => setVideoExportProgress(0.45 + progress * 0.55)
              : setVideoExportProgress,
          );
        }
      } else if (renderedFromMotion) {
        setVideoExportProgress(1);
      }
      const result = await saveBlob(video, timestampedFilename("mp4"));
      showSaveResult("MP4 export complete", "The H.264 MP4 recording", result);
    } catch (error) {
      setDeviceError(`MP4 export failed: ${error instanceof Error ? error.message : String(error)}. The original recording is still held in memory; you can retry without recording again.`);
    } finally {
      setVideoExportProgress(null);
      setVideoExportBackend(null);
      tracker.scheduleHealthCheck("MP4 export");
    }
  };

  const exportWebmSource = async () => {
    if (!lastVideo || lastVideo.type.includes("mp4")) return;
    try {
      const result = await saveBlob(lastVideo, timestampedFilename("webm", "_source"));
      showSaveResult("WebM source saved", "The unconverted source recording", result);
    } catch (error) {
      setDeviceError(`WebM source export failed: ${String(error)}`);
    } finally {
      tracker.scheduleHealthCheck("WebM export");
    }
  };

  const exportGlb = async () => {
    try {
      const appearance = recordedAppearanceRef.current;
      const exportSettings = appearance?.settings ?? settings;
      const bytes = await createAnimatedGlb(
        editedFramesForExport(),
        appearance?.identityVertices ?? identityVertices,
        appearance?.manualExpressions ?? manualExpressions,
        appearance?.frozenExpressions ?? frozenExpressions,
        {
          enabled: exportSettings.skinTextureEnabled,
          tone: exportSettings.skinTone,
          scale: exportSettings.skinTextureScale,
          rotation: exportSettings.skinTextureRotation,
          feather: exportSettings.skinTextureFeather,
        },
        {
          avatarKind: exportSettings.avatarKind,
          neutralFrame: appearance?.neutralFrame ?? neutralFrame,
          mirror: exportSettings.mirror,
          eyeShaderEnabled: exportSettings.eyeShaderEnabled,
          eyeColor: exportSettings.eyeColor,
          headPose: {
            enabled: exportSettings.headRotationEnabled,
            yawStrength: exportSettings.headYawStrength,
            pitchStrength: exportSettings.headPitchStrength,
            rollStrength: exportSettings.headRollStrength,
            deadZone: exportSettings.headRotationDeadZone,
            smoothing: exportSettings.headRotationSmoothing,
          },
        },
      );
      const result = await saveBytes(bytes, timestampedFilename("glb", `_${exportSettings.avatarKind}_animation`), "model/gltf-binary");
      showSaveResult("Blender export complete", `The animated GLB with ${avatarProfiles[exportSettings.avatarKind].label} morph targets`, result);
    } catch (error) {
      setDeviceError(`Animated GLB export failed: ${String(error)}`);
    } finally {
      tracker.scheduleHealthCheck("GLB export");
    }
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

  const handleStageError = useCallback((message: string) => {
    setDeviceError(message);
  }, []);
  const handleCompositeCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    avatarCanvasRef.current = canvas;
  }, []);
  const handleViewportResize = useCallback((width: number, height: number) => {
    setStageSize((current) => current.width === width && current.height === height ? current : { width, height });
  }, []);
  const handleViewStateChange = useCallback((viewState: CameraViewState) => {
    currentViewStateRef.current = viewState;
  }, []);
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
      viewState: stageAppearance?.viewState ?? currentViewStateRef.current,
    };
    sendOutputSnapshot(snapshot);
  }, [captureFinalizing, capturePaused, getCurrentTrackingFrame, motionVideoRendering, pngSequenceRendering, popoutState, recordingState, resetViewSignal, sendOutputSnapshot, stageAppearance, stageBackgroundImageUrl, stageFrozenExpressions, stageIdentityVertices, stageManualExpressions, stageNeutralFrame, stageSettings]);

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
        captureContent={<CaptureSidebarContent web={isWebEdition} settings={settings} cameras={cameras} cameraReady={cameraAccess === "ready"} permissionAsking={permissionState === "asking"} ffmpegStatus={ffmpegStatus} ffmpegVersion={ffmpegVersion} updateSetting={updateSetting} enumerateDevices={() => void captureDevices.enumerateDevices()} requestAccess={() => void captureDevices.requestAccess()} checkFfmpeg={() => void checkFfmpeg()} chooseFfmpeg={() => void chooseFfmpegExecutable()} openFfmpegDownload={() => void openExternal("https://ffmpeg.org/download.html")} />}
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
        resetView={() => setResetViewSignal((value) => value + 1)}
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
          onAvatarMotion: storeAvatarMotion,
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
          onTrimStartChange: (value) => { setExportTrimStartMs(Math.min(exportTrimEndMs || recordedDuration, Math.max(0, value))); setRecordingElapsed(0); setPlaybackFrame(null); },
          onTrimEndChange: (value) => { setExportTrimEndMs(Math.min(recordedDuration, Math.max(exportTrimStartMs, value))); setRecordingElapsed(0); setPlaybackFrame(null); },
          onSpeedChange: (value) => { setExportPlaybackSpeed(Math.min(4, Math.max(0.1, value))); setRecordingElapsed(0); setPlaybackFrame(null); },
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
        recording={{ state: recordingState, elapsed: recordingElapsed, frameCount: recordedFrames.length, draftFrameCount: recordingFramesRef.current.length, playing, playbackActive: Boolean(playbackFrame || playing), calibrating, finalizing: captureFinalizing, videoBusy: videoExportProgress !== null, popoutStarting: popoutState === "starting", motionNeedsFace: !trackingFrame && settings.recordingMode === "motion", start: () => void startRecording(), stop: stopRecording, togglePause, returnLive: returnToLiveTracking }}
        timeline={{ percent: timelinePercent, duration: timelineDuration, position: timelinePosition, recordedDuration, playbackDuration, seek: seekPlayback }}
        exports={{ fps: settings.exportFps, motionInputRef, hasTake: recordedFrames.length > 0, hasVideo: Boolean(lastVideo), sourceIsWebm: Boolean(lastVideo && !lastVideo.type.includes("mp4")), videoProgress: videoExportProgress, backend: videoExportBackend, setFps: (value) => updateSetting("exportFps", value), useCurrentLook: useCurrentAppearanceForTake, exportMotion: () => void exportMotion(), exportGlb: () => void exportGlb(), exportWebmSource: () => void exportWebmSource(), exportVideo: () => void exportVideo() }}
      />
      <ToastCenter
        toasts={toasts}
        onDismiss={dismissToast}
      />
      <StudioFileInputs motionRef={motionInputRef} backgroundRef={backgroundInputRef} presetRef={presetInputRef} importMotion={(file) => void importMotionJson(file)} chooseBackground={(file) => void chooseBackgroundImage(file)} importPresets={(file) => void presetController.importBundle(file)} />
    </main>
    {backendMenu && createPortal(<BackendMenu position={backendMenu} backend={settings.trackingBackend} gpuProbe={gpuProbe} cpuProbe={cpuProbe} close={tracker.closeBackendMenu} select={tracker.selectBackend} />, document.body)}
    {settingsOpen && createPortal(<SettingsPopover web={isWebEdition} theme={theme} accent={accent} uiScale={uiScale} settings={settings} appVersion={appVersion} close={() => setSettingsOpen(false)} setTheme={setTheme} setAccent={setAccent} setUiScale={setUiScale} updateSetting={updateSetting} openExternal={(url) => void openExternal(url)} />, document.body)}
    </>
  );
}

export default App;
