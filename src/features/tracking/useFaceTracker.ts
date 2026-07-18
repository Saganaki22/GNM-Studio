import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import { MouthOpenGate } from "../../lib/retarget";
import { AdaptiveTrackingSmoother } from "../../lib/trackingSmoothing";
import type { BackendProbe } from "../../app/studioConfig";
import type { TrackingBackend, TrackingFrame } from "../../types";

interface FaceTrackerOptions {
  cameraReady: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  paused: boolean;
  backend: TrackingBackend;
  fps: number;
  trackingSmoothing: number;
  motionSmoothing: number;
  getNeutralFrame(): TrackingFrame | null;
  mouthDeadZone: number;
  onBackendChange(backend: TrackingBackend): void;
  onBeforeReload(): void;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
  onError(message: string | ((current: string) => string)): void;
}

export function useFaceTracker({
  cameraReady,
  videoRef,
  paused,
  backend,
  fps,
  trackingSmoothing,
  motionSmoothing,
  getNeutralFrame,
  mouthDeadZone,
  onBackendChange,
  onBeforeReload,
  onToast,
  onError,
}: FaceTrackerOptions) {
  const [frame, setFrame] = useState<TrackingFrame | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [delegate, setDelegate] = useState("—");
  const [fallbackReason, setFallbackReason] = useState("");
  const [gpuProbe, setGpuProbe] = useState<BackendProbe>({ available: null, reason: "Not tested yet" });
  const [cpuProbe, setCpuProbe] = useState<BackendProbe>({ available: null, reason: "Not tested yet" });
  const [backendMenu, setBackendMenu] = useState<{ x: number; y: number } | null>(null);
  const [restartKey, setRestartKey] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const busyRef = useRef(false);
  const busySinceRef = useRef(0);
  const lastActivityRef = useRef(0);
  const frameErrorsRef = useRef(0);
  const recoveryPendingRef = useRef(false);
  const lastAutomaticRecoveryRef = useRef(0);
  const reloadReasonRef = useRef<string | null>(null);
  const healthCheckRef = useRef<number | null>(null);
  const pausedRef = useRef(paused);
  const frameRef = useRef<TrackingFrame | null>(frame);
  const trackingSmoothingRef = useRef(trackingSmoothing);
  const motionSmoothingRef = useRef(motionSmoothing);
  const neutralFrameGetterRef = useRef(getNeutralFrame);
  const mouthDeadZoneRef = useRef(mouthDeadZone);
  const smootherRef = useRef(new AdaptiveTrackingSmoother());
  const mouthOpenGateRef = useRef(new MouthOpenGate());

  pausedRef.current = paused;
  frameRef.current = frame;
  trackingSmoothingRef.current = trackingSmoothing;
  motionSmoothingRef.current = motionSmoothing;
  neutralFrameGetterRef.current = getNeutralFrame;
  mouthDeadZoneRef.current = mouthDeadZone;

  const resetFilters = useCallback(() => {
    smootherRef.current.reset();
    mouthOpenGateRef.current.reset();
  }, []);
  const getCurrentFrame = useCallback(() => frameRef.current, []);

  const reload = useCallback((automaticReason?: string) => {
    if (!cameraReady) {
      onToast({
        type: "warning",
        title: "Camera is not available",
        message: "Connect or allow the selected camera before reloading the MediaPipe tracker.",
      });
      return;
    }
    const now = performance.now();
    if (automaticReason && lastAutomaticRecoveryRef.current > 0 && now - lastAutomaticRecoveryRef.current < 10_000) {
      recoveryPendingRef.current = false;
      setStatus("error");
      onError(`MediaPipe tracker: automatic recovery did not stay healthy. ${automaticReason} Use Reload tracker to try again, or switch the tracking backend.`);
      return;
    }
    lastAutomaticRecoveryRef.current = automaticReason ? now : 0;
    if (healthCheckRef.current !== null) {
      window.clearTimeout(healthCheckRef.current);
      healthCheckRef.current = null;
    }
    recoveryPendingRef.current = true;
    reloadReasonRef.current = automaticReason ?? "manual";
    busyRef.current = false;
    busySinceRef.current = 0;
    lastActivityRef.current = performance.now();
    frameErrorsRef.current = 0;
    resetFilters();
    onBeforeReload();
    onError("");
    frameRef.current = null;
    setFrame(null);
    setStatus("loading");
    setDelegate("Restarting…");
    setFallbackReason("");
    const video = videoRef.current;
    if (video?.srcObject && video.paused) void video.play().catch(() => undefined);
    setRestartKey((value) => value + 1);
    onToast({
      type: automaticReason ? "warning" : "info",
      title: automaticReason ? "Recovering face tracking" : "Reloading MediaPipe tracker",
      message: automaticReason ?? "The local face model and tracking worker are being loaded again. Your avatar and app settings will not be reset.",
      duration: automaticReason ? 7_000 : 4_000,
    });
  }, [cameraReady, onBeforeReload, onError, onToast, resetFilters, videoRef]);

  const scheduleHealthCheck = useCallback((exportName: string) => {
    if (!cameraReady || status !== "ready") return;
    if (healthCheckRef.current !== null) window.clearTimeout(healthCheckRef.current);
    healthCheckRef.current = window.setTimeout(() => {
      healthCheckRef.current = null;
      const activityAge = performance.now() - lastActivityRef.current;
      if (!recoveryPendingRef.current && (busyRef.current || activityAge > 3_500)) {
        reload(`MediaPipe did not resume normally after the ${exportName}. The app is reloading the local tracker automatically.`);
      }
    }, 2_000);
  }, [cameraReady, reload, status]);

  useEffect(() => () => {
    if (healthCheckRef.current !== null) window.clearTimeout(healthCheckRef.current);
  }, []);

  useEffect(() => {
    if (!backendMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBackendMenu(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [backendMenu]);

  useEffect(() => {
    if (!cameraReady) {
      setStatus("idle");
      setDelegate("—");
      return;
    }
    busyRef.current = false;
    busySinceRef.current = 0;
    frameErrorsRef.current = 0;
    const worker = new Worker(new URL("../../faceTracker.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    setStatus("loading");
    worker.onmessage = (event) => {
      if (event.data.type === "ready") {
        const reloadReason = reloadReasonRef.current;
        reloadReasonRef.current = null;
        recoveryPendingRef.current = false;
        lastActivityRef.current = performance.now();
        frameErrorsRef.current = 0;
        setStatus("ready");
        setDelegate(event.data.delegate === "CPU" && event.data.fallbackReason ? "CPU fallback" : event.data.delegate);
        setFallbackReason(event.data.fallbackReason ?? "");
        if (event.data.delegate === "GPU") setGpuProbe({ available: true, reason: "GPU delegate initialized successfully" });
        else setCpuProbe({ available: true, reason: "CPU delegate initialized successfully" });
        if (event.data.fallbackReason) setGpuProbe({ available: false, reason: event.data.fallbackReason });
        onError((current) => current.startsWith("MediaPipe tracker:") ? "" : current);
        if (event.data.fallbackReason) {
          onToast({
            type: "warning",
            title: "GPU tracking unavailable",
            message: "MediaPipe is running locally on CPU fallback. Tracking still works, but may use more processor time.",
            detail: event.data.fallbackReason,
            duration: 8_000,
          });
        }
        if (reloadReason) {
          onToast({
            type: "success",
            title: "MediaPipe tracker ready",
            message: reloadReason === "manual"
              ? "The local face model was reloaded successfully. Live avatar motion and landmarks can resume."
              : "Face tracking recovered successfully without changing your avatar, calibration, or settings.",
          });
        }
      }
      if (event.data.type === "fallback") {
        setDelegate("GPU → CPU");
        setGpuProbe({ available: false, reason: event.data.message });
      }
      if (event.data.type === "result") {
        lastActivityRef.current = performance.now();
        frameErrorsRef.current = 0;
        if (pausedRef.current) return;
        const rawFrame = event.data.frame as TrackingFrame | null;
        if (rawFrame) {
          const smoothed = smootherRef.current.smooth(rawFrame, trackingSmoothingRef.current, motionSmoothingRef.current);
          smoothed.mouthOpen = mouthOpenGateRef.current.update(smoothed, neutralFrameGetterRef.current(), mouthDeadZoneRef.current);
          frameRef.current = smoothed;
          setFrame(smoothed);
        } else {
          resetFilters();
          frameRef.current = null;
          setFrame(null);
        }
      }
      if (event.data.type === "frame-error") {
        lastActivityRef.current = performance.now();
        frameErrorsRef.current += 1;
        if (frameErrorsRef.current >= 3 && !recoveryPendingRef.current) {
          reload(`MediaPipe failed to process ${frameErrorsRef.current} consecutive camera frames. The GPU context may have been interrupted, so the tracker is restarting automatically.`);
        }
      }
      if (event.data.type === "idle") {
        busyRef.current = false;
        busySinceRef.current = 0;
      }
      if (event.data.type === "error") {
        recoveryPendingRef.current = false;
        reloadReasonRef.current = null;
        busyRef.current = false;
        busySinceRef.current = 0;
        setStatus("error");
        if (event.data.requestedBackend === "gpu") setGpuProbe({ available: false, reason: event.data.message });
        if (event.data.requestedBackend === "cpu" || event.data.requestedBackend === "auto") setCpuProbe({ available: false, reason: event.data.message });
        onError(`MediaPipe tracker: ${event.data.message}`);
      }
    };
    worker.onerror = (event) => {
      recoveryPendingRef.current = false;
      reloadReasonRef.current = null;
      busyRef.current = false;
      busySinceRef.current = 0;
      setStatus("error");
      onError(`MediaPipe tracker: the tracking worker stopped unexpectedly (${event.message || "unknown worker error"}). Use Reload tracker to recover.`);
    };
    worker.onmessageerror = () => {
      busyRef.current = false;
      busySinceRef.current = 0;
      setStatus("error");
      onError("MediaPipe tracker: the tracking worker returned unreadable frame data. Use Reload tracker to recover.");
    };
    worker.postMessage({ type: "init", preference: backend });
    return () => {
      worker.terminate();
      busyRef.current = false;
      busySinceRef.current = 0;
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [backend, cameraReady, onError, onToast, reload, resetFilters, restartKey]);

  useEffect(() => {
    if (status !== "ready") return;
    let animation = 0;
    let lastCapture = 0;
    const capture = async (now: number) => {
      if (pausedRef.current) {
        animation = requestAnimationFrame(capture);
        return;
      }
      const video = videoRef.current;
      const interval = 1000 / Math.max(1, fps);
      if (busyRef.current && busySinceRef.current > 0 && now - busySinceRef.current > 4_000 && !recoveryPendingRef.current) {
        reload("MediaPipe stopped returning camera frames for four seconds. The local tracking worker is being restarted automatically.");
      }
      if (video && video.readyState >= 2 && now - lastCapture >= interval && !busyRef.current) {
        busyRef.current = true;
        busySinceRef.current = now;
        lastCapture = now;
        try {
          const bitmap = await createImageBitmap(video);
          workerRef.current?.postMessage({ type: "frame", bitmap, timestamp: now }, [bitmap]);
        } catch {
          busyRef.current = false;
          busySinceRef.current = 0;
        }
      }
      animation = requestAnimationFrame(capture);
    };
    animation = requestAnimationFrame(capture);
    return () => cancelAnimationFrame(animation);
  }, [fps, reload, status, videoRef]);

  const openBackendMenu = useCallback((x: number, y: number) => {
    setBackendMenu({
      x: Math.min(Math.max(8, x), window.innerWidth - 244),
      y: Math.min(Math.max(8, y), window.innerHeight - 188),
    });
  }, []);

  const selectBackend = useCallback((nextBackend: TrackingBackend) => {
    if (nextBackend === "gpu" && gpuProbe.available === false) return;
    if (nextBackend === "cpu" && cpuProbe.available === false) return;
    setBackendMenu(null);
    onError("");
    frameRef.current = null;
    setFrame(null);
    setStatus("loading");
    setFallbackReason("");
    setDelegate(nextBackend === "auto" ? "GPU → CPU" : nextBackend.toUpperCase());
    if (backend === nextBackend) setRestartKey((value) => value + 1);
    else onBackendChange(nextBackend);
    onToast({
      type: "info",
      title: "Tracking backend changed",
      message: nextBackend === "auto" ? "MediaPipe will try GPU first and fall back to CPU." : `MediaPipe will restart using ${nextBackend.toUpperCase()} only.`,
      duration: 4_000,
    });
  }, [backend, cpuProbe.available, gpuProbe.available, onBackendChange, onError, onToast]);

  return {
    frame,
    status,
    delegate,
    fallbackReason,
    gpuProbe,
    cpuProbe,
    backendMenu,
    reload,
    scheduleHealthCheck,
    resetFilters,
    getCurrentFrame,
    openBackendMenu,
    closeBackendMenu: () => setBackendMenu(null),
    selectBackend,
  };
}
