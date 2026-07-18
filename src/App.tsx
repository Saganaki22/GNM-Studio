import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Camera as PhosphorCamera, Microphone as PhosphorMicrophone,
  Pause as PhosphorPause, Play as PhosphorPlay,
} from "@phosphor-icons/react";
import {
  Aperture, ArrowLeftRight, Box, Camera, Check, ChevronDown, CircleStop, Cpu, Download, Eye,
  FlipHorizontal2, Gauge, ImagePlus, Layers3, Maximize2, Minimize2, Moon, Pause, Play,
  PictureInPicture2, RefreshCw, RotateCcw, Settings2, SlidersHorizontal, Sparkles, Sun, Upload, Video,
  WandSparkles, X, Zap,
} from "lucide-react";
import { AudioMeter } from "./components/AudioMeter";
import { ExportWorkspace } from "./components/ExportWorkspace";
import { ExpressionControl } from "./components/ExpressionControl";
import { FpsInput } from "./components/FpsInput";
import { GnmExpressionEditor } from "./components/GnmExpressionEditor";
import { GithubMark } from "./components/GithubMark";
import { JointControl } from "./components/JointControl";
import { Stage } from "./components/Stage";
import { ToastCenter, type ToastMessage } from "./components/ToastCenter";
import { saveBlob, saveBytes, type SaveResult } from "./lib/save";
import { createAnimatedGlb } from "./lib/glbExport";
import { loadBackgroundImage, removeBackgroundImage, saveBackgroundImage } from "./lib/backgroundStore";
import { DenseDecoder, expressionDecoderInput, weightedIdentityDecoderInput } from "./lib/decoder";
import { identityVertexCount } from "./lib/identityVertices";
import type { WebIdentityEvaluator } from "./lib/webIdentity";
import { avatarProfiles, facecapControlGroups, facecapInfluences } from "./lib/avatarProfiles";
import {
  outputChannelName, type MainToOutputCommand, type MainToOutputMessage, type OutputOwnerPhase, type OutputSnapshot, type OutputToMainMessage,
} from "./lib/outputChannel";
import { parseMotionFile } from "./lib/motionFile";
import { MouthOpenGate, mouthOpenInfluence, semanticExpressionNames, semanticInfluences } from "./lib/retarget";
import { skinToneOptions } from "./lib/skinMaterial";
import { eyeColorOptions } from "./lib/gnmEyes";
import { AdaptiveTrackingSmoother } from "./lib/trackingSmoothing";
import { assetUrl } from "./lib/assets";
import type { ViewportSize } from "./lib/coverProjection";
import { assessFaceAlignment } from "./lib/faceAlignment";
import { inspectRecordedMedia } from "./lib/mediaInspection";
import {
  cloneLiveAudioTrack, preferredAudioRecorderMimeType, preferredVideoRecorderMimeType, preferredWebmRecorderMimeType,
} from "./lib/recordingMedia";
import {
  captureRecordedTakeSnapshot, recordingAppearanceSettingKeys, serializableRecordedTakeSnapshot,
} from "./lib/recordingAppearance";
import {
  pinnedFullscreenControlsState, toggledFullscreenControlsOverride,
  type FullscreenControlsOverride,
} from "./lib/fullscreenControls";
import type {
  AppSettings, AvatarKind, AvatarMotionSample, CameraViewState, DeviceOption, FaceAlignment,
  IdentityVertices, RecordedFrame, RecordedTakeSnapshot, RecordingMode, TrackingBackend, TrackingFrame,
  VideoEncoderBackend,
} from "./types";
import { canvasPngBlob } from "./lib/canvasCapture";
import { createStoredZip } from "./lib/zipStore";
import { canMountStudioRenderer, outputOwnerBusy, phaseFromHeartbeat } from "./lib/outputOwner";
import { applyFrozenGnmExpressionComponents, blendGnmExpressions, mirrorGnmEyeRegion } from "./lib/gnmExpressions";
import {
  createFullStatePreset, loadStoredPresets, parseFullStatePresetBundle, saveStoredPresets, serializePresetBundle,
  type FullStatePreset,
} from "./lib/presets";
import { trimAndRetimeMotion } from "./lib/motionEdit";
import { afterBrowserPaint, formatTime, timestampedFilename } from "./lib/studioFormat";
import { applyNeutralBaseline, estimateTrackingQuality, playbackTrackingFrame, recordedFrameAtTime } from "./lib/trackingFrames";
import {
  accentOptions, brandHeadIconStyle, initialSettings, isDesktopRuntime, isWebEdition,
  manualJointGroups, releasesUrl, repositoryUrl, settingsStorageVersion, type AccentOption, type BackendProbe,
  type FfmpegProbe, type Workspace,
} from "./app/studioConfig";
import "./App.css";

