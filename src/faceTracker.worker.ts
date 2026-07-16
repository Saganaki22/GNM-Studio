/// <reference lib="webworker" />

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { assetUrl } from "./lib/assets";

let landmarker: FaceLandmarker | null = null;

async function createLandmarker(delegate: "GPU" | "CPU", loaderAttempt = "primary") {
  // This runs in an ES-module worker. The module-aware MediaPipe loader exports
  // ModuleFactory onto globalThis; the classic loader leaves it module-scoped
  // and fails in WebView2 with "ModuleFactory not set".
  const vision = await FilesetResolver.forVisionTasks(assetUrl("wasm"), true);
  // MediaPipe clears ModuleFactory after instantiation. If GPU graph creation
  // fails after WASM loaded, a unique loader URL makes the CPU fallback execute
  // the module factory again instead of receiving the cached ES module.
  if (loaderAttempt !== "primary") {
    vision.wasmLoaderPath = `${vision.wasmLoaderPath}?attempt=${loaderAttempt}`;
  }
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: assetUrl("models/face_landmarker.task"),
      delegate,
    },
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.55,
    minFacePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });
}

self.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  if (message.type === "init") {
    const preference = (message.preference ?? "auto") as "auto" | "gpu" | "cpu";
    try {
      if (preference === "cpu") {
        landmarker = await createLandmarker("CPU");
        self.postMessage({ type: "ready", delegate: "CPU" });
      } else if (preference === "gpu") {
        landmarker = await createLandmarker("GPU");
        self.postMessage({ type: "ready", delegate: "GPU" });
      } else {
        try {
          landmarker = await createLandmarker("GPU");
          self.postMessage({ type: "ready", delegate: "GPU" });
        } catch (gpuError) {
          const fallbackReason = gpuError instanceof Error ? gpuError.message : String(gpuError);
          self.postMessage({ type: "fallback", message: fallbackReason });
          landmarker = await createLandmarker("CPU", `cpu-${Date.now()}`);
          self.postMessage({ type: "ready", delegate: "CPU", fallbackReason });
        }
      }
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        requestedBackend: preference,
      });
    }
    return;
  }

  if (message.type === "frame") {
    const bitmap = message.bitmap as ImageBitmap;
    try {
      if (!landmarker) return;
      const result = landmarker.detectForVideo(bitmap, message.timestamp);
      const face = result.faceLandmarks[0];
      self.postMessage({
        type: "result",
        frame: face
          ? {
              timestamp: message.timestamp,
              landmarks: face.map(({ x, y, z }) => ({ x, y, z })),
              blendshapes: (result.faceBlendshapes[0]?.categories ?? []).map(
                ({ categoryName, score }) => ({ name: categoryName, score }),
              ),
              matrix: Array.from(
                result.facialTransformationMatrixes[0]?.data ?? [],
              ),
            }
          : null,
      });
    } catch (error) {
      self.postMessage({
        type: "frame-error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      bitmap.close();
      self.postMessage({ type: "idle" });
    }
  }
};

export {};
