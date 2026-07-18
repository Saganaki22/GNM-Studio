import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import { cloneLiveAudioTrack } from "../../lib/recordingMedia";
import type { DeviceOption } from "../../types";
import { useAudioMonitor } from "./useAudioMonitor";

export type CaptureAccess = "idle" | "ready" | "unavailable";
export type CapturePermission = "idle" | "asking" | "ready" | "error";

interface CaptureDeviceOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraId: string;
  microphoneId: string;
  cameraFps: number;
  muted: boolean;
  resolveSelection(cameras: DeviceOption[], microphones: DeviceOption[]): void;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
  onError(message: string | ((current: string) => string)): void;
}

export function useCaptureDevices({
  videoRef,
  cameraId,
  microphoneId,
  cameraFps,
  muted,
  resolveSelection,
  onToast,
  onError,
}: CaptureDeviceOptions) {
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [microphones, setMicrophones] = useState<DeviceOption[]>([]);
  const [permissionState, setPermissionState] = useState<CapturePermission>("idle");
  const [cameraAccess, setCameraAccess] = useState<CaptureAccess>("idle");
  const [microphoneAccess, setMicrophoneAccess] = useState<CaptureAccess>("idle");
  const [devicePromptDismissed, setDevicePromptDismissed] = useState(false);
  const [paused, setPausedState] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(paused);
  const mutedRef = useRef(muted);

  pausedRef.current = paused;
  mutedRef.current = muted;

  const attachVideo = useCallback(() => {
    const video = videoRef.current;
    const stream = cameraStreamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [videoRef]);

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
    resolveSelection(cameraOptions, microphoneOptions);
  }, [resolveSelection]);

  useEffect(() => {
    void enumerateDevices();
    navigator.mediaDevices?.addEventListener("devicechange", enumerateDevices);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", enumerateDevices);
  }, [enumerateDevices]);

  const requestAccess = useCallback(async () => {
    setPermissionState("asking");
    setDevicePromptDismissed(false);
    onError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState("error");
      setCameraAccess("unavailable");
      setMicrophoneAccess("unavailable");
      onError("Capture devices: this system does not expose the MediaDevices API. The avatar editor can still be used without a camera.");
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
        onError(`Capture access was not granted. Camera: ${cameraReason}. Microphone: ${microphoneReason}. You can continue without capture devices and use the avatar manually.`);
        return;
      }
      setPermissionState("ready");
      const connected = [cameraReady && "camera", microphoneReady && "microphone"].filter(Boolean).join(" and ");
      const unavailable = [!cameraReady && "camera", !microphoneReady && "microphone"].filter(Boolean).join(" and ");
      onToast({
        type: unavailable ? "warning" : "success",
        title: unavailable ? "Some capture hardware is unavailable" : "Capture devices connected",
        message: `${connected[0].toUpperCase() + connected.slice(1)} access is ready. Available capture processing remains local to this computer.${unavailable ? ` ${unavailable[0].toUpperCase() + unavailable.slice(1)} access is unavailable, but the avatar editor still works.` : ""}`,
        detail: unavailable ? `${unavailable[0].toUpperCase() + unavailable.slice(1)} access was unavailable or not granted. Offline avatar editing and rendering remain usable.` : undefined,
        duration: unavailable ? 8_000 : 5_000,
      });
    } catch (error) {
      setPermissionState("error");
      onError(error instanceof Error ? error.message : String(error));
    }
  }, [enumerateDevices, onError, onToast]);

  useEffect(() => {
    if (cameraAccess !== "ready" || !cameraId) return;
    let cancelled = false;
    let ownedStream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: cameraId },
        frameRate: { ideal: cameraFps },
        width: { ideal: 1280 }, height: { ideal: 720 },
      },
      audio: false,
    }).then((stream) => {
      if (cancelled) return stream.getTracks().forEach((track) => track.stop());
      ownedStream = stream;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = stream;
      stream.getVideoTracks().forEach((track) => { track.enabled = !pausedRef.current; });
      attachVideo();
    }).catch((error) => {
      setCameraAccess("unavailable");
      onError(`Camera stream: ${error instanceof Error ? error.message : String(error)}. Manual avatar tools remain available.`);
    });
    return () => {
      cancelled = true;
      ownedStream?.getTracks().forEach((track) => track.stop());
      if (cameraStreamRef.current === ownedStream) cameraStreamRef.current = null;
    };
  }, [attachVideo, cameraAccess, cameraFps, cameraId, onError]);

  useEffect(() => {
    if (microphoneAccess !== "ready" || !microphoneId) return;
    let stopped = false;
    let ownedStream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        deviceId: { exact: microphoneId },
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      },
    }).then((stream) => {
      if (stopped) return stream.getTracks().forEach((track) => track.stop());
      ownedStream = stream;
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = stream;
      stream.getAudioTracks().forEach((track) => { track.enabled = !mutedRef.current && !pausedRef.current; });
      setMicrophoneStream(stream);
    }).catch((error) => {
      setMicrophoneAccess("unavailable");
      onError(`Microphone stream: ${error instanceof Error ? error.message : String(error)}. Silent avatar recording remains available.`);
    });
    return () => {
      stopped = true;
      ownedStream?.getTracks().forEach((track) => track.stop());
      if (microphoneStreamRef.current === ownedStream) microphoneStreamRef.current = null;
      setMicrophoneStream((current) => current === ownedStream ? null : current);
    };
  }, [microphoneAccess, microphoneId, onError]);

  useEffect(() => {
    cameraStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !paused; });
    microphoneStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !muted && !paused; });
    if (!paused && videoRef.current?.srcObject) void videoRef.current.play().catch(() => undefined);
  }, [muted, paused, videoRef]);

  const handleAudioUnavailable = useCallback((message: string) => {
    setMicrophoneAccess("unavailable");
    onError(message);
  }, [onError]);
  const audio = useAudioMonitor({ stream: microphoneStream, muted, paused, monitoring, onUnavailable: handleAudioUnavailable });

  const setPaused = useCallback((nextPaused: boolean) => {
    pausedRef.current = nextPaused;
    setPausedState(nextPaused);
    cameraStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = !nextPaused; });
    microphoneStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextPaused && !mutedRef.current; });
    if (!nextPaused && videoRef.current?.srcObject) void videoRef.current.play().catch(() => undefined);
  }, [videoRef]);

  const cloneAudioTrack = useCallback(() => cloneLiveAudioTrack(microphoneStreamRef.current, mutedRef.current), []);

  const continueWithoutCapture = useCallback(() => {
    setDevicePromptDismissed(true);
    onToast({
      type: "info",
      title: "Continuing without capture",
      message: "Avatar creation, manual expressions, backgrounds, lighting, and avatar-video export remain available.",
    });
  }, [onToast]);

  return {
    cameras,
    microphones,
    permissionState,
    cameraAccess,
    microphoneAccess,
    devicePromptDismissed,
    paused,
    monitoring,
    audioLevel: audio.level,
    audioPeak: audio.peak,
    enumerateDevices,
    requestAccess,
    continueWithoutCapture,
    setPaused,
    setMonitoring,
    cloneAudioTrack,
    attachVideo,
  };
}
