/// <reference lib="webworker" />

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import ortWasmFactoryUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import { assetUrl } from "../../lib/assets";
import { fitCustomHeadImageSize } from "./customHeadImageSizing";
import {
  buildCustomHeadTarget,
  canonicalizeCustomHeadLandmarks,
  solveCustomHeadGeometry,
  validateCustomHeadFitRuntime,
  type CustomHeadFitRuntime,
} from "./customHeadGeometryFit";
import { analyzeCustomHeadView } from "./customHeadMeasurements";
import type { CustomHeadBackend, CustomHeadProgress } from "./customHeadTypes";

const DINO_MODEL = "onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX";

type FitMessage = {
  type: "fit";
  id: number;
  front: ImageBitmap;
  profile: ImageBitmap | null;
  currentWeights: Float32Array | null;
  strength: number;
};

type FeatureTensor = { data: Float32Array; dims: number[] };
type DinoExtractor = {
  (image: OffscreenCanvas): Promise<FeatureTensor>;
  dispose(): Promise<void>;
};
type DinoRuntime = { extractor: DinoExtractor; backend: Exclude<CustomHeadBackend, "unavailable"> };

let landmarkerPromise: Promise<FaceLandmarker> | null = null;
let fitRuntimePromise: Promise<CustomHeadFitRuntime> | null = null;
let dinoPromise: Promise<DinoRuntime> | null = null;
let queue = Promise.resolve();

function postProgress(id: number, progress: CustomHeadProgress) {
  self.postMessage({ type: "progress", id, progress });
}

async function loadLandmarker() {
  landmarkerPromise ??= (async () => {
    const vision = await FilesetResolver.forVisionTasks(assetUrl("wasm"), true);
    return FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: assetUrl("models/face_landmarker.task"), delegate: "CPU" },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "IMAGE",
      numFaces: 1,
      minFaceDetectionConfidence: 0.35,
      minFacePresenceConfidence: 0.35,
    });
  })();
  return landmarkerPromise;
}

