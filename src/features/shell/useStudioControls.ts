import { useCallback, useEffect, useRef } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import type { Workspace } from "../../app/studioConfig";

interface StudioControlsOptions {
  capturePaused: boolean;
  calibrating: boolean;
  captureFinalizing: boolean;
  cameraReady: boolean;
  microphoneReady: boolean;
  recordingState: "idle" | "recording" | "paused";
  hasRecordedFrames: boolean;
  setCapturePaused(paused: boolean): void;
  setRecordingPaused(paused: boolean): void;
  togglePlayback(): void;
  setActivePanel(panel: "avatar" | "capture"): void;
  setActiveWorkspace(workspace: Workspace): void;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
}

export function useStudioControls(options: StudioControlsOptions) {
  const pausedRef = useRef(options.capturePaused);
  const workspaceTimerRef = useRef<number | null>(null);
  const workspaceRafRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  pausedRef.current = options.capturePaused;

  useEffect(() => () => {
    if (workspaceTimerRef.current !== null) window.clearTimeout(workspaceTimerRef.current);
    if (workspaceRafRef.current !== null) cancelAnimationFrame(workspaceRafRef.current);
  }, []);

  const setCaptureProcessingPaused = useCallback((paused: boolean, synchronizeRecording: boolean) => {
    const current = optionsRef.current;
    if (current.calibrating || current.captureFinalizing) return;
    if (synchronizeRecording && current.recordingState !== "idle") current.setRecordingPaused(paused);
    pausedRef.current = paused;
    current.setCapturePaused(paused);
    current.onToast({
      type: paused ? "warning" : "success",
      title: paused ? "Capture paused" : "Capture resumed",
      message: paused
        ? `Face tracking and microphone processing are paused. The avatar will hold its last tracked pose${synchronizeRecording && current.recordingState !== "idle" ? " and the active take timeline is paused" : ""}.`
        : `Face tracking and microphone processing have resumed on the selected devices${synchronizeRecording && current.recordingState !== "idle" ? " with the active take" : ""}.`,
    });
  }, []);

  const toggleCaptureProcessing = useCallback(() => {
    setCaptureProcessingPaused(!pausedRef.current, optionsRef.current.recordingState !== "idle");
  }, [setCaptureProcessingPaused]);

  useEffect(() => {
    const toggleFromKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key.toLowerCase() !== "p") return;
      const current = optionsRef.current;
      if (current.calibrating || current.captureFinalizing || (!current.cameraReady && !current.microphoneReady)) return;
      event.preventDefault();
      toggleCaptureProcessing();
    };
    window.addEventListener("keydown", toggleFromKeyboard);
    return () => window.removeEventListener("keydown", toggleFromKeyboard);
  }, [toggleCaptureProcessing]);

  const activateWorkspace = useCallback((workspace: Workspace) => {
    const current = optionsRef.current;
    current.setActiveWorkspace(workspace);
    if (workspace === "capture") current.setActivePanel("capture");
    if (workspace === "create" || workspace === "edit") current.setActivePanel("avatar");
    if (workspaceTimerRef.current !== null) window.clearTimeout(workspaceTimerRef.current);
    if (workspaceRafRef.current !== null) cancelAnimationFrame(workspaceRafRef.current);
    workspaceTimerRef.current = window.setTimeout(() => {
      workspaceTimerRef.current = null;
      const target = document.querySelector<HTMLElement>(`[data-workspace-target="${workspace}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      target?.classList.remove("workspace-highlight");
      workspaceRafRef.current = requestAnimationFrame(() => {
        workspaceRafRef.current = null;
        target?.classList.add("workspace-highlight");
      });
      if (workspace === "export") {
        target?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus({ preventScroll: true });
      }
    }, 0);
  }, []);

  const showAvatar = useCallback(() => {
    optionsRef.current.setActivePanel("avatar");
    optionsRef.current.setActiveWorkspace("create");
  }, []);
  const showCapture = useCallback(() => {
    optionsRef.current.setActivePanel("capture");
    optionsRef.current.setActiveWorkspace("capture");
  }, []);
  const togglePause = useCallback(() => {
    const current = optionsRef.current;
    if (current.recordingState === "recording") setCaptureProcessingPaused(true, true);
    else if (current.recordingState === "paused") setCaptureProcessingPaused(false, true);
    else if (current.hasRecordedFrames) current.togglePlayback();
  }, [setCaptureProcessingPaused]);

  return {
    activateWorkspace,
    showAvatar,
    showCapture,
    toggleCaptureProcessing,
    togglePause,
  };
}
