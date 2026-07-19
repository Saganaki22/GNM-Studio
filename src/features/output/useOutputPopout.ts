import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import { isDesktopRuntime } from "../../app/studioConfig";
import {
  outputChannelName,
  type MainToOutputCommand,
  type MainToOutputMessage,
  type OutputOwnerPhase,
  type OutputSnapshot,
  type OutputToMainMessage,
} from "../../lib/outputChannel";
import { canMountStudioRenderer, outputOwnerBusy, phaseFromHeartbeat } from "../../lib/outputOwner";
import type { AvatarMotionSample, CameraViewState, TrackingFrame } from "../../types";

type OutputStartCommand = Omit<Extract<MainToOutputCommand, { type: "record"; action: "start" }>, "type" | "action">;
type RecordingWaiter = {
  startResolve?: () => void;
  startReject?: (error: Error) => void;
  resultResolve?: (blob: Blob) => void;
  resultReject?: (error: Error) => void;
  startTimer?: number;
  resultTimer?: number;
};

interface OutputPopoutOptions {
  isRecordingActive(): boolean;
  onRecordingInterrupted(): void;
  onRecordResult(blob: Blob): void;
  onRecordError(): void;
  onViewState(viewState: CameraViewState): void;
  onAvatarMotion(sample: AvatarMotionSample, frameTimestamp: number): void;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
  onError(message: string): void;
}

