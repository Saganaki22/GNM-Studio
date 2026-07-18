import { useCallback, useRef, useState } from "react";
import type { CameraViewState } from "../../types";
import type { ViewportSize } from "../../lib/coverProjection";

export function useStagePresentation(onError: (message: string) => void) {
  const [size, setSize] = useState<ViewportSize>({ width: 640, height: 480 });
  const [forcedViewState, setForcedViewState] = useState<CameraViewState | null>(null);
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentViewStateRef = useRef<CameraViewState | null>(null);

  const handleCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
  }, []);

  const handleResize = useCallback((width: number, height: number) => {
    setSize((current) => current.width === width && current.height === height ? current : { width, height });
  }, []);

  const handleViewState = useCallback((viewState: CameraViewState) => {
    currentViewStateRef.current = viewState;
  }, []);

  const resetView = useCallback(() => {
    setResetViewSignal((value) => value + 1);
  }, []);
  const getCanvas = useCallback(() => canvasRef.current, []);
  const getCurrentViewState = useCallback(() => currentViewStateRef.current, []);

  return {
    size,
    forcedViewState,
    resetViewSignal,
    getCanvas,
    getCurrentViewState,
    setForcedViewState,
    resetView,
    handleCanvas,
    handleResize,
    handleViewState,
    handleError: onError,
  };
}
