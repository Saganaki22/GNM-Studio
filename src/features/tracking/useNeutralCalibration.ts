import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import { assessFaceAlignment } from "../../lib/faceAlignment";
import { mouthOpenInfluence } from "../../lib/retarget";
import type { ViewportSize } from "../../lib/coverProjection";
import type { FaceAlignment, TrackingFrame } from "../../types";

interface NeutralCalibrationOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  stageSize: ViewportSize;
  mirror: boolean;
  cameraReady: boolean;
  recordingIdle: boolean;
  frame: TrackingFrame | null;
  getCurrentFrame(): TrackingFrame | null;
  onNeutralChanged(): void;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
}

export function useNeutralCalibration({
  videoRef,
  stageSize,
  mirror,
  cameraReady,
  recordingIdle,
  frame,
  getCurrentFrame,
  onNeutralChanged,
  onToast,
}: NeutralCalibrationOptions) {
  const [neutralFrame, setNeutralFrame] = useState<TrackingFrame | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [complete, setComplete] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const neutralFrameRef = useRef<TrackingFrame | null>(null);
  const sessionRef = useRef(0);
  const alignmentRef = useRef<FaceAlignment>({ status: "missing", message: "Calibration idle — connect a camera when you want face tracking" });
  const timerWaitersRef = useRef(new Map<number, () => void>());
  const recordingIdleRef = useRef(recordingIdle);
  const currentFrameGetterRef = useRef(getCurrentFrame);
  const neutralChangedRef = useRef(onNeutralChanged);

  recordingIdleRef.current = recordingIdle;
  currentFrameGetterRef.current = getCurrentFrame;
  neutralChangedRef.current = onNeutralChanged;

  const getNeutralFrame = useCallback(() => neutralFrameRef.current, []);

  const faceAlignment = useMemo(
    () => assessFaceAlignment(frame, mirror, videoRef.current, stageSize),
    [frame, mirror, stageSize, videoRef],
  );
  const calibrationMouthOpen = useMemo(() => frame ? mouthOpenInfluence(
    Object.fromEntries(frame.blendshapes.map(({ name, score }) => [name, score])),
    frame.landmarks,
  ) : 0, [frame]);
  const calibrationFaceAlignment: FaceAlignment = calibrating
    && faceAlignment.status === "ready" && calibrationMouthOpen > 0.12
    ? { ...faceAlignment, status: "adjust", message: "Relax and close your mouth for a neutral calibration" }
    : faceAlignment;
  const readiness: FaceAlignment = calibrating
    ? calibrationFaceAlignment
    : neutralFrame
      ? { status: "ready", message: "Neutral calibration saved" }
      : frame
        ? { status: "ready", message: "Face detected — press Calibrate neutral when ready" }
        : { status: "missing", message: cameraReady ? "Calibration idle — waiting for a face" : "Calibration idle — connect a camera when you want face tracking" };
  alignmentRef.current = calibrationFaceAlignment;

  const resolveTimers = useCallback(() => {
    for (const [timer, resolve] of timerWaitersRef.current) {
      window.clearTimeout(timer);
      resolve();
    }
    timerWaitersRef.current.clear();
  }, []);

  const delay = useCallback((milliseconds: number) => new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => {
      timerWaitersRef.current.delete(timer);
      resolve();
    }, milliseconds);
    timerWaitersRef.current.set(timer, resolve);
  }), []);

  const cancel = useCallback(() => {
    sessionRef.current += 1;
    resolveTimers();
    setCalibrating(false);
    setComplete(false);
    setCountdown(null);
  }, [resolveTimers]);

  useEffect(() => () => {
    sessionRef.current += 1;
    resolveTimers();
  }, [resolveTimers]);

  const calibrate = useCallback(async () => {
    const initialFrame = currentFrameGetterRef.current();
    if (!recordingIdleRef.current || !initialFrame) return;
    const session = ++sessionRef.current;
    setCalibrating(true);
    setComplete(false);
    setCountdown(null);
    let readySince: number | null = null;
    let stableAnchor: Pick<FaceAlignment, "centerX" | "centerY" | "sizeRatio"> | null = null;

    while (sessionRef.current === session) {
      const alignment = alignmentRef.current;
      const currentFrame = currentFrameGetterRef.current();
      if (alignment.status !== "ready" || !currentFrame) {
        readySince = null;
        stableAnchor = null;
        setCountdown(null);
      } else {
        const now = performance.now();
        const movedSinceAnchor = stableAnchor
          && alignment.centerX !== undefined && alignment.centerY !== undefined && alignment.sizeRatio !== undefined
          && stableAnchor.centerX !== undefined && stableAnchor.centerY !== undefined && stableAnchor.sizeRatio !== undefined
          && (
            Math.hypot(alignment.centerX - stableAnchor.centerX, alignment.centerY - stableAnchor.centerY) > 0.018
            || Math.abs(alignment.sizeRatio - stableAnchor.sizeRatio) > 0.035
          );
        if (!stableAnchor || movedSinceAnchor) {
          stableAnchor = { centerX: alignment.centerX, centerY: alignment.centerY, sizeRatio: alignment.sizeRatio };
          readySince = now;
        }
        readySince ??= now;
        const elapsed = performance.now() - readySince;
        if (elapsed >= 3_000) {
          neutralFrameRef.current = currentFrame;
          setNeutralFrame(currentFrame);
          neutralChangedRef.current();
          setCountdown(null);
          setComplete(true);
          onToast({
            type: "success",
            title: "Neutral pose calibrated",
            message: "The aligned live frame is now the neutral baseline for head movement and expressions.",
          });
          await delay(700);
          if (sessionRef.current !== session) return;
          setCalibrating(false);
          setComplete(false);
          return;
        }
        setCountdown(Math.max(1, 3 - Math.floor(elapsed / 1_000)));
      }
      await delay(100);
    }
  }, [delay, onToast]);

  const restoreNeutralFrame = useCallback((frame: TrackingFrame | null) => {
    neutralFrameRef.current = frame;
    setNeutralFrame(frame);
    neutralChangedRef.current();
  }, []);

  return {
    neutralFrame,
    calibrating,
    complete,
    countdown,
    faceAlignment: calibrationFaceAlignment,
    readiness,
    getNeutralFrame,
    restoreNeutralFrame,
    calibrate,
    cancel,
  };
}
