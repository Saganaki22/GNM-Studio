/// <reference lib="webworker" />

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import ortWasmFactoryUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import { assetUrl } from "../../lib/assets";
import { analyzeCustomHeadView, customHeadFeatureNames } from "./customHeadMeasurements";
import type { CustomHeadAnalysis, CustomHeadBackend, CustomHeadProgress } from "./customHeadTypes";

const DINO_MODEL = "onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX";

type FitMessage = {
  type: "fit";
  id: number;
  front: ImageBitmap;
  profile: ImageBitmap;
  currentWeights: Float32Array | null;
  strength: number;
};

type FitRuntime = {
  version: number;
  featureNames: string[];
  mediaPipeCanonical: number[];
  gnmRatioMean: number[];
  priorWeights: number[];
  weightStd: number[];
  gain: number[][];
  targetScaleLimits: [number, number];
};

type FeatureTensor = { data: Float32Array; dims: number[] };
type DinoExtractor = {
  (image: OffscreenCanvas): Promise<FeatureTensor>;
  dispose(): Promise<void>;
};
type DinoRuntime = { extractor: DinoExtractor; backend: Exclude<CustomHeadBackend, "unavailable"> };

let landmarkerPromise: Promise<FaceLandmarker> | null = null;
let fitRuntimePromise: Promise<FitRuntime> | null = null;
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
      minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.6,
    });
  })();
  return landmarkerPromise;
}

async function loadFitRuntime() {
  fitRuntimePromise ??= fetch(assetUrl("models/gnm_custom_head_fit.json"))
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load the custom-head fitting runtime (HTTP ${response.status}).`);
      return response.json() as Promise<FitRuntime>;
    })
    .then((runtime) => {
      const featureCount = customHeadFeatureNames.length;
      if (
        runtime.version !== 1
        || runtime.featureNames.join("|") !== customHeadFeatureNames.join("|")
        || runtime.mediaPipeCanonical.length !== featureCount
        || runtime.gnmRatioMean.length !== featureCount
        || runtime.priorWeights.length !== 253
        || runtime.weightStd.length !== 253
        || runtime.gain.length !== 253
        || runtime.gain.some((row) => row.length !== featureCount)
      ) {
        throw new Error("The bundled custom-head fitting runtime is incompatible with this app build.");
      }
      return runtime;
    });
  return fitRuntimePromise;
}

function canvasFromBitmap(bitmap: ImageBitmap) {
  const maximum = 1024;
  const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not create an image-analysis canvas.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas;
}

async function analyzeImage(id: number, canvas: OffscreenCanvas, view: "front" | "profile") {
  postProgress(id, { stage: "landmarks", message: `Reading ${view} facial geometry…`, percent: null });
  const landmarker = await loadLandmarker();
  const result = landmarker.detect(canvas);
  const face = result.faceLandmarks[0];
  if (!face) throw new Error(`No face was detected in the ${view} image.`);
  return analyzeCustomHeadView(
    view,
    face.map(({ x, y, z }) => ({ x, y, z })),
    (result.faceBlendshapes[0]?.categories ?? []).map(({ categoryName, score }) => ({ name: categoryName, score })),
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

function fitWeights(
  runtime: FitRuntime,
  front: CustomHeadAnalysis,
  profile: CustomHeadAnalysis,
  currentWeights: Float32Array | null,
  strength: number,
) {
  const measured = [...front.measurements, ...profile.measurements];
  if (measured.length !== customHeadFeatureNames.length || measured.some((value) => !Number.isFinite(value))) {
    throw new Error("The two images did not produce a complete set of head measurements.");
  }
  const [minimumScale, maximumScale] = runtime.targetScaleLimits;
  const targetRatios = measured.map((value, index) => {
    const relative = value / Math.max(runtime.mediaPipeCanonical[index], 1e-6);
    return runtime.gnmRatioMean[index] * Math.min(maximumScale, Math.max(minimumScale, relative));
  });
  const fitted = new Float32Array(253);
  for (let component = 0; component < fitted.length; component += 1) {
    let value = runtime.priorWeights[component];
    for (let feature = 0; feature < targetRatios.length; feature += 1) {
      value += runtime.gain[component][feature] * (targetRatios[feature] - runtime.gnmRatioMean[feature]);
    }
    const spread = runtime.weightStd[component] * 3.4;
    fitted[component] = Math.min(runtime.priorWeights[component] + spread, Math.max(runtime.priorWeights[component] - spread, value));
  }
  const source = currentWeights?.length === 253 ? currentWeights : new Float32Array(runtime.priorWeights);
  const blend = Math.min(1, Math.max(0, strength));
  for (let component = 0; component < fitted.length; component += 1) {
    fitted[component] = source[component] + (fitted[component] - source[component]) * blend;
  }
  return fitted;
}

async function fit(message: FitMessage) {
  const frontCanvas = canvasFromBitmap(message.front);
  const profileCanvas = canvasFromBitmap(message.profile);
  const [front, profile, fitRuntime] = await Promise.all([
    analyzeImage(message.id, frontCanvas, "front"),
    analyzeImage(message.id, profileCanvas, "profile"),
    loadFitRuntime(),
  ]);

  const warnings: string[] = [];
  let backend: CustomHeadBackend = "unavailable";
  let consistency: number | null = null;
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

  postProgress(message.id, { stage: "fitting", message: "Solving constrained GNM identity coefficients…", percent: null });
  const weights = fitWeights(fitRuntime, front, profile, message.currentWeights, message.strength);
  self.postMessage({
    type: "result",
    id: message.id,
    result: {
      weights,
      backend,
      consistency,
      warnings,
      frontYaw: front.yawProxy,
      profileYaw: profile.yawProxy,
    },
  }, [weights.buffer]);
}

self.onmessage = (event: MessageEvent<FitMessage>) => {
  if (event.data.type !== "fit") return;
  const message = event.data;
  queue = queue.then(() => fit(message)).catch((error) => {
    message.front.close();
    message.profile.close();
    self.postMessage({ type: "error", id: message.id, message: error instanceof Error ? error.message : String(error) });
  });
};

export {};
