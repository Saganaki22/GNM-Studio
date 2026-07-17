import { useCallback, useEffect, useRef, useState } from "react";
import { Stage } from "./Stage";
import { loadBackgroundImage } from "../lib/backgroundStore";
import {
  outputChannelName,
  type MainToOutputMessage,
  type OutputSnapshot,
  type OutputToMainMessage,
} from "../lib/outputChannel";
import type { TrackingFrame } from "../types";
import "../App.css";

const isDesktopRuntime = "__TAURI_INTERNALS__" in window;

export function OutputWindow() {
  const [snapshot, setSnapshot] = useState<OutputSnapshot | null>(null);
  const [frame, setFrame] = useState<TrackingFrame | null>(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const snapshotRef = useRef<OutputSnapshot | null>(null);

  snapshotRef.current = snapshot;

  const post = useCallback((message: OutputToMainMessage) => channelRef.current?.postMessage(message), []);

  const stopRecorderTracks = () => {
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
  };

  const startRecording = useCallback(async (message: Extract<MainToOutputMessage, { type: "record"; action: "start" }>) => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.captureStream !== "function") throw new Error("The popout render surface is not ready for recording.");
    if (recorderRef.current && recorderRef.current.state !== "inactive") throw new Error("The popout is already recording.");
    const stream = canvas.captureStream(message.fps);
    const currentSnapshot = snapshotRef.current;
    if (currentSnapshot && !currentSnapshot.settings.muted && navigator.mediaDevices?.getUserMedia) {
      try {
        const microphone = await navigator.mediaDevices.getUserMedia({
          audio: currentSnapshot.settings.microphoneId
            ? { deviceId: { exact: currentSnapshot.settings.microphoneId } }
            : true,
        });
        microphone.getAudioTracks().forEach((track) => stream.addTrack(track));
      } catch (microphoneError) {
        post({ type: "error", operation: "Popout microphone", message: `${String(microphoneError)}. Video recording will continue without audio.` });
      }
    }
    const mimeTypes = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1.42E01E", "video/mp4",
      "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm",
    ];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: message.videoBitrate,
      audioBitsPerSecond: message.audioBitrate,
    });
    chunksRef.current = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onerror = (event) => post({ type: "error", operation: "Popout recording", message: event.type });
    recorder.onstop = () => {
      if (chunksRef.current.length) {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
        post({ type: "record-result", blob, mimeType: blob.type });
      } else {
        post({ type: "error", operation: "Popout recording", message: "The encoder stopped without producing media data." });
      }
      stopRecorderTracks();
      recorderRef.current = null;
    };
    recorderStreamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start(250);
  }, [post]);

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
      if (message.type === "snapshot") {
        setSnapshot(message.snapshot);
        setFrame(message.snapshot.frame);
      } else if (message.type === "frame") {
        setFrame(message.frame);
        setSnapshot((current) => current ? { ...current, trackingReady: message.trackingReady } : current);
      } else if (message.type === "record") {
        if (message.action === "start") void startRecording(message).catch((recordError) => post({ type: "error", operation: "Popout recording", message: String(recordError) }));
        else if (message.action === "pause" && recorderRef.current?.state === "recording") recorderRef.current.pause();
        else if (message.action === "resume" && recorderRef.current?.state === "paused") recorderRef.current.resume();
        else if (message.action === "stop" && recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
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
    const heartbeat = window.setInterval(() => post({ type: "heartbeat", timestamp: Date.now() }), 1_000);
    const closing = () => post({ type: "closed" });
    window.addEventListener("beforeunload", closing);
    return () => {
      window.removeEventListener("beforeunload", closing);
      window.clearInterval(heartbeat);
      stopRecorderTracks();
      channel.close();
      channelRef.current = null;
    };
  }, [post, startRecording]);

  useEffect(() => {
    const suppressContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", suppressContextMenu);
    return () => window.removeEventListener("contextmenu", suppressContextMenu);
  }, []);

  if (!snapshot) return <main className="output-window"><div className="output-loading">Connecting to GNM Studio…</div></main>;
  const settings = snapshot.settings;
  return (
    <main className="output-window">
      <Stage
        avatarKind={settings.avatarKind}
        videoRef={videoRef}
        frame={frame}
        neutralFrame={snapshot.neutralFrame}
        showWebcam={false}
        showAvatar={settings.showAvatar}
        showLandmarks={false}
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
        onCancelCalibration={() => undefined}
        onCompositeCanvas={(canvas) => { canvasRef.current = canvas; }}
        onSkinMaterialError={(message) => { setError(message); post({ type: "error", operation: "Popout material", message }); }}
      />
      {error && <div className="output-error">{error}</div>}
    </main>
  );
}