async function loadFitRuntime() {
  fitRuntimePromise ??= fetch(assetUrl("models/gnm_custom_head_fit.json"))
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load the custom-head fitting runtime (HTTP ${response.status}).`);
      return response.json() as Promise<unknown>;
    })
    .then(validateCustomHeadFitRuntime);
  return fitRuntimePromise;
}

function canvasFromBitmap(bitmap: ImageBitmap) {
  const { width, height } = fitCustomHeadImageSize(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not create an image-analysis canvas.");
  try {
    context.drawImage(bitmap, 0, 0, width, height);
  } finally {
    bitmap.close();
  }
  return canvas;
}

function closeBitmap(bitmap: ImageBitmap) {
  try {
    bitmap.close();
  } catch {
    // A transferred bitmap may already have been consumed by canvasFromBitmap.
  }
}

async function analyzeImage(id: number, canvas: OffscreenCanvas, view: "front" | "profile") {
  postProgress(id, { stage: "landmarks", message: `Reading ${view} facial geometry…`, percent: null });
  const landmarker = await loadLandmarker();
  let result = landmarker.detect(canvas);
  let face = result.faceLandmarks[0];
  let mirrored = false;
  if (!face) {
    postProgress(id, { stage: "landmarks", message: `Retrying the ${view} face from the opposite orientation…`, percent: null });
    const retryCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const retryContext = retryCanvas.getContext("2d", { willReadFrequently: true });
    if (retryContext) {
      retryContext.translate(canvas.width, 0);
      retryContext.scale(-1, 1);
      retryContext.drawImage(canvas, 0, 0);
      result = landmarker.detect(retryCanvas);
      face = result.faceLandmarks[0];
      mirrored = Boolean(face);
    }
  }
  if (!face) throw new Error(`No face was detected in the ${view} image.`);
  return analyzeCustomHeadView(
    view,
    face.map(({ x, y, z }) => ({ x: mirrored ? 1 - x : x, y, z })),
    (result.faceBlendshapes[0]?.categories ?? []).map(({ categoryName, score }) => ({ name: categoryName, score })),
    canvas.width / Math.max(1, canvas.height),
  );
}

function transformerProgress(id: number, update: unknown) {
  if (!update || typeof update !== "object") return;
  const value = update as { progress?: number; file?: string; status?: string };
  const rawProgress = Number(value.progress);
  const percent = Number.isFinite(rawProgress) ? Math.min(100, Math.max(0, rawProgress)) : null;
  const file = value.file?.split("/").at(-1);
  postProgress(id, {
    stage: "model",
    message: file ? `Preparing DINOv3 · ${file}` : "Preparing the DINOv3 Q4 feature model…",
    percent,
  });
}

async function createDinoRuntime(id: number, device: "webgpu" | "wasm") {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowRemoteModels = true;
  // Transformers.js ships an inert `/models/` Node/browser default. Disable
  // local lookup here so a Pages build never probes the domain root before it
  // requests the configured Hugging Face model.
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = { mjs: ortWasmFactoryUrl, wasm: ortWasmUrl };
  }
  const extractor = await pipeline("image-feature-extraction", DINO_MODEL, {
    dtype: "q4",
    device,
    progress_callback: (update: unknown) => transformerProgress(id, update),
  });
  return { extractor: extractor as unknown as DinoExtractor, backend: device } satisfies DinoRuntime;
}

async function loadDino(id: number) {
  if (!dinoPromise) {
    dinoPromise = (async () => {
      if ("gpu" in navigator) {
        try {
          return await createDinoRuntime(id, "webgpu");
        } catch (error) {
          postProgress(id, {
            stage: "model",
            message: `WebGPU was unavailable (${error instanceof Error ? error.message : String(error)}). Retrying with WASM…`,
            percent: null,
          });
        }
      }
      return createDinoRuntime(id, "wasm");
    })().catch((error) => {
      dinoPromise = null;
      throw error;
    });
  }
  return dinoPromise;
}

function normalizedDescriptor(tensor: FeatureTensor) {
  const dimension = tensor.dims.at(-1) ?? 0;
  if (!dimension || tensor.data.length < dimension) throw new Error("DINOv3 returned an invalid feature tensor.");
  // DINOv3's first token is its global CLS descriptor. It is a more stable
  // cross-view identity signal than averaging background-heavy patch tokens.
  const descriptor = tensor.data.slice(0, dimension);
  let norm = 0;
  for (const value of descriptor) norm += value * value;
  norm = Math.sqrt(Math.max(norm, 1e-12));
  for (let index = 0; index < descriptor.length; index += 1) descriptor[index] /= norm;
  return descriptor;
}

async function extractDinoDescriptor(id: number, runtime: DinoRuntime, canvas: OffscreenCanvas, view: string) {
  postProgress(id, { stage: "features", message: `Extracting DINOv3 features from the ${view} image…`, percent: null });
  return normalizedDescriptor(await runtime.extractor(canvas));
}

function cosine(first: Float32Array, second: Float32Array) {
  const count = Math.min(first.length, second.length);
  let value = 0;
  for (let index = 0; index < count; index += 1) value += first[index] * second[index];
  return Math.min(1, Math.max(-1, value));
}

async function fit(message: FitMessage) {
  const frontCanvas = canvasFromBitmap(message.front);
  const profileCanvas = message.profile ? canvasFromBitmap(message.profile) : null;
  const [front, profile, fitRuntime] = await Promise.all([
    analyzeImage(message.id, frontCanvas, "front"),
    profileCanvas ? analyzeImage(message.id, profileCanvas, "profile") : Promise.resolve(null),
    loadFitRuntime(),
  ]);

  const warnings: string[] = [];
  if (front.neutralScore < 0.54) {
    warnings.push("The front photo is expressive. Mouth-sensitive identity measurements were automatically neutralized.");
  }
  if (profile && profile.neutralScore < 0.48) {
    warnings.push("The side photo is expressive. Profile lip measurements were automatically neutralized.");
  }
  let backend: CustomHeadBackend = "unavailable";
  let consistency: number | null = null;
  if (!profile || !profileCanvas) {
    warnings.push("This was a front-only geometry fit. Add an optional 45–60° image to validate the person and stabilize facial depth.");
  } else {
    try {
      const dino = await loadDino(message.id);
      backend = dino.backend;
      const [frontDescriptor, profileDescriptor] = await Promise.all([
        extractDinoDescriptor(message.id, dino, frontCanvas, "front"),
        extractDinoDescriptor(message.id, dino, profileCanvas, "profile"),
      ]);
      consistency = cosine(frontDescriptor, profileDescriptor);
      if (consistency < 0.35) {
        warnings.push("DINOv3 found weak agreement between the two views. Confirm that both photos show the same person.");
      }
    } catch (error) {
      warnings.push(`DINOv3 was unavailable, so the fit used MediaPipe geometry only: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  postProgress(message.id, { stage: "fitting", message: "Aligning dense facial geometry in local XYZ space…", percent: null });
  const frontCoordinates = canonicalizeCustomHeadLandmarks(
    front.landmarks,
    front.imageAspect,
    fitRuntime.landmarkIndices,
  );
  const profileCoordinates = profile
    ? canonicalizeCustomHeadLandmarks(profile.landmarks, profile.imageAspect, fitRuntime.landmarkIndices)
    : null;
  const { target, coordinateWeights } = buildCustomHeadTarget(
    fitRuntime,
    { coordinates: frontCoordinates, neutralScore: front.neutralScore },
    profileCoordinates && profile
      ? { coordinates: profileCoordinates, neutralScore: profile.neutralScore }
      : null,
  );
  postProgress(message.id, { stage: "fitting", message: "Solving the valid GNM identity subspace…", percent: null });
  const geometryFit = solveCustomHeadGeometry(
    fitRuntime,
    target,
    coordinateWeights,
    message.currentWeights,
    message.strength,
  );
  const { weights } = geometryFit;
  self.postMessage({
    type: "result",
    id: message.id,
    result: {
      weights,
      backend,
      consistency,
      warnings,
      frontYaw: front.yawProxy,
      profileYaw: profile?.yawProxy ?? null,
      geometry: geometryFit.diagnostics,
    },
  }, [weights.buffer]);
}

self.onmessage = (event: MessageEvent<FitMessage>) => {
  if (event.data.type !== "fit") return;
  const message = event.data;
  queue = queue.then(() => fit(message)).catch((error) => {
    closeBitmap(message.front);
    if (message.profile) closeBitmap(message.profile);
    self.postMessage({ type: "error", id: message.id, message: error instanceof Error ? error.message : String(error) });
  });
};

export {};
