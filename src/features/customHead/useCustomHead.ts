import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import { captureVideoFrame, inspectCustomHeadImage } from "./customHeadImage";
import type {
  CustomHeadFitResult, CustomHeadImage, CustomHeadProgress, CustomHeadView,
} from "./customHeadTypes";
import { CustomHeadWorkerClient } from "./customHeadWorkerClient";

interface CustomHeadOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraReady: boolean;
  recordingIdle: boolean;
  currentWeights: Float32Array | null;
  applyWeights(weights: Float32Array): Promise<void>;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
  onError(message: string): void;
}

type ImageSlots = Record<CustomHeadView, CustomHeadImage | null>;

const emptyImages = (): ImageSlots => ({ front: null, profile: null });

export function useCustomHead(options: CustomHeadOptions) {
  const [images, setImages] = useState<ImageSlots>(emptyImages);
  const [strength, setStrength] = useState(0.82);
  const [status, setStatus] = useState<"idle" | "fitting" | "applying" | "error">("idle");
  const [progress, setProgress] = useState<CustomHeadProgress | null>(null);
  const [lastResult, setLastResult] = useState<CustomHeadFitResult | null>(null);
  const imagesRef = useRef(images);
  const workerRef = useRef<CustomHeadWorkerClient | null>(null);
  const optionsRef = useRef(options);
  imagesRef.current = images;
  optionsRef.current = options;

  const revokeImage = useCallback((image: CustomHeadImage | null) => {
    if (image) URL.revokeObjectURL(image.url);
  }, []);

  useEffect(() => () => {
    workerRef.current?.dispose();
    workerRef.current = null;
    revokeImage(imagesRef.current.front);
    revokeImage(imagesRef.current.profile);
  }, [revokeImage]);

  const replaceImage = useCallback(async (
    view: CustomHeadView,
    blob: Blob,
    name: string,
    source: CustomHeadImage["source"],
  ) => {
    try {
      const dimensions = await inspectCustomHeadImage(blob);
      const next: CustomHeadImage = { blob, name, source, ...dimensions, url: URL.createObjectURL(blob) };
      setImages((current) => {
        revokeImage(current[view]);
        return { ...current, [view]: next };
      });
      setLastResult(null);
      setStatus("idle");
      setProgress(null);
      if (source === "upload") {
        optionsRef.current.onToast({
          type: "info",
          title: `${view === "front" ? "Front" : "Three-quarter"} image ready`,
          message: view === "front"
            ? `${name} was loaded locally. You can fit now; a 45–60° image is optional and improves depth validation.`
            : `${name} was loaded locally. Add a straight-on front image if it is still missing, then press Fit custom GNM head.`,
          duration: 4_000,
        });
      }
    } catch (error) {
      optionsRef.current.onError(`Custom head ${view} image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [revokeImage]);

  const chooseFile = useCallback((view: CustomHeadView, file: File | null) => {
    if (file) void replaceImage(view, file, file.name, "upload");
  }, [replaceImage]);

  const capture = useCallback(async (view: CustomHeadView) => {
    const video = optionsRef.current.videoRef.current;
    if (!optionsRef.current.cameraReady || !video) {
      optionsRef.current.onError("Custom head camera capture: enable a camera first, or upload an image instead.");
      return;
    }
    try {
      const blob = await captureVideoFrame(video);
      const stamp = new Date().toISOString().replaceAll(":", "-").replace("T", "_").slice(0, 19);
      await replaceImage(view, blob, `${view}-${stamp}.jpg`, "camera");
      optionsRef.current.onToast({
        type: "info",
        title: `${view === "front" ? "Front" : "Side"} view captured`,
        message: view === "front" ? "Check that the face is straight and neutral." : "Check for a 45–60° turn with both eyes and the nose profile visible.",
      });
    } catch (error) {
      optionsRef.current.onError(`Custom head camera capture: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [replaceImage]);

  const remove = useCallback((view: CustomHeadView) => {
    setImages((current) => {
      revokeImage(current[view]);
      return { ...current, [view]: null };
    });
    setLastResult(null);
    setStatus("idle");
    setProgress(null);
  }, [revokeImage]);

  const fit = useCallback(async () => {
    const current = imagesRef.current;
    if (!current.front) {
      optionsRef.current.onError("Custom head: add a straight-on front image first. The three-quarter image is optional.");
      return;
    }
    if (!optionsRef.current.recordingIdle) {
      optionsRef.current.onError("Custom head: stop recording or playback before changing the identity.");
      return;
    }
    setStatus("fitting");
    setLastResult(null);
    setProgress({ stage: "landmarks", message: current.profile ? "Preparing both reference images…" : "Preparing the front image…", percent: null });
    let frontBitmap: ImageBitmap | null = null;
    let profileBitmap: ImageBitmap | null = null;
    try {
      frontBitmap = await createImageBitmap(current.front.blob);
      profileBitmap = current.profile ? await createImageBitmap(current.profile.blob) : null;
      workerRef.current ??= new CustomHeadWorkerClient();
      const pendingFit = workerRef.current.fit(
        frontBitmap,
        profileBitmap,
        optionsRef.current.currentWeights,
        strength,
        setProgress,
      );
      // postMessage transferred ownership to the worker. It now closes both
      // bitmaps after drawing them into its bounded analysis canvases.
      frontBitmap = null;
      profileBitmap = null;
      const result = await pendingFit;
      setStatus("applying");
      setProgress({ stage: "fitting", message: "Applying the fitted GNM identity…", percent: null });
      await optionsRef.current.applyWeights(result.weights);
      setLastResult(result);
      setStatus("idle");
      setProgress(null);
      const backend = result.backend === "unavailable" ? "MediaPipe geometry fallback" : `DINOv3 ${result.backend.toUpperCase()}`;
      optionsRef.current.onToast({
        type: "success",
        title: "Custom head applied",
        message: `${current.profile ? "The two-view" : "The front-view"} proportions were fitted to a bounded GNM identity with ${backend}.`,
        detail: result.consistency === null ? undefined : `DINOv3 cross-view cosine similarity: ${(result.consistency * 100).toFixed(1)}%.`,
        duration: 7_000,
      });
      if (result.warnings.length) {
        optionsRef.current.onToast({
          type: "warning",
          title: "Custom head completed with a warning",
          message: result.warnings[0],
          detail: result.warnings.slice(1).join("\n") || undefined,
          duration: 10_000,
        });
      }
    } catch (error) {
      workerRef.current?.dispose();
      workerRef.current = null;
      setStatus("error");
      setProgress(null);
      optionsRef.current.onError(`Custom head fitting: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Covers a failed second createImageBitmap before worker ownership begins.
      try { frontBitmap?.close(); } catch { /* already detached */ }
      try { profileBitmap?.close(); } catch { /* already detached */ }
    }
  }, [strength]);

  return {
    images,
    strength,
    status,
    progress,
    lastResult,
    cameraReady: options.cameraReady,
    recordingIdle: options.recordingIdle,
    setStrength,
    chooseFile,
    capture,
    remove,
    fit,
  };
}
