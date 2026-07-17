import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera as PhosphorCamera, Microphone as PhosphorMicrophone } from "@phosphor-icons/react";
import {
  Aperture, Box, Camera, Check, ChevronDown, CircleStop, Cpu, Download, Eye,
  FlipHorizontal2, Gauge, ImagePlus, Layers3, Lock, Maximize2, Minimize2, Minus, Moon, Pause, Play, Plus,
  PictureInPicture2, RefreshCw, RotateCcw, Settings2, SlidersHorizontal, Sparkles, Sun, Unlock, Upload, Video,
  WandSparkles, X, Zap,
} from "lucide-react";
import { AudioMeter } from "./components/AudioMeter";
import { Stage } from "./components/Stage";
import { ToastCenter, type ToastMessage } from "./components/ToastCenter";
import { saveBlob, saveBytes, type SaveResult } from "./lib/save";
import { createAnimatedGlb } from "./lib/glbExport";
import { loadBackgroundImage, removeBackgroundImage, saveBackgroundImage } from "./lib/backgroundStore";
import { DenseDecoder, identityDecoderInput } from "./lib/decoder";
import { identityVertexCount } from "./lib/identityVertices";
import type { WebIdentityEvaluator } from "./lib/webIdentity";
import { avatarProfiles, facecapControlGroups, facecapInfluences } from "./lib/avatarProfiles";
import {
  outputChannelName, type MainToOutputMessage, type OutputSnapshot, type OutputToMainMessage,
} from "./lib/outputChannel";
import { parseMotionFile } from "./lib/motionFile";
import { semanticExpressionNames, semanticInfluences } from "./lib/retarget";
import { skinToneOptions } from "./lib/skinMaterial";
import { AdaptiveTrackingSmoother } from "./lib/trackingSmoothing";
import { assetUrl } from "./lib/assets";
import type { ViewportSize } from "./lib/coverProjection";
import { assessFaceAlignment } from "./lib/faceAlignment";
import { inspectRecordedMedia } from "./lib/mediaInspection";
import {
  cloneLiveAudioTrack, preferredAudioRecorderMimeType, preferredVideoRecorderMimeType,
} from "./lib/recordingMedia";
import type {
  AppSettings, AvatarKind, AvatarMotionSample, CameraViewState, DeviceOption, FaceAlignment,
  IdentityVertices, RecordedFrame, RecordingMode, TrackingBackend, TrackingFrame, VideoEncoderBackend,
} from "./types";
import "./App.css";

const isDesktopRuntime = "__TAURI_INTERNALS__" in window;
const isWebEdition = __GNM_WEB_BUILD__ || !isDesktopRuntime;
const brandHeadIconStyle: React.CSSProperties = {
  WebkitMask: `url("${assetUrl("head-svgrepo-com.svg")}") center / contain no-repeat`,
  mask: `url("${assetUrl("head-svgrepo-com.svg")}") center / contain no-repeat`,
};

const initialSettings: AppSettings = {
  avatarKind: "gnm",
  cameraId: "", microphoneId: "", cameraFps: 30, trackingFps: 30, trackingSmoothingEnabled: true, trackingSmoothing: 0.72, motionSmoothingEnabled: true, motionSmoothing: 0.35, trackingBackend: "auto",
  exportFps: 30, videoBitrateMbps: 12, audioBitrateKbps: 192, videoEncoderBackend: isDesktopRuntime ? "auto" : "webcodecs", ffmpegPath: "ffmpeg", showWebcam: true, showAvatar: true, showLandmarks: false,
  mirror: true, muted: false, avatarOpacity: 0.92, wireframe: false,
  skinTextureEnabled: false, skinTone: "light", skinTextureScale: 8, skinTextureRotation: 0, skinTextureFeather: 0.12,
  backgroundMode: "studio", backgroundColor: "#101820", backgroundImageZoom: 1,
  mouseLightEnabled: true, mouseLightIntensity: 1,
  headRotationEnabled: true, headYawStrength: 1, headPitchStrength: 1, headRollStrength: 1, headRotationDeadZone: 1.5, headRotationSmoothing: 0.35,
  outputAutoHideEnabled: true, outputAutoHideDelay: 2.5, outputAlwaysHideControls: false,
  recordingMode: "motion",
};

const repositoryUrl = "https://github.com/Saganaki22/GNM-Studio";
const releasesUrl = `${repositoryUrl}/releases`;
const settingsStorageVersion = 3;
const accentOptions = ["teal", "blue", "green", "red", "yellow"] as const;
type AccentOption = (typeof accentOptions)[number];
type Workspace = "capture" | "create" | "edit" | "export";
type BackendProbe = { available: boolean | null; reason: string };
type FfmpegProbe = { available: boolean; version?: string; error?: string };

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function timestampedFilename(extension: string, suffix = "") {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `GNM-Studio_${timestamp}${suffix}.${extension}`;
}

function afterBrowserPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function estimateTrackingQuality(frame: TrackingFrame | null) {
  if (!frame?.landmarks.length) return 0;
  const valid = frame.landmarks.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
  if (valid.length < 100) return 0;
  const xs = valid.map((point) => point.x);
  const ys = valid.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const faceHeight = maxY - minY;
  const finiteScore = valid.length / frame.landmarks.length;
  const visibleScore = valid.filter((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1).length / valid.length;
  const sizeScore = 1 - Math.min(1, Math.abs(faceHeight - 0.46) / 0.42);
  const centerScore = 1 - Math.min(1, Math.hypot(centerX - 0.5, centerY - 0.5) / 0.65);
  let facingScore = 1;
  if (frame.matrix.length === 16) {
    const forwardLength = Math.hypot(frame.matrix[8], frame.matrix[9], frame.matrix[10]);
    if (forwardLength > 0.001) facingScore = Math.min(1, Math.max(0, Math.abs(frame.matrix[10]) / forwardLength));
  }
  return Math.round(100 * (
    0.38 * finiteScore
    + 0.22 * visibleScore
    + 0.14 * sizeScore
    + 0.12 * centerScore
    + 0.14 * facingScore
  ));
}

function applyNeutralBaseline(frame: TrackingFrame | null, neutral: TrackingFrame | null) {
  if (!frame || !neutral) return frame;
  const neutralScores = new Map(neutral.blendshapes.map((shape) => [shape.name, shape.score]));
  return {
    ...frame,
    blendshapes: frame.blendshapes.map((shape) => ({
      name: shape.name,
      score: Math.min(1, Math.max(0, shape.score - (neutralScores.get(shape.name) ?? 0))),
    })),
  };
}

function playbackTrackingFrame(frame: RecordedFrame, landmarks: TrackingFrame["landmarks"]): TrackingFrame {
  return {
    timestamp: performance.now(),
    landmarks,
    blendshapes: Object.entries(frame.blendshapes).map(([name, score]) => ({ name, score })),
    matrix: frame.matrix,
    avatarMotion: frame.avatarMotion,
  };
}

function recordedFrameAtTime(frames: RecordedFrame[], timestamp: number) {
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return frames[low];
}

function GithubMark({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.16 1.18A10.9 10.9 0 0 1 12 6.1c.98 0 1.95.13 2.86.38 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.41-2.71 5.39-5.29 5.68.42.36.78 1.07.78 2.16v3.25c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

function FpsInput({
  label, value, onChange, compact = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const next = Math.min(120, Math.max(1, Number.isFinite(parsed) ? parsed : value));
    setDraft(String(next));
    onChange(next);
  };
  return (
    <div className={`fps-control ${compact ? "compact" : ""}`}>
      <span>{label}</span>
      <span className="fps-stepper">
        <button type="button" onClick={() => commit(String(value - 1))} disabled={value <= 1} aria-label={`Decrease ${label}`}><Minus size={12} /></button>
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ""))}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          aria-label={`${label}, frames per second`}
        />
        <button type="button" onClick={() => commit(String(value + 1))} disabled={value >= 120} aria-label={`Increase ${label}`}><Plus size={12} /></button>
      </span>
    </div>
  );
}

function ExpressionControl({
  name, value, frozen, onChange, onToggle,
}: {
  name: string;
  value: number;
  frozen: boolean;
  onChange: (value: number) => void;
  onToggle: () => void;
}) {
  const inputId = `expression-${name}`;
  return (
    <div className={`slider-row has-lock ${frozen ? "is-frozen" : ""}`}>
      <label htmlFor={inputId}>{name.replaceAll("_", " ")}</label>
      <input
        id={inputId}
        type="range"
        min="0"
        max="100"
        disabled={frozen}
        value={value * 100}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <output>{Math.round(value * 100)}</output>
      <button
        type="button"
        className="expression-lock"
        aria-pressed={frozen}
        onClick={onToggle}
        title={frozen ? `Unfreeze ${name}` : `Freeze ${name} at its current value`}
      >
        {frozen ? <Lock size={13} /> : <Unlock size={13} />}
      </button>
    </div>
  );
}