function App() {
  const [gnmInfo, setGnmInfo] = useState<{ vertices: number; identityDimensions: number; expressionDimensions: number } | null>(null);
  const [identitySeed, setIdentitySeed] = useState("GNM-2048");
  const [identityGender, setIdentityGender] = useState<"female" | "male" | "blend">("blend");
  const [identityEthnicity, setIdentityEthnicity] = useState<"middle_eastern" | "asian" | "white" | "black" | "blend">("blend");
  const [identityPresentationStrength, setIdentityPresentationStrength] = useState(0);
  const [identityPopulationWeights, setIdentityPopulationWeights] = useState<[number, number, number, number]>([0.25, 0.25, 0.25, 0.25]);
  const [identityVertices, setIdentityVertices] = useState<IdentityVertices | null>(null);
  const [identityStatus, setIdentityStatus] = useState<"ready" | "generating" | "error">("ready");
  const [webIdentityBackend, setWebIdentityBackend] = useState<"detecting" | "webgpu" | "cpu">("detecting");
  const [identityDecoderReady, setIdentityDecoderReady] = useState(false);
  const [identityWeights, setIdentityWeights] = useState<Float32Array | null>(null);
  const [expressionDecoderReady, setExpressionDecoderReady] = useState(false);
  const [gnmExpressionStatus, setGnmExpressionStatus] = useState<"ready" | "evaluating" | "error">("ready");
  const [gnmExpressionWeights, setGnmExpressionWeights] = useState<Float32Array>(() => new Float32Array(383));
  const [gnmFrozenExpressionComponents, setGnmFrozenExpressionComponents] = useState<Record<number, number>>({});
  const [gnmExpressionA, setGnmExpressionA] = useState("surprise");
  const [gnmExpressionB, setGnmExpressionB] = useState("happy");
  const [gnmExpressionSeedA, setGnmExpressionSeedA] = useState("GNM-EXP-A");
  const [gnmExpressionSeedB, setGnmExpressionSeedB] = useState("GNM-EXP-B");
  const [gnmExpressionBlend, setGnmExpressionBlend] = useState(0);
  const [gnmExpressionAbActive, setGnmExpressionAbActive] = useState(false);
  const [gnmExpressionEndpointA, setGnmExpressionEndpointA] = useState<Float32Array>(() => new Float32Array(383));
  const [gnmExpressionEndpointB, setGnmExpressionEndpointB] = useState<Float32Array>(() => new Float32Array(383));
  const [fullStatePresets, setFullStatePresets] = useState<FullStatePreset[]>(loadStoredPresets);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetName, setPresetName] = useState("My GNM look");
  const [manualExpressions, setManualExpressions] = useState<Record<string, number>>({});
  const [frozenExpressions, setFrozenExpressions] = useState<Record<string, number>>({});
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem("gnm-studio-settings");
    if (!saved) return initialSettings;
    let parsed: Partial<AppSettings>;
    try {
      parsed = JSON.parse(saved) as Partial<AppSettings>;
    } catch {
      localStorage.removeItem("gnm-studio-settings");
      return initialSettings;
    }
    const savedStorageVersion = Number(localStorage.getItem("gnm-studio-settings-version") ?? 0);
    const upgradingSingleSmoothingControl = parsed.motionSmoothing === undefined;
    return {
      ...initialSettings,
      ...parsed,
      videoEncoderBackend: isDesktopRuntime ? parsed.videoEncoderBackend ?? initialSettings.videoEncoderBackend : "webcodecs",
      // Version 2 makes the experimental material opt-in even for people whose
      // older local preference had it enabled. Later choices remain persistent.
      skinTextureEnabled: savedStorageVersion < 2
        ? false
        : parsed.skinTextureEnabled ?? initialSettings.skinTextureEnabled,
      trackingSmoothing: upgradingSingleSmoothingControl
        ? Math.max(0.72, parsed.trackingSmoothing ?? initialSettings.trackingSmoothing)
        : parsed.trackingSmoothing ?? initialSettings.trackingSmoothing,
    };
  });
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [microphones, setMicrophones] = useState<DeviceOption[]>([]);
  const [permissionState, setPermissionState] = useState<"idle" | "asking" | "ready" | "error">("idle");
  const [cameraAccess, setCameraAccess] = useState<"idle" | "ready" | "unavailable">("idle");
  const [microphoneAccess, setMicrophoneAccess] = useState<"idle" | "ready" | "unavailable">("idle");
  const [devicePromptDismissed, setDevicePromptDismissed] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const [trackingFrame, setTrackingFrame] = useState<TrackingFrame | null>(null);
  const [trackerStatus, setTrackerStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [trackerDelegate, setTrackerDelegate] = useState("—");
  const [trackerFallbackReason, setTrackerFallbackReason] = useState("");
  const [gpuProbe, setGpuProbe] = useState<BackendProbe>({ available: null, reason: "Not tested yet" });
  const [cpuProbe, setCpuProbe] = useState<BackendProbe>({ available: null, reason: "Not tested yet" });
  const [backendMenu, setBackendMenu] = useState<{ x: number; y: number } | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioPeak, setAudioPeak] = useState(0);
  const [capturePaused, setCapturePaused] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationComplete, setCalibrationComplete] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [neutralFrame, setNeutralFrame] = useState<TrackingFrame | null>(null);
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
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  const [backgroundImageName, setBackgroundImageName] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playbackFrame, setPlaybackFrame] = useState<TrackingFrame | null>(null);
  const [activePanel, setActivePanel] = useState<"avatar" | "capture">(isWebEdition ? "capture" : "avatar");
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>(isWebEdition ? "capture" : "create");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("gnm-studio-theme") === "light" ? "light" : "dark");
  const [accent, setAccent] = useState<AccentOption>(() => {
    const saved = localStorage.getItem("gnm-studio-accent") as AccentOption | null;
    return saved && accentOptions.includes(saved) ? saved : "teal";
  });
  const [uiScale, setUiScale] = useState(() => {
    const saved = Number(localStorage.getItem("gnm-studio-ui-scale") ?? 100);
    return Number.isFinite(saved) ? Math.min(125, Math.max(80, saved)) : 100;
  });
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => localStorage.getItem("gnm-studio-left-sidebar-collapsed") === "true");
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => localStorage.getItem("gnm-studio-right-sidebar-collapsed") === "true");
  const [fullscreen, setFullscreen] = useState(false);
  const [outputControlsHidden, setOutputControlsHidden] = useState(false);
  const [fullscreenControlsOverride, setFullscreenControlsOverride] = useState<FullscreenControlsOverride>(null);
  const [outputOwnerPhase, setOutputOwnerPhase] = useState<OutputOwnerPhase>("studio");
  const popoutState = canMountStudioRenderer(outputOwnerPhase)
    ? "idle"
    : outputOwnerPhase === "connecting"
      ? "starting"
      : "active";
  const [trackerRestartKey, setTrackerRestartKey] = useState(0);
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [stageSize, setStageSize] = useState<ViewportSize>({ width: 640, height: 480 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const faceAlignment = useMemo(
    () => assessFaceAlignment(trackingFrame, settings.mirror, videoRef.current, stageSize),
    [settings.mirror, stageSize, trackingFrame],
  );
  const calibrationMouthOpen = useMemo(() => trackingFrame ? mouthOpenInfluence(
    Object.fromEntries(trackingFrame.blendshapes.map(({ name, score }) => [name, score])),
    trackingFrame.landmarks,
  ) : 0, [trackingFrame]);
  const calibrationFaceAlignment: FaceAlignment = calibrating
    && faceAlignment.status === "ready" && calibrationMouthOpen > 0.12
    ? { ...faceAlignment, status: "adjust", message: "Relax and close your mouth for a neutral calibration" }
    : faceAlignment;
  const calibrationReadiness: FaceAlignment = calibrating
    ? calibrationFaceAlignment
    : neutralFrame
      ? { status: "ready", message: "Neutral calibration saved" }
      : trackingFrame
        ? { status: "ready", message: "Face detected — press Calibrate neutral when ready" }
        : { status: "missing", message: cameraAccess === "ready" ? "Calibration idle — waiting for a face" : "Calibration idle — connect a camera when you want face tracking" };
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const motionInputRef = useRef<HTMLInputElement>(null);
  const presetInputRef = useRef<HTMLInputElement>(null);
  const backgroundObjectUrlRef = useRef<string | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const monitorNodeRef = useRef<GainNode | null>(null);
  const mutedRef = useRef(settings.muted);
  const capturePausedRef = useRef(capturePaused);
  const monitoringRef = useRef(monitoring);
  const trackerWorkerRef = useRef<Worker | null>(null);
  const trackerBusyRef = useRef(false);
  const trackerBusySinceRef = useRef(0);
  const trackerLastActivityRef = useRef(0);
  const trackerFrameErrorsRef = useRef(0);
  const trackerRecoveryPendingRef = useRef(false);
  const trackerLastAutomaticRecoveryRef = useRef(0);
  const trackerReloadReasonRef = useRef<string | null>(null);
  const trackerHealthCheckRef = useRef<number | null>(null);
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
  const outputHideTimerRef = useRef<number | null>(null);
  const outputChannelRef = useRef<BroadcastChannel | null>(null);
  const outputHeartbeatRef = useRef(0);
  const outputOwnerPhaseRef = useRef<OutputOwnerPhase>(outputOwnerPhase);
  const outputSessionRef = useRef("");
  const activeOutputRecordingRequestRef = useRef("");
  const outputRecordingWaitersRef = useRef(new Map<string, {
    startResolve?: () => void;
    startReject?: (error: Error) => void;
    resultResolve?: (blob: Blob) => void;
    resultReject?: (error: Error) => void;
    startTimer?: number;
    resultTimer?: number;
  }>());
  const outputPngWaitersRef = useRef(new Map<string, { resolve: (blob: Blob) => void; reject: (error: Error) => void; timer: number }>());
  const webPopoutRef = useRef<Window | null>(null);
  const playbackAnimationRef = useRef<number | null>(null);
  const trackingFrameRef = useRef<TrackingFrame | null>(null);
  const faceAlignmentRef = useRef<FaceAlignment>(faceAlignment);
  const trackingSmoothingRef = useRef(settings.trackingSmoothing);
  const motionSmoothingRef = useRef(settings.motionSmoothing);
  const trackingSmootherRef = useRef(new AdaptiveTrackingSmoother());
  const mouthOpenGateRef = useRef(new MouthOpenGate());
  const neutralFrameRef = useRef<TrackingFrame | null>(neutralFrame);
  const mouthDeadZoneRef = useRef(settings.mouthDeadZone);
  const calibrationSessionRef = useRef(0);
  const identityDecoderRef = useRef<DenseDecoder | null>(null);
  const expressionDecoderRef = useRef<DenseDecoder | null>(null);
  const identityWeightsRef = useRef<Float32Array | null>(null);
  const identityEvaluationSkipRef = useRef<Float32Array | null>(null);
  const gnmExpressionWeightsRef = useRef(gnmExpressionWeights);
  const identityGenerationRef = useRef(0);
  const webIdentityEvaluatorRef = useRef<WebIdentityEvaluator | null>(null);
  const toastIdRef = useRef(0);

  mutedRef.current = settings.muted;
  capturePausedRef.current = capturePaused;
  monitoringRef.current = monitoring;
  trackingFrameRef.current = trackingFrame;
  faceAlignmentRef.current = calibrationFaceAlignment;
  trackingSmoothingRef.current = settings.trackingSmoothingEnabled ? settings.trackingSmoothing : 0;
  motionSmoothingRef.current = settings.motionSmoothingEnabled ? settings.motionSmoothing : 0;
  neutralFrameRef.current = neutralFrame;
  mouthDeadZoneRef.current = settings.mouthDeadZone;
  identityWeightsRef.current = identityWeights;
  gnmExpressionWeightsRef.current = gnmExpressionWeights;
  outputOwnerPhaseRef.current = outputOwnerPhase;

  const pushToast = useCallback((toast: Omit<ToastMessage, "id">) => {
    const message = { ...toast, id: ++toastIdRef.current };
    setToasts((current) => [...current.slice(-3), message]);
    return message.id;
  }, []);

  const storeAvatarMotion = useCallback((sample: AvatarMotionSample, frameTimestamp: number) => {
    latestAvatarMotionRef.current = { timestamp: frameTimestamp, sample };
    const pendingFrameIndex = pendingAvatarMotionFramesRef.current.get(frameTimestamp);
    if (pendingFrameIndex !== undefined) {
      const pendingFrame = recordingFramesRef.current[pendingFrameIndex];
      if (pendingFrame) pendingFrame.avatarMotion = sample;
      pendingAvatarMotionFramesRef.current.delete(frameTimestamp);
    }
  }, []);

  const rejectOutputWaiters = useCallback((reason: string) => {
    const error = new Error(reason);
    for (const waiter of outputRecordingWaitersRef.current.values()) {
      if (waiter.startTimer) window.clearTimeout(waiter.startTimer);
      if (waiter.resultTimer) window.clearTimeout(waiter.resultTimer);
      waiter.startReject?.(error);
      waiter.resultReject?.(error);
    }
    outputRecordingWaitersRef.current.clear();
    for (const waiter of outputPngWaitersRef.current.values()) {
      window.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    outputPngWaitersRef.current.clear();
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(outputChannelName);
    outputChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<OutputToMainMessage>) => {
      const message = event.data;
      if (!outputSessionRef.current || message.ownerId !== outputSessionRef.current) return;
      if (message.type === "ready") {
        outputHeartbeatRef.current = Date.now();
        setOutputOwnerPhase("popout-ready");
        pushToast({ type: "success", title: "Output popout connected", message: "The popout now owns the only 3D renderer. Camera tracking and controls remain in the studio." });
      } else if (message.type === "heartbeat") {
        outputHeartbeatRef.current = message.timestamp;
        if (outputOwnerPhaseRef.current !== "closing" && outputOwnerPhaseRef.current !== "restoring") {
          setOutputOwnerPhase((current) => phaseFromHeartbeat(current, message.phase));
        }
      } else if (message.type === "closed") {
        const graceful = outputOwnerPhaseRef.current === "closing" || outputOwnerPhaseRef.current === "restoring";
        if (!graceful) {
          rejectOutputWaiters("The output popout closed before its active operation completed.");
          if (recordingTickerRef.current) window.clearInterval(recordingTickerRef.current);
          setRecordedFrames([...recordingFramesRef.current]);
          setRecordingState("idle");
          setCaptureFinalizing(false);
          pushToast({ type: "warning", title: "Output popout closed", message: "The studio renderer was recovered. Captured motion frames remain available, but unfinished popout video pixels could not be finalized." });
        }
        setOutputOwnerPhase("studio");
        outputHeartbeatRef.current = 0;
        outputSessionRef.current = "";
      } else if (message.type === "shutdown-ready") {
        setOutputOwnerPhase("restoring");
        channel.postMessage({ type: "close", ownerId: message.ownerId } satisfies MainToOutputMessage);
        webPopoutRef.current?.close();
      } else if (message.type === "record-state") {
        const waiter = outputRecordingWaitersRef.current.get(message.requestId);
        if (message.state === "recording") {
          if (waiter?.startTimer) window.clearTimeout(waiter.startTimer);
          waiter?.startResolve?.();
          if (waiter) {
            waiter.startResolve = undefined;
            waiter.startReject = undefined;
            waiter.startTimer = undefined;
          }
          setOutputOwnerPhase("popout-recording");
        } else if (message.state === "encoding") {
          setOutputOwnerPhase("popout-encoding");
        } else if (message.state === "ready" && outputOwnerPhaseRef.current !== "closing") {
          setOutputOwnerPhase("popout-ready");
        }
      } else if (message.type === "record-result") {
        setLastVideo(message.blob);
        setCaptureFinalizing(false);
        if (activeOutputRecordingRequestRef.current === message.requestId) activeOutputRecordingRequestRef.current = "";
        const waiter = outputRecordingWaitersRef.current.get(message.requestId);
        if (waiter?.resultTimer) window.clearTimeout(waiter.resultTimer);
        waiter?.resultResolve?.(message.blob);
        outputRecordingWaitersRef.current.delete(message.requestId);
      } else if (message.type === "png-result") {
        const waiter = outputPngWaitersRef.current.get(message.requestId);
        if (waiter) {
          window.clearTimeout(waiter.timer);
          waiter.resolve(message.blob);
          outputPngWaitersRef.current.delete(message.requestId);
        }
      } else if (message.type === "view-state") {
        currentViewStateRef.current = message.viewState;
      } else if (message.type === "avatar-motion") {
        storeAvatarMotion(message.sample, message.frameTimestamp);
      } else if (message.type === "error") {
        if (message.operation === "Popout microphone") {
          pushToast({ type: "warning", title: "Popout recording has no microphone", message: message.message, duration: 8_000 });
        } else {
          if (message.operation === "Popout recording") {
            setCaptureFinalizing(false);
            rejectOutputWaiters(message.message);
          }
          if (message.operation === "Popout PNG capture") rejectOutputWaiters(message.message);
          setDeviceError(`${message.operation}: ${message.message}`);
        }
      }
    };
    return () => {
      channel.close();
      outputChannelRef.current = null;
    };
  }, [pushToast, rejectOutputWaiters, storeAvatarMotion]);

  useEffect(() => {
    if (outputOwnerPhase === "studio" || outputOwnerPhase === "connecting" || outputOwnerPhase === "failed") return;
    const monitor = window.setInterval(() => {
      if (Date.now() - outputHeartbeatRef.current < 4_000) return;
      setOutputOwnerPhase("failed");
      rejectOutputWaiters("The output popout disconnected before the requested operation completed.");
      if (recordingState !== "idle") {
        setRecordedFrames([...recordingFramesRef.current]);
        setRecordingState("idle");
        setCaptureFinalizing(false);
        if (recordingTickerRef.current) window.clearInterval(recordingTickerRef.current);
      }
      requestAnimationFrame(() => setOutputOwnerPhase("studio"));
      pushToast({ type: "warning", title: "Output popout disconnected", message: "The studio renderer was restored without creating a duplicate. Motion frames remain available; an unfinished popout video container could not be recovered." });
    }, 1_000);
    return () => window.clearInterval(monitor);
  }, [outputOwnerPhase, pushToast, recordingState, rejectOutputWaiters]);

  useEffect(() => {
    localStorage.setItem("gnm-studio-settings", JSON.stringify(settings));
    localStorage.setItem("gnm-studio-settings-version", String(settingsStorageVersion));
  }, [settings]);

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
    let disposed = false;
    loadBackgroundImage()
      .then((stored) => {
        if (disposed || !stored?.blob) return;
        const url = URL.createObjectURL(stored.blob);
        backgroundObjectUrlRef.current = url;
        setBackgroundImageUrl(url);
        setBackgroundImageName(stored.name);
      })
      .catch((error) => setDeviceError(`Custom background: ${String(error)}`));
    return () => {
      disposed = true;
      const currentUrl = backgroundObjectUrlRef.current;
      const recordedUrl = recordedAppearanceRef.current?.backgroundImageUrl;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      if (recordedUrl && recordedUrl !== currentUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accent;
    document.documentElement.dataset.edition = isWebEdition ? "web" : "desktop";
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("gnm-studio-theme", theme);
    localStorage.setItem("gnm-studio-accent", accent);
    localStorage.setItem("gnm-studio-ui-scale", String(uiScale));
  }, [accent, theme, uiScale]);

  useEffect(() => localStorage.setItem("gnm-studio-left-sidebar-collapsed", String(leftSidebarCollapsed)), [leftSidebarCollapsed]);
  useEffect(() => localStorage.setItem("gnm-studio-right-sidebar-collapsed", String(rightSidebarCollapsed)), [rightSidebarCollapsed]);
  useEffect(() => {
    try {
      saveStoredPresets(fullStatePresets);
    } catch (error) {
      setDeviceError(`Preset storage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [fullStatePresets]);

  useEffect(() => {
    const duration = recordedFrames.at(-1)?.timestamp ?? 0;
    setExportTrimStartMs(0);
    setExportTrimEndMs(duration);
    setExportPlaybackSpeed(1);
  }, [recordedFrames]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => {
    if (!backendMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBackendMenu(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [backendMenu]);

  const clearOutputHideTimer = useCallback(() => {
    if (outputHideTimerRef.current !== null) window.clearTimeout(outputHideTimerRef.current);
    outputHideTimerRef.current = null;
  }, []);

  const scheduleOutputControls = useCallback(() => {
    clearOutputHideTimer();
    if (!fullscreen) {
      setOutputControlsHidden(false);
      return;
    }
    const pinnedState = pinnedFullscreenControlsState(fullscreenControlsOverride, settings.outputAlwaysHideControls);
    if (pinnedState !== null) {
      setOutputControlsHidden(pinnedState);
      return;
    }
    setOutputControlsHidden(false);
    if (settings.outputAutoHideEnabled) {
      outputHideTimerRef.current = window.setTimeout(
        () => setOutputControlsHidden(true),
        Math.max(0.5, settings.outputAutoHideDelay) * 1_000,
      );
    }
  }, [clearOutputHideTimer, fullscreen, fullscreenControlsOverride, settings.outputAlwaysHideControls, settings.outputAutoHideDelay, settings.outputAutoHideEnabled]);

  const exitFullscreenView = useCallback(async () => {
    try {
      if (isDesktopRuntime) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setFullscreen(false);
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (error) {
      setDeviceError(`Exit fullscreen: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setFullscreen(false);
      setOutputControlsHidden(false);
      setFullscreenControlsOverride(null);
      clearOutputHideTimer();
    }
  }, [clearOutputHideTimer]);

  useEffect(() => {
    if (!fullscreen) return;
    scheduleOutputControls();
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape") void exitFullscreenView();
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        clearOutputHideTimer();
        const nextOverride = toggledFullscreenControlsOverride(outputControlsHidden);
        setFullscreenControlsOverride(nextOverride);
        setOutputControlsHidden(nextOverride === "hidden");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearOutputHideTimer();
    };
  }, [clearOutputHideTimer, exitFullscreenView, fullscreen, outputControlsHidden, scheduleOutputControls]);

  useEffect(() => {
    if (isDesktopRuntime) return;
    const syncFullscreen = () => {
      if (!document.fullscreenElement) {
        setFullscreen(false);
        setOutputControlsHidden(false);
        setFullscreenControlsOverride(null);
      }
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

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

  useEffect(() => {
    let disposed = false;
    Promise.all([
      DenseDecoder.load(assetUrl("models/gnm_identity_decoder.bin")),
      DenseDecoder.load(assetUrl("models/gnm_expression_decoder.bin")),
    ])
      .then(([identityDecoder, expressionDecoder]) => {
        if (disposed) return;
        identityDecoderRef.current = identityDecoder;
        expressionDecoderRef.current = expressionDecoder;
        setIdentityDecoderReady(true);
        setExpressionDecoderReady(true);
      })
      .catch((error) => setDeviceError(`GNM decoder: ${String(error)}`));
    return () => {
      disposed = true;
      webIdentityEvaluatorRef.current?.dispose();
      webIdentityEvaluatorRef.current = null;
    };
  }, []);

  const evaluateGnmParameters = useCallback(async (identity: Float32Array, expression: Float32Array) => {
    if (isDesktopRuntime) {
      const { invoke } = await import("@tauri-apps/api/core");
      const positions = await invoke<number[][]>("gnm_evaluate", {
        identity: Array.from(identity),
        expression: Array.from(expression),
        rotations: new Array(4).fill(null).map(() => [0, 0, 0]),
        translation: [0, 0, 0],
      });
      return { positions: positions as IdentityVertices, backend: "native Rust" };
    }
    if (!webIdentityEvaluatorRef.current) {
      const { WebIdentityEvaluator } = await import("./lib/webIdentity");
      webIdentityEvaluatorRef.current = new WebIdentityEvaluator();
    }
    const evaluation = await webIdentityEvaluatorRef.current.evaluateExpression(identity, expression);
    setWebIdentityBackend(evaluation.backend);
    return {
      positions: evaluation.positions as IdentityVertices,
      backend: evaluation.backend === "webgpu" ? "worker WebGPU" : "worker CPU",
    };
  }, []);

  const generateIdentity = useCallback(async (
    seed = identitySeed,
    presentationStrength = identityPresentationStrength,
    populationWeights = identityPopulationWeights,
    announce = true,
  ) => {
    if (!identityDecoderRef.current) {
      setDeviceError("Identity generation: the local identity decoder is still loading. Wait a moment and retry.");
      return;
    }
    const request = ++identityGenerationRef.current;
    setIdentityStatus("generating");
    try {
      const identity = identityDecoderRef.current.evaluate(
        weightedIdentityDecoderInput(seed, presentationStrength, populationWeights),
      );
      identityWeightsRef.current = identity;
      identityEvaluationSkipRef.current = identity;
      setIdentityWeights(identity);
      const evaluation = await evaluateGnmParameters(identity, gnmExpressionWeightsRef.current);
      if (request !== identityGenerationRef.current) return;
      setIdentityVertices(evaluation.positions);
      setIdentityStatus("ready");
      if (announce) {
        pushToast({
          type: "success",
          title: "Identity generated",
          message: `GNM rebuilt ${identityVertexCount(evaluation.positions).toLocaleString()} vertices from seed ${seed} with ${evaluation.backend}.`,
        });
      }
    } catch (error) {
      if (request !== identityGenerationRef.current) return;
      setIdentityStatus("error");
      setDeviceError(`Identity generation: ${String(error)}`);
    }
  }, [evaluateGnmParameters, identityPopulationWeights, identityPresentationStrength, identitySeed, pushToast]);

  useEffect(() => {
    if (!identityDecoderReady || settings.avatarKind !== "gnm" || recordingState !== "idle") return;
    const timer = window.setTimeout(() => {
      void generateIdentity(identitySeed, identityPresentationStrength, identityPopulationWeights, false);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [generateIdentity, identityDecoderReady, identityEthnicity, identityGender, identityPopulationWeights, identityPresentationStrength, identitySeed, recordingState, settings.avatarKind]);

  useEffect(() => {
    if (!expressionDecoderReady || !expressionDecoderRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        const indexA = semanticExpressionNames.findIndex((name) => name === gnmExpressionA);
        const indexB = semanticExpressionNames.findIndex((name) => name === gnmExpressionB);
        setGnmExpressionEndpointA(expressionDecoderRef.current!.evaluate(expressionDecoderInput(gnmExpressionSeedA, indexA)));
        setGnmExpressionEndpointB(expressionDecoderRef.current!.evaluate(expressionDecoderInput(gnmExpressionSeedB, indexB)));
      } catch (error) {
        setGnmExpressionStatus("error");
        setDeviceError(`Expression decoder: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [expressionDecoderReady, gnmExpressionA, gnmExpressionB, gnmExpressionSeedA, gnmExpressionSeedB]);

  useEffect(() => {
    if (!expressionDecoderReady || !gnmExpressionAbActive) return;
    setGnmExpressionWeights(applyFrozenGnmExpressionComponents(
      blendGnmExpressions(gnmExpressionEndpointA, gnmExpressionEndpointB, gnmExpressionBlend),
      gnmFrozenExpressionComponents,
    ));
  }, [expressionDecoderReady, gnmExpressionAbActive, gnmExpressionBlend, gnmExpressionEndpointA, gnmExpressionEndpointB, gnmFrozenExpressionComponents]);

  useEffect(() => {
    if (!identityWeights || settings.avatarKind !== "gnm") return;
    if (identityEvaluationSkipRef.current === identityWeights) {
      identityEvaluationSkipRef.current = null;
      return;
    }
    const request = ++identityGenerationRef.current;
    setGnmExpressionStatus("evaluating");
    const timer = window.setTimeout(() => {
      evaluateGnmParameters(identityWeights, gnmExpressionWeights)
        .then((evaluation) => {
          if (request !== identityGenerationRef.current) return;
          setIdentityVertices(evaluation.positions);
          setIdentityStatus("ready");
          setGnmExpressionStatus("ready");
        })
        .catch((error) => {
          if (request !== identityGenerationRef.current) return;
          setIdentityStatus("error");
          setGnmExpressionStatus("error");
          setDeviceError(`GNM expression evaluation: ${error instanceof Error ? error.message : String(error)}`);
        });
    }, 18);
    return () => window.clearTimeout(timer);
  }, [evaluateGnmParameters, gnmExpressionWeights, identityWeights, settings.avatarKind]);

  const resampleExpressionSeed = (slot: "a" | "b") => {
    const seed = `GNM-EXP-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase()}`;
    if (slot === "a") setGnmExpressionSeedA(seed);
    else setGnmExpressionSeedB(seed);
    setGnmExpressionAbActive(true);
  };

  const setRawGnmExpressionWeight = (index: number, value: number) => {
    setGnmExpressionAbActive(false);
    setGnmExpressionWeights((current) => {
      const next = current.slice();
      next[index] = Math.min(2, Math.max(-2, value));
      return applyFrozenGnmExpressionComponents(next, gnmFrozenExpressionComponents);
    });
  };

  const toggleRawGnmExpressionFreeze = (index: number) => {
    setGnmFrozenExpressionComponents((current) => {
      if (index in current) {
        const next = { ...current };
        delete next[index];
        return next;
      }
      return { ...current, [index]: gnmExpressionWeightsRef.current[index] };
    });
  };

  const mirrorRawGnmExpression = (direction: "left-to-right" | "right-to-left") => {
    setGnmExpressionAbActive(false);
    setGnmExpressionWeights((current) => applyFrozenGnmExpressionComponents(
      mirrorGnmEyeRegion(current, direction),
      gnmFrozenExpressionComponents,
    ));
  };

  const resetRawGnmExpression = () => {
    setGnmFrozenExpressionComponents({});
    setGnmExpressionWeights(new Float32Array(383));
    setGnmExpressionBlend(0);
    setGnmExpressionAbActive(false);
  };

  const chooseIdentityPresentation = (presentation: typeof identityGender) => {
    setIdentityGender(presentation);
    setIdentityPresentationStrength(presentation === "female" ? -1 : presentation === "male" ? 1 : 0);
  };

  const chooseIdentityPopulation = (population: typeof identityEthnicity) => {
    setIdentityEthnicity(population);
    const index = { middle_eastern: 0, asian: 1, white: 2, black: 3 } as const;
    if (population === "blend") setIdentityPopulationWeights([0.25, 0.25, 0.25, 0.25]);
    else setIdentityPopulationWeights([0, 1, 2, 3].map((value) => value === index[population] ? 1 : 0) as [number, number, number, number]);
  };

  const updateIdentityPopulationWeight = (index: number, value: number) => {
    setIdentityEthnicity("blend");
    setIdentityPopulationWeights((current) => {
      const next = [...current] as [number, number, number, number];
      next[index] = Math.min(1, Math.max(0, value));
      return next;
    });
  };

  const compareIdentityPresentation = () => {
    const next = identityPresentationStrength <= 0 ? 1 : -1;
    setIdentityPresentationStrength(next);
    setIdentityGender(next < 0 ? "female" : "male");
  };

  const captureCurrentFullState = () => captureRecordedTakeSnapshot({
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

  const saveNewFullStatePreset = () => {
    try {
      const preset = createFullStatePreset(presetName, captureCurrentFullState());
      setFullStatePresets((current) => [...current, preset]);
      setSelectedPresetId(preset.id);
      setPresetName(preset.name);
      pushToast({ type: "success", title: "Preset saved", message: `${preset.name} now stores this model, identity, 383-component expression, materials, layers, calibration and camera view.` });
    } catch (error) {
      setDeviceError(`Save preset: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const updateSelectedFullStatePreset = () => {
    const existing = fullStatePresets.find((preset) => preset.id === selectedPresetId);
    if (!existing) return;
    try {
      const updated = createFullStatePreset(existing.name, captureCurrentFullState(), existing);
      setFullStatePresets((current) => current.map((preset) => preset.id === existing.id ? updated : preset));
      pushToast({ type: "success", title: "Preset updated", message: `${updated.name} now contains the current full state.` });
    } catch (error) {
      setDeviceError(`Update preset: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const renameSelectedFullStatePreset = () => {
    const existing = fullStatePresets.find((preset) => preset.id === selectedPresetId);
    if (!existing) return;
    try {
      const renamed = createFullStatePreset(presetName, existing.snapshot, existing);
      setFullStatePresets((current) => current.map((preset) => preset.id === existing.id ? renamed : preset));
      setPresetName(renamed.name);
      pushToast({ type: "success", title: "Preset renamed", message: `The preset is now named ${renamed.name}.` });
    } catch (error) {
      setDeviceError(`Rename preset: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const loadSelectedFullStatePreset = () => {
    const preset = fullStatePresets.find((entry) => entry.id === selectedPresetId);
    if (!preset) return;
    const snapshot = preset.snapshot;
    setSettings(snapshot.settings);
    setIdentitySeed(snapshot.identityParameters.seed);
    setIdentityGender(snapshot.identityParameters.presentation);
    setIdentityEthnicity(snapshot.identityParameters.population);
    setIdentityPresentationStrength(snapshot.identityParameters.presentationStrength);
    setIdentityPopulationWeights(snapshot.identityParameters.populationWeights ?? [0.25, 0.25, 0.25, 0.25]);
    if (snapshot.identityWeights) setIdentityWeights(snapshot.identityWeights.slice());
    setGnmExpressionWeights(snapshot.gnmExpressionWeights?.slice() ?? new Float32Array(383));
    setGnmFrozenExpressionComponents(snapshot.gnmFrozenExpressionComponents ?? {});
    setGnmExpressionAbActive(false);
    setManualExpressions({ ...snapshot.manualExpressions });
    setFrozenExpressions({ ...snapshot.frozenExpressions });
    setNeutralFrame(snapshot.neutralFrame);
    neutralFrameRef.current = snapshot.neutralFrame;
    mouthOpenGateRef.current.reset();
    setForcedViewState(snapshot.viewState);
    if (snapshot.backgroundImageUrl) setBackgroundImageUrl(snapshot.backgroundImageUrl);
    pushToast({ type: "success", title: "Preset loaded", message: `${preset.name} was restored and is being evaluated locally.` });
  };

  const deleteSelectedFullStatePreset = () => {
    const preset = fullStatePresets.find((entry) => entry.id === selectedPresetId);
    if (!preset) return;
    setFullStatePresets((current) => current.filter((entry) => entry.id !== selectedPresetId));
    setSelectedPresetId("");
    pushToast({ type: "info", title: "Preset deleted", message: `${preset.name} was removed from local storage.` });
  };

  const importPresetBundle = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error("The selected preset bundle exceeds the 64 MB safety limit.");
      const bundle = parseFullStatePresetBundle(JSON.parse(await file.text()));
      setFullStatePresets((current) => {
        const byId = new Map(current.map((preset) => [preset.id, preset]));
        for (const preset of bundle.presets) byId.set(preset.id, preset);
        return [...byId.values()].slice(0, 16);
      });
      if (bundle.presets[0]) {
        setSelectedPresetId(bundle.presets[0].id);
        setPresetName(bundle.presets[0].name);
      }
      pushToast({ type: "success", title: "Preset bundle imported", message: `${bundle.presets.length} validated preset${bundle.presets.length === 1 ? "" : "s"} are available locally.` });
    } catch (error) {
      setDeviceError(`Import preset bundle: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const exportPresetBundle = async () => {
    if (!fullStatePresets.length) return;
    try {
      const bytes = new TextEncoder().encode(serializePresetBundle(fullStatePresets));
      const result = await saveBytes(bytes, timestampedFilename("json", "_preset_bundle"), "application/json");
      showSaveResult("Preset bundle exported", `${fullStatePresets.length} named full-state preset${fullStatePresets.length === 1 ? "" : "s"}`, result);
    } catch (error) {
      setDeviceError(`Export preset bundle: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const randomizeIdentity = () => {
    const seed = `GNM-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase()}`;
    setIdentitySeed(seed);
    void generateIdentity(seed);
  };

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

  const setCaptureProcessingPaused = (paused: boolean, synchronizeRecording: boolean) => {
    if (calibrating || captureFinalizing) return;
    if (synchronizeRecording && recordingState !== "idle") {
      const recordingMode = recordedAppearanceRef.current?.settings.recordingMode ?? settings.recordingMode;
      if (popoutState === "active" && recordingMode !== "motion") {
        const requestId = activeOutputRecordingRequestRef.current;
        if (requestId) postToOutput({ type: "record", action: paused ? "pause" : "resume", requestId });
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
    setCapturePaused(paused);
    cameraStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !paused; });
    micStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !paused && !mutedRef.current; });
    if (paused) {
      setAudioLevel(0);
      setAudioPeak(0);
    } else if (videoRef.current?.srcObject) {
      void videoRef.current.play().catch(() => undefined);
    }
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

  const chooseBackgroundImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setDeviceError(`Custom background: ${file.name} is not a supported image file.`);
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setDeviceError("Custom background: choose an image smaller than 50 MB.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = `${bitmap.width} × ${bitmap.height}`;
      bitmap.close();
      await saveBackgroundImage({ blob: file, name: file.name });
      if (backgroundObjectUrlRef.current && backgroundObjectUrlRef.current !== recordedAppearanceRef.current?.backgroundImageUrl) {
        URL.revokeObjectURL(backgroundObjectUrlRef.current);
      }
      const url = URL.createObjectURL(file);
      backgroundObjectUrlRef.current = url;
      setBackgroundImageUrl(url);
      setBackgroundImageName(file.name);
      updateSetting("backgroundMode", "image");
      pushToast({
        type: "success",
        title: backgroundImageUrl ? "Background replaced" : "Background added",
        message: `${file.name} (${dimensions}) is stored locally. Its aspect ratio will be preserved.`,
      });
    } catch (error) {
      setDeviceError(`Custom background: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const clearBackgroundImage = async () => {
    try {
      await removeBackgroundImage();
      if (backgroundObjectUrlRef.current && backgroundObjectUrlRef.current !== recordedAppearanceRef.current?.backgroundImageUrl) {
        URL.revokeObjectURL(backgroundObjectUrlRef.current);
      }
      backgroundObjectUrlRef.current = null;
      setBackgroundImageUrl(null);
      setBackgroundImageName("");
      updateSetting("backgroundMode", "studio");
      pushToast({ type: "info", title: "Custom background removed", message: "The locally stored image was cleared." });
    } catch (error) {
      setDeviceError(`Remove custom background: ${String(error)}`);
    }
  };

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

  const reloadTracker = useCallback((automaticReason?: string) => {
    if (cameraAccess !== "ready") {
      pushToast({
        type: "warning",
        title: "Camera is not available",
        message: "Connect or allow the selected camera before reloading the MediaPipe tracker.",
      });
      return;
    }
    const now = performance.now();
    if (automaticReason && trackerLastAutomaticRecoveryRef.current > 0 && now - trackerLastAutomaticRecoveryRef.current < 10_000) {
      trackerRecoveryPendingRef.current = false;
      setTrackerStatus("error");
      setDeviceError(`MediaPipe tracker: automatic recovery did not stay healthy. ${automaticReason} Use Reload tracker to try again, or switch the tracking backend.`);
      return;
    }
    trackerLastAutomaticRecoveryRef.current = automaticReason ? now : 0;
    if (trackerHealthCheckRef.current !== null) {
      window.clearTimeout(trackerHealthCheckRef.current);
      trackerHealthCheckRef.current = null;
    }
    trackerRecoveryPendingRef.current = true;
    trackerReloadReasonRef.current = automaticReason ?? "manual";
    trackerBusyRef.current = false;
    trackerBusySinceRef.current = 0;
    trackerLastActivityRef.current = performance.now();
    trackerFrameErrorsRef.current = 0;
    trackingSmootherRef.current.reset();
    mouthOpenGateRef.current.reset();
    if (playbackAnimationRef.current) cancelAnimationFrame(playbackAnimationRef.current);
    playbackAnimationRef.current = null;
    setPlaying(false);
    setPlaybackFrame(null);
    setDeviceError("");
    setTrackingFrame(null);
    setTrackerStatus("loading");
    setTrackerDelegate("Restarting…");
    setTrackerFallbackReason("");
    const video = videoRef.current;
    if (video?.srcObject && video.paused) void video.play().catch(() => undefined);
    setTrackerRestartKey((value) => value + 1);
    pushToast({
      type: automaticReason ? "warning" : "info",
      title: automaticReason ? "Recovering face tracking" : "Reloading MediaPipe tracker",
      message: automaticReason ?? "The local face model and tracking worker are being loaded again. Your avatar and app settings will not be reset.",
      duration: automaticReason ? 7_000 : 4_000,
    });
  }, [cameraAccess, pushToast]);

  const scheduleTrackerHealthCheck = useCallback((exportName: string) => {
    if (cameraAccess !== "ready" || trackerStatus !== "ready") return;
    if (trackerHealthCheckRef.current !== null) window.clearTimeout(trackerHealthCheckRef.current);
    trackerHealthCheckRef.current = window.setTimeout(() => {
      trackerHealthCheckRef.current = null;
      const activityAge = performance.now() - trackerLastActivityRef.current;
      if (!trackerRecoveryPendingRef.current && (trackerBusyRef.current || activityAge > 3_500)) {
        reloadTracker(`MediaPipe did not resume normally after the ${exportName}. The app is reloading the local tracker automatically.`);
      }
    }, 2_000);
  }, [cameraAccess, reloadTracker, trackerStatus]);

  const openBackendMenu = (x: number, y: number) => {
    setSettingsOpen(false);
    setBackendMenu({
      x: Math.min(Math.max(8, x), window.innerWidth - 244),
      y: Math.min(Math.max(8, y), window.innerHeight - 188),
    });
  };

  const selectTrackingBackend = (backend: TrackingBackend) => {
    if (backend === "gpu" && gpuProbe.available === false) return;
    if (backend === "cpu" && cpuProbe.available === false) return;
    setBackendMenu(null);
    setDeviceError("");
    setTrackingFrame(null);
    setTrackerStatus("loading");
    setTrackerFallbackReason("");
    setTrackerDelegate(backend === "auto" ? "GPU → CPU" : backend.toUpperCase());
    if (settings.trackingBackend === backend) {
      setTrackerRestartKey((value) => value + 1);
    } else {
      updateSetting("trackingBackend", backend);
    }
    pushToast({
      type: "info",
      title: "Tracking backend changed",
      message: backend === "auto" ? "MediaPipe will try GPU first and fall back to CPU." : `MediaPipe will restart using ${backend.toUpperCase()} only.`,
      duration: 4_000,
    });
  };

  const toggleFullscreen = async () => {
    if (fullscreen) {
      await exitFullscreenView();
      return;
    }
    try {
      if (isDesktopRuntime) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setFullscreen(true);
      } else {
        await document.documentElement.requestFullscreen();
      }
      setFullscreen(true);
      setFullscreenControlsOverride(null);
      setOutputControlsHidden(settings.outputAlwaysHideControls);
    } catch (error) {
      setDeviceError(`Enter fullscreen: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const postToOutput = (command: MainToOutputCommand) => {
    const ownerId = outputSessionRef.current;
    if (!ownerId) return;
    outputChannelRef.current?.postMessage({ ...command, ownerId } satisfies MainToOutputMessage);
  };

  const beginOutputRecording = (command: Omit<Extract<MainToOutputCommand, { type: "record"; action: "start" }>, "type" | "action">) => new Promise<void>((resolve, reject) => {
    const waiter = outputRecordingWaitersRef.current.get(command.requestId) ?? {};
    waiter.startResolve = resolve;
    waiter.startReject = reject;
    waiter.startTimer = window.setTimeout(() => {
      outputRecordingWaitersRef.current.delete(command.requestId);
      reject(new Error("The popout recorder did not acknowledge startup within 10 seconds."));
    }, 10_000);
    outputRecordingWaitersRef.current.set(command.requestId, waiter);
    activeOutputRecordingRequestRef.current = command.requestId;
    postToOutput({ type: "record", action: "start", ...command });
  });

  const waitForOutputRecordingResult = (requestId: string) => new Promise<Blob>((resolve, reject) => {
    const waiter = outputRecordingWaitersRef.current.get(requestId) ?? {};
    waiter.resultResolve = resolve;
    waiter.resultReject = reject;
    waiter.resultTimer = window.setTimeout(() => {
      outputRecordingWaitersRef.current.delete(requestId);
      reject(new Error("The popout recorder did not finish encoding within 30 seconds."));
    }, 30_000);
    outputRecordingWaitersRef.current.set(requestId, waiter);
  });

  const openOutputPopout = async () => {
    if (popoutState === "active") {
      postToOutput({ type: "focus" });
      return;
    }
    if (typeof BroadcastChannel === "undefined") {
      setDeviceError("Output popout is unavailable because this WebView does not support BroadcastChannel.");
      return;
    }
    const ownerId = crypto.randomUUID?.() ?? `output-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    outputSessionRef.current = ownerId;
    setOutputOwnerPhase("connecting");
    outputHeartbeatRef.current = Date.now();
    try {
      if (isDesktopRuntime) {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("output");
        if (existing) await existing.close();
        const output = new WebviewWindow("output", {
            url: `?output=1&outputSession=${encodeURIComponent(ownerId)}`,
            title: `${activeProfile.label} · GNM Studio Output`,
            width: 1280,
            height: 720,
            minWidth: 480,
            minHeight: 270,
            resizable: true,
            decorations: true,
            center: true,
          });
          void output.once("tauri://error", (event) => {
            setOutputOwnerPhase("failed");
            outputSessionRef.current = "";
            setDeviceError(`Open output popout: ${String(event.payload)}`);
            requestAnimationFrame(() => setOutputOwnerPhase("studio"));
          });
      } else {
        const url = new URL(window.location.href);
        url.searchParams.set("output", "1");
        url.searchParams.set("outputSession", ownerId);
        webPopoutRef.current = window.open(url, "gnm-studio-output", "popup,width=1280,height=720,resizable=yes");
        if (!webPopoutRef.current) throw new Error("The browser blocked the popout. Allow popups for this site and retry.");
      }
      window.setTimeout(() => {
        if (outputOwnerPhaseRef.current !== "connecting" || outputSessionRef.current !== ownerId) return;
        webPopoutRef.current?.close();
        setOutputOwnerPhase("failed");
        outputSessionRef.current = "";
        setDeviceError("Output popout did not connect within 10 seconds. It was closed so the studio renderer could be restored safely.");
        requestAnimationFrame(() => setOutputOwnerPhase("studio"));
      }, 10_000);
    } catch (error) {
      setOutputOwnerPhase("failed");
      outputSessionRef.current = "";
      setDeviceError(`Open output popout: ${error instanceof Error ? error.message : String(error)}`);
      requestAnimationFrame(() => setOutputOwnerPhase("studio"));
    }
  };

  const closeOutputPopout = () => {
    if (outputOwnerBusy(outputOwnerPhase)) {
      pushToast({ type: "warning", title: "Output is busy", message: "Stop the recording and let the popout finish encoding before returning its renderer." });
      return;
    }
    setOutputOwnerPhase("closing");
    postToOutput({ type: "shutdown" });
    const ownerId = outputSessionRef.current;
    window.setTimeout(() => {
      if (outputSessionRef.current !== ownerId || (outputOwnerPhaseRef.current !== "closing" && outputOwnerPhaseRef.current !== "restoring")) return;
      webPopoutRef.current?.close();
      outputSessionRef.current = "";
      setOutputOwnerPhase("studio");
      pushToast({ type: "warning", title: "Output handoff timed out", message: "The studio renderer was restored after the popout did not complete its shutdown acknowledgement." });
    }, 6_000);
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

  const enumerateDevices = useCallback(async () => {
    if (!navigator.mediaDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameraOptions = devices
      .filter((device) => device.kind === "videoinput")
      .map((device, index) => ({ id: device.deviceId, label: device.label || `Camera ${index + 1}` }));
    const microphoneOptions = devices
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }));
    setCameras(cameraOptions);
    setMicrophones(microphoneOptions);
    setSettings((current) => ({
      ...current,
      cameraId: cameraOptions.some((device) => device.id === current.cameraId)
        ? current.cameraId : cameraOptions[0]?.id ?? "",
      microphoneId: microphoneOptions.some((device) => device.id === current.microphoneId)
        ? current.microphoneId : microphoneOptions[0]?.id ?? "",
    }));
  }, []);

  useEffect(() => {
    enumerateDevices();
    navigator.mediaDevices?.addEventListener("devicechange", enumerateDevices);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", enumerateDevices);
  }, [enumerateDevices]);

  const requestDeviceAccess = async () => {
    setPermissionState("asking");
    setDevicePromptDismissed(false);
    setDeviceError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState("error");
      setCameraAccess("unavailable");
      setMicrophoneAccess("unavailable");
      setDeviceError("Capture devices: this system does not expose the MediaDevices API. The avatar editor can still be used without a camera.");
      return;
    }
    try {
      const [cameraResult, microphoneResult] = await Promise.allSettled([
        navigator.mediaDevices.getUserMedia({ video: true, audio: false }),
        navigator.mediaDevices.getUserMedia({ video: false, audio: true }),
      ]);
      if (cameraResult.status === "fulfilled") cameraResult.value.getTracks().forEach((track) => track.stop());
      if (microphoneResult.status === "fulfilled") microphoneResult.value.getTracks().forEach((track) => track.stop());
      const cameraReady = cameraResult.status === "fulfilled";
      const microphoneReady = microphoneResult.status === "fulfilled";
      setCameraAccess(cameraReady ? "ready" : "unavailable");
      setMicrophoneAccess(microphoneReady ? "ready" : "unavailable");
      await enumerateDevices();
      if (!cameraReady && !microphoneReady) {
        const cameraReason = cameraResult.status === "rejected" ? String(cameraResult.reason) : "Unavailable";
        const microphoneReason = microphoneResult.status === "rejected" ? String(microphoneResult.reason) : "Unavailable";
        setPermissionState("error");
        setDeviceError(`Capture access was not granted. Camera: ${cameraReason}. Microphone: ${microphoneReason}. You can continue without capture devices and use the avatar manually.`);
        return;
      }
      setPermissionState("ready");
      const connected = [cameraReady && "camera", microphoneReady && "microphone"].filter(Boolean).join(" and ");
      const unavailable = [!cameraReady && "camera", !microphoneReady && "microphone"].filter(Boolean).join(" and ");
      pushToast({
        type: unavailable ? "warning" : "success",
        title: unavailable ? "Some capture hardware is unavailable" : "Capture devices connected",
        message: `${connected[0].toUpperCase() + connected.slice(1)} access is ready. Available capture processing remains local to this computer.${unavailable ? ` ${unavailable[0].toUpperCase() + unavailable.slice(1)} access is unavailable, but the avatar editor still works.` : ""}`,
        detail: unavailable ? `${unavailable[0].toUpperCase() + unavailable.slice(1)} access was unavailable or not granted. Offline avatar editing and rendering remain usable.` : undefined,
        duration: unavailable ? 8_000 : 5_000,
      });
    } catch (error) {
      setPermissionState("error");
      setDeviceError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (cameraAccess !== "ready" || !settings.cameraId) return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: settings.cameraId },
        frameRate: { ideal: settings.cameraFps },
        width: { ideal: 1280 }, height: { ideal: 720 },
      },
      audio: false,
    }).then((stream) => {
      if (cancelled) return stream.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = stream;
      stream.getVideoTracks().forEach((track) => { track.enabled = !capturePausedRef.current; });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    }).catch((error) => {
      setCameraAccess("unavailable");
      setDeviceError(`Camera stream: ${error instanceof Error ? error.message : String(error)}. Manual avatar tools remain available.`);
    });
    return () => { cancelled = true; };
  }, [cameraAccess, settings.cameraFps, settings.cameraId]);

  useEffect(() => {
    if (microphoneAccess !== "ready" || !settings.microphoneId) return;
    let stopped = false;
    let animation = 0;
    navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        deviceId: { exact: settings.microphoneId },
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      },
    }).then((stream) => {
      if (stopped) return stream.getTracks().forEach((track) => track.stop());
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => { track.enabled = !mutedRef.current && !capturePausedRef.current; });

      const context = new AudioContext();
      audioContextRef.current?.close();
      audioContextRef.current = context;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      const monitor = context.createGain();
      monitor.gain.value = monitoringRef.current ? 0.8 : 0;
      monitorNodeRef.current = monitor;
      source.connect(analyser);
      source.connect(monitor).connect(context.destination);
      const data = new Float32Array(analyser.fftSize);
      let peak = 0;
      let lastUpdate = 0;
      const tick = (now: number) => {
        if (capturePausedRef.current) {
          if (now - lastUpdate > 32) {
            setAudioLevel(0);
            setAudioPeak(0);
            lastUpdate = now;
          }
          animation = requestAnimationFrame(tick);
          return;
        }
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const sample of data) sum += sample * sample;
        const rms = Math.sqrt(sum / data.length);
        const scaled = Math.min(1, Math.max(0, (20 * Math.log10(Math.max(rms, 1e-7)) + 60) / 60));
        peak = Math.max(scaled, peak * 0.985);
        if (now - lastUpdate > 32) {
          setAudioLevel(mutedRef.current || capturePausedRef.current ? 0 : scaled);
          setAudioPeak(mutedRef.current || capturePausedRef.current ? 0 : peak);
          lastUpdate = now;
        }
        animation = requestAnimationFrame(tick);
      };
      tick(0);
    }).catch((error) => {
      setMicrophoneAccess("unavailable");
      setDeviceError(`Microphone stream: ${error instanceof Error ? error.message : String(error)}. Silent avatar recording remains available.`);
    });
    return () => {
      stopped = true;
      cancelAnimationFrame(animation);
    };
  }, [microphoneAccess, settings.microphoneId]);

  useEffect(() => {
    micStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !settings.muted && !capturePausedRef.current;
    });
  }, [settings.muted]);

  useEffect(() => {
    if (monitorNodeRef.current) monitorNodeRef.current.gain.value = monitoring ? 0.8 : 0;
  }, [monitoring]);

  useEffect(() => {
    if (cameraAccess !== "ready") {
      setTrackerStatus("idle");
      setTrackerDelegate("—");
      return;
    }
    trackerBusyRef.current = false;
    trackerBusySinceRef.current = 0;
    trackerFrameErrorsRef.current = 0;
    const worker = new Worker(new URL("./faceTracker.worker.ts", import.meta.url), { type: "module" });
    trackerWorkerRef.current = worker;
    setTrackerStatus("loading");
    worker.onmessage = (event) => {
      if (event.data.type === "ready") {
        const reloadReason = trackerReloadReasonRef.current;
        trackerReloadReasonRef.current = null;
        trackerRecoveryPendingRef.current = false;
        trackerLastActivityRef.current = performance.now();
        trackerFrameErrorsRef.current = 0;
        setTrackerStatus("ready");
        setTrackerDelegate(event.data.delegate === "CPU" && event.data.fallbackReason ? "CPU fallback" : event.data.delegate);
        setTrackerFallbackReason(event.data.fallbackReason ?? "");
        if (event.data.delegate === "GPU") {
          setGpuProbe({ available: true, reason: "GPU delegate initialized successfully" });
        } else {
          setCpuProbe({ available: true, reason: "CPU delegate initialized successfully" });
        }
        if (event.data.fallbackReason) {
          setGpuProbe({ available: false, reason: event.data.fallbackReason });
        }
        setDeviceError((current) => current.startsWith("MediaPipe tracker:") ? "" : current);
        if (event.data.fallbackReason) {
          pushToast({
            type: "warning",
            title: "GPU tracking unavailable",
            message: "MediaPipe is running locally on CPU fallback. Tracking still works, but may use more processor time.",
            detail: event.data.fallbackReason,
            duration: 8_000,
          });
        }
        if (reloadReason) {
          pushToast({
            type: "success",
            title: "MediaPipe tracker ready",
            message: reloadReason === "manual"
              ? "The local face model was reloaded successfully. Live avatar motion and landmarks can resume."
              : "Face tracking recovered successfully without changing your avatar, calibration, or settings.",
          });
        }
      }
      if (event.data.type === "fallback") {
        setTrackerDelegate("GPU → CPU");
        setGpuProbe({ available: false, reason: event.data.message });
      }
      if (event.data.type === "result") {
        trackerLastActivityRef.current = performance.now();
        trackerFrameErrorsRef.current = 0;
        if (capturePausedRef.current) return;
        const rawFrame = event.data.frame as TrackingFrame | null;
        if (rawFrame) {
          const smoothed = trackingSmootherRef.current.smooth(
            rawFrame,
            trackingSmoothingRef.current,
            motionSmoothingRef.current,
          );
          smoothed.mouthOpen = mouthOpenGateRef.current.update(smoothed, neutralFrameRef.current, mouthDeadZoneRef.current);
          setTrackingFrame(smoothed);
        } else {
          trackingSmootherRef.current.reset();
          mouthOpenGateRef.current.reset();
          setTrackingFrame(null);
        }
      }
      if (event.data.type === "frame-error") {
        trackerLastActivityRef.current = performance.now();
        trackerFrameErrorsRef.current += 1;
        if (trackerFrameErrorsRef.current >= 3 && !trackerRecoveryPendingRef.current) {
          reloadTracker(`MediaPipe failed to process ${trackerFrameErrorsRef.current} consecutive camera frames. The GPU context may have been interrupted, so the tracker is restarting automatically.`);
        }
      }
      if (event.data.type === "idle") {
        trackerBusyRef.current = false;
        trackerBusySinceRef.current = 0;
      }
      if (event.data.type === "error") {
        trackerRecoveryPendingRef.current = false;
        trackerReloadReasonRef.current = null;
        trackerBusyRef.current = false;
        trackerBusySinceRef.current = 0;
        setTrackerStatus("error");
        if (event.data.requestedBackend === "gpu") {
          setGpuProbe({ available: false, reason: event.data.message });
        }
        if (event.data.requestedBackend === "cpu") {
          setCpuProbe({ available: false, reason: event.data.message });
        }
        if (event.data.requestedBackend === "auto") {
          setCpuProbe({ available: false, reason: event.data.message });
        }
        setDeviceError(`MediaPipe tracker: ${event.data.message}`);
      }
    };
    worker.onerror = (event) => {
      trackerRecoveryPendingRef.current = false;
      trackerReloadReasonRef.current = null;
      trackerBusyRef.current = false;
      trackerBusySinceRef.current = 0;
      setTrackerStatus("error");
      setDeviceError(`MediaPipe tracker: the tracking worker stopped unexpectedly (${event.message || "unknown worker error"}). Use Reload tracker to recover.`);
    };
    worker.onmessageerror = () => {
      trackerBusyRef.current = false;
      trackerBusySinceRef.current = 0;
      setTrackerStatus("error");
      setDeviceError("MediaPipe tracker: the tracking worker returned unreadable frame data. Use Reload tracker to recover.");
    };
    worker.postMessage({ type: "init", preference: settings.trackingBackend });
    return () => {
      worker.terminate();
      trackerBusyRef.current = false;
      trackerBusySinceRef.current = 0;
      if (trackerWorkerRef.current === worker) trackerWorkerRef.current = null;
    };
  }, [cameraAccess, pushToast, reloadTracker, settings.trackingBackend, trackerRestartKey]);

  useEffect(() => {
    if (trackerStatus !== "ready") return;
    let animation = 0;
    let lastCapture = 0;
    const capture = async (now: number) => {
      if (capturePausedRef.current) {
        animation = requestAnimationFrame(capture);
        return;
      }
      const video = videoRef.current;
      const interval = 1000 / Math.max(1, settings.trackingFps);
      if (trackerBusyRef.current && trackerBusySinceRef.current > 0 && now - trackerBusySinceRef.current > 4_000 && !trackerRecoveryPendingRef.current) {
        reloadTracker("MediaPipe stopped returning camera frames for four seconds. The local tracking worker is being restarted automatically.");
      }
      if (video && video.readyState >= 2 && now - lastCapture >= interval && !trackerBusyRef.current) {
        trackerBusyRef.current = true;
        trackerBusySinceRef.current = now;
        lastCapture = now;
        try {
          const bitmap = await createImageBitmap(video);
          trackerWorkerRef.current?.postMessage({ type: "frame", bitmap, timestamp: now }, [bitmap]);
        } catch {
          trackerBusyRef.current = false;
          trackerBusySinceRef.current = 0;
        }
      }
      animation = requestAnimationFrame(capture);
    };
    animation = requestAnimationFrame(capture);
    return () => cancelAnimationFrame(animation);
  }, [reloadTracker, settings.trackingFps, trackerStatus]);

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

  const calibrate = async () => {
    if (recordingState !== "idle" || !trackingFrame) return;
    const session = ++calibrationSessionRef.current;
    setCalibrating(true);
    setCalibrationComplete(false);
    setCountdown(null);
    let readySince: number | null = null;
    let stableAnchor: Pick<FaceAlignment, "centerX" | "centerY" | "sizeRatio"> | null = null;

    while (calibrationSessionRef.current === session) {
      const alignment = faceAlignmentRef.current;
      const currentFrame = trackingFrameRef.current;
      if (alignment.status !== "ready" || !currentFrame) {
        readySince = null;
        stableAnchor = null;
        setCountdown(null);
      } else {
        const now = performance.now();
        const movedSinceAnchor = stableAnchor
          && alignment.centerX !== undefined && alignment.centerY !== undefined && alignment.sizeRatio !== undefined
          && stableAnchor.centerX !== undefined && stableAnchor.centerY !== undefined && stableAnchor.sizeRatio !== undefined
          && (
            Math.hypot(alignment.centerX - stableAnchor.centerX, alignment.centerY - stableAnchor.centerY) > 0.018
            || Math.abs(alignment.sizeRatio - stableAnchor.sizeRatio) > 0.035
          );
        if (!stableAnchor || movedSinceAnchor) {
          stableAnchor = {
            centerX: alignment.centerX,
            centerY: alignment.centerY,
            sizeRatio: alignment.sizeRatio,
          };
          readySince = now;
        }
        readySince ??= now;
        const elapsed = performance.now() - readySince;
        if (elapsed >= 3_000) {
          setNeutralFrame(currentFrame);
          neutralFrameRef.current = currentFrame;
          mouthOpenGateRef.current.reset();
          setCountdown(null);
          setCalibrationComplete(true);
          pushToast({
            type: "success",
            title: "Neutral pose calibrated",
            message: "The aligned live frame is now the neutral baseline for head movement and expressions.",
          });
          window.setTimeout(() => {
            if (calibrationSessionRef.current !== session) return;
            setCalibrating(false);
            setCalibrationComplete(false);
          }, 700);
          return;
        }
        setCountdown(Math.max(1, 3 - Math.floor(elapsed / 1_000)));
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  };

  const cancelCalibration = () => {
    calibrationSessionRef.current += 1;
    setCalibrating(false);
    setCalibrationComplete(false);
    setCountdown(null);
  };

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
      const audioTrack = cloneLiveAudioTrack(micStreamRef.current, settings.muted);
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
        await beginOutputRecording({
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
        const audioTrack = cloneLiveAudioTrack(micStreamRef.current, settings.muted);
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
      const requestId = activeOutputRecordingRequestRef.current;
      if (requestId) postToOutput({ type: "record", action: "stop", requestId });
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
      setNeutralFrame(importedAppearance.neutralFrame);
      neutralFrameRef.current = importedAppearance.neutralFrame;
      mouthOpenGateRef.current.reset();
      updateSetting("avatarKind", importedAppearance.settings.avatarKind);
      setManualExpressions(importedAppearance.manualExpressions);
      setFrozenExpressions(importedAppearance.frozenExpressions);
      setIdentityVertices(importedAppearance.identityVertices);
      if (importedAppearance.identityWeights) {
        identityEvaluationSkipRef.current = importedAppearance.identityWeights;
        identityWeightsRef.current = importedAppearance.identityWeights;
        setIdentityWeights(importedAppearance.identityWeights);
      }
      if (importedAppearance.gnmExpressionWeights) setGnmExpressionWeights(importedAppearance.gnmExpressionWeights);
      setGnmFrozenExpressionComponents(importedAppearance.gnmFrozenExpressionComponents ?? {});
      setIdentitySeed(importedAppearance.identityParameters.seed);
      setIdentityGender(importedAppearance.identityParameters.presentation);
      setIdentityEthnicity(importedAppearance.identityParameters.population);
      setIdentityPresentationStrength(importedAppearance.identityParameters.presentationStrength);
      if (importedAppearance.identityParameters.populationWeights) setIdentityPopulationWeights(importedAppearance.identityParameters.populationWeights);
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
      scheduleTrackerHealthCheck("JSON export");
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
        await beginOutputRecording({
          requestId,
          fps: settings.exportFps,
          videoBitrate: quality.videoBitrate,
          audioBitrate: quality.audioBitrate,
          retainedAudio: editedAudio ?? undefined,
          useLiveMicrophone: false,
          forceWebm,
        });
        const completed = waitForOutputRecordingResult(requestId);
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
        postToOutput({ type: "record", action: "stop", requestId });
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
        const requestId = crypto.randomUUID?.() ?? `png-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const result = new Promise<Blob>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            outputPngWaitersRef.current.delete(requestId);
            reject(new Error("The popout did not return the PNG within 15 seconds."));
          }, 15_000);
          outputPngWaitersRef.current.set(requestId, { resolve, reject, timer });
        });
        postToOutput({ type: "capture-png", requestId, width, height });
        return result;
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
      scheduleTrackerHealthCheck("WebM export");
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
      scheduleTrackerHealthCheck("PNG sequence export");
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
      scheduleTrackerHealthCheck("MP4 export");
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
      scheduleTrackerHealthCheck("WebM export");
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
      scheduleTrackerHealthCheck("GLB export");
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
    const video = videoRef.current;
    if (!video || !cameraStreamRef.current) return;
    if (video.srcObject !== cameraStreamRef.current) video.srcObject = cameraStreamRef.current;
    void video.play().catch(() => undefined);
  }, [popoutState]);

  useEffect(() => {
    if (popoutState !== "active") return;
    const snapshot: OutputSnapshot = {
      settings: stageSettings,
      frame: displayedFrameRef.current,
      neutralFrame: stageNeutralFrame,
      identityVertices: stageIdentityVertices,
      manualExpressions: stageManualExpressions,
      frozenExpressions: stageFrozenExpressions,
      trackingReady: Boolean(trackingFrameRef.current),
      capturePaused,
      recordingActive: motionVideoRendering || pngSequenceRendering || recordingState !== "idle",
      resetViewSignal,
      backgroundImageUrl: stageBackgroundImageUrl,
      viewState: stageAppearance?.viewState ?? currentViewStateRef.current,
    };
    postToOutput({ type: "snapshot", snapshot });
  }, [captureFinalizing, capturePaused, motionVideoRendering, pngSequenceRendering, popoutState, recordingState, resetViewSignal, stageAppearance, stageBackgroundImageUrl, stageFrozenExpressions, stageIdentityVertices, stageManualExpressions, stageNeutralFrame, stageSettings]);

  useEffect(() => {
    if (popoutState !== "active") return;
    postToOutput({ type: "frame", frame: displayedFrame, trackingReady: Boolean(trackingFrame) });
  }, [displayedFrame, popoutState, trackingFrame]);

  return (
    <>
    <main
      className={`app-shell ${isWebEdition ? "web-edition" : "desktop-edition"} ${leftSidebarCollapsed ? "left-sidebar-collapsed" : ""} ${rightSidebarCollapsed ? "right-sidebar-collapsed" : ""} ${recordingState === "recording" ? "is-recording" : ""} ${fullscreen ? "viewport-focus" : ""} ${outputControlsHidden ? "output-controls-hidden" : ""}`}
      style={{ "--ui-scale": (uiScale / 100).toFixed(2) } as React.CSSProperties}
      onPointerMove={fullscreen ? scheduleOutputControls : undefined}
    >
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><span className="brand-head-icon" style={brandHeadIconStyle} /></span><div><strong>GNM</strong><span>Studio</span></div>{isWebEdition && <small className="edition-badge">WEB</small>}</div>
        <nav className="workspace-tabs" aria-label="Workspace">
          {(["capture", "create", "edit", "export"] as Workspace[]).map((workspace) => (
            <button
              type="button"
              key={workspace}
              className={activeWorkspace === workspace ? "active" : ""}
              aria-current={activeWorkspace === workspace ? "page" : undefined}
              onClick={() => activateWorkspace(workspace)}
            >
              {workspace[0].toUpperCase() + workspace.slice(1)}
            </button>
          ))}
        </nav>
        <div className="system-status">
          <button type="button" className={`capture-pause-button ${capturePaused ? "paused" : ""}`} onClick={toggleCaptureProcessing} disabled={calibrating || captureFinalizing || (cameraAccess !== "ready" && microphoneAccess !== "ready")} title={capturePaused ? "Resume face tracking, microphone, and any active take (P)" : "Pause face tracking, microphone, and any active take (P)"} aria-label={capturePaused ? "Resume face tracking, microphone, and any active take" : "Pause face tracking, microphone, and any active take"} aria-keyshortcuts="P" aria-pressed={capturePaused}>{capturePaused ? <PhosphorPlay size={15} weight="fill" /> : <PhosphorPause size={15} weight="fill" />}</button>
          <span className="device-status" title={captureStatusTitle} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openBackendMenu(event.clientX, event.clientY); }}><span className={`capture-device-icon ${cameraAccess === "ready" ? capturePaused ? "paused" : "ready" : "unavailable"}`} title={`Camera ${cameraAccess === "ready" ? capturePaused ? "paused" : "ready" : "not connected"}`}><PhosphorCamera size={14} weight="fill" /></span><span className={`capture-device-icon ${microphoneAccess === "ready" ? capturePaused ? "paused" : "ready" : "unavailable"}`} title={`Microphone ${microphoneAccess === "ready" ? capturePaused ? "paused" : "ready" : "not connected"}`}><PhosphorMicrophone size={14} weight="fill" /></span><b>{connectedCaptureCount}/2</b></span>
          <button
            className={`backend-status ${backendMenu ? "active" : ""}`}
            title="Click or right-click to choose Auto, GPU, or CPU tracking"
            aria-haspopup="menu"
            aria-expanded={Boolean(backendMenu)}
            onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openBackendMenu(rect.right - 232, rect.bottom + 7); }}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openBackendMenu(event.clientX, event.clientY); }}
          ><i className={trackerStatus === "ready" ? capturePaused ? "paused" : "online" : ""} />{capturePaused && trackerStatus === "ready" ? "Paused" : trackerDelegate}</button>
          {recordingState !== "idle" && <span className="recording-pill">● REC {formatTime(recordingElapsed)}</span>}
          <button
            className={`icon-button ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen((value) => !value)}
            title="Appearance settings"
            aria-expanded={settingsOpen}
          ><Settings2 size={18} /></button>
        </div>
      </header>

      <aside className={`sidebar left-sidebar ${leftSidebarCollapsed ? "collapsed" : ""}`}>
        <button type="button" className="sidebar-collapse-toggle" aria-label={leftSidebarCollapsed ? "Expand left sidebar" : "Collapse left sidebar"} title={leftSidebarCollapsed ? "Expand left sidebar" : "Collapse left sidebar"} onClick={() => setLeftSidebarCollapsed((value) => !value)}><ChevronDown size={15} /></button>
        <div className="sidebar-tabs">
          <button className={activePanel === "avatar" ? "active" : ""} onClick={() => { setActivePanel("avatar"); setActiveWorkspace("create"); }}><WandSparkles size={16} />Avatar</button>
          <button className={activePanel === "capture" ? "active" : ""} onClick={() => { setActivePanel("capture"); setActiveWorkspace("capture"); }}><Camera size={16} />Capture</button>
        </div>
        {activePanel === "avatar" ? (
          <>
            <section className="panel-section model-picker" data-workspace-target="create">
              <div className="section-heading"><span>Mocap model</span><small>Local avatars</small></div>
              <div className="model-choice-list" role="radiogroup" aria-label="Mocap avatar model">
                {(["gnm", "facecap"] as AvatarKind[]).map((avatarKind) => {
                  const selected = settings.avatarKind === avatarKind;
                  const facecap = avatarKind === "facecap";
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`model-choice-card ${selected ? "active" : ""}`}
                      key={avatarKind}
                      onClick={() => {
                        if (selected) return;
                        updateSetting("avatarKind", avatarKind);
                        pushToast({ type: "info", title: `${avatarProfiles[avatarKind].label} selected`, message: facecap ? "MediaPipe now drives all 52 FaceCap morph targets directly." : "GNM semantic deformation and seeded desktop identities are active." });
                      }}
                    >
                      <span className="model-choice-icon">{facecap ? <Aperture size={20} /> : <Box size={20} />}</span>
                      <span className="model-choice-copy">
                        <strong>{facecap ? "FaceCap 52" : "GNM Head v3"}</strong>
                        <small>{facecap ? "Direct 52-channel tracking" : "Seeded identity + semantic controls"}</small>
                      </span>
                      <span className="model-choice-meta"><em>{facecap ? "MIT" : "GNM"}</em>{selected && <Check size={15} />}</span>
                    </button>
                  );
                })}
              </div>
              <p className="model-choice-detail">{settings.avatarKind === "gnm" ? `${(gnmInfo?.vertices ?? 17_821).toLocaleString()} vertices · ${(gnmInfo?.identityDimensions ?? 253) + (gnmInfo?.expressionDimensions ?? 383)} native controls` : "52 MediaPipe/ARKit morph targets · bundled offline KTX2 materials"}</p>
            </section>
            {activeProfile.supportsIdentity && (
              <section className="panel-section">
                <div className="section-heading"><span>Identity</span><button onClick={randomizeIdentity} disabled={identityStatus === "generating" || recordingState !== "idle"}><RefreshCw size={14} />{identityStatus === "generating" ? "Generating" : "Randomize"}</button></div>
                <label className="field-label">Seed<input className="text-input" value={identitySeed} disabled={recordingState !== "idle"} onChange={(event) => setIdentitySeed(event.target.value)} /></label>
                <div className="two-up"><label className="field-label">Presentation<select value={identityGender} disabled={recordingState !== "idle"} onChange={(event) => chooseIdentityPresentation(event.target.value as typeof identityGender)}><option value="blend">Blend</option><option value="female">Feminine</option><option value="male">Masculine</option></select></label><label className="field-label">Population<select value={identityEthnicity} disabled={recordingState !== "idle"} onChange={(event) => chooseIdentityPopulation(event.target.value as typeof identityEthnicity)}><option value="blend">Blend</option><option value="asian">Asian</option><option value="black">Black</option><option value="middle_eastern">Middle Eastern</option><option value="white">White</option></select></label></div>
                <label className="slider-row identity-presentation-strength"><span>Feminine</span><input type="range" min="-100" max="100" step="1" value={identityPresentationStrength * 100} disabled={recordingState !== "idle"} onChange={(event) => { const value = Number(event.target.value) / 100; setIdentityPresentationStrength(value); setIdentityGender(Math.abs(value) < 0.01 ? "blend" : value < 0 ? "female" : "male"); }} /><output>{Math.round(identityPresentationStrength * 100)}</output><small>Masculine</small></label>
                <button type="button" className="secondary-button wide identity-compare" disabled={recordingState !== "idle"} onClick={compareIdentityPresentation}><ArrowLeftRight size={13} />Compare feminine / masculine with this seed</button>
                <details className="advanced-expression identity-population-blend">
                  <summary><SlidersHorizontal size={14} />Population blend<small>Weighted</small></summary>
                  {(["Middle Eastern", "Asian", "White", "Black"] as const).map((label, index) => <label className="slider-row" key={label}><span>{label}</span><input type="range" min="0" max="100" value={identityPopulationWeights[index] * 100} disabled={recordingState !== "idle"} onChange={(event) => updateIdentityPopulationWeight(index, Number(event.target.value) / 100)} /><output>{Math.round(identityPopulationWeights[index] * 100)}</output></label>)}
                </details>
                <button className="secondary-button wide" onClick={() => void generateIdentity()} disabled={identityStatus === "generating" || recordingState !== "idle"}>{identityStatus === "generating" ? isWebEdition ? webIdentityBackend === "webgpu" ? "Building with WebGPU…" : "Building in web worker…" : "Building GNM mesh…" : isWebEdition ? "Apply identity locally" : "Apply identity"}</button>
                {isWebEdition && <p className="helper-copy web-edition-note">The compressed identity runtime evaluates locally in a dedicated worker. {webIdentityBackend === "webgpu" ? "WebGPU compute is active." : webIdentityBackend === "cpu" ? "This device is using the compatible CPU-worker fallback." : "WebGPU is selected automatically when this browser supports it."} Camera tracking and the interface remain responsive.</p>}
              </section>
            )}
            <details className="panel-section experimental-skin full-state-presets">
              <summary><span><strong>Named presets</strong><small>Full model state</small></span><span className="skin-summary-state">{fullStatePresets.length} saved<ChevronDown size={14} /></span></summary>
              <div className="experimental-skin-content">
                <label className="field-label">Saved preset<select value={selectedPresetId} disabled={!fullStatePresets.length || recordingState !== "idle"} onChange={(event) => { const id = event.target.value; setSelectedPresetId(id); const preset = fullStatePresets.find((entry) => entry.id === id); if (preset) setPresetName(preset.name); }}><option value="">{fullStatePresets.length ? "Choose a preset" : "No presets saved"}</option>{fullStatePresets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label>
                <label className="field-label">Preset name<input value={presetName} maxLength={80} disabled={recordingState !== "idle"} onChange={(event) => setPresetName(event.target.value)} /></label>
                <div className="preset-action-grid">
                  <button type="button" className="primary-button" disabled={recordingState !== "idle" || !presetName.trim()} onClick={saveNewFullStatePreset}>Save new</button>
                  <button type="button" className="secondary-button" disabled={recordingState !== "idle" || !selectedPresetId} onClick={loadSelectedFullStatePreset}>Load</button>
                  <button type="button" className="secondary-button" disabled={recordingState !== "idle" || !selectedPresetId} onClick={updateSelectedFullStatePreset}>Update</button>
                  <button type="button" className="secondary-button" disabled={recordingState !== "idle" || !selectedPresetId || !presetName.trim()} onClick={renameSelectedFullStatePreset}>Rename</button>
                  <button type="button" className="secondary-button danger" disabled={recordingState !== "idle" || !selectedPresetId} onClick={deleteSelectedFullStatePreset}>Delete</button>
                </div>
                <div className="preset-bundle-actions"><button type="button" className="secondary-button" disabled={recordingState !== "idle"} onClick={() => presetInputRef.current?.click()}><Upload size={13} />Import bundle</button><button type="button" className="secondary-button" disabled={!fullStatePresets.length} onClick={() => void exportPresetBundle()}><Download size={13} />Export bundle</button></div>
                <p className="helper-copy">Presets include the avatar, identity conditioning, all 383 GNM values, manual/frozen controls, materials, layers, calibration and view. Bundles are version-checked before loading.</p>
              </div>
            </details>
            <details className="panel-section experimental-skin">
              <summary><span><strong>Skin material</strong><small>Experimental</small></span><span className={settings.skinTextureEnabled ? "skin-summary-state enabled" : "skin-summary-state"}>{settings.skinTextureEnabled ? "Microtexture on" : "Microtexture off"}<ChevronDown size={14} /></span></summary>
              <div className="experimental-skin-content">
                <label className={`toggle-row ${settings.skinTextureEnabled ? "is-active" : ""}`}><span>Skin microtexture<small>{settings.skinTextureEnabled ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.skinTextureEnabled} onChange={(event) => updateSetting("skinTextureEnabled", event.target.checked)} /></label>
                <div className="skin-tone-field">
                  <span>Base colour · Neutral disables skin tint</span>
                  <div className="skin-tone-options" role="radiogroup" aria-label="Skin base colour">
                    {skinToneOptions.map((tone) => <button type="button" key={tone.id} role="radio" aria-checked={settings.skinTone === tone.id} className={settings.skinTone === tone.id ? "active" : ""} style={{ "--skin-tone": tone.swatch } as React.CSSProperties} title={tone.label} onClick={() => updateSetting("skinTone", tone.id)}><span /><small>{tone.label}</small></button>)}
                  </div>
                </div>
                <label className="slider-row"><span>Texture scale</span><input type="range" min="2" max="20" step="0.5" disabled={!settings.skinTextureEnabled} value={settings.skinTextureScale} onChange={(event) => updateSetting("skinTextureScale", Number(event.target.value))} /><output>{settings.skinTextureScale.toFixed(1)}×</output></label>
                <label className="slider-row"><span>Rotation</span><input type="range" min="-180" max="180" step="1" disabled={!settings.skinTextureEnabled} value={settings.skinTextureRotation} onChange={(event) => updateSetting("skinTextureRotation", Number(event.target.value))} /><output>{settings.skinTextureRotation}°</output></label>
                <label className="slider-row"><span>Seam feather</span><input type="range" min="0" max="30" step="1" disabled={!settings.skinTextureEnabled} value={settings.skinTextureFeather * 100} onChange={(event) => updateSetting("skinTextureFeather", Number(event.target.value) / 100)} /><output>{Math.round(settings.skinTextureFeather * 100)}%</output></label>
                <p className="helper-copy">The base pigment works with texture on or off. Studio lighting still creates natural highlights and shadows. Feather blends opposite tile edges; high values soften pore contrast near each repeat.</p>
              </div>
            </details>
            <details className="panel-section experimental-skin eye-appearance">
              <summary><span><strong>Eye appearance</strong><small>Both avatars</small></span><span className={settings.eyeShaderEnabled ? "skin-summary-state enabled" : "skin-summary-state"}>{settings.eyeShaderEnabled ? eyeColorOptions.find((option) => option.id === settings.eyeColor)?.label : "Original eyes"}<ChevronDown size={14} /></span></summary>
              <div className="experimental-skin-content">
                <label className={`toggle-row ${settings.eyeShaderEnabled ? "is-active" : ""}`}><span>Eye shader<small>{settings.eyeShaderEnabled ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.eyeShaderEnabled} onChange={(event) => updateSetting("eyeShaderEnabled", event.target.checked)} /></label>
                <div className="skin-tone-field">
                  <span>Iris colour</span>
                  <div className="eye-color-options" role="radiogroup" aria-label="Iris colour">
                    {eyeColorOptions.map((option) => <button type="button" key={option.id} role="radio" aria-checked={settings.eyeColor === option.id} className={settings.eyeColor === option.id ? "active" : ""} disabled={!settings.eyeShaderEnabled} style={{ "--eye-color": option.swatch } as React.CSSProperties} title={option.label} onClick={() => updateSetting("eyeColor", option.id)}><span /><small>{option.label}</small></button>)}
                  </div>
                </div>
                <p className="helper-copy">The shader preserves black pupils, natural sclera, highlights and tracked gaze. Turn it off to use the model's original eye appearance.</p>
              </div>
            </details>
            <section className="panel-section" data-workspace-target="edit">
              <div className="section-heading"><span>Expression</span><small>{Object.keys(frozenExpressions).length ? `${Object.keys(frozenExpressions).length} frozen` : `${activeProfile.expressionCount} ${activeProfile.shortLabel} controls`}</small></div>
              {settings.avatarKind === "gnm" && semanticExpressionNames.slice(0, 6).map((name) => (
                <ExpressionControl
                  key={name}
                  name={name}
                  value={name in frozenExpressions ? frozenExpressions[name] : manualExpressions[name] ?? 0}
                  frozen={name in frozenExpressions}
                  onChange={(value) => setManualExpressions((current) => ({ ...current, [name]: value }))}
                  onToggle={() => toggleExpressionFreeze(name)}
                />
              ))}
              {settings.avatarKind === "gnm" && <details className="advanced-expression">
                <summary><SlidersHorizontal size={15} />All semantic controls</summary>
                {semanticExpressionNames.slice(6).map((name) => (
                  <ExpressionControl
                    key={name}
                    name={name}
                    value={name in frozenExpressions ? frozenExpressions[name] : manualExpressions[name] ?? 0}
                    frozen={name in frozenExpressions}
                    onChange={(value) => setManualExpressions((current) => ({ ...current, [name]: value }))}
                    onToggle={() => toggleExpressionFreeze(name)}
                  />
                ))}
              </details>}
              {settings.avatarKind === "gnm" && <GnmExpressionEditor
                semanticNames={semanticExpressionNames}
                semanticA={gnmExpressionA}
                semanticB={gnmExpressionB}
                seedA={gnmExpressionSeedA}
                seedB={gnmExpressionSeedB}
                blend={gnmExpressionBlend}
                weights={gnmExpressionWeights}
                frozen={gnmFrozenExpressionComponents}
                ready={expressionDecoderReady}
                busy={gnmExpressionStatus === "evaluating"}
                backend={isDesktopRuntime ? "Native Rust" : webIdentityBackend === "webgpu" ? "WebGPU worker" : "CPU worker"}
                disabled={recordingState !== "idle" || captureFinalizing}
                onSemanticA={(value) => { setGnmExpressionA(value); setGnmExpressionAbActive(true); }}
                onSemanticB={(value) => { setGnmExpressionB(value); setGnmExpressionAbActive(true); }}
                onSeedA={(value) => { setGnmExpressionSeedA(value); setGnmExpressionAbActive(true); }}
                onSeedB={(value) => { setGnmExpressionSeedB(value); setGnmExpressionAbActive(true); }}
                onResampleA={() => resampleExpressionSeed("a")}
                onResampleB={() => resampleExpressionSeed("b")}
                onBlend={(value) => { setGnmExpressionBlend(value); setGnmExpressionAbActive(true); }}
                onWeight={setRawGnmExpressionWeight}
                onToggleFreeze={toggleRawGnmExpressionFreeze}
                onMirror={mirrorRawGnmExpression}
                onReset={resetRawGnmExpression}
              />}
              <details className="advanced-expression manual-joint-controls">
                <summary><SlidersHorizontal size={15} />Neck, head, eyes and XYZ<small>Offsets</small></summary>
                <p className="helper-copy">Signed offsets layer on top of webcam motion. Freeze any channel to keep that value while the remaining tracked controls continue moving.</p>
                {manualJointGroups.map((group) => <div className="joint-control-group" key={group.label}><strong>{group.label}</strong>{group.controls.map(([name, label]) => <JointControl key={name} name={name} label={label} value={name in frozenExpressions ? frozenExpressions[name] : manualExpressions[name] ?? 0} frozen={name in frozenExpressions} unit={group.unit ?? "°"} onChange={(value) => setManualExpressions((current) => ({ ...current, [name]: value }))} onToggle={() => toggleExpressionFreeze(name)} />)}</div>)}
                <button type="button" className="secondary-button wide" onClick={() => { const names = new Set<string>(manualJointGroups.flatMap((group) => group.controls.map(([name]) => name))); setManualExpressions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !names.has(name)))); setFrozenExpressions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !names.has(name)))); }}><RotateCcw size={14} />Reset joint offsets and locks</button>
              </details>
              {settings.avatarKind === "facecap" && facecapControlGroups.map((group, index) => (
                <details className="advanced-expression facecap-expression-group" open={index === 3 || index === 4} key={group.label}>
                  <summary><SlidersHorizontal size={15} />{group.label}<small>{group.names.length}</small></summary>
                  {group.names.map((name) => (
                    <ExpressionControl
                      key={name}
                      name={name}
                      value={name in frozenExpressions ? frozenExpressions[name] : manualExpressions[name] ?? 0}
                      frozen={name in frozenExpressions}
                      onChange={(value) => setManualExpressions((current) => ({ ...current, [name]: value }))}
                      onToggle={() => toggleExpressionFreeze(name)}
                    />
                  ))}
                </details>
              ))}
              <button className="secondary-button wide" onClick={resetActiveExpressions}><RotateCcw size={15} />Reset {activeProfile.shortLabel} expressions and locks</button>
            </section>
          </>
        ) : (
          <>
            <section className="panel-section" data-workspace-target="capture"><div className="section-heading"><span>Camera input</span><button onClick={enumerateDevices}><RefreshCw size={14} /></button></div><label className="field-label">Device<select value={settings.cameraId} disabled={!cameras.length} onChange={(event) => updateSetting("cameraId", event.target.value)}>{!cameras.length && <option value="">No camera available</option>}{cameras.map((device) => <option value={device.id} key={device.id}>{device.label}</option>)}</select></label><FpsInput label="Requested FPS" value={settings.cameraFps} onChange={(value) => updateSetting("cameraFps", value)} />{cameraAccess !== "ready" && <button className="secondary-button wide" onClick={requestDeviceAccess} disabled={permissionState === "asking"}><Aperture size={15} />{permissionState === "asking" ? "Waiting for access…" : "Connect capture devices"}</button>}<p className="helper-copy capture-optional">Camera access is optional. The avatar editor and avatar-video recording work without it.</p></section>
            <section className="panel-section">
              <div className="section-heading"><span>Record type</span><small>What the red button captures</small></div>
              <div className="record-type-picker" role="radiogroup" aria-label="Record type">
                {(["motion", "avatar", "composite"] as RecordingMode[]).map((mode) => {
                  const label = mode === "motion" ? "Motion" : mode === "avatar" ? "Avatar" : "Composite";
                  return <button type="button" role="radio" aria-checked={settings.recordingMode === mode} className={settings.recordingMode === mode ? "active" : ""} key={mode} onClick={() => updateSetting("recordingMode", mode)}>{label}</button>;
                })}
              </div>
              <p className="record-type-description">{settings.recordingMode === "motion"
                ? "Editable mocap, neutral-relative XYZ, rotation, scale and optional microphone audio for JSON, GLB or later video rendering."
                : settings.recordingMode === "avatar"
                  ? "A flattened recording of the rendered avatar and its selected background, without the webcam layer."
                  : "A flattened recording of the exact camera + avatar composition shown by the enabled layers."}</p>
              <details className="advanced-expression encoder-quality">
                <summary><SlidersHorizontal size={15} />Encoder quality</summary>
                <label className="field-label encoder-backend">MP4 backend
                  <select value={settings.videoEncoderBackend} disabled={isWebEdition} onChange={(event) => updateSetting("videoEncoderBackend", event.target.value as VideoEncoderBackend)}>
                    {!isWebEdition && <option value="auto">Auto · FFmpeg then WebCodecs</option>}
                    <option value="webcodecs">Portable WebCodecs</option>
                    {!isWebEdition && <option value="ffmpeg">System FFmpeg</option>}
                  </select>
                </label>
                {!isWebEdition && settings.videoEncoderBackend !== "webcodecs" && (
                  <div className="ffmpeg-controls">
                    <label className="field-label">FFmpeg command or path<input type="text" value={settings.ffmpegPath} spellCheck={false} onChange={(event) => updateSetting("ffmpegPath", event.target.value)} /></label>
                    <div className={`ffmpeg-status ${ffmpegStatus}`}><i /><span>{ffmpegStatus === "checking" ? "Checking…" : ffmpegStatus === "available" ? "FFmpeg available" : ffmpegStatus === "unavailable" ? settings.videoEncoderBackend === "auto" ? "Unavailable · Auto will use WebCodecs" : "FFmpeg unavailable" : "Not checked"}</span></div>
                    {ffmpegVersion && <small className="ffmpeg-version" title={ffmpegVersion}>{ffmpegVersion}</small>}
                    <div className="encoder-backend-actions">
                      <button type="button" className="secondary-button" onClick={() => void checkFfmpeg()}><RefreshCw size={13} />Check</button>
                      <button type="button" className="secondary-button" onClick={() => void chooseFfmpegExecutable()}>Choose .exe</button>
                      <button type="button" className="secondary-button" onClick={() => void openExternal("https://ffmpeg.org/download.html")}><Download size={13} />Get FFmpeg</button>
                    </div>
                  </div>
                )}
                <label className="slider-row bitrate-slider"><span>Video</span><input type="range" min="1" max="50" step="1" value={settings.videoBitrateMbps} onChange={(event) => updateSetting("videoBitrateMbps", Number(event.target.value))} /><output>{settings.videoBitrateMbps} Mbps</output></label>
                <label className="slider-row bitrate-slider"><span>Audio</span><input type="range" min="64" max="320" step="16" value={settings.audioBitrateKbps} onChange={(event) => updateSetting("audioBitrateKbps", Number(event.target.value))} /><output>{settings.audioBitrateKbps} kbps</output></label>
                <p className="helper-copy">{isWebEdition ? "The web edition uses local browser WebCodecs; availability depends on the browser and GPU driver. " : "Applied to direct recording and offline MP4 conversion. "}Defaults: 12 Mbps H.264 and 192 kbps AAC.</p>
              </details>
            </section>
          </>
        )}
      </aside>

      <section className="viewport-column">
        <div className="viewport-toolbar">
          {activeWorkspace === "export" ? (
            <div className="export-toolbar-title"><Download size={16} /><span>Export workspace</span><small>The renderer stays mounted behind this panel so captures retain the exact take state.</small></div>
          ) : (<>
          <div className="segmented view-mode-switch" aria-label="Viewport layers">
            <button disabled={calibrating} className={settings.showWebcam && settings.showAvatar ? "active" : ""} aria-pressed={settings.showWebcam && settings.showAvatar} onClick={() => { updateSetting("showWebcam", true); updateSetting("showAvatar", true); }}>Overlay</button>
            <button disabled={calibrating} className={settings.showWebcam && !settings.showAvatar ? "active" : ""} aria-pressed={settings.showWebcam && !settings.showAvatar} onClick={() => { updateSetting("showWebcam", true); updateSetting("showAvatar", false); }}>Camera</button>
            <button disabled={calibrating} className={!settings.showWebcam && settings.showAvatar ? "active" : ""} aria-pressed={!settings.showWebcam && settings.showAvatar} onClick={() => { updateSetting("showWebcam", false); updateSetting("showAvatar", true); }}>Avatar</button>
          </div>
          <div className="toolbar-actions"><button className="icon-button" title="Save a PNG photo of the exact canvas" disabled={calibrating || videoExportProgress !== null || pngSequenceRendering} onClick={() => void captureStill()}><PhosphorCamera size={17} weight="duotone" /></button><button disabled={calibrating} className={`icon-button ${settings.mirror ? "active" : ""}`} title={settings.mirror ? "Mirrored camera and motion" : "Raw camera and motion"} aria-pressed={settings.mirror} onClick={() => updateSetting("mirror", !settings.mirror)}><FlipHorizontal2 size={16} /></button><button className="icon-button" title="Reset view" onClick={() => setResetViewSignal((value) => value + 1)}><RotateCcw size={16} /></button><button className={`icon-button ${popoutState !== "idle" ? "active" : ""}`} title={popoutState === "idle" ? "Open a clean canvas-only output window" : popoutState === "starting" ? "Output popout is connecting" : "Focus output popout"} aria-pressed={popoutState !== "idle"} disabled={calibrating || popoutState === "starting" || (popoutState === "idle" && recordingState !== "idle")} onClick={() => void openOutputPopout()}><PictureInPicture2 size={16} /></button><button className={`icon-button ${fullscreen ? "active" : ""}`} title={fullscreen ? "Exit fullscreen output (Esc)" : "Fullscreen canvas output"} aria-pressed={fullscreen} disabled={popoutState !== "idle"} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button></div>
          </>)}
        </div>
        {popoutState !== "idle" && <video ref={videoRef} className="tracking-video-hidden" autoPlay muted playsInline />}
        {popoutState === "idle" ? (
        <Stage
          avatarKind={stageSettings.avatarKind}
          videoRef={videoRef}
          frame={displayedFrame}
          neutralFrame={stageNeutralFrame}
          showWebcam={calibrating || stageSettings.showWebcam}
          showAvatar={!calibrating && (motionVideoRendering || pngSequenceRendering || stageSettings.showAvatar)}
          showLandmarks={!calibrating && stageSettings.showLandmarks}
          mirror={stageSettings.mirror}
          opacity={stageSettings.avatarOpacity}
          wireframe={stageSettings.wireframe}
          skinTextureEnabled={stageSettings.skinTextureEnabled}
          skinTone={stageSettings.skinTone}
          skinTextureScale={stageSettings.skinTextureScale}
          skinTextureRotation={stageSettings.skinTextureRotation}
          skinTextureFeather={stageSettings.skinTextureFeather}
          eyeShaderEnabled={stageSettings.eyeShaderEnabled}
          eyeColor={stageSettings.eyeColor}
          backgroundMode={stageSettings.backgroundMode}
          backgroundColor={stageSettings.backgroundColor}
          backgroundImageUrl={stageBackgroundImageUrl}
          backgroundImageZoom={stageSettings.backgroundImageZoom}
          mouseLightEnabled={stageSettings.mouseLightEnabled}
          mouseLightIntensity={stageSettings.mouseLightIntensity}
          headPoseSettings={{
            enabled: stageSettings.headRotationEnabled,
            yawStrength: stageSettings.headYawStrength,
            pitchStrength: stageSettings.headPitchStrength,
            rollStrength: stageSettings.headRollStrength,
            deadZone: stageSettings.headRotationDeadZone,
            smoothing: stageSettings.headRotationSmoothing,
          }}
          calibrating={calibrating}
          calibrationComplete={calibrationComplete}
          faceAlignment={calibrationFaceAlignment}
          countdown={countdown}
          trackingReady={Boolean(trackingFrame)}
          identityVertices={stageIdentityVertices}
          manualExpressions={stageManualExpressions}
          frozenExpressions={stageFrozenExpressions}
          recordingMode={motionVideoRendering || pngSequenceRendering ? "avatar" : stageSettings.recordingMode}
          recordingActive={motionVideoRendering || pngSequenceRendering || recordingState !== "idle"}
          resetViewSignal={resetViewSignal}
          viewStateOverride={forcedViewState}
          onCancelCalibration={cancelCalibration}
          onCompositeCanvas={handleCompositeCanvas}
          onStageError={handleStageError}
          onViewportResize={handleViewportResize}
          onViewStateChange={handleViewStateChange}
          onAvatarMotion={storeAvatarMotion}
        />
        ) : (
          <div className="popout-placeholder">
            <PictureInPicture2 size={38} />
            <strong>{popoutState === "starting" ? "Opening output canvas…" : "Canvas is live in the popout"}</strong>
            <span>The popout owns the only 3D renderer. Camera tracking, editing and exports continue here without duplicate GPU work.</span>
            <div>
              <button className="secondary-button" disabled={popoutState !== "active"} onClick={() => postToOutput({ type: "focus" })}>Focus popout</button>
              <button className="primary-button" disabled={popoutState !== "active" || recordingState !== "idle"} onClick={closeOutputPopout} title={recordingState !== "idle" ? "Stop the current recording before closing the output" : "Close the popout and restore this canvas"}>Bring canvas back</button>
            </div>
          </div>
        )}
        {activeWorkspace === "export" && (
          <ExportWorkspace
            hasTake={recordedFrames.length > 0}
            hasVideo={Boolean(lastVideo)}
            durationMs={recordedDuration}
            frameCount={recordedFrames.length}
            width={settings.exportWidth}
            height={settings.exportHeight}
            fps={settings.exportFps}
            trimStartMs={exportTrimStartMs}
            trimEndMs={exportTrimEndMs || recordedDuration}
            speed={exportPlaybackSpeed}
            busy={captureFinalizing || videoExportProgress !== null || pngSequenceRendering}
            progress={pngExportProgress ?? videoExportProgress}
            onWidthChange={(value) => updateSetting("exportWidth", Math.min(7680, Math.max(64, Math.round(value / 2) * 2)))}
            onHeightChange={(value) => updateSetting("exportHeight", Math.min(4320, Math.max(64, Math.round(value / 2) * 2)))}
            onFpsChange={(value) => updateSetting("exportFps", Math.min(120, Math.max(1, Math.round(value))))}
            onTrimStartChange={(value) => { setExportTrimStartMs(Math.min(exportTrimEndMs || recordedDuration, Math.max(0, value))); setRecordingElapsed(0); setPlaybackFrame(null); }}
            onTrimEndChange={(value) => { setExportTrimEndMs(Math.min(recordedDuration, Math.max(exportTrimStartMs, value))); setRecordingElapsed(0); setPlaybackFrame(null); }}
            onSpeedChange={(value) => { setExportPlaybackSpeed(Math.min(4, Math.max(0.1, value))); setRecordingElapsed(0); setPlaybackFrame(null); }}
            onExportMp4={() => void exportVideo()}
            onExportWebm={() => void exportWebm()}
            onExportPng={() => void exportPngSequence()}
            onReturn={() => activateWorkspace("capture")}
          />
        )}
        {activeWorkspace !== "export" && permissionState !== "ready" && !devicePromptDismissed && (
          <div className="permission-card"><Aperture size={28} /><div><strong>Connect capture devices (optional)</strong><span>Camera and microphone are only needed for live tracking and audio. Manual avatar tools remain available.</span>{deviceError && <small className="error-text">{deviceError}</small>}</div><div className="permission-actions"><button className="primary-button" onClick={requestDeviceAccess} disabled={permissionState === "asking"}>{permissionState === "asking" ? "Waiting…" : "Enable camera & microphone"}</button><button className="secondary-button" onClick={() => { setDevicePromptDismissed(true); pushToast({ type: "info", title: "Continuing without capture", message: "Avatar creation, manual expressions, backgrounds, lighting, and avatar-video export remain available." }); }}>Continue without capture</button></div></div>
        )}
      </section>

      <aside className={`sidebar right-sidebar ${rightSidebarCollapsed ? "collapsed" : ""}`}>
        <button type="button" className="sidebar-collapse-toggle" aria-label={rightSidebarCollapsed ? "Expand right sidebar" : "Collapse right sidebar"} title={rightSidebarCollapsed ? "Expand right sidebar" : "Collapse right sidebar"} onClick={() => setRightSidebarCollapsed((value) => !value)}><ChevronDown size={15} /></button>
        <section className={`panel-section tracking-score tracker-${trackerStatus}`}><div className="score-ring" style={{ "--score": `${faceConfidence * 3.6}deg` } as React.CSSProperties}><strong>{faceConfidence}</strong><small>%</small></div><div><span>Tracking quality</span><strong>{trackingQualityLabel}</strong><small title={trackerFallbackReason || undefined}>{settings.trackingFps} FPS target · {trackerDelegate}</small><button className="inline-retry tracker-reload" disabled={cameraAccess !== "ready"} title={cameraAccess === "ready" ? "Reload the local MediaPipe model and face-tracking worker" : "Connect a camera before reloading the tracker"} onClick={() => reloadTracker()}><RefreshCw size={12} />{trackerStatus === "error" ? "Retry tracker" : trackerStatus === "loading" ? "Restart loading" : "Reload tracker"}</button></div></section>
        <section className="panel-section"><div className="section-heading"><span>Layers</span><Layers3 size={15} /></div><label className={`toggle-row ${settings.showWebcam ? "is-active" : ""}`}><span><Video size={16} />Webcam<small>{settings.showWebcam ? "ON" : "OFF"}</small></span><input type="checkbox" disabled={calibrating} checked={settings.showWebcam} onChange={(event) => updateSetting("showWebcam", event.target.checked)} /></label><label className={`toggle-row ${settings.showAvatar ? "is-active" : ""}`}><span><Box size={16} />{activeProfile.shortLabel} avatar<small>{settings.showAvatar ? "ON" : "OFF"}</small></span><input type="checkbox" disabled={calibrating} checked={settings.showAvatar} onChange={(event) => updateSetting("showAvatar", event.target.checked)} /></label><label className={`toggle-row ${settings.showLandmarks ? "is-active" : ""}`}><span><Gauge size={16} />Landmarks<small>{settings.showLandmarks ? "ON" : "OFF"}</small></span><input type="checkbox" disabled={calibrating} checked={settings.showLandmarks} onChange={(event) => updateSetting("showLandmarks", event.target.checked)} /></label><label className={`toggle-row ${settings.mirror ? "is-active" : ""}`}><span><Eye size={16} />Mirror camera + motion<small>{settings.mirror ? "ON" : "OFF"}</small></span><input type="checkbox" disabled={calibrating} checked={settings.mirror} onChange={(event) => updateSetting("mirror", event.target.checked)} /></label></section>
        <section className="panel-section">
          <div className="section-heading"><span>Avatar display</span></div>
          <label className="slider-row"><span>Opacity</span><input type="range" min="0" max="100" value={settings.avatarOpacity * 100} onChange={(event) => updateSetting("avatarOpacity", Number(event.target.value) / 100)} /><output>{Math.round(settings.avatarOpacity * 100)}</output></label>
          <label className="toggle-row"><span>Wireframe</span><input type="checkbox" checked={settings.wireframe} onChange={(event) => updateSetting("wireframe", event.target.checked)} /></label>
          <label className="field-label background-field">Head background
            <select
              value={settings.backgroundMode}
              onChange={(event) => {
                const mode = event.target.value as typeof settings.backgroundMode;
                updateSetting("backgroundMode", mode);
                if (mode === "image" && !backgroundImageUrl) window.setTimeout(() => backgroundInputRef.current?.click(), 0);
              }}
            >
              <option value="studio">Studio gradient</option>
              <option value="solid">Solid colour</option>
              <option value="image">Custom image</option>
              <option value="transparent">Transparent</option>
            </select>
          </label>
          {settings.backgroundMode === "solid" && <label className="color-field"><span>Background colour</span><input type="color" value={settings.backgroundColor} onChange={(event) => updateSetting("backgroundColor", event.target.value)} /><output>{settings.backgroundColor.toUpperCase()}</output></label>}
          {settings.backgroundMode === "image" && (
            <div className="background-image-controls">
              <div className="background-image-actions">
                <button className="secondary-button" onClick={() => backgroundInputRef.current?.click()}><ImagePlus size={15} />{backgroundImageUrl ? "Replace image" : "Choose image"}</button>
                {backgroundImageUrl && <button className="icon-button" onClick={() => void clearBackgroundImage()} title="Remove custom background"><X size={14} /></button>}
              </div>
              <small title={backgroundImageName}>{backgroundImageName || "No image selected"}</small>
              <label className="slider-row image-zoom"><span>Image zoom</span><input type="range" min="100" max="300" step="1" disabled={!backgroundImageUrl} value={settings.backgroundImageZoom * 100} onChange={(event) => updateSetting("backgroundImageZoom", Number(event.target.value) / 100)} /><output>{Math.round(settings.backgroundImageZoom * 100)}%</output></label>
              <p className="helper-copy">Cover-fit preserves the original aspect ratio, including square images. Zoom changes framing without stretching.</p>
            </div>
          )}
          <label className={`toggle-row ${settings.mouseLightEnabled ? "is-active" : ""}`}><span>Pointer light<small>{settings.mouseLightEnabled ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.mouseLightEnabled} onChange={(event) => updateSetting("mouseLightEnabled", event.target.checked)} /></label>
          <label className="slider-row"><span>Light power</span><input type="range" min="0" max="200" disabled={!settings.mouseLightEnabled} value={settings.mouseLightIntensity * 100} onChange={(event) => updateSetting("mouseLightIntensity", Number(event.target.value) / 100)} /><output>{Math.round(settings.mouseLightIntensity * 100)}</output></label>
        </section>
        <section className="panel-section"><div className="section-heading"><span>Neutral calibration</span><small>{neutralFrame ? "Calibrated" : "Recommended"}</small></div><p className="helper-copy">Face forward with a relaxed expression. Calibration temporarily shows camera-only, then restores your previous layers. It zeros resting facial channels, head orientation, XYZ translation, and relative scale.</p><div className={`face-readiness ${calibrationReadiness.status}`}><i /><span>{calibrationReadiness.message}</span></div><button className="primary-button wide" onClick={() => void calibrate()} disabled={calibrating || recordingState !== "idle" || trackerStatus !== "ready" || !trackingFrame}><Sparkles size={16} />{calibrating ? "Verifying position…" : neutralFrame ? "Recalibrate" : "Calibrate neutral"}</button></section>
        <section className="panel-section">
          <div className="section-heading"><span>Tracking motion</span></div>
          <FpsInput label="MediaPipe FPS" value={settings.trackingFps} onChange={(value) => updateSetting("trackingFps", value)} />
          <label className={`toggle-row ${settings.trackingSmoothingEnabled ? "is-active" : ""}`}><span>Facial smoothing<small>{settings.trackingSmoothingEnabled ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.trackingSmoothingEnabled} onChange={(event) => updateSetting("trackingSmoothingEnabled", event.target.checked)} /></label>
          <label className="slider-row smoothing-slider"><span>Face strength</span><input type="range" min="0" max="100" step="1" disabled={!settings.trackingSmoothingEnabled} value={settings.trackingSmoothing * 100} onChange={(event) => updateSetting("trackingSmoothing", Number(event.target.value) / 100)} /><output>{Math.round(settings.trackingSmoothing * 100)}%</output></label>
          <label className={`toggle-row ${settings.motionSmoothingEnabled ? "is-active" : ""}`}><span>Head motion smoothing<small>{settings.motionSmoothingEnabled ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.motionSmoothingEnabled} onChange={(event) => updateSetting("motionSmoothingEnabled", event.target.checked)} /></label>
          <label className="slider-row smoothing-slider"><span>Motion strength</span><input type="range" min="0" max="100" step="1" disabled={!settings.motionSmoothingEnabled} value={settings.motionSmoothing * 100} onChange={(event) => updateSetting("motionSmoothing", Number(event.target.value) / 100)} /><output>{Math.round(settings.motionSmoothing * 100)}%</output></label>
          <label className="slider-row smoothing-slider"><span>Mouth dead zone</span><input type="range" min="0" max="100" step="1" value={settings.mouthDeadZone * 100} onChange={(event) => updateSetting("mouthDeadZone", Number(event.target.value) / 100)} /><output>{Math.round(settings.mouthDeadZone * 100)}%</output></label>
          <p className="helper-copy smoothing-help">Face filtering is intentionally stronger; head motion uses a lighter independent filter. Small isolated one-frame twitches are rejected, while sustained and fast deliberate movement remains responsive. 0% is raw.</p>
          <details className="advanced-expression head-pose-settings">
            <summary><RotateCcw size={15} />Face-only head rotation</summary>
            <label className={`toggle-row ${settings.headRotationEnabled ? "is-active" : ""}`}><span>Rotate from face<small>{settings.headRotationEnabled ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.headRotationEnabled} onChange={(event) => updateSetting("headRotationEnabled", event.target.checked)} /></label>
            <label className="slider-row"><span>Yaw</span><input type="range" min="0" max="150" step="1" disabled={!settings.headRotationEnabled} value={settings.headYawStrength * 100} onChange={(event) => updateSetting("headYawStrength", Number(event.target.value) / 100)} /><output>{Math.round(settings.headYawStrength * 100)}%</output></label>
            <label className="slider-row"><span>Pitch</span><input type="range" min="0" max="150" step="1" disabled={!settings.headRotationEnabled} value={settings.headPitchStrength * 100} onChange={(event) => updateSetting("headPitchStrength", Number(event.target.value) / 100)} /><output>{Math.round(settings.headPitchStrength * 100)}%</output></label>
            <label className="slider-row"><span>Roll</span><input type="range" min="0" max="150" step="1" disabled={!settings.headRotationEnabled} value={settings.headRollStrength * 100} onChange={(event) => updateSetting("headRollStrength", Number(event.target.value) / 100)} /><output>{Math.round(settings.headRollStrength * 100)}%</output></label>
            <label className="slider-row"><span>Dead zone</span><input type="range" min="0" max="10" step="0.25" disabled={!settings.headRotationEnabled} value={settings.headRotationDeadZone} onChange={(event) => updateSetting("headRotationDeadZone", Number(event.target.value))} /><output>{settings.headRotationDeadZone.toFixed(1)}°</output></label>
            <label className="slider-row"><span>Pose smoothing</span><input type="range" min="0" max="100" step="1" disabled={!settings.headRotationEnabled} value={settings.headRotationSmoothing * 100} onChange={(event) => updateSetting("headRotationSmoothing", Number(event.target.value) / 100)} /><output>{Math.round(settings.headRotationSmoothing * 100)}%</output></label>
            <p className="helper-copy">Uses MediaPipe's facial transform first and face landmarks as a fallback. It does not depend on shoulders or torso pose.</p>
          </details>
        </section>
      </aside>

      <footer className="transport-dock">
        <AudioMeter devices={microphones} selectedId={settings.microphoneId} onSelect={(id) => updateSetting("microphoneId", id)} level={audioLevel} peak={audioPeak} muted={settings.muted} onToggleMute={() => updateSetting("muted", !settings.muted)} monitoring={monitoring} onToggleMonitoring={() => setMonitoring((value) => !value)} onRefresh={enumerateDevices} />
        <section className="transport">
          <div className="transport-main">
            {recordingState === "idle" ? <button className="record-button" onClick={startRecording} disabled={calibrating || captureFinalizing || videoExportProgress !== null || popoutState === "starting"} title={calibrating ? "Finish or cancel neutral calibration before recording" : captureFinalizing ? "Wait for the previous take to finish finalizing" : videoExportProgress !== null ? "Wait for video export to finish" : popoutState === "starting" ? "Wait for the output popout to connect" : !trackingFrame && settings.recordingMode === "motion" ? "Motion mode needs a detected face" : "Start recording"}><span />{captureFinalizing ? "Finalizing…" : "Record"}</button> : <button className="stop-button" onClick={stopRecording}><CircleStop size={18} />Stop</button>}
            <button className="icon-button transport-icon" onClick={togglePause} disabled={videoExportProgress !== null || (recordingState === "idle" && !recordedFrames.length)} title={playing ? "Pause playback" : recordingState === "recording" ? "Pause recording" : recordingState === "paused" ? "Resume recording" : "Play recorded take"}>{recordingState === "recording" || playing ? <Pause size={18} /> : <Play size={18} />}</button>
            {(playbackFrame || playing) && <button className="secondary-button return-live" onClick={returnToLiveTracking} title="Stop playback and return the avatar to the active camera"><RefreshCw size={14} /><span>Return to Live</span></button>}
            <div className="timecode"><strong>{formatTime(recordingElapsed)}</strong><span>{recordedFrames.length || recordingFramesRef.current.length} frames</span></div>
          </div>
          <div className={`timeline ${recordedFrames.length && recordingState === "idle" ? "seekable" : ""}`}>
            <div className="timeline-track">
              <div className="timeline-progress" style={{ width: `${timelinePercent}%` }} />
              <span className="playhead" style={{ left: `${timelinePercent}%` }} />
              <input
                className="timeline-range"
                type="range"
                min="0"
                max={timelineDuration}
                step="1"
                value={timelinePosition}
                disabled={recordingState !== "idle" || videoExportProgress !== null || !recordedFrames.length}
                aria-label="Recorded motion position"
                aria-valuetext={`${formatTime(timelinePosition)} of ${formatTime(recordedDuration)}`}
                onInput={(event) => seekPlayback(Number(event.currentTarget.value))}
              />
            </div>
            <div className="timeline-labels"><span>00:00</span><span>{formatTime(recordedFrames.length ? playbackDuration : timelineDuration)}</span></div>
          </div>
          <div className="export-cluster" data-workspace-target="export"><FpsInput compact label="Export FPS" value={settings.exportFps} onChange={(value) => updateSetting("exportFps", value)} /><button className="secondary-button motion-import" onClick={() => motionInputRef.current?.click()} disabled={recordingState !== "idle" || calibrating || videoExportProgress !== null} title="Import a GNM Studio motion JSON file"><Upload size={15} /><span>Import JSON</span></button>{recordedFrames.length > 0 && <button className="secondary-button" onClick={useCurrentAppearanceForTake} disabled={recordingState !== "idle" || captureFinalizing || videoExportProgress !== null} title="Replace the take's immutable appearance snapshot with the current avatar, materials, layers, lighting, and view"><WandSparkles size={15} /><span>Use current look</span></button>}<button className="secondary-button" onClick={exportMotion} disabled={!recordedFrames.length || videoExportProgress !== null} title="Export motion JSON"><Download size={16} /><span>JSON</span></button><button className="secondary-button" onClick={exportGlb} disabled={!recordedFrames.length || videoExportProgress !== null} title="Export animated GLB for Blender"><Download size={16} /><span>GLB</span></button>{lastVideo && !lastVideo.type.includes("mp4") && <button className="secondary-button source-export" onClick={exportWebmSource} disabled={videoExportProgress !== null || captureFinalizing} title="Export optional unconverted WebM source"><Download size={14} /><span>WebM source</span></button>}<button className="primary-button" onClick={exportVideo} disabled={(!lastVideo && !recordedFrames.length) || captureFinalizing || videoExportProgress !== null || recordingState !== "idle"} title={captureFinalizing ? "Wait for the recorded media and microphone tracks to finish finalizing" : lastVideo ? "Export the directly recorded take as H.264/AAC MP4 without re-rendering" : recordedFrames.length ? "Render the recorded motion, framing, view, and retained audio as MP4" : "Record a motion or video take before exporting MP4"}><Download size={16} /><span>{captureFinalizing ? "Finalizing…" : videoExportProgress !== null ? videoExportBackend === "ffmpeg" ? "FFmpeg rendering…" : `Rendering ${Math.round(videoExportProgress * 100)}%` : "MP4"}</span></button></div>
        </section>
      </footer>
      <ToastCenter
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
      <input
        ref={motionInputRef}
        className="visually-hidden-input"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          void importMotionJson(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={backgroundInputRef}
        className="visually-hidden-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/bmp,image/gif"
        onChange={(event) => {
          void chooseBackgroundImage(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={presetInputRef}
        className="visually-hidden-input"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          void importPresetBundle(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </main>
    {backendMenu && createPortal(
      <div className="backend-menu-portal">
        <button className="backend-menu-scrim" aria-label="Close tracking backend menu" onClick={() => setBackendMenu(null)} />
        <div className="backend-menu" role="menu" aria-label="Tracking backend" style={{ left: backendMenu.x, top: backendMenu.y }}>
          <header><span>Tracking backend</span><small>Right-click selector</small></header>
          <button role="menuitemradio" aria-checked={settings.trackingBackend === "auto"} onClick={() => selectTrackingBackend("auto")}>
            <RefreshCw size={15} /><span><strong>Auto</strong><small>GPU first, CPU fallback</small></span>{settings.trackingBackend === "auto" && <Check size={14} />}
          </button>
          <button role="menuitemradio" aria-checked={settings.trackingBackend === "gpu"} disabled={gpuProbe.available === false} title={gpuProbe.reason} onClick={() => selectTrackingBackend("gpu")}>
            <Zap size={15} /><span><strong>GPU</strong><small>{gpuProbe.available === true ? "Available" : gpuProbe.available === false ? "Unavailable" : "Not tested yet"}</small></span>{settings.trackingBackend === "gpu" && <Check size={14} />}
          </button>
          <button role="menuitemradio" aria-checked={settings.trackingBackend === "cpu"} disabled={cpuProbe.available === false} title={cpuProbe.reason} onClick={() => selectTrackingBackend("cpu")}>
            <Cpu size={15} /><span><strong>CPU</strong><small>{cpuProbe.available === true ? "Available" : cpuProbe.available === false ? "Unavailable" : "Not tested yet"}</small></span>{settings.trackingBackend === "cpu" && <Check size={14} />}
          </button>
        </div>
      </div>,
      document.body,
    )}
    {settingsOpen && createPortal(
      <div className="settings-portal">
        <button className="settings-scrim" aria-label="Close settings" onClick={() => setSettingsOpen(false)} />
        <aside className="settings-popover" role="dialog" aria-modal="true" aria-label="Appearance settings">
          <header className="settings-head">
            <div><Settings2 size={17} /><span><strong>Settings</strong><small>Appearance and interface</small></span></div>
            <button className="popover-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={16} /></button>
          </header>
          <section className="settings-group">
            <div className="settings-label"><span>Theme</span><small>Choose the application surface</small></div>
            <div className="settings-segmented">
              <button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><Moon size={14} />Dark</button>
              <button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}><Sun size={14} />Light</button>
            </div>
          </section>
          <section className="settings-group">
            <div className="settings-label"><span>Accent colour</span><small>Applied to active controls and meters</small></div>
            <div className="accent-picker">
              {accentOptions.map((option) => (
                <button
                  key={option}
                  className={`accent-dot accent-${option} ${accent === option ? "active" : ""}`}
                  onClick={() => setAccent(option)}
                  title={option}
                  aria-label={`${option} accent`}
                  aria-pressed={accent === option}
                />
              ))}
            </div>
          </section>
          <section className="settings-group">
            <div className="settings-label"><span>Interface scale</span><small>The settings window remains stationary while the studio scales</small></div>
            <div className="settings-scale">
              <input type="range" min="80" max="125" step="1" value={uiScale} onChange={(event) => setUiScale(Number(event.target.value))} />
              <output>{uiScale}%</output>
            </div>
            <button className="settings-reset" onClick={() => setUiScale(100)} disabled={uiScale === 100}><RotateCcw size={13} />Reset to 100%</button>
          </section>
          <section className="settings-group">
            <div className="settings-label"><span>Fullscreen output</span><small>Clean controls for capture and OBS</small></div>
            <label className={`toggle-row ${settings.outputAutoHideEnabled ? "is-active" : ""}`}><span>Auto-hide controls<small>{settings.outputAutoHideEnabled ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.outputAutoHideEnabled} onChange={(event) => updateSetting("outputAutoHideEnabled", event.target.checked)} /></label>
            <label className="slider-row"><span>Hide delay</span><input type="range" min="0.5" max="10" step="0.5" disabled={!settings.outputAutoHideEnabled || settings.outputAlwaysHideControls} value={settings.outputAutoHideDelay} onChange={(event) => updateSetting("outputAutoHideDelay", Number(event.target.value))} /><output>{settings.outputAutoHideDelay.toFixed(1)}s</output></label>
            <label className={`toggle-row ${settings.outputAlwaysHideControls ? "is-active" : ""}`}><span>Always clean<small>{settings.outputAlwaysHideControls ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.outputAlwaysHideControls} onChange={(event) => updateSetting("outputAlwaysHideControls", event.target.checked)} /></label>
            <p className="helper-copy">Move the pointer to reveal controls, press H to toggle them, and press Esc to exit fullscreen.</p>
          </section>
          <footer className="settings-about">
            <span className="settings-about-icon"><span className="brand-head-icon" style={brandHeadIconStyle} /></span>
            <span className="settings-about-copy"><strong>GNM Studio {isWebEdition ? "Web" : "Desktop"}</strong><small>Apache-2.0 · {isWebEdition ? "GitHub Pages build" : "Manifest build"}</small></span>
            <span className="settings-about-links">
              <button onClick={() => void openExternal(repositoryUrl)} title="Open GNM Studio on GitHub"><GithubMark />GitHub</button>
              <button onClick={() => void openExternal(releasesUrl)} title="Open GNM Studio releases">v{appVersion}</button>
            </span>
          </footer>
        </aside>
      </div>,
      document.body,
    )}
    </>
  );
}

export default App;
