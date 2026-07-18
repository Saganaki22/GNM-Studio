import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import { avatarProfiles } from "../../lib/avatarProfiles";
import { formatTime } from "../../lib/studioFormat";
import { applyNeutralBaseline } from "../../lib/trackingFrames";
import { inspectRecordedMedia } from "../../lib/mediaInspection";
import { parseMotionFile, type MotionFile } from "../../lib/motionFile";
import { mouthOpenInfluence } from "../../lib/retarget";
import { preferredAudioRecorderMimeType, preferredVideoRecorderMimeType } from "../../lib/recordingMedia";
import type { MainToOutputCommand } from "../../lib/outputChannel";
import type {
  AppSettings,
  AvatarMotionSample,
  CameraViewState,
  RecordedFrame,
  RecordedTakeSnapshot,
  TrackingFrame,
} from "../../types";

type RecordingState = "idle" | "recording" | "paused";
type OutputStartCommand = Omit<Extract<MainToOutputCommand, { type: "record"; action: "start" }>, "type" | "action">;

interface RecordingOutputAdapter {
  isActive(): boolean;
  begin(command: OutputStartCommand): Promise<void>;
  pause(paused: boolean): void;
  stop(): void;
}

interface RecordingPlaybackAdapter {
  reset(): void;
  setElapsed(elapsed: number): void;
  showFrame(frame: RecordedFrame, elapsed: number): void;
}

interface RecordingSessionOptions {
  settings: AppSettings;
  trackingFrame: TrackingFrame | null;
  neutralFrame: TrackingFrame | null;
  capturePaused: boolean;
  microphoneReady: boolean;
  backgroundImageUrl: string | null;
  getCanvas(): HTMLCanvasElement | null;
  cloneAudioTrack(): MediaStreamTrack | null;
  captureAppearance(): RecordedTakeSnapshot;
  createImportedAppearance(motion: MotionFile): RecordedTakeSnapshot;
  applyImportedAppearance(appearance: RecordedTakeSnapshot): void;
  output: RecordingOutputAdapter;
  playback: RecordingPlaybackAdapter;
  openExportWorkspace(): void;
  onImportedFps(fps: number): void;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
  onError(message: string): void;
}

