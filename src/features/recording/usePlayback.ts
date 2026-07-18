import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import { playbackTrackingFrame, recordedFrameAtTime } from "../../lib/trackingFrames";
import type { Landmark, RecordedFrame, TrackingFrame } from "../../types";

interface PlaybackOptions {
  isRecordingIdle(): boolean;
  cameraReady: boolean;
  getFrames(): RecordedFrame[];
  getLandmarks(): Landmark[];
  onToast(toast: Omit<ToastMessage, "id">): unknown;
}

export function usePlayback({ isRecordingIdle, cameraReady, getFrames, getLandmarks, onToast }: PlaybackOptions) {
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState<TrackingFrame | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const animationRef = useRef<number | null>(null);
  const frameGetterRef = useRef(getFrames);
  const landmarkGetterRef = useRef(getLandmarks);
  const recordingIdleGetterRef = useRef(isRecordingIdle);
  const cameraReadyRef = useRef(cameraReady);
  const toastRef = useRef(onToast);

  frameGetterRef.current = getFrames;
  landmarkGetterRef.current = getLandmarks;
  recordingIdleGetterRef.current = isRecordingIdle;
  cameraReadyRef.current = cameraReady;
  toastRef.current = onToast;

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  }, []);

  useEffect(() => () => cancelAnimation(), [cancelAnimation]);

  const resetSilently = useCallback(() => {
    cancelAnimation();
    setPlaying(false);
    setFrame(null);
  }, [cancelAnimation]);

  const seek = useCallback((requestedTime: number) => {
    const frames = frameGetterRef.current();
    if (!recordingIdleGetterRef.current() || !frames.length) return;
    cancelAnimation();
    setPlaying(false);
    const duration = frames.at(-1)?.timestamp ?? 0;
    const nextElapsed = Math.min(duration, Math.max(0, requestedTime));
    const recorded = recordedFrameAtTime(frames, nextElapsed);
    setFrame(playbackTrackingFrame(recorded, landmarkGetterRef.current()));
    setElapsed(nextElapsed);
  }, [cancelAnimation]);

  const returnToLive = useCallback(() => {
    if (!recordingIdleGetterRef.current()) return;
    cancelAnimation();
    setPlaying(false);
    setFrame(null);
    setElapsed(0);
    toastRef.current({
      type: "info",
      title: "Live tracking restored",
      message: cameraReadyRef.current
        ? "Playback is closed and the avatar is responding to the active camera again. The recorded take is still available."
        : "Playback is closed and the avatar has returned to its live/manual state. The recorded take is still available.",
    });
  }, [cancelAnimation]);

  const toggle = useCallback(() => {
    const frames = frameGetterRef.current();
    if (!recordingIdleGetterRef.current() || !frames.length) return;
    if (playing) {
      cancelAnimation();
      setPlaying(false);
      return;
    }
    const duration = frames.at(-1)?.timestamp ?? 0;
    const resumeFrom = elapsed >= duration ? 0 : Math.min(duration, Math.max(0, elapsed));
    const started = performance.now() - resumeFrom;
    const landmarks = landmarkGetterRef.current();
    setFrame(playbackTrackingFrame(recordedFrameAtTime(frames, resumeFrom), landmarks));
    setElapsed(resumeFrom);
    setPlaying(true);
    const tick = (now: number) => {
      const nextElapsed = Math.min(duration, now - started);
      setFrame(playbackTrackingFrame(recordedFrameAtTime(frames, nextElapsed), landmarks));
      setElapsed(nextElapsed);
      if (nextElapsed < duration) {
        animationRef.current = requestAnimationFrame(tick);
      } else {
        setPlaying(false);
        setFrame(null);
        animationRef.current = null;
      }
    };
    animationRef.current = requestAnimationFrame(tick);
  }, [cancelAnimation, elapsed, playing]);

  const showRecordedFrame = useCallback((recorded: RecordedFrame, nextElapsed: number) => {
    cancelAnimation();
    setPlaying(false);
    setFrame(playbackTrackingFrame(recorded, landmarkGetterRef.current()));
    setElapsed(nextElapsed);
  }, [cancelAnimation]);

  return {
    playing,
    frame,
    elapsed,
    seek,
    returnToLive,
    toggle,
    resetSilently,
    showRecordedFrame,
    setFrame,
    setElapsed,
  };
}
