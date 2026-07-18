import { useCallback, useEffect, useRef, useState } from "react";
import { isDesktopRuntime } from "../../app/studioConfig";
import { pinnedFullscreenControlsState, toggledFullscreenControlsOverride, type FullscreenControlsOverride } from "../../lib/fullscreenControls";

export interface FullscreenSettings {
  outputAutoHideEnabled: boolean;
  outputAutoHideDelay: number;
  outputAlwaysHideControls: boolean;
}

export function useFullscreenControls(settings: FullscreenSettings, onError: (message: string) => void) {
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [controlsOverride, setControlsOverride] = useState<FullscreenControlsOverride>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const scheduleControls = useCallback(() => {
    clearHideTimer();
    if (!fullscreen) {
      setControlsHidden(false);
      return;
    }
    const pinnedState = pinnedFullscreenControlsState(controlsOverride, settings.outputAlwaysHideControls);
    if (pinnedState !== null) {
      setControlsHidden(pinnedState);
      return;
    }
    setControlsHidden(false);
    if (settings.outputAutoHideEnabled) {
      hideTimerRef.current = window.setTimeout(
        () => setControlsHidden(true),
        Math.max(0.5, settings.outputAutoHideDelay) * 1_000,
      );
    }
  }, [clearHideTimer, controlsOverride, fullscreen, settings.outputAlwaysHideControls, settings.outputAutoHideDelay, settings.outputAutoHideEnabled]);

  const exit = useCallback(async () => {
    try {
      if (isDesktopRuntime) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setFullscreen(false);
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (error) {
      onError(`Exit fullscreen: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setFullscreen(false);
      setControlsHidden(false);
      setControlsOverride(null);
      clearHideTimer();
    }
  }, [clearHideTimer, onError]);

  const toggle = useCallback(async () => {
    if (fullscreen) return exit();
    try {
      if (isDesktopRuntime) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setFullscreen(true);
      } else {
        await document.documentElement.requestFullscreen();
      }
      setFullscreen(true);
      setControlsOverride(null);
      setControlsHidden(settings.outputAlwaysHideControls);
    } catch (error) {
      onError(`Enter fullscreen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [exit, fullscreen, onError, settings.outputAlwaysHideControls]);

  useEffect(() => {
    if (!fullscreen) return;
    scheduleControls();
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape") void exit();
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        clearHideTimer();
        const nextOverride = toggledFullscreenControlsOverride(controlsHidden);
        setControlsOverride(nextOverride);
        setControlsHidden(nextOverride === "hidden");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      clearHideTimer();
    };
  }, [clearHideTimer, controlsHidden, exit, fullscreen, scheduleControls]);

  useEffect(() => {
    if (isDesktopRuntime) return;
    const syncFullscreen = () => {
      if (!document.fullscreenElement) {
        setFullscreen(false);
        setControlsHidden(false);
        setControlsOverride(null);
      }
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  return { fullscreen, controlsHidden, scheduleControls, toggle, exit };
}