export function useOutputPopout(options: OutputPopoutOptions) {
  const [ownerPhase, setOwnerPhase] = useState<OutputOwnerPhase>("studio");
  const ownerPhaseRef = useRef<OutputOwnerPhase>(ownerPhase);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const heartbeatRef = useRef(0);
  const sessionRef = useRef("");
  const activeRecordingRequestRef = useRef("");
  const recordingWaitersRef = useRef(new Map<string, RecordingWaiter>());
  const pngWaitersRef = useRef(new Map<string, { resolve: (blob: Blob) => void; reject: (error: Error) => void; timer: number }>());
  const webPopoutRef = useRef<Window | null>(null);
  const connectTimerRef = useRef<number | null>(null);
  const shutdownTimerRef = useRef<number | null>(null);
  const restoreAnimationRef = useRef<number | null>(null);
  const tauriErrorUnlistenRef = useRef<(() => void) | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  ownerPhaseRef.current = ownerPhase;

  const transition = useCallback((next: OutputOwnerPhase | ((current: OutputOwnerPhase) => OutputOwnerPhase)) => {
    setOwnerPhase((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      ownerPhaseRef.current = resolved;
      return resolved;
    });
  }, []);

  const clearConnectTimer = useCallback(() => {
    if (connectTimerRef.current !== null) window.clearTimeout(connectTimerRef.current);
    connectTimerRef.current = null;
  }, []);
  const clearShutdownTimer = useCallback(() => {
    if (shutdownTimerRef.current !== null) window.clearTimeout(shutdownTimerRef.current);
    shutdownTimerRef.current = null;
  }, []);
  const scheduleStudioRestore = useCallback(() => {
    if (restoreAnimationRef.current !== null) cancelAnimationFrame(restoreAnimationRef.current);
    restoreAnimationRef.current = requestAnimationFrame(() => {
      restoreAnimationRef.current = null;
      transition("studio");
    });
  }, [transition]);

  const rejectWaiters = useCallback((reason: string) => {
    const error = new Error(reason);
    for (const waiter of recordingWaitersRef.current.values()) {
      if (waiter.startTimer) window.clearTimeout(waiter.startTimer);
      if (waiter.resultTimer) window.clearTimeout(waiter.resultTimer);
      waiter.startReject?.(error);
      waiter.resultReject?.(error);
    }
    recordingWaitersRef.current.clear();
    for (const waiter of pngWaitersRef.current.values()) {
      window.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pngWaitersRef.current.clear();
  }, []);

  const post = useCallback((command: MainToOutputCommand) => {
    const ownerId = sessionRef.current;
    if (!ownerId) return;
    channelRef.current?.postMessage({ ...command, ownerId } satisfies MainToOutputMessage);
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(outputChannelName);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<OutputToMainMessage>) => {
      const message = event.data;
      if (!sessionRef.current || message.ownerId !== sessionRef.current) return;
      if (message.type === "ready") {
        clearConnectTimer();
        heartbeatRef.current = Date.now();
        transition("popout-ready");
        optionsRef.current.onToast({ type: "success", title: "Output popout connected", message: "The popout now owns the only 3D renderer. Camera tracking and controls remain in the studio." });
      } else if (message.type === "heartbeat") {
        heartbeatRef.current = message.timestamp;
        if (ownerPhaseRef.current !== "closing" && ownerPhaseRef.current !== "restoring") {
          transition((current) => phaseFromHeartbeat(current, message.phase));
        }
      } else if (message.type === "closed") {
        clearConnectTimer();
        clearShutdownTimer();
        const graceful = ownerPhaseRef.current === "closing" || ownerPhaseRef.current === "restoring";
        if (!graceful) {
          rejectWaiters("The output popout closed before its active operation completed.");
          optionsRef.current.onRecordingInterrupted();
          optionsRef.current.onToast({ type: "warning", title: "Output popout closed", message: "The studio renderer was recovered. Captured motion frames remain available, but unfinished popout video pixels could not be finalized." });
        }
        transition("studio");
        heartbeatRef.current = 0;
        sessionRef.current = "";
      } else if (message.type === "shutdown-ready") {
        transition("restoring");
        channel.postMessage({ type: "close", ownerId: message.ownerId } satisfies MainToOutputMessage);
        webPopoutRef.current?.close();
      } else if (message.type === "record-state") {
        const waiter = recordingWaitersRef.current.get(message.requestId);
        if (message.state === "recording") {
          if (waiter?.startTimer) window.clearTimeout(waiter.startTimer);
          waiter?.startResolve?.();
          if (waiter) {
            waiter.startResolve = undefined;
            waiter.startReject = undefined;
            waiter.startTimer = undefined;
          }
          transition("popout-recording");
        } else if (message.state === "encoding") {
          transition("popout-encoding");
        } else if (message.state === "ready" && ownerPhaseRef.current !== "closing") {
          transition("popout-ready");
        }
      } else if (message.type === "record-result") {
        optionsRef.current.onRecordResult(message.blob);
        if (activeRecordingRequestRef.current === message.requestId) activeRecordingRequestRef.current = "";
        const waiter = recordingWaitersRef.current.get(message.requestId);
        if (waiter?.resultTimer) window.clearTimeout(waiter.resultTimer);
        waiter?.resultResolve?.(message.blob);
        recordingWaitersRef.current.delete(message.requestId);
      } else if (message.type === "png-result") {
        const waiter = pngWaitersRef.current.get(message.requestId);
        if (waiter) {
          window.clearTimeout(waiter.timer);
          waiter.resolve(message.blob);
          pngWaitersRef.current.delete(message.requestId);
        }
      } else if (message.type === "view-state") {
        optionsRef.current.onViewState(message.viewState);
      } else if (message.type === "avatar-motion") {
        optionsRef.current.onAvatarMotion(message.sample, message.frameTimestamp);
      } else if (message.type === "error") {
        if (message.operation === "Popout microphone") {
          optionsRef.current.onToast({ type: "warning", title: "Popout recording has no microphone", message: message.message, duration: 8_000 });
        } else {
          if (message.operation === "Popout recording") {
            optionsRef.current.onRecordError();
            rejectWaiters(message.message);
          }
          if (message.operation === "Popout PNG capture") rejectWaiters(message.message);
          optionsRef.current.onError(`${message.operation}: ${message.message}`);
        }
      }
    };
    return () => {
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [clearConnectTimer, clearShutdownTimer, rejectWaiters, transition]);

  useEffect(() => {
    if (ownerPhase === "studio" || ownerPhase === "connecting" || ownerPhase === "failed") return;
    const monitor = window.setInterval(() => {
      if (Date.now() - heartbeatRef.current < 4_000) return;
      window.clearInterval(monitor);
      transition("failed");
      rejectWaiters("The output popout disconnected before the requested operation completed.");
      if (optionsRef.current.isRecordingActive()) optionsRef.current.onRecordingInterrupted();
      scheduleStudioRestore();
      optionsRef.current.onToast({ type: "warning", title: "Output popout disconnected", message: "The studio renderer was restored without creating a duplicate. Motion frames remain available; an unfinished popout video container could not be recovered." });
    }, 1_000);
    return () => window.clearInterval(monitor);
  }, [ownerPhase, rejectWaiters, scheduleStudioRestore, transition]);

  useEffect(() => () => {
    clearConnectTimer();
    clearShutdownTimer();
    if (restoreAnimationRef.current !== null) cancelAnimationFrame(restoreAnimationRef.current);
    tauriErrorUnlistenRef.current?.();
    webPopoutRef.current?.close();
    rejectWaiters("The studio output controller was disposed before the requested operation completed.");
  }, [clearConnectTimer, clearShutdownTimer, rejectWaiters]);

  const beginRecording = useCallback((command: OutputStartCommand) => new Promise<void>((resolve, reject) => {
    const waiter = recordingWaitersRef.current.get(command.requestId) ?? {};
    waiter.startResolve = resolve;
    waiter.startReject = reject;
    waiter.startTimer = window.setTimeout(() => {
      recordingWaitersRef.current.delete(command.requestId);
      reject(new Error("The popout recorder did not acknowledge startup within 10 seconds."));
    }, 10_000);
    recordingWaitersRef.current.set(command.requestId, waiter);
    activeRecordingRequestRef.current = command.requestId;
    post({ type: "record", action: "start", ...command });
  }), [post]);

  const waitForRecordingResult = useCallback((requestId: string, timeoutMs = 30_000) => new Promise<Blob>((resolve, reject) => {
    const waiter = recordingWaitersRef.current.get(requestId) ?? {};
    waiter.resultResolve = resolve;
    waiter.resultReject = reject;
    waiter.resultTimer = window.setTimeout(() => {
      recordingWaitersRef.current.delete(requestId);
      reject(new Error(`The popout recorder did not finish encoding within ${Math.ceil(timeoutMs / 1_000)} seconds.`));
    }, timeoutMs);
    recordingWaitersRef.current.set(requestId, waiter);
  }), []);

  const pauseRecording = useCallback((paused: boolean) => {
    const requestId = activeRecordingRequestRef.current;
    if (requestId) post({ type: "record", action: paused ? "pause" : "resume", requestId });
  }, [post]);
  const stopRecording = useCallback(() => {
    const requestId = activeRecordingRequestRef.current;
    if (requestId) post({ type: "record", action: "stop", requestId });
  }, [post]);

  const capturePng = useCallback((width: number, height: number) => {
    if (ownerPhaseRef.current !== "popout-ready" && ownerPhaseRef.current !== "popout-recording" && ownerPhaseRef.current !== "popout-encoding") {
      return Promise.reject(new Error("The output renderer is not ready to capture a PNG."));
    }
    const requestId = crypto.randomUUID?.() ?? `png-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const result = new Promise<Blob>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pngWaitersRef.current.delete(requestId);
        reject(new Error("The popout did not return the PNG within 15 seconds."));
      }, 15_000);
      pngWaitersRef.current.set(requestId, { resolve, reject, timer });
    });
    post({ type: "capture-png", requestId, width, height });
    return result;
  }, [post]);

  const open = useCallback(async (profileLabel: string) => {
    if (!canMountStudioRenderer(ownerPhaseRef.current)) {
      post({ type: "focus" });
      return;
    }
    if (typeof BroadcastChannel === "undefined") {
      optionsRef.current.onError("Output popout is unavailable because this WebView does not support BroadcastChannel.");
      return;
    }
    clearConnectTimer();
    clearShutdownTimer();
    const ownerId = crypto.randomUUID?.() ?? `output-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionRef.current = ownerId;
    transition("connecting");
    heartbeatRef.current = Date.now();
    try {
      if (isDesktopRuntime) {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("output");
        if (existing) await existing.close();
        const output = new WebviewWindow("output", {
          url: `?output=1&outputSession=${encodeURIComponent(ownerId)}`,
          title: `${profileLabel} · GNM Studio Output`,
          width: 1280,
          height: 720,
          minWidth: 480,
          minHeight: 270,
          resizable: true,
          decorations: true,
          center: true,
        });
        const unlisten = await output.once("tauri://error", (event) => {
          transition("failed");
          sessionRef.current = "";
          optionsRef.current.onError(`Open output popout: ${String(event.payload)}`);
          scheduleStudioRestore();
        });
        tauriErrorUnlistenRef.current?.();
        tauriErrorUnlistenRef.current = unlisten;
      } else {
        const url = new URL(window.location.href);
        url.searchParams.set("output", "1");
        url.searchParams.set("outputSession", ownerId);
        webPopoutRef.current = window.open(url, "gnm-studio-output", "popup,width=1280,height=720,resizable=yes");
        if (!webPopoutRef.current) throw new Error("The browser blocked the popout. Allow popups for this site and retry.");
      }
      connectTimerRef.current = window.setTimeout(() => {
        connectTimerRef.current = null;
        if (ownerPhaseRef.current !== "connecting" || sessionRef.current !== ownerId) return;
        webPopoutRef.current?.close();
        transition("failed");
        sessionRef.current = "";
        optionsRef.current.onError("Output popout did not connect within 10 seconds. It was closed so the studio renderer could be restored safely.");
        scheduleStudioRestore();
      }, 10_000);
    } catch (error) {
      transition("failed");
      sessionRef.current = "";
      optionsRef.current.onError(`Open output popout: ${error instanceof Error ? error.message : String(error)}`);
      scheduleStudioRestore();
    }
  }, [clearConnectTimer, clearShutdownTimer, post, scheduleStudioRestore, transition]);

  const close = useCallback(() => {
    if (outputOwnerBusy(ownerPhaseRef.current)) {
      optionsRef.current.onToast({ type: "warning", title: "Output is busy", message: "Stop the recording and let the popout finish encoding before returning its renderer." });
      return;
    }
    clearShutdownTimer();
    transition("closing");
    post({ type: "shutdown" });
    const ownerId = sessionRef.current;
    shutdownTimerRef.current = window.setTimeout(() => {
      shutdownTimerRef.current = null;
      if (sessionRef.current !== ownerId || (ownerPhaseRef.current !== "closing" && ownerPhaseRef.current !== "restoring")) return;
      webPopoutRef.current?.close();
      sessionRef.current = "";
      transition("studio");
      optionsRef.current.onToast({ type: "warning", title: "Output handoff timed out", message: "The studio renderer was restored after the popout did not complete its shutdown acknowledgement." });
    }, 6_000);
  }, [clearShutdownTimer, post, transition]);
  const focus = useCallback(() => post({ type: "focus" }), [post]);
  const sendSnapshot = useCallback((snapshot: OutputSnapshot) => post({ type: "snapshot", snapshot }), [post]);
  const sendFrame = useCallback((frame: TrackingFrame | null, trackingReady: boolean) => {
    post({ type: "frame", frame, trackingReady });
  }, [post]);

  const popoutState = canMountStudioRenderer(ownerPhase)
    ? "idle" as const
    : ownerPhase === "connecting"
      ? "starting" as const
      : "active" as const;

  return {
    ownerPhase,
    popoutState,
    canMountRenderer: canMountStudioRenderer(ownerPhase),
    open,
    close,
    focus,
    sendSnapshot,
    sendFrame,
    beginRecording,
    waitForRecordingResult,
    pauseRecording,
    stopRecording,
    capturePng,
  };
}
