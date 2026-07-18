import { useEffect, useRef, useState } from "react";

interface AudioMonitorOptions {
  stream: MediaStream | null;
  muted: boolean;
  paused: boolean;
  monitoring: boolean;
  onUnavailable(message: string): void;
}

export function useAudioMonitor({ stream, muted, paused, monitoring, onUnavailable }: AudioMonitorOptions) {
  const [level, setAudioLevel] = useState(0);
  const [peak, setAudioPeak] = useState(0);
  const mutedRef = useRef(muted);
  const pausedRef = useRef(paused);
  const monitoringRef = useRef(monitoring);
  const monitorNodeRef = useRef<GainNode | null>(null);

  mutedRef.current = muted;
  pausedRef.current = paused;
  monitoringRef.current = monitoring;

  useEffect(() => {
    if (!stream) {
      setAudioLevel(0);
      setAudioPeak(0);
      return;
    }

    let animation = 0;
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      const monitor = context.createGain();
      monitor.gain.value = monitoringRef.current ? 0.8 : 0;
      monitorNodeRef.current = monitor;
      source.connect(analyser);
      source.connect(monitor).connect(context.destination);

      const data = new Float32Array(analyser.fftSize);
      let rollingPeak = 0;
      let lastUpdate = 0;
      const tick = (now: number) => {
        if (pausedRef.current) {
          if (now - lastUpdate > 32) {
            setAudioLevel(0);
            setAudioPeak(0);
            lastUpdate = now;
          }
          animation = requestAnimationFrame(tick);
          return;
        }
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const sample of data) sum += sample * sample;
        const rms = Math.sqrt(sum / data.length);
        const scaled = Math.min(1, Math.max(0, (20 * Math.log10(Math.max(rms, 1e-7)) + 60) / 60));
        rollingPeak = Math.max(scaled, rollingPeak * 0.985);
        if (now - lastUpdate > 32) {
          setAudioLevel(mutedRef.current || pausedRef.current ? 0 : scaled);
          setAudioPeak(mutedRef.current || pausedRef.current ? 0 : rollingPeak);
          lastUpdate = now;
        }
        animation = requestAnimationFrame(tick);
      };
      tick(0);
    } catch (error) {
      onUnavailable(`Microphone stream: ${error instanceof Error ? error.message : String(error)}. Silent avatar recording remains available.`);
    }

    return () => {
      cancelAnimationFrame(animation);
      if (monitorNodeRef.current?.context === context) monitorNodeRef.current = null;
      void context?.close().catch(() => undefined);
    };
  }, [onUnavailable, stream]);

  useEffect(() => {
    if (monitorNodeRef.current) monitorNodeRef.current.gain.value = monitoring ? 0.8 : 0;
  }, [monitoring]);

  useEffect(() => {
    if (muted || paused) {
      setAudioLevel(0);
      setAudioPeak(0);
    }
  }, [muted, paused]);

  return { level, peak };
}
