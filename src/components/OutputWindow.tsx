import { useCallback, useEffect, useRef, useState } from "react";
import { Stage } from "./Stage";
import { loadBackgroundImage } from "../lib/backgroundStore";
import {
  outputChannelName,
  type MainToOutputMessage,
  type OutputSnapshot,
  type OutputToMainEvent,
  type OutputToMainMessage,
} from "../lib/outputChannel";
import type { TrackingFrame } from "../types";
import { inspectRecordedMedia } from "../lib/mediaInspection";
import { preferredVideoRecorderMimeType, preferredWebmRecorderMimeType } from "../lib/recordingMedia";
import { canvasPngBlob } from "../lib/canvasCapture";
import "../App.css";

const isDesktopRuntime = "__TAURI_INTERNALS__" in window;
const ownerId = new URL(window.location.href).searchParams.get("outputSession") ?? "";

export function OutputWindow() {
  const [snapshot, setSnapshot] = useState<OutputSnapshot | null>(null);
  const [frame, setFrame] = useState<TrackingFrame | null>(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [rendererMounted, setRendererMounted] = useState(true);
  const [exportRenderSize, setExportRenderSize] = useState<{ width: number; height: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const snapshotRef = useRef<OutputSnapshot | null>(null);
  const recorderAudioContextRef = useRef<AudioContext | null>(null);
  const recorderAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeRecordingRequestRef = useRef("");
  const shutdownRequestedRef = useRef(false);
  const outputPhaseRef = useRef<"ready" | "recording" | "encoding" | "closing">("ready");

  snapshotRef.current = snapshot;

  const post = useCallback((message: OutputToMainEvent) => channelRef.current?.postMessage({ ...message, ownerId } satisfies OutputToMainMessage), []);
  const handleCompositeCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
  }, []);
  const handleStageError = useCallback((message: string) => {
    setError(message);
    post({ type: "error", operation: message.startsWith("Avatar model:") ? "Popout avatar" : "Popout material", message });
  }, [post]);

  const stopRecorderTracks = () => {
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
    try { recorderAudioSourceRef.current?.stop(); } catch { /* It may have ended naturally. */ }
    recorderAudioSourceRef.current = null;
    const audioContext = recorderAudioContextRef.current;
    recorderAudioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") void audioContext.close();
  };

  const finishShutdown = useCallback(async () => {
    outputPhaseRef.current = "closing";
    setRendererMounted(false);
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    post({ type: "shutdown-ready" });
  }, [post]);

  const startRecording = useCallback(async (message: Extract<MainToOutputMessage, { type: "record"; action: "start" }>) => {
    // Offline motion renders carry explicit dimensions: reframe the stage at the
    // export size before the stream starts so the recording is native-resolution.
    setExportRenderSize(message.width && message.height ? { width: message.width, height: message.height } : null);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.captureStream !== "function") throw new Error("The popout render surface is not ready for recording.");
    if (recorderRef.current && recorderRef.current.state !== "inactive") throw new Error("The popout is already recording.");
    const stream = canvas.captureStream(message.fps);
    const currentSnapshot = snapshotRef.current;
    let expectedAudio = false;
    if (message.retainedAudio) {
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(await message.retainedAudio.arrayBuffer());
      const destination = audioContext.createMediaStreamDestination();
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(destination);
      destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      recorderAudioContextRef.current = audioContext;
      recorderAudioSourceRef.current = source;
      expectedAudio = stream.getAudioTracks().length > 0;
    } else if (message.useLiveMicrophone && currentSnapshot && !currentSnapshot.settings.muted && navigator.mediaDevices?.getUserMedia) {
      try {
        const microphone = await navigator.mediaDevices.getUserMedia({
          audio: currentSnapshot.settings.microphoneId
            ? { deviceId: { exact: currentSnapshot.settings.microphoneId } }
            : true,
        });
        microphone.getAudioTracks().forEach((track) => stream.addTrack(track));
        expectedAudio = stream.getAudioTracks().length > 0;
      } catch (microphoneError) {
        post({ type: "error", operation: "Popout microphone", message: `${String(microphoneError)}. Video recording will continue without audio.` });
      }
    }
    const mimeType = message.forceWebm ? preferredWebmRecorderMimeType(expectedAudio) : preferredVideoRecorderMimeType(expectedAudio);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: message.videoBitrate,
      audioBitsPerSecond: message.audioBitrate,
    });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onerror = (event) => { setExportRenderSize(null); post({ type: "error", operation: "Popout recording", message: event.type }); };
    recorder.onstop = async () => {
      setExportRenderSize(null);
      outputPhaseRef.current = "encoding";
      post({ type: "record-state", requestId: message.requestId, state: "encoding" });
      if (chunksRef.current.length) {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
        if (expectedAudio) {
          try {
            const tracks = await inspectRecordedMedia(blob);
            if (!tracks.hasAudio) post({ type: "error", operation: "Popout microphone", message: "The selected recorder codec omitted the microphone track. Choose WebCodecs export or retry with a current WebView2 runtime." });
          } catch (inspectionError) {
            post({ type: "error", operation: "Popout recording", message: `Could not verify recorded microphone audio: ${String(inspectionError)}` });
          }
        }
        post({ type: "record-result", requestId: message.requestId, blob, mimeType: blob.type });
      } else {
        post({ type: "error", operation: "Popout recording", message: "The encoder stopped without producing media data." });
      }
      stopRecorderTracks();
      recorderRef.current = null;
      activeRecordingRequestRef.current = "";
      if (shutdownRequestedRef.current) {
        void finishShutdown();
      } else {
        outputPhaseRef.current = "ready";
        post({ type: "record-state", requestId: message.requestId, state: "ready" });
      }
    };
    recorderStreamRef.current = stream;
    recorderRef.current = recorder;
    activeRecordingRequestRef.current = message.requestId;
    if (recorderAudioContextRef.current?.state === "suspended") await recorderAudioContextRef.current.resume();
    recorder.start(250);
    recorderAudioSourceRef.current?.start();
    outputPhaseRef.current = "recording";
    post({ type: "record-state", requestId: message.requestId, state: "recording" });
  }, [finishShutdown, post]);

  useEffect(() => {
    let objectUrl: string | null = null;
    loadBackgroundImage().then((stored) => {
      if (!stored?.blob) return;
      objectUrl = URL.createObjectURL(stored.blob);
      setBackgroundImageUrl(objectUrl);
    }).catch((loadError) => setError(`Background: ${String(loadError)}`));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel(outputChannelName);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<MainToOutputMessage>) => {
      const message = event.data;
      if (!ownerId || message.ownerId !== ownerId) return;
      if (message.type === "snapshot") {
        setSnapshot(message.snapshot);
        setFrame(message.snapshot.frame);
      } else if (message.type === "frame") {
        setFrame(message.frame);
        setSnapshot((current) => current ? { ...current, trackingReady: message.trackingReady } : current);
      } else if (message.type === "record") {
        if (message.action === "start") void startRecording(message).catch((recordError) => post({ type: "error", operation: "Popout recording", message: String(recordError) }));
        else if (message.requestId !== activeRecordingRequestRef.current) return;
        else if (message.action === "pause" && recorderRef.current?.state === "recording") {
          recorderRef.current.pause();
          post({ type: "record-state", requestId: message.requestId, state: "paused" });
        } else if (message.action === "resume" && recorderRef.current?.state === "paused") {
          recorderRef.current.resume();
          post({ type: "record-state", requestId: message.requestId, state: "recording" });
        } else if (message.action === "stop" && recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      } else if (message.type === "capture-png") {
        const canvas = canvasRef.current;
        if (!canvas) {
          post({ type: "error", operation: "Popout PNG capture", message: "The popout render surface is not ready." });
        } else {
          setExportRenderSize({ width: message.width, height: message.height });
          void new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
            .then(() => canvasPngBlob(canvas, message.width, message.height))
            .then((blob) => post({ type: "png-result", requestId: message.requestId, blob }))
            .catch((captureError) => post({ type: "error", operation: "Popout PNG capture", message: String(captureError) }))
            .finally(() => setExportRenderSize(null));
        }
      } else if (message.type === "shutdown") {
        shutdownRequestedRef.current = true;
        outputPhaseRef.current = "closing";
        if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
        else void finishShutdown();
      } else if (message.type === "focus") {
        if (isDesktopRuntime) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setFocus());
        else window.focus();
      } else if (message.type === "close") {
        if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
        if (isDesktopRuntime) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close());
        else window.close();
      }
    };
    post({ type: "ready" });
    const heartbeat = window.setInterval(() => post({ type: "heartbeat", timestamp: Date.now(), phase: outputPhaseRef.current }), 1_000);
    const closing = () => post({ type: "closed" });
    window.addEventListener("beforeunload", closing);
    return () => {
      window.removeEventListener("beforeunload", closing);
      window.clearInterval(heartbeat);
      stopRecorderTracks();
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      channel.close();
      channelRef.current = null;
    };
  }, [finishShutdown, post, startRecording]);

  useEffect(() => {
    const video = videoRef.current;
    const webcamEnabled = snapshot?.settings.showWebcam ?? false;
    if (!video || !webcamEnabled || !navigator.mediaDevices?.getUserMedia) {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      if (video) video.srcObject = null;
      return;
    }

    let cancelled = false;
    const cameraId = snapshot?.settings.cameraId ?? "";
    const cameraFps = snapshot?.settings.cameraFps ?? 30;
    navigator.mediaDevices.getUserMedia({
      video: {
        ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
        frameRate: { ideal: cameraFps },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    }).then((stream) => {
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = stream;
      stream.getVideoTracks().forEach((track) => { track.enabled = !snapshotRef.current?.capturePaused; });
      video.srcObject = stream;
      void video.play().catch((playError) => {
        const message = `Could not start the selected camera layer: ${String(playError)}`;
        setError(message);
        post({ type: "error", operation: "Popout camera", message });
      });
    }).catch((cameraError) => {
      if (cancelled) return;
      const message = `Could not mirror the selected camera in the popout: ${String(cameraError)}`;
      setError(message);
      post({ type: "error", operation: "Popout camera", message });
    });

    return () => {
      cancelled = true;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      video.srcObject = null;
    };
  }, [post, snapshot?.settings.cameraFps, snapshot?.settings.cameraId, snapshot?.settings.showWebcam]);

  useEffect(() => {
    cameraStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !snapshot?.capturePaused;
    });
  }, [snapshot?.capturePaused]);

  useEffect(() => {
    const suppressContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", suppressContextMenu);
    return () => window.removeEventListener("contextmenu", suppressContextMenu);
  }, []);

  if (!snapshot || !rendererMounted) return <main className="output-window"><div className="output-loading">{rendererMounted ? "Connecting to GNM Studio…" : "Returning output to the studio…"}</div></main>;
  const settings = snapshot.settings;
  return (
    <main className="output-window">
      <Stage
        avatarKind={settings.avatarKind}
        videoRef={videoRef}
        frame={frame}
        neutralFrame={snapshot.neutralFrame}
        showWebcam={settings.showWebcam}
        showAvatar={settings.showAvatar}
        showLandmarks={settings.showLandmarks}
        mirror={settings.mirror}
        opacity={settings.avatarOpacity}
        wireframe={settings.wireframe}
        skinTextureEnabled={settings.skinTextureEnabled}
        skinTone={settings.skinTone}
        skinTextureScale={settings.skinTextureScale}
        skinTextureRotation={settings.skinTextureRotation}
        skinTextureFeather={settings.skinTextureFeather}
        eyeShaderEnabled={settings.eyeShaderEnabled}
        eyeColor={settings.eyeColor}
        backgroundMode={settings.backgroundMode}
        backgroundColor={settings.backgroundColor}
        backgroundImageUrl={snapshot.backgroundImageUrl ?? backgroundImageUrl}
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
        calibrating={false}
        calibrationComplete={false}
        faceAlignment={{ status: "ready", message: "Output" }}
        countdown={null}
        trackingReady={snapshot.trackingReady}
        identityVertices={snapshot.identityVertices}
        manualExpressions={snapshot.manualExpressions}
        frozenExpressions={snapshot.frozenExpressions}
        recordingMode="avatar"
        recordingActive={snapshot.recordingActive}
        resetViewSignal={snapshot.resetViewSignal}
        viewStateOverride={snapshot.viewState}
        exportRenderSize={exportRenderSize}
        onCancelCalibration={() => undefined}
        onCompositeCanvas={handleCompositeCanvas}
        onStageError={handleStageError}
        onViewStateChange={(viewState) => post({ type: "view-state", viewState })}
        onAvatarMotion={(sample, frameTimestamp) => post({ type: "avatar-motion", sample, frameTimestamp })}
      />
      {error && <div className="output-error">{error}</div>}
    </main>
  );
}
