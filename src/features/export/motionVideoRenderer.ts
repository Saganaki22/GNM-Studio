import { afterBrowserPaint } from "../../lib/studioFormat";
import { inspectRecordedMedia } from "../../lib/mediaInspection";
import { preferredVideoRecorderMimeType, preferredWebmRecorderMimeType } from "../../lib/recordingMedia";
import { playbackTrackingFrame, recordedFrameAtTime } from "../../lib/trackingFrames";
import type { AppSettings, CameraViewState, RecordedFrame, RecordedTakeSnapshot, TrackingFrame } from "../../types";
import type { MainToOutputCommand, OutputOwnerPhase } from "../../lib/outputChannel";

type OutputStartCommand = Omit<Extract<MainToOutputCommand, { type: "record"; action: "start" }>, "type" | "action">;

export interface MotionVideoRenderContext {
  settings: AppSettings;
  renderFrames: RecordedFrame[];
  appearance: RecordedTakeSnapshot | null;
  recordedViewState: CameraViewState | null;
  neutralFrame: TrackingFrame | null;
  trackingFrame: TrackingFrame | null;
  editedAudio: Blob | null;
  outputOwnerPhase: OutputOwnerPhase;
  restoreFrame: TrackingFrame | null;
  restoreElapsed: number;
  getCanvas(): HTMLCanvasElement | null;
  getCurrentViewState(): CameraViewState | null;
  captureCurrentCanvasPng(width: number, height: number): Promise<Blob>;
  recording: {
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
  };
  setForcedViewState(view: CameraViewState | null): void;
  setRendering(rendering: boolean): void;
  setProgress(progress: number): void;
}

function renderQuality(settings: AppSettings) {
  return {
    videoBitrate: settings.videoBitrateMbps * 1_000_000,
    audioBitrate: settings.audioBitrateKbps * 1_000,
  };
}

export async function renderRecordedMotionVideo(
  context: MotionVideoRenderContext,
  { forceWebm = false }: { forceWebm?: boolean } = {},
) {
  const {
    settings, renderFrames, appearance, recordedViewState, neutralFrame, trackingFrame, editedAudio,
    outputOwnerPhase, getCanvas, getCurrentViewState, recording, playback, output,
    setForcedViewState, setRendering, setProgress,
  } = context;
  if (!renderFrames.length) throw new Error("The current trim range contains no motion frames.");
  const restoreViewState = getCurrentViewState();
  const quality = renderQuality(settings);
  let duration = Math.max(renderFrames.at(-1)?.timestamp ?? 0, 500);
  const landmarks = appearance?.neutralFrame?.landmarks ?? neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
  const renderInPopout = outputOwnerPhase === "popout-ready";
  let canvas = getCanvas();
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
      playback.resetSilently();
      setRendering(true);
      playback.setFrame(playbackTrackingFrame(renderFrames[0], landmarks));
      playback.setElapsed(0);
      recording.setVideoQuality(quality);
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
          playback.setFrame(playbackTrackingFrame(recorded, landmarks));
          playback.setElapsed(elapsed);
          setProgress(Math.min(0.45, (elapsed / duration) * 0.45));
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
      recording.setVideo(rendered);
      return { video: rendered, quality };
    } finally {
      if (animation) cancelAnimationFrame(animation);
      setRendering(false);
      playback.setFrame(null);
      playback.setElapsed(duration);
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
        if (recorderFailure) reject(recorderFailure);
        else if (!chunks.length) reject(new Error("The browser recorder completed without producing video data."));
        else resolve(new Blob(chunks, { type: activeRecorder.mimeType || mimeType }));
      };
    });

    playback.resetSilently();
    setRendering(true);
    playback.setFrame(playbackTrackingFrame(renderFrames[0], landmarks));
    playback.setElapsed(0);
    recording.setVideoQuality(quality);
    await afterBrowserPaint();
    if (renderAudioContext?.state === "suspended") await renderAudioContext.resume();
    activeRecorder.start(250);
    renderAudioSource?.start();
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        const elapsed = Math.min(duration, now - started);
        const recorded = recordedFrameAtTime(renderFrames, elapsed);
        playback.setFrame(playbackTrackingFrame(recorded, landmarks));
        playback.setElapsed(elapsed);
        setProgress(Math.min(0.45, (elapsed / duration) * 0.45));
        if (elapsed < duration && !recorderFailure) animation = requestAnimationFrame(tick);
        else requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      };
      animation = requestAnimationFrame(tick);
    });
    if (activeRecorder.state !== "inactive") activeRecorder.stop();
    const rendered = await completed;
    if (hasAudio) {
      const tracks = await inspectRecordedMedia(rendered);
      if (!tracks.hasAudio) throw new Error("The motion renderer omitted the retained microphone track.");
    }
    recording.setVideo(rendered);
    return { video: rendered, quality };
  } finally {
    if (animation) cancelAnimationFrame(animation);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    try { renderAudioSource?.stop(); } catch { /* The source may have ended naturally. */ }
    if (renderAudioContext) await renderAudioContext.close();
    setRendering(false);
    playback.setFrame(null);
    playback.setElapsed(duration);
    setForcedViewState(restoreViewState);
    await afterBrowserPaint();
    setForcedViewState(null);
  }
}

export async function renderRecordedMotionMp4(context: MotionVideoRenderContext) {
  const {
    settings, renderFrames, appearance, recordedViewState, neutralFrame, trackingFrame, editedAudio,
    restoreFrame, restoreElapsed, getCanvas, getCurrentViewState, captureCurrentCanvasPng,
    recording, playback, setForcedViewState, setRendering, setProgress,
  } = context;
  if (!renderFrames.length) throw new Error("The current trim range contains no motion frames.");
  if (renderFrames.length > 20_000) {
    throw new Error(`The edited take contains ${renderFrames.length.toLocaleString()} frames, above the 20,000-frame deterministic-render safety limit.`);
  }
  const restoreView = getCurrentViewState();
  const landmarks = appearance?.neutralFrame?.landmarks ?? neutralFrame?.landmarks ?? trackingFrame?.landmarks ?? [];
  const quality = renderQuality(settings);
  const { createOfflineMp4Encoder } = await import("../../lib/offlineVideoExport");
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
    playback.resetSilently();
    setRendering(true);
    setForcedViewState(appearance?.viewState ?? recordedViewState ?? restoreView);
    recording.setVideoQuality(quality);
    playback.setFrame(playbackTrackingFrame(renderFrames[0], landmarks));
    playback.setElapsed(0);
    await afterBrowserPaint();
    for (let index = 0; index < renderFrames.length; index += 1) {
      const frame = renderFrames[index];
      playback.setFrame(playbackTrackingFrame(frame, landmarks));
      playback.setElapsed(frame.timestamp);
      await afterBrowserPaint();
      let sourceCanvas = getCanvas();
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
      setProgress((index + 1) / renderFrames.length * 0.92);
    }
    const video = await encoder.finalize();
    completed = true;
    setProgress(1);
    recording.setVideo(video);
    return { video, quality };
  } finally {
    if (!completed) await encoder.cancel().catch(() => undefined);
    setRendering(false);
    playback.setFrame(restoreFrame);
    playback.setElapsed(restoreElapsed);
    setForcedViewState(restoreView);
    await afterBrowserPaint();
    setForcedViewState(null);
  }
}