export function useRecordingSession(options: RecordingSessionOptions) {
  const [state, setState] = useState<RecordingState>("idle");
  const [frames, setFrames] = useState<RecordedFrame[]>([]);
  const [lastVideo, setLastVideo] = useState<Blob | null>(null);
  const [lastAudio, setLastAudio] = useState<Blob | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [appearance, setAppearance] = useState<RecordedTakeSnapshot | null>(null);
  const [viewState, setViewState] = useState<CameraViewState | null>(null);
  const [videoQuality, setVideoQuality] = useState({ videoBitrate: 12_000_000, audioBitrate: 192_000 });
  const stateRef = useRef<RecordingState>(state);
  const framesRef = useRef<RecordedFrame[]>([]);
  const appearanceRef = useRef<RecordedTakeSnapshot | null>(null);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const pausedDurationRef = useRef(0);
  const latestAvatarMotionRef = useRef<{ timestamp: number; sample: AvatarMotionSample } | null>(null);
  const pendingAvatarMotionFramesRef = useRef(new Map<number, number>());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const tickerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  stateRef.current = state;

  const clearTicker = useCallback(() => {
    if (tickerRef.current !== null) window.clearInterval(tickerRef.current);
    tickerRef.current = null;
  }, []);
  const releaseStream = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
    if (captureStreamRef.current === stream) captureStreamRef.current = null;
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    clearTicker();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      try { recorder.stop(); } catch { /* The recorder may already be shutting down. */ }
    }
    releaseStream(captureStreamRef.current);
  }, [clearTicker, releaseStream]);

  const storeAvatarMotion = useCallback((sample: AvatarMotionSample, frameTimestamp: number) => {
    latestAvatarMotionRef.current = { timestamp: frameTimestamp, sample };
    const pendingFrameIndex = pendingAvatarMotionFramesRef.current.get(frameTimestamp);
    if (pendingFrameIndex !== undefined) {
      const pendingFrame = framesRef.current[pendingFrameIndex];
      if (pendingFrame) pendingFrame.avatarMotion = sample;
      pendingAvatarMotionFramesRef.current.delete(frameTimestamp);
    }
  }, []);

  useEffect(() => {
    if (!options.trackingFrame || state !== "recording") return;
    const calibratedFrame = applyNeutralBaseline(options.trackingFrame, options.neutralFrame) ?? options.trackingFrame;
    const latestAvatarMotion = latestAvatarMotionRef.current;
    const avatarMotion = latestAvatarMotion?.timestamp === calibratedFrame.timestamp ? latestAvatarMotion.sample : undefined;
    const captured: RecordedFrame = {
      timestamp: calibratedFrame.timestamp - startedAtRef.current - pausedDurationRef.current,
      blendshapes: Object.fromEntries(calibratedFrame.blendshapes.map(({ name, score }) => [name, score])),
      matrix: calibratedFrame.matrix,
      avatarMotion,
      mouthOpen: calibratedFrame.mouthOpen ?? mouthOpenInfluence(
        Object.fromEntries(calibratedFrame.blendshapes.map(({ name, score }) => [name, score])),
        calibratedFrame.landmarks,
      ),
    };
    framesRef.current.push(captured);
    if (!avatarMotion) pendingAvatarMotionFramesRef.current.set(calibratedFrame.timestamp, framesRef.current.length - 1);
  }, [options.neutralFrame, options.trackingFrame, state]);

  const start = useCallback(async () => {
    const current = optionsRef.current;
    const { settings } = current;
    if (current.capturePaused) {
      current.onToast({
        type: "warning",
        title: "Resume capture before recording",
        message: "Press the header Play button so face tracking and microphone processing are live before starting a take.",
      });
      return;
    }
    if (current.output.isActive() && settings.recordingMode !== "motion" && !settings.showAvatar) {
      current.onToast({
        type: "warning",
        title: "Popout avatar layer is disabled",
        message: "The clean popout intentionally excludes webcam pixels. Enable the avatar before recording there, or bring the canvas back for a camera composite.",
      });
      return;
    }
    if (!current.trackingFrame && settings.recordingMode === "motion") {
      current.onToast({
        type: "warning",
        title: "Tracker not ready",
        message: "Motion recording needs a detected face. Enable the camera, wait for Face linked, or choose Avatar video to record manual controls.",
      });
      return;
    }
    if (settings.recordingMode === "avatar" && !settings.showAvatar) {
      current.onToast({
        type: "warning",
        title: "Avatar layer is disabled",
        message: `Avatar video mode records only enabled avatar content. Turn on the ${avatarProfiles[settings.avatarKind].shortLabel} avatar or choose Camera + avatar mode.`,
      });
      return;
    }
    if (settings.recordingMode === "composite" && !settings.showAvatar && !settings.showWebcam) {
      current.onToast({
        type: "warning",
        title: "No visual layers are enabled",
        message: `Enable Webcam, the ${avatarProfiles[settings.avatarKind].shortLabel} avatar, or both before recording a composite video.`,
      });
      return;
    }

    let captureStream: MediaStream | null = null;
    let recordingIncludesAudio = false;
    try {
      current.playback.reset();
      framesRef.current = [];
      pendingAvatarMotionFramesRef.current.clear();
      latestAvatarMotionRef.current = null;
      setFrames([]);
      setLastVideo(null);
      setLastAudio(null);
      setFinalizing(false);
      const nextAppearance = current.captureAppearance();
      const previousBackgroundUrl = appearanceRef.current?.backgroundImageUrl;
      if (previousBackgroundUrl && previousBackgroundUrl !== current.backgroundImageUrl) URL.revokeObjectURL(previousBackgroundUrl);
      appearanceRef.current = nextAppearance;
      setAppearance(nextAppearance);
      setViewState(nextAppearance.viewState);
      const started = performance.now();
      startedAtRef.current = started;
      pausedAtRef.current = null;
      pausedDurationRef.current = 0;
      current.playback.setElapsed(0);

      const videoBitrate = settings.videoBitrateMbps * 1_000_000;
      const audioBitrate = settings.audioBitrateKbps * 1_000;
      setVideoQuality({ videoBitrate, audioBitrate });
      if (settings.recordingMode === "motion") {
        const audioTrack = current.cloneAudioTrack();
        if (audioTrack) {
          recordingIncludesAudio = true;
          const stream = new MediaStream([audioTrack]);
          captureStream = stream;
          captureStreamRef.current = stream;
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
              if (mountedRef.current) setLastAudio(audio);
            } catch (audioError) {
              if (mountedRef.current) current.onError(`Motion microphone capture failed: ${audioError instanceof Error ? audioError.message : String(audioError)} The motion frames remain usable.`);
            } finally {
              releaseStream(stream);
              if (recorderRef.current === recorder) recorderRef.current = null;
              if (mountedRef.current) setFinalizing(false);
            }
          };
          recorder.onerror = (event) => {
            if (mountedRef.current) {
              setFinalizing(false);
              current.onError(`Motion microphone recorder failed: ${event.type}. Motion capture will remain available without audio.`);
            }
            releaseStream(stream);
            if (recorderRef.current === recorder) recorderRef.current = null;
          };
          recorder.start(250);
          recorderRef.current = recorder;
        } else if (!settings.muted && current.microphoneReady) {
          current.onToast({ type: "warning", title: "Microphone track is not ready", message: "Motion capture will continue, but this take cannot include audio. Refresh the microphone and retry if audio is required." });
        }
      } else if (current.output.isActive()) {
        recordingIncludesAudio = !settings.muted;
        await current.output.begin({
          requestId: crypto.randomUUID?.() ?? `record-${Date.now()}`,
          fps: settings.exportFps,
          videoBitrate,
          audioBitrate,
          useLiveMicrophone: !settings.muted,
        });
        if (settings.recordingMode === "composite") {
          current.onToast({ type: "info", title: "Recording clean popout output", message: "The output window is canvas-only, so this take contains the avatar/background and microphone but not the webcam layer." });
        }
      } else {
        const canvas = current.getCanvas();
        if (!canvas) throw new Error("The rendered capture surface is not ready yet.");
        const stream = canvas.captureStream(settings.exportFps);
        captureStream = stream;
        captureStreamRef.current = stream;
        const audioTrack = current.cloneAudioTrack();
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
            if (expectedAudio && !tracks.hasAudio) throw new Error("The selected recorder codec omitted the microphone track. Retry with the portable WebCodecs backend or update WebView2.");
            if (mountedRef.current) setLastVideo(video);
          } catch (recordError) {
            if (mountedRef.current) current.onError(`Video finalization failed: ${recordError instanceof Error ? recordError.message : String(recordError)}`);
          } finally {
            releaseStream(stream);
            if (recorderRef.current === recorder) recorderRef.current = null;
            if (mountedRef.current) setFinalizing(false);
          }
        };
        recorder.onerror = (event) => {
          if (mountedRef.current) {
            setFinalizing(false);
            current.onError(`Video recorder failed: ${event.type}`);
          }
          releaseStream(stream);
          if (recorderRef.current === recorder) recorderRef.current = null;
        };
        recorder.start(250);
        recorderRef.current = recorder;
      }
      stateRef.current = "recording";
      setState("recording");
      clearTicker();
      tickerRef.current = window.setInterval(() => {
        const now = pausedAtRef.current ?? performance.now();
        optionsRef.current.playback.setElapsed(Math.max(0, now - startedAtRef.current - pausedDurationRef.current));
      }, 100);
      current.onToast({
        type: "info",
        title: "Recording started",
        message: settings.recordingMode === "motion"
          ? `Capturing timestamped face, neutral-relative XYZ, scale, and head-pose controls at up to ${settings.trackingFps} FPS${recordingIncludesAudio ? " with retained microphone audio" : " without microphone audio"}.`
          : `Capturing ${settings.recordingMode === "avatar" ? "avatar" : "composite"} video at ${settings.exportFps} FPS${recordingIncludesAudio ? " with microphone audio" : " without microphone audio"}.`,
      });
    } catch (error) {
      releaseStream(captureStream);
      recorderRef.current = null;
      clearTicker();
      stateRef.current = "idle";
      setState("idle");
      current.onError(`Recording setup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [clearTicker, releaseStream]);

  const setPaused = useCallback((paused: boolean) => {
    if (stateRef.current === "idle") return;
    const current = optionsRef.current;
    const recordingMode = appearanceRef.current?.settings.recordingMode ?? current.settings.recordingMode;
    if (current.output.isActive() && recordingMode !== "motion") {
      current.output.pause(paused);
    } else if (recorderRef.current) {
      if (paused && recorderRef.current.state === "recording") recorderRef.current.pause();
      if (!paused && recorderRef.current.state === "paused") recorderRef.current.resume();
    }
    if (paused) {
      pausedAtRef.current = performance.now();
      stateRef.current = "paused";
      setState("paused");
    } else {
      const now = performance.now();
      if (pausedAtRef.current !== null) pausedDurationRef.current += now - pausedAtRef.current;
      pausedAtRef.current = null;
      stateRef.current = "recording";
      setState("recording");
    }
  }, []);

  const stop = useCallback(() => {
    const current = optionsRef.current;
    const recordingMode = appearanceRef.current?.settings.recordingMode ?? current.settings.recordingMode;
    const hasRecorder = Boolean(recorderRef.current);
    if (current.output.isActive() && recordingMode !== "motion") {
      setFinalizing(true);
      current.output.stop();
    } else if (recorderRef.current && recorderRef.current.state !== "inactive") {
      setFinalizing(true);
      recorderRef.current.stop();
    } else {
      setFinalizing(false);
    }
    clearTicker();
    setFrames([...framesRef.current]);
    current.playback.setElapsed(framesRef.current.at(-1)?.timestamp ?? 0);
    stateRef.current = "idle";
    setState("idle");
    current.onToast({
      type: "success",
      title: "Take recorded",
      message: current.settings.recordingMode === "motion"
        ? `${framesRef.current.length.toLocaleString()} motion frames are ready${hasRecorder ? "; microphone audio is finalizing" : ""}.`
        : `The ${avatarProfiles[current.settings.avatarKind].shortLabel} video take is finalizing and will be ready for MP4 export momentarily${framesRef.current.length ? `; ${framesRef.current.length.toLocaleString()} motion frames were also retained` : ""}.`,
    });
  }, [clearTicker]);

  const interruptOutput = useCallback(() => {
    clearTicker();
    setFrames([...framesRef.current]);
    stateRef.current = "idle";
    setState("idle");
    setFinalizing(false);
  }, [clearTicker]);

  const acceptOutputVideo = useCallback((blob: Blob) => {
    setLastVideo(blob);
    setFinalizing(false);
  }, []);

  const importMotionJson = useCallback(async (file?: File) => {
    if (!file) return;
    const current = optionsRef.current;
    if (stateRef.current !== "idle") {
      current.onToast({
        type: "warning",
        title: "Stop recording before importing",
        message: "The current recording must be stopped before another motion take can replace it.",
      });
      return;
    }
    if (file.size > 256 * 1024 * 1024) {
      current.onError(`Motion JSON import failed: ${file.name} is larger than the 256 MB safety limit.`);
      return;
    }
    try {
      const motion = parseMotionFile(JSON.parse(await file.text()));
      current.playback.reset();
      current.onError("");
      const importedAppearance = motion.appearance ?? current.createImportedAppearance(motion);
      current.applyImportedAppearance(importedAppearance);
      const previousBackgroundUrl = appearanceRef.current?.backgroundImageUrl;
      if (previousBackgroundUrl && previousBackgroundUrl !== current.backgroundImageUrl) URL.revokeObjectURL(previousBackgroundUrl);
      appearanceRef.current = importedAppearance;
      setAppearance(importedAppearance);
      framesRef.current = motion.frames;
      setFrames(motion.frames);
      setLastVideo(null);
      setLastAudio(null);
      setViewState(importedAppearance.viewState);
      current.playback.setElapsed(0);
      current.onImportedFps(importedAppearance.settings.exportFps);
      current.playback.showFrame(motion.frames[0], 0);
      current.openExportWorkspace();
      const duration = motion.frames.at(-1)?.timestamp ?? 0;
      current.onToast({
        type: "success",
        title: "Motion JSON imported",
        message: `${motion.frames.length.toLocaleString()} frames from ${file.name} are ready to scrub, play, and export as GLB.`,
        detail: `Duration: ${formatTime(duration)} · FPS: ${motion.fps} · Neutral calibration: ${importedAppearance.neutralFrame ? "restored" : "not included"} · Appearance snapshot: ${motion.version === 2 ? "restored" : "rebuilt from current settings"}. JSON contains no MP4/WebM camera or microphone source.`,
        duration: 9_000,
      });
    } catch (error) {
      current.onError(`Motion JSON import failed for ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const useCurrentAppearance = useCallback(() => {
    if (!framesRef.current.length) return;
    const current = optionsRef.current;
    const nextAppearance = current.captureAppearance();
    appearanceRef.current = nextAppearance;
    setAppearance(nextAppearance);
    setViewState(nextAppearance.viewState);
    current.onToast({
      type: "success",
      title: "Recorded take restyled",
      message: lastVideo
        ? "Playback, JSON, and GLB now use the current appearance. The directly recorded video remains unchanged because its pixels are already baked."
        : "Playback and future JSON, GLB, and MP4 renders now use the current appearance. The recorded motion frames were not changed.",
      duration: 8_000,
    });
  }, [lastVideo]);
  const getState = useCallback(() => stateRef.current, []);
  const getAppearance = useCallback(() => appearanceRef.current, []);

  return {
    state,
    frames,
    lastVideo,
    lastAudio,
    finalizing,
    appearance,
    viewState,
    videoQuality,
    draftFrameCount: framesRef.current.length,
    start,
    stop,
    setPaused,
    interruptOutput,
    acceptOutputVideo,
    finishOutputError: () => setFinalizing(false),
    storeAvatarMotion,
    importMotionJson,
    useCurrentAppearance,
    getState,
    getAppearance,
    setVideo: setLastVideo,
    setAudio: setLastAudio,
    setFinalizing,
    setVideoQuality,
  };
}
