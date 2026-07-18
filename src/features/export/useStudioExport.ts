import { useEffect, useState } from "react";
import { isWebEdition } from "../../app/studioConfig";
import { createAnimatedGlb } from "../../lib/glbExport";
import { avatarProfiles } from "../../lib/avatarProfiles";
import { canvasPngBlob } from "../../lib/canvasCapture";
import { createStoredZip } from "../../lib/zipStore";
import { saveBlob, saveBytes, type SaveResult } from "../../lib/save";
import { serializableRecordedTakeSnapshot } from "../../lib/recordingAppearance";
import { trimAndRetimeMotion } from "../../lib/motionEdit";
import { afterBrowserPaint, timestampedFilename } from "../../lib/studioFormat";
import { playbackTrackingFrame } from "../../lib/trackingFrames";
import { renderRecordedMotionMp4, renderRecordedMotionVideo } from "./motionVideoRenderer";
import type { MainToOutputCommand, OutputOwnerPhase } from "../../lib/outputChannel";
import type {
  AppSettings, CameraViewState, IdentityVertices, RecordedFrame, RecordedTakeSnapshot, TrackingFrame,
} from "../../types";

type OutputStartCommand = Omit<Extract<MainToOutputCommand, { type: "record"; action: "start" }>, "type" | "action">;

interface StudioExportOptions {
  settings: AppSettings;
  recordedFrames: RecordedFrame[];
  recordedViewState: CameraViewState | null;
  lastVideo: Blob | null;
  lastAudio: Blob | null;
  lastVideoQuality: { videoBitrate: number; audioBitrate: number };
  captureFinalizing: boolean;
  manualExpressions: Record<string, number>;
  frozenExpressions: Record<string, number>;
  neutralFrame: TrackingFrame | null;
  trackingFrame: TrackingFrame | null;
  identityVertices: IdentityVertices | null;
  playbackFrame: TrackingFrame | null;
  recordingElapsed: number;
  outputOwnerPhase: OutputOwnerPhase;
  popoutState: "idle" | "starting" | "active";
  recording: {
    getAppearance(): RecordedTakeSnapshot | null;
    setVideo(blob: Blob | null): void;
    setVideoQuality(quality: { videoBitrate: number; audioBitrate: number }): void;
  };
  playback: {
    resetSilently(): void;
    setFrame(frame: TrackingFrame | null): void;
    setElapsed(elapsed: number): void;
  };
  output: {
    beginRecording(command: OutputStartCommand): Promise<void>;
    waitForRecordingResult(requestId: string): Promise<Blob>;
    stopRecording(): void;
    capturePng(width: number, height: number): Promise<Blob>;
  };
  ffmpeg: { check(path?: string, notify?: boolean): Promise<{ available: boolean; version?: string; error?: string }> };
  getCanvas(): HTMLCanvasElement | null;
  getCurrentViewState(): CameraViewState | null;
  setForcedViewState(viewState: CameraViewState | null): void;
  showSaveResult(title: string, description: string, result: SaveResult): void;
  pushToast(toast: { type: "success" | "info" | "warning" | "error"; title: string; message: string; detail?: string; duration?: number }): unknown;
  setDeviceError(message: string): void;
  scheduleTrackerHealthCheck(exportName: string): void;
}