function App() {
  const [gnmInfo, setGnmInfo] = useState<{ vertices: number; identityDimensions: number; expressionDimensions: number } | null>(null);
  const [identitySeed, setIdentitySeed] = useState("GNM-2048");
  const [identityGender, setIdentityGender] = useState<"female" | "male" | "blend">("blend");
  const [identityEthnicity, setIdentityEthnicity] = useState<"middle_eastern" | "asian" | "white" | "black" | "blend">("blend");
  const [identityVertices, setIdentityVertices] = useState<IdentityVertices | null>(null);
  const [identityStatus, setIdentityStatus] = useState<"ready" | "generating" | "error">("ready");
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
  const [monitoring, setMonitoring] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationComplete, setCalibrationComplete] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [neutralFrame, setNeutralFrame] = useState<TrackingFrame | null>(null);
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "paused">("idle");
  const [recordingStartedAt, setRecordingStartedAt] = useState(0);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [recordedFrames, setRecordedFrames] = useState<RecordedFrame[]>([]);
  const [lastVideo, setLastVideo] = useState<Blob | null>(null);
  const [lastAudio, setLastAudio] = useState<Blob | null>(null);
  const [captureFinalizing, setCaptureFinalizing] = useState(false);
  const [recordedViewState, setRecordedViewState] = useState<CameraViewState | null>(null);
  const [forcedViewState, setForcedViewState] = useState<CameraViewState | null>(null);
  const [lastVideoQuality, setLastVideoQuality] = useState({ videoBitrate: 12_000_000, audioBitrate: 192_000 });
  const [videoExportProgress, setVideoExportProgress] = useState<number | null>(null);
  const [videoExportBackend, setVideoExportBackend] = useState<"webcodecs" | "ffmpeg" | null>(null);
  const [motionVideoRendering, setMotionVideoRendering] = useState(false);
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
  const [fullscreen, setFullscreen] = useState(false);
  const [outputControlsHidden, setOutputControlsHidden] = useState(false);
  const [popoutState, setPopoutState] = useState<"idle" | "starting" | "active">("idle");
  const [trackerRestartKey, setTrackerRestartKey] = useState(0);
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [stageSize, setStageSize] = useState<ViewportSize>({ width: 640, height: 480 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const faceAlignment = useMemo(
    () => assessFaceAlignment(trackingFrame, settings.mirror, videoRef.current, stageSize),
    [settings.mirror, stageSize, trackingFrame],
  );
  const calibrationReadiness: FaceAlignment = calibrating
    ? faceAlignment
    : neutralFrame
      ? { status: "ready", message: "Neutral calibration saved" }
      : trackingFrame
        ? { status: "ready", message: "Face detected — press Calibrate neutral when ready" }
        : { status: "missing", message: cameraAccess === "ready" ? "Calibration idle — waiting for a face" : "Calibration idle — connect a camera when you want face tracking" };
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const motionInputRef = useRef<HTMLInputElement>(null);
  const backgroundObjectUrlRef = useRef<string | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const monitorNodeRef = useRef<GainNode | null>(null);
  const mutedRef = useRef(settings.muted);
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
  const popoutStateRef = useRef(popoutState);
  const webPopoutRef = useRef<Window | null>(null);
  const playbackAnimationRef = useRef<number | null>(null);
  const trackingFrameRef = useRef<TrackingFrame | null>(null);
  const faceAlignmentRef = useRef<FaceAlignment>(faceAlignment);
  const trackingSmoothingRef = useRef(settings.trackingSmoothing);
  const motionSmoothingRef = useRef(settings.motionSmoothing);
  const trackingSmootherRef = useRef(new AdaptiveTrackingSmoother());
  const calibrationSessionRef = useRef(0);
  const identityDecoderRef = useRef<DenseDecoder | null>(null);
  const webIdentityEvaluatorRef = useRef<WebIdentityEvaluator | null>(null);
  const toastIdRef = useRef(0);

  mutedRef.current = settings.muted;
  monitoringRef.current = monitoring;
  trackingFrameRef.current = trackingFrame;
  faceAlignmentRef.current = faceAlignment;
  trackingSmoothingRef.current = settings.trackingSmoothingEnabled ? settings.trackingSmoothing : 0;
  motionSmoothingRef.current = settings.motionSmoothingEnabled ? settings.motionSmoothing : 0;
  popoutStateRef.current = popoutState;

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

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(outputChannelName);
    outputChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<OutputToMainMessage>) => {
      const message = event.data;
      if (message.type === "ready") {
        outputHeartbeatRef.current = Date.now();
        setPopoutState("active");
        pushToast({ type: "success", title: "Output popout connected", message: "The popout now owns the only 3D renderer. Camera tracking and controls remain in the studio." });
      } else if (message.type === "heartbeat") {
        outputHeartbeatRef.current = message.timestamp;
      } else if (message.type === "closed") {
        setPopoutState("idle");
        outputHeartbeatRef.current = 0;
      } else if (message.type === "record-result") {
        setLastVideo(message.blob);
        setCaptureFinalizing(false);
      } else if (message.type === "view-state") {
        currentViewStateRef.current = message.viewState;
      } else if (message.type === "avatar-motion") {
        storeAvatarMotion(message.sample, message.frameTimestamp);
      } else if (message.type === "error") {
        if (message.operation === "Popout microphone") {
          pushToast({ type: "warning", title: "Popout recording has no microphone", message: message.message, duration: 8_000 });
        } else {
          if (message.operation === "Popout recording") setCaptureFinalizing(false);
          setDeviceError(`${message.operation}: ${message.message}`);
        }
      }
    };
    return () => {
      channel.close();
      outputChannelRef.current = null;
    };
  }, [pushToast, storeAvatarMotion]);

  useEffect(() => {
    if (popoutState !== "active") return;
    const monitor = window.setInterval(() => {
      if (Date.now() - outputHeartbeatRef.current < 4_000) return;
      setPopoutState("idle");
      if (recordingState !== "idle") {
        setRecordingState("idle");
        setCaptureFinalizing(false);
        if (recordingTickerRef.current) window.clearInterval(recordingTickerRef.current);
      }
      pushToast({ type: "warning", title: "Output popout disconnected", message: "The canvas has been restored to the studio. Any unfinished popout video could not be recovered." });
    }, 1_000);
    return () => window.clearInterval(monitor);
  }, [popoutState, pushToast, recordingState]);

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
      if (backgroundObjectUrlRef.current) URL.revokeObjectURL(backgroundObjectUrlRef.current);
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
    if (settings.outputAlwaysHideControls) {
      setOutputControlsHidden(true);
      return;
    }
    setOutputControlsHidden(false);
    if (settings.outputAutoHideEnabled) {
      outputHideTimerRef.current = window.setTimeout(
        () => setOutputControlsHidden(true),
        Math.max(0.5, settings.outputAutoHideDelay) * 1_000,
      );
    }
  }, [clearOutputHideTimer, fullscreen, settings.outputAlwaysHideControls, settings.outputAutoHideDelay, settings.outputAutoHideEnabled]);

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
        setOutputControlsHidden((value) => !value);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearOutputHideTimer();
    };
  }, [clearOutputHideTimer, exitFullscreenView, fullscreen, scheduleOutputControls]);

  useEffect(() => {
    if (isDesktopRuntime) return;
    const syncFullscreen = () => {
      if (!document.fullscreenElement) {
        setFullscreen(false);
        setOutputControlsHidden(false);
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
    DenseDecoder.load(assetUrl("models/gnm_identity_decoder.bin"))
      .then((decoder) => { if (!disposed) identityDecoderRef.current = decoder; })
      .catch((error) => setDeviceError(`Identity decoder: ${String(error)}`));
    return () => {
      disposed = true;
      webIdentityEvaluatorRef.current?.dispose();
      webIdentityEvaluatorRef.current = null;
    };
  }, []);

  const generateIdentity = async (seed = identitySeed) => {
    if (!identityDecoderRef.current) {
      setDeviceError("Identity generation: the local identity decoder is still loading. Wait a moment and retry.");
      return;
    }
    setIdentityStatus("generating");
    try {
      const identity = identityDecoderRef.current.evaluate(
        identityDecoderInput(seed, identityGender, identityEthnicity),
      );
      let vertices: IdentityVertices;
      if (isDesktopRuntime) {
        const { invoke } = await import("@tauri-apps/api/core");
        vertices = await invoke<number[][]>("gnm_evaluate", {
          identity: Array.from(identity),
          expression: new Array(383).fill(0),
          rotations: new Array(4).fill(null).map(() => [0, 0, 0]),
          translation: [0, 0, 0],
        });
      } else {
        if (!webIdentityEvaluatorRef.current) {
          const { WebIdentityEvaluator } = await import("./lib/webIdentity");
          webIdentityEvaluatorRef.current = new WebIdentityEvaluator();
        }
        vertices = await webIdentityEvaluatorRef.current.evaluate(identity);
      }
      setIdentityVertices(vertices);
      setIdentityStatus("ready");
      pushToast({
        type: "success",
        title: "Identity generated",
        message: `GNM rebuilt ${identityVertexCount(vertices).toLocaleString()} vertices from seed ${seed}${isDesktopRuntime ? " with the native Rust evaluator" : " in a background web worker"}.`,
      });
    } catch (error) {
      setIdentityStatus("error");
      setDeviceError(`Identity generation: ${String(error)}`);
    }
  };

  const randomizeIdentity = () => {
    const seed = `GNM-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase()}`;
    setIdentitySeed(seed);
    void generateIdentity(seed);
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

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
      if (backgroundObjectUrlRef.current) URL.revokeObjectURL(backgroundObjectUrlRef.current);
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
      if (backgroundObjectUrlRef.current) URL.revokeObjectURL(backgroundObjectUrlRef.current);
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
      setOutputControlsHidden(settings.outputAlwaysHideControls);
    } catch (error) {
      setDeviceError(`Enter fullscreen: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const postToOutput = (message: MainToOutputMessage) => outputChannelRef.current?.postMessage(message);

  const openOutputPopout = async () => {
    if (popoutState === "active") {
      postToOutput({ type: "focus" });
      return;
    }
    if (typeof BroadcastChannel === "undefined") {
      setDeviceError("Output popout is unavailable because this WebView does not support BroadcastChannel.");
      return;
    }
    setPopoutState("starting");
    outputHeartbeatRef.current = Date.now();
    try {
      if (isDesktopRuntime) {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("output");
        if (existing) {
          await existing.setFocus();
        } else {
          const output = new WebviewWindow("output", {
            url: "?output=1",
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
            setPopoutState("idle");
            setDeviceError(`Open output popout: ${String(event.payload)}`);
          });
        }
      } else {
        const url = new URL(window.location.href);
        url.searchParams.set("output", "1");
        webPopoutRef.current = window.open(url, "gnm-studio-output", "popup,width=1280,height=720,resizable=yes");
        if (!webPopoutRef.current) throw new Error("The browser blocked the popout. Allow popups for this site and retry.");
      }
      window.setTimeout(() => {
        if (popoutStateRef.current !== "starting") return;
        webPopoutRef.current?.close();
        setPopoutState("idle");
        setDeviceError("Output popout did not connect within 10 seconds. It was closed so the studio renderer could be restored safely.");
      }, 10_000);
    } catch (error) {
      setPopoutState("idle");
      setDeviceError(`Open output popout: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const closeOutputPopout = () => {
    postToOutput({ type: "close" });
    webPopoutRef.current?.close();
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
      stream.getAudioTracks().forEach((track) => { track.enabled = !mutedRef.current; });

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
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const sample of data) sum += sample * sample;
        const rms = Math.sqrt(sum / data.length);
        const scaled = Math.min(1, Math.max(0, (20 * Math.log10(Math.max(rms, 1e-7)) + 60) / 60));
        peak = Math.max(scaled, peak * 0.985);
        if (now - lastUpdate > 32) {
          setAudioLevel(mutedRef.current ? 0 : scaled);
          setAudioPeak(mutedRef.current ? 0 : peak);
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
      track.enabled = !settings.muted;
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
        const rawFrame = event.data.frame as TrackingFrame | null;
        if (rawFrame) {
          setTrackingFrame(trackingSmootherRef.current.smooth(
            rawFrame,
            trackingSmoothingRef.current,
            motionSmoothingRef.current,
          ));
        } else {
          trackingSmootherRef.current.reset();
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
      timestamp: calibratedFrame.timestamp - recordingStartedAt,
      blendshapes: Object.fromEntries(calibratedFrame.blendshapes.map(({ name, score }) => [name, score])),
      matrix: calibratedFrame.matrix,
      avatarMotion,
    };
    recordingFramesRef.current.push(captured);
    if (!avatarMotion) {
      pendingAvatarMotionFramesRef.current.set(calibratedFrame.timestamp, recordingFramesRef.current.length - 1);
    }
  }, [neutralFrame, recordingStartedAt, recordingState, trackingFrame]);

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
    setRecordedViewState(currentViewStateRef.current);
    const started = performance.now();
    setRecordingStartedAt(started);
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
        postToOutput({
          type: "record",
          action: "start",
          fps: settings.exportFps,
          videoBitrate,
          audioBitrate,
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
    recordingTickerRef.current = window.setInterval(() => setRecordingElapsed(performance.now() - started), 100);
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
    if (playbackAnimationRef.current) cancelAnimationFrame(playbackAnimationRef.current);
    playbackAnimationRef.current = null;
    setPlaying(false);
    const duration = recordedFrames.at(-1)?.timestamp ?? 0;
    const elapsed = Math.min(duration, Math.max(0, requestedTime));
    const recorded = recordedFrameAtTime(recordedFrames, elapsed);
    const landmarks = neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
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
      if (popoutState === "active" && settings.recordingMode !== "motion") postToOutput({ type: "record", action: "pause" });
      else mediaRecorderRef.current?.pause();
      setRecordingState("paused");
      pushToast({ type: "warning", title: "Recording paused", message: "The current take is preserved. Resume when ready." });
    } else if (recordingState === "paused") {
      if (popoutState === "active" && settings.recordingMode !== "motion") postToOutput({ type: "record", action: "resume" });
      else mediaRecorderRef.current?.resume();
      setRecordingState("recording");
      pushToast({ type: "info", title: "Recording resumed", message: "Motion and enabled media tracks are recording again." });
    } else if (recordedFrames.length) {
      if (playing) {
        if (playbackAnimationRef.current) cancelAnimationFrame(playbackAnimationRef.current);
        playbackAnimationRef.current = null;
        setPlaying(false);
      } else {
        const duration = recordedFrames.at(-1)?.timestamp ?? 0;
        const resumeFrom = recordingElapsed >= duration ? 0 : Math.min(duration, Math.max(0, recordingElapsed));
        const started = performance.now() - resumeFrom;
        const landmarks = neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
        const initialFrame = recordedFrameAtTime(recordedFrames, resumeFrom);
        setPlaybackFrame(playbackTrackingFrame(initialFrame, landmarks));
        setRecordingElapsed(resumeFrom);
        setPlaying(true);
        const tick = (now: number) => {
          const elapsed = Math.min(duration, now - started);
          const recorded = recordedFrameAtTime(recordedFrames, elapsed);
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
    if (popoutState === "active" && settings.recordingMode !== "motion") {
      setCaptureFinalizing(true);
      postToOutput({ type: "record", action: "stop" });
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
      setNeutralFrame(motion.neutral);
      if (motion.avatarKind) updateSetting("avatarKind", motion.avatarKind);
      setManualExpressions(motion.manualExpressions);
      setFrozenExpressions(motion.frozenExpressions);
      recordingFramesRef.current = motion.frames;
      setRecordedFrames(motion.frames);
      setLastVideo(null);
      setLastAudio(null);
      setRecordedViewState(motion.viewState);
      setRecordingElapsed(0);
      updateSetting("exportFps", motion.fps);
      const firstFrame = motion.frames[0];
      const landmarks = motion.neutral?.landmarks ?? trackingFrame?.landmarks ?? [];
      setPlaybackFrame(playbackTrackingFrame(firstFrame, landmarks));
      setActiveWorkspace("export");
      const duration = motion.frames.at(-1)?.timestamp ?? 0;
      pushToast({
        type: "success",
        title: "Motion JSON imported",
        message: `${motion.frames.length.toLocaleString()} frames from ${file.name} are ready to scrub, play, and export as GLB.`,
        detail: `Duration: ${formatTime(duration)} · FPS: ${motion.fps} · Neutral calibration: ${motion.neutral ? "restored" : "not included"}. JSON contains motion only, so no MP4/WebM camera or microphone source was restored.`,
        duration: 9_000,
      });
    } catch (error) {
      setDeviceError(`Motion JSON import failed for ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const exportMotion = async () => {
    try {
      const payload = {
        format: "gnm-studio-motion", version: 1, fps: settings.exportFps,
        avatarKind: settings.avatarKind,
        retargetProfile: activeProfile.label,
        manualExpressions,
        frozenExpressions,
        neutral: neutralFrame, frames: recordedFrames,
        viewState: recordedViewState,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
      const result = await saveBytes(bytes, timestampedFilename("json", "_motion"), "application/json");
      showSaveResult("Motion export complete", "The editable JSON capture", result);
    } catch (error) {
      setDeviceError(`Motion JSON export failed: ${String(error)}`);
    } finally {
      scheduleTrackerHealthCheck("JSON export");
    }
  };

  const renderRecordedMotionVideo = async () => {
    if (!recordedFrames.length) throw new Error("There is no recorded motion take to render.");
    const restoreViewState = currentViewStateRef.current;
    let canvas = avatarCanvasRef.current;
    if (!canvas && popoutState !== "idle") {
      pushToast({ type: "info", title: "Restoring the studio canvas", message: "Motion-to-video rendering needs the local output surface, so the popout is closing before the offline pass." });
      closeOutputPopout();
      const deadline = performance.now() + 10_000;
      while (!avatarCanvasRef.current && performance.now() < deadline) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      canvas = avatarCanvasRef.current;
      if (canvas) await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    }
    if (!canvas) throw new Error("The rendered capture surface is not ready yet.");
    if (typeof canvas.captureStream !== "function") {
      throw new Error("This browser cannot capture the rendered avatar canvas. Use a current Chromium-based browser.");
    }
    const quality = {
      videoBitrate: settings.videoBitrateMbps * 1_000_000,
      audioBitrate: settings.audioBitrateKbps * 1_000,
    };
    let duration = Math.max(recordedFrames.at(-1)?.timestamp ?? 0, 500);
    const landmarks = neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
    let stream: MediaStream | null = null;
    let renderAudioContext: AudioContext | null = null;
    let renderAudioSource: AudioBufferSourceNode | null = null;
    let recorder: MediaRecorder | null = null;
    let animation = 0;

    setForcedViewState(recordedViewState ?? restoreViewState);
    try {
      await afterBrowserPaint();
      stream = canvas.captureStream(settings.exportFps);
      if (lastAudio) {
        try {
          renderAudioContext = new AudioContext();
          const audioBuffer = await renderAudioContext.decodeAudioData(await lastAudio.arrayBuffer());
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
      const mimeType = preferredVideoRecorderMimeType(hasAudio);
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
      setPlaybackFrame(playbackTrackingFrame(recordedFrames[0], landmarks));
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
          const recorded = recordedFrameAtTime(recordedFrames, elapsed);
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
      let video = lastVideo;
      let quality = lastVideoQuality;
      let renderedFromMotion = false;
      if (!video) {
        renderedFromMotion = true;
        setVideoExportProgress(0);
        setVideoExportBackend("webcodecs");
        pushToast({
          type: "info",
          title: "Rendering motion take to video",
          message: "The avatar will play once in real time, then the browser will encode the result as MP4. Keep this tab visible until export finishes.",
          duration: 8_000,
        });
        const rendered = await renderRecordedMotionVideo();
        video = rendered.video;
        quality = rendered.quality;
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
      const bytes = await createAnimatedGlb(
        recordedFrames,
        identityVertices,
        manualExpressions,
        frozenExpressions,
        {
          enabled: settings.skinTextureEnabled,
          tone: settings.skinTone,
          scale: settings.skinTextureScale,
          rotation: settings.skinTextureRotation,
          feather: settings.skinTextureFeather,
        },
        {
          avatarKind: settings.avatarKind,
          neutralFrame,
          mirror: settings.mirror,
          headPose: {
            enabled: settings.headRotationEnabled,
            yawStrength: settings.headYawStrength,
            pitchStrength: settings.headPitchStrength,
            rollStrength: settings.headRollStrength,
            deadZone: settings.headRotationDeadZone,
            smoothing: settings.headRotationSmoothing,
          },
        },
      );
      const result = await saveBytes(bytes, timestampedFilename("glb", `_${settings.avatarKind}_animation`), "model/gltf-binary");
      showSaveResult("Blender export complete", `The animated GLB with ${activeProfile.label} morph targets`, result);
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
  const timelineDuration = recordedFrames.length
    ? Math.max(1, recordedDuration)
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
  const activeLiveExpressions: Record<string, number> = settings.avatarKind === "facecap" ? liveFacecap : liveSemantic;
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
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cameraStreamRef.current) return;
    if (video.srcObject !== cameraStreamRef.current) video.srcObject = cameraStreamRef.current;
    void video.play().catch(() => undefined);
  }, [popoutState]);

  useEffect(() => {
    if (popoutState !== "active") return;
    const snapshot: OutputSnapshot = {
      settings,
      frame: displayedFrameRef.current,
      neutralFrame,
      identityVertices,
      manualExpressions,
      frozenExpressions,
      trackingReady: Boolean(trackingFrameRef.current),
      recordingActive: motionVideoRendering || recordingState !== "idle",
      resetViewSignal,
      backgroundImageUrl,
      viewState: currentViewStateRef.current,
    };
    postToOutput({ type: "snapshot", snapshot });
  }, [backgroundImageUrl, frozenExpressions, identityVertices, manualExpressions, motionVideoRendering, neutralFrame, popoutState, recordingState, resetViewSignal, settings]);

  useEffect(() => {
    if (popoutState !== "active") return;
    postToOutput({ type: "frame", frame: displayedFrame, trackingReady: Boolean(trackingFrame) });
  }, [displayedFrame, popoutState, trackingFrame]);

  return (
    <>
    <main
      className={`app-shell ${isWebEdition ? "web-edition" : "desktop-edition"} ${recordingState === "recording" ? "is-recording" : ""} ${fullscreen ? "viewport-focus" : ""} ${outputControlsHidden ? "output-controls-hidden" : ""}`}
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
          <span className="device-status" title={captureStatusTitle} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openBackendMenu(event.clientX, event.clientY); }}><span className={`capture-device-icon ${cameraAccess === "ready" ? "ready" : "unavailable"}`} title={`Camera ${cameraAccess === "ready" ? "ready" : "not connected"}`}><PhosphorCamera size={14} weight="fill" /></span><span className={`capture-device-icon ${microphoneAccess === "ready" ? "ready" : "unavailable"}`} title={`Microphone ${microphoneAccess === "ready" ? "ready" : "not connected"}`}><PhosphorMicrophone size={14} weight="fill" /></span><b>{connectedCaptureCount}/2</b></span>
          <button
            className={`backend-status ${backendMenu ? "active" : ""}`}
            title="Click or right-click to choose Auto, GPU, or CPU tracking"
            aria-haspopup="menu"
            aria-expanded={Boolean(backendMenu)}
            onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openBackendMenu(rect.right - 232, rect.bottom + 7); }}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openBackendMenu(event.clientX, event.clientY); }}
          ><i className={trackerStatus === "ready" ? "online" : ""} />{trackerDelegate}</button>
          {recordingState !== "idle" && <span className="recording-pill">● REC {formatTime(recordingElapsed)}</span>}
          <button
            className={`icon-button ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen((value) => !value)}
            title="Appearance settings"
            aria-expanded={settingsOpen}
          ><Settings2 size={18} /></button>
        </div>
      </header>

      <aside className="sidebar left-sidebar">
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
                <div className="section-heading"><span>Identity</span><button onClick={randomizeIdentity} disabled={identityStatus === "generating"}><RefreshCw size={14} />{identityStatus === "generating" ? "Generating" : "Randomize"}</button></div>
                <label className="field-label">Seed<input className="text-input" value={identitySeed} onChange={(event) => setIdentitySeed(event.target.value)} onBlur={() => void generateIdentity()} /></label>
                <div className="two-up"><label className="field-label">Presentation<select value={identityGender} onChange={(event) => setIdentityGender(event.target.value as typeof identityGender)}><option value="blend">Blend</option><option value="female">Feminine</option><option value="male">Masculine</option></select></label><label className="field-label">Population<select value={identityEthnicity} onChange={(event) => setIdentityEthnicity(event.target.value as typeof identityEthnicity)}><option value="blend">Blend</option><option value="asian">Asian</option><option value="black">Black</option><option value="middle_eastern">Middle Eastern</option><option value="white">White</option></select></label></div>
                <button className="secondary-button wide" onClick={() => void generateIdentity()} disabled={identityStatus === "generating"}>{identityStatus === "generating" ? isWebEdition ? "Building in web worker…" : "Building GNM mesh…" : isWebEdition ? "Apply identity locally" : "Apply identity"}</button>
                {isWebEdition && <p className="helper-copy web-edition-note">The first identity loads a compressed browser runtime, then evaluates locally in a dedicated worker. Camera tracking and the interface remain responsive.</p>}
              </section>
            )}
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
              <div className="section-heading"><span>Capture mode</span></div>
              {(["motion", "avatar", "composite"] as RecordingMode[]).map((mode) => <label className="radio-card" key={mode}><input type="radio" name="mode" checked={settings.recordingMode === mode} onChange={() => updateSetting("recordingMode", mode)} /><span><strong>{mode === "motion" ? "Motion data" : mode === "avatar" ? "Avatar video" : "Camera + avatar"}</strong><small>{mode === "motion" ? "Small, editable capture" : mode === "avatar" ? "Clean rendered output" : "Composited performance"}</small></span></label>)}
              <p className="helper-copy capture-mode-help">Chooses what Record saves, not what the live viewport shows. Motion retains editable neutral-relative XYZ, scale, rotation, exact framing/view state, and unmuted microphone audio for later rendering; video modes capture the visible avatar or camera/avatar composite directly.</p>
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
          <div className="segmented view-mode-switch" aria-label="Viewport layers">
            <button disabled={calibrating} className={settings.showWebcam && settings.showAvatar ? "active" : ""} aria-pressed={settings.showWebcam && settings.showAvatar} onClick={() => { updateSetting("showWebcam", true); updateSetting("showAvatar", true); }}>Overlay</button>
            <button disabled={calibrating} className={settings.showWebcam && !settings.showAvatar ? "active" : ""} aria-pressed={settings.showWebcam && !settings.showAvatar} onClick={() => { updateSetting("showWebcam", true); updateSetting("showAvatar", false); }}>Camera</button>
            <button disabled={calibrating} className={!settings.showWebcam && settings.showAvatar ? "active" : ""} aria-pressed={!settings.showWebcam && settings.showAvatar} onClick={() => { updateSetting("showWebcam", false); updateSetting("showAvatar", true); }}>Avatar</button>
          </div>
          <div className="toolbar-actions"><button disabled={calibrating} className={`icon-button ${settings.mirror ? "active" : ""}`} title={settings.mirror ? "Mirrored camera and motion" : "Raw camera and motion"} aria-pressed={settings.mirror} onClick={() => updateSetting("mirror", !settings.mirror)}><FlipHorizontal2 size={16} /></button><button className="icon-button" title="Reset view" onClick={() => setResetViewSignal((value) => value + 1)}><RotateCcw size={16} /></button><button className={`icon-button ${popoutState !== "idle" ? "active" : ""}`} title={popoutState === "idle" ? "Open a clean canvas-only output window" : popoutState === "starting" ? "Output popout is connecting" : "Focus output popout"} aria-pressed={popoutState !== "idle"} disabled={calibrating || popoutState === "starting" || (popoutState === "idle" && recordingState !== "idle")} onClick={() => void openOutputPopout()}><PictureInPicture2 size={16} /></button><button className={`icon-button ${fullscreen ? "active" : ""}`} title={fullscreen ? "Exit fullscreen output (Esc)" : "Fullscreen canvas output"} aria-pressed={fullscreen} disabled={popoutState !== "idle"} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button></div>
        </div>
        {popoutState !== "idle" && <video ref={videoRef} className="tracking-video-hidden" autoPlay muted playsInline />}
        {popoutState === "idle" ? (
        <Stage
          avatarKind={settings.avatarKind}
          videoRef={videoRef}
          frame={displayedFrame}
          neutralFrame={neutralFrame}
          showWebcam={calibrating || settings.showWebcam}
          showAvatar={!calibrating && (motionVideoRendering || settings.showAvatar)}
          showLandmarks={!calibrating && settings.showLandmarks}
          mirror={settings.mirror}
          opacity={settings.avatarOpacity}
          wireframe={settings.wireframe}
          skinTextureEnabled={settings.skinTextureEnabled}
          skinTone={settings.skinTone}
          skinTextureScale={settings.skinTextureScale}
          skinTextureRotation={settings.skinTextureRotation}
          skinTextureFeather={settings.skinTextureFeather}
          backgroundMode={settings.backgroundMode}
          backgroundColor={settings.backgroundColor}
          backgroundImageUrl={backgroundImageUrl}
          backgroundImageZoom={settings.backgroundImageZoom}
          mouseLightEnabled={settings.mouseLightEnabled}
          mouseLightIntensity={settings.mouseLightIntensity}
          headPoseSettings={{
            enabled: settings.headRotationEnabled,
            yawStrength: settings.headYawStrength,
            pitchStrength: settings.headPitchStrength,
            rollStrength: settings.headRollStrength,
            deadZone: settings.headRotationDeadZone,
            smoothing: settings.headRotationSmoothing,
          }}
          calibrating={calibrating}
          calibrationComplete={calibrationComplete}
          faceAlignment={faceAlignment}
          countdown={countdown}
          trackingReady={Boolean(trackingFrame)}
          identityVertices={identityVertices}
          manualExpressions={manualExpressions}
          frozenExpressions={frozenExpressions}
          recordingMode={motionVideoRendering ? "avatar" : settings.recordingMode}
          recordingActive={motionVideoRendering || recordingState !== "idle"}
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
        {permissionState !== "ready" && !devicePromptDismissed && (
          <div className="permission-card"><Aperture size={28} /><div><strong>Connect capture devices (optional)</strong><span>Camera and microphone are only needed for live tracking and audio. Manual avatar tools remain available.</span>{deviceError && <small className="error-text">{deviceError}</small>}</div><div className="permission-actions"><button className="primary-button" onClick={requestDeviceAccess} disabled={permissionState === "asking"}>{permissionState === "asking" ? "Waiting…" : "Enable camera & microphone"}</button><button className="secondary-button" onClick={() => { setDevicePromptDismissed(true); pushToast({ type: "info", title: "Continuing without capture", message: "Avatar creation, manual expressions, backgrounds, lighting, and avatar-video export remain available." }); }}>Continue without capture</button></div></div>
        )}
      </section>

      <aside className="sidebar right-sidebar">
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
            <div className="timeline-labels"><span>00:00</span><span>{formatTime(recordedFrames.length ? recordedDuration : timelineDuration)}</span></div>
          </div>
          <div className="export-cluster" data-workspace-target="export"><FpsInput compact label="Export FPS" value={settings.exportFps} onChange={(value) => updateSetting("exportFps", value)} /><button className="secondary-button motion-import" onClick={() => motionInputRef.current?.click()} disabled={recordingState !== "idle" || calibrating || videoExportProgress !== null} title="Import a GNM Studio motion JSON file"><Upload size={15} /><span>Import JSON</span></button><button className="secondary-button" onClick={exportMotion} disabled={!recordedFrames.length || videoExportProgress !== null} title="Export motion JSON"><Download size={16} /><span>JSON</span></button><button className="secondary-button" onClick={exportGlb} disabled={!recordedFrames.length || videoExportProgress !== null} title="Export animated GLB for Blender"><Download size={16} /><span>GLB</span></button>{lastVideo && !lastVideo.type.includes("mp4") && <button className="secondary-button source-export" onClick={exportWebmSource} disabled={videoExportProgress !== null || captureFinalizing} title="Export optional unconverted WebM source"><Download size={14} /><span>WebM source</span></button>}<button className="primary-button" onClick={exportVideo} disabled={(!lastVideo && !recordedFrames.length) || captureFinalizing || videoExportProgress !== null || recordingState !== "idle"} title={captureFinalizing ? "Wait for the recorded media and microphone tracks to finish finalizing" : lastVideo ? "Export the directly recorded take as H.264/AAC MP4 without re-rendering" : recordedFrames.length ? "Render the recorded motion, framing, view, and retained audio as MP4" : "Record a motion or video take before exporting MP4"}><Download size={16} /><span>{captureFinalizing ? "Finalizing…" : videoExportProgress !== null ? videoExportBackend === "ffmpeg" ? "FFmpeg rendering…" : `Rendering ${Math.round(videoExportProgress * 100)}%` : "MP4"}</span></button></div>
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
