import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import { isDesktopRuntime, type FfmpegProbe } from "../../app/studioConfig";
import type { VideoEncoderBackend } from "../../types";

interface FfmpegEncoderOptions {
  path: string;
  backend: VideoEncoderBackend;
  setPath(path: string): void;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
  onError(message: string): void;
}

export function useFfmpegEncoder({ path, backend, setPath, onToast, onError }: FfmpegEncoderOptions) {
  const [status, setStatus] = useState<"unknown" | "checking" | "available" | "unavailable">("unknown");
  const [version, setVersion] = useState("");
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (!isDesktopRuntime || backend === "webcodecs") {
      setStatus("unknown");
      setVersion("");
      return;
    }
    let cancelled = false;
    setStatus("checking");
    const timer = window.setTimeout(() => {
      import("../../lib/systemFfmpeg")
        .then(({ probeSystemFfmpeg }) => probeSystemFfmpeg(path))
        .then((probe) => {
          if (cancelled) return;
          setStatus(probe.available ? "available" : "unavailable");
          setVersion(probe.version ?? probe.error ?? "");
        })
        .catch((error) => {
          if (cancelled) return;
          setStatus("unavailable");
          setVersion(String(error));
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [backend, path]);

  const check = useCallback(async (candidatePath = pathRef.current, notify = true): Promise<FfmpegProbe> => {
    setStatus("checking");
    try {
      const { probeSystemFfmpeg } = await import("../../lib/systemFfmpeg");
      const probe = await probeSystemFfmpeg(candidatePath);
      setStatus(probe.available ? "available" : "unavailable");
      setVersion(probe.version ?? probe.error ?? "");
      if (notify) {
        onToast(probe.available ? {
          type: "success",
          title: "System FFmpeg detected",
          message: probe.version ?? `${candidatePath} is ready for MP4 conversion.`,
        } : {
          type: "warning",
          title: "System FFmpeg was not found",
          message: "Choose ffmpeg.exe, add FFmpeg to PATH, install it from the official download page, or select WebCodecs.",
          detail: probe.error,
          duration: 9_000,
        });
      }
      return probe;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus("unavailable");
      setVersion(message);
      if (notify) onToast({ type: "warning", title: "FFmpeg check failed", message: "The app could not inspect the configured FFmpeg executable.", detail: message, duration: 9_000 });
      return { available: false, error: message };
    }
  }, [onToast]);

  const choose = useCallback(async () => {
    try {
      if (!("__TAURI_INTERNALS__" in window)) throw new Error("Choosing ffmpeg.exe is available in the desktop build.");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose ffmpeg.exe",
        filters: [{ name: "FFmpeg executable", extensions: ["exe"] }],
      });
      if (typeof selected !== "string") return;
      setPath(selected);
      await check(selected);
    } catch (error) {
      onError(`Choose FFmpeg executable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [check, onError, setPath]);

  return { status, version, check, choose };
}