export function useStudioExport(options: StudioExportOptions) {
  const {
    settings, recordedFrames, recordedViewState, lastVideo, lastAudio, lastVideoQuality, captureFinalizing,
    manualExpressions, frozenExpressions, neutralFrame, trackingFrame, identityVertices, playbackFrame,
    recordingElapsed, outputOwnerPhase, popoutState, recording, playback, output, ffmpeg,
    getCanvas, getCurrentViewState, setForcedViewState, showSaveResult, pushToast, setDeviceError,
    scheduleTrackerHealthCheck,
  } = options;
  const [videoExportProgress, setVideoExportProgress] = useState<number | null>(null);
  const [videoExportBackend, setVideoExportBackend] = useState<"webcodecs" | "ffmpeg" | null>(null);
  const [motionVideoRendering, setMotionVideoRendering] = useState(false);
  const [pngSequenceRendering, setPngSequenceRendering] = useState(false);
  const [pngExportProgress, setPngExportProgress] = useState<number | null>(null);
  const [exportTrimStartMs, setExportTrimStartMs] = useState(0);
  const [exportTrimEndMs, setExportTrimEndMs] = useState(0);
  const [exportPlaybackSpeed, setExportPlaybackSpeed] = useState(1);

  useEffect(() => {
    const duration = recordedFrames.at(-1)?.timestamp ?? 0;
    setExportTrimStartMs(0);
    setExportTrimEndMs(duration);
    setExportPlaybackSpeed(1);
  }, [recordedFrames]);

  const editedFramesForExport = () => trimAndRetimeMotion(
    recordedFrames,
    exportTrimStartMs,
    exportTrimEndMs || (recordedFrames.at(-1)?.timestamp ?? 0),
    exportPlaybackSpeed,
    settings.exportFps,
  );

  const exportMotion = async () => {
    try {
      const appearance = recording.getAppearance();
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

  const createMotionRenderContext = async () => {
    const appearance = recording.getAppearance();
    const editedAudio = lastAudio
      ? await import("../../lib/audioEdit").then(({ trimAndRetimeAudio }) => (
          trimAndRetimeAudio(lastAudio, exportTrimStartMs, exportTrimEndMs, exportPlaybackSpeed)
        ))
      : null;
    return {
      settings,
      renderFrames: editedFramesForExport(),
      appearance,
      recordedViewState,
      neutralFrame,
      trackingFrame,
      editedAudio,
      outputOwnerPhase,
      restoreFrame: playbackFrame,
      restoreElapsed: recordingElapsed,
      getCanvas,
      getCurrentViewState,
      captureCurrentCanvasPng,
      recording,
      playback,
      output,
      setForcedViewState,
      setRendering: setMotionVideoRendering,
      setProgress: setVideoExportProgress,
    };
  };

  const renderMotionVideo = async ({ forceWebm = false }: { forceWebm?: boolean } = {}) => {
    if (!recordedFrames.length) throw new Error("There is no recorded motion take to render.");
    return renderRecordedMotionVideo(await createMotionRenderContext(), { forceWebm });
  };

  const renderMotionMp4 = async () => renderRecordedMotionMp4(await createMotionRenderContext());
  const captureCurrentCanvasPng = async (width = settings.exportWidth, height = settings.exportHeight) => {
    const canvas = getCanvas();
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
        const rendered = await renderMotionVideo({ forceWebm: true });
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
    const appearance = recording.getAppearance();
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
    const restoreView = getCurrentViewState();
    const landmarks = appearance?.neutralFrame?.landmarks ?? neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
    const entries: { name: string; bytes: Uint8Array }[] = [];
    playback.resetSilently();
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
        playback.setFrame(playbackTrackingFrame(frame, landmarks));
        playback.setElapsed(timestamp);
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
      playback.setFrame(restoreFrame);
      playback.setElapsed(restoreElapsed);
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
            const rendered = await renderMotionMp4();
            video = rendered.video;
            quality = rendered.quality;
          } catch (error) {
            if (settings.videoEncoderBackend === "webcodecs" || isWebEdition) throw error;
            pushToast({ type: "warning", title: "Portable H.264 unavailable", message: "Auto is falling back to the system-FFmpeg path for this device.", duration: 7_000 });
          }
        }
        if (!video) {
          const rendered = await renderMotionVideo();
          video = rendered.video;
          quality = rendered.quality;
        }
      }
      if (!video.type.includes("mp4")) {
        if (!renderedFromMotion) setVideoExportProgress(0);
        let useSystemFfmpeg = false;
        if (settings.videoEncoderBackend !== "webcodecs" && "__TAURI_INTERNALS__" in window) {
          const probe = await ffmpeg.check(settings.ffmpegPath, false);
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
          const { convertWithSystemFfmpeg } = await import("../../lib/systemFfmpeg");
          video = await convertWithSystemFfmpeg(video, settings.ffmpegPath, quality, setVideoExportProgress);
        } else {
          setVideoExportBackend("webcodecs");
          pushToast({
            type: "info",
            title: "Rendering MP4 with WebCodecs",
            message: "The portable local encoder is converting the WebM source to H.264/AAC. Recording timestamps are preserved.",
            duration: 7_000,
          });
          const { convertToMp4 } = await import("../../lib/mp4Export");
          video = await convertToMp4(
            video,
            quality,
            renderedFromMotion
              ? (progress: number) => setVideoExportProgress(0.45 + progress * 0.55)
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
      const appearance = recording.getAppearance();
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



  return {
    videoExportProgress,
    videoExportBackend,
    motionVideoRendering,
    pngSequenceRendering,
    pngExportProgress,
    exportTrimStartMs,
    exportTrimEndMs,
    exportPlaybackSpeed,
    setExportTrimStartMs,
    setExportTrimEndMs,
    setExportPlaybackSpeed,
    editedFramesForExport,
    exportMotion,
    captureStill,
    exportWebm,
    exportPngSequence,
    exportVideo,
    exportWebmSource,
    exportGlb,
  };
}
