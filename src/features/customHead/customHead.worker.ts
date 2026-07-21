/// <reference lib="webworker" />

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import ortWasmFactoryUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import { assetUrl } from "../../lib/assets";
import { fitCustomHeadImageSize } from "./customHeadImageSizing";
import { analyzeCustomHeadView, customHeadFeatureNames } from "./customHeadMeasurements";
import type { CustomHeadAnalysis, CustomHeadBackend, CustomHeadProgress } from "./customHeadTypes";

const DINO_MODEL = "onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX";

type FitMessage = {
  type: "fit";
  id: number;
  front: ImageBitmap;
  profile: ImageBitmap | null;
  currentWeights: Float32Array | null;
  strength: number;
};

type FitRuntime = {
  version: number;
  featureNames: string[];
  mediaPipeCanonical: number[];
  gnmRatioMean: number[];
  gnmRatioStd: number[];
  priorWeights: number[];
  weightStd: number[];
  gain: number[][];
  targetScaleLimits: [number, number];
  ratioStdLimit: number;
  weightZLimit: number;
  weightRmsLimit: number;
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
      return response.json() as Promise<FitRuntime>;
    })
    .then((runtime) => {
      const featureCount = customHeadFeatureNames.length;
      if (
        runtime.version !== 1
        || runtime.featureNames.join("|") !== customHeadFeatureNames.join("|")
        || runtime.mediaPipeCanonical.length !== featureCount
        || runtime.gnmRatioMean.length !== featureCount
        || runtime.gnmRatioStd.length !== featureCount
        || runtime.priorWeights.length !== 253
        || runtime.weightStd.length !== 253
        || runtime.gain.length !== 253
        || runtime.gain.some((row) => row.length !== featureCount)
        || !Number.isFinite(runtime.ratioStdLimit)
        || !Number.isFinite(runtime.weightZLimit)
        || !Number.isFinite(runtime.weightRmsLimit)
      ) {
        throw new Error("The bundled custom-head fitting runtime is incompatible with this app build.");
      }
      return runtime;
    });
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
  profile: CustomHeadAnalysis | null,
  currentWeights: Float32Array | null,
  strength: number,
) {
  const reliability = (score: number, neutralTarget: number) => (
    Math.min(1, Math.max(0, score / Math.max(neutralTarget, 1e-5)))
  );
  // The straight-on image now supplies both aspect-corrected 2D proportions
  // and MediaPipe Z projection. An optional three-quarter image stabilizes the
  // five depth channels without being mandatory for a useful fit.
  const measured = [...front.measurements];
  if (profile) {
    const profileReliability = reliability(profile.neutralScore, 0.48);
    const profileBlend = 0.22 + profileReliability * 0.18;
    for (let feature = 0; feature < profile.measurements.length; feature += 1) {
      const index = 11 + feature;
      measured[index] += (profile.measurements[feature] - measured[index]) * profileBlend;
    }
  }
  if (measured.length !== customHeadFeatureNames.length || measured.some((value) => !Number.isFinite(value))) {
    throw new Error("The front image did not produce a complete set of head measurements.");
  }
  // Expressions should not become permanent identity. When a source photo is
  // non-neutral, progressively damp its mouth-sensitive ratios back toward the
  // canonical neutral head while retaining the stable cranial measurements.
  const frontReliability = reliability(front.neutralScore, 0.54);
  const dampToCanonical = (index: number, amount: number) => {
    const canonical = runtime.mediaPipeCanonical[index];
    measured[index] = canonical + (measured[index] - canonical) * amount;
  };
  dampToCanonical(7, frontReliability);
  dampToCanonical(8, 0.45 + frontReliability * 0.55);
  const depthReliability = profile ? reliability(profile.neutralScore, 0.48) : frontReliability;
  dampToCanonical(14, depthReliability);
  dampToCanonical(15, depthReliability);
  const [minimumScale, maximumScale] = runtime.targetScaleLimits;
  const targetRatios = measured.map((value, index) => {
    const relative = value / Math.max(runtime.mediaPipeCanonical[index], 1e-6);
    const scaled = runtime.gnmRatioMean[index] * Math.min(maximumScale, Math.max(minimumScale, relative));
    const spread = runtime.gnmRatioStd[index] * runtime.ratioStdLimit;
    return Math.min(runtime.gnmRatioMean[index] + spread, Math.max(runtime.gnmRatioMean[index] - spread, scaled));
  });
  const fitted = new Float32Array(253);
  const normalized = new Float32Array(253);
  for (let component = 0; component < fitted.length; component += 1) {
    let value = runtime.priorWeights[component];
    for (let feature = 0; feature < targetRatios.length; feature += 1) {
      value += runtime.gain[component][feature] * (targetRatios[feature] - runtime.gnmRatioMean[feature]);
    }
    const z = (value - runtime.priorWeights[component]) / runtime.weightStd[component];
    normalized[component] = Math.min(runtime.weightZLimit, Math.max(-runtime.weightZLimit, z));
  }
  let normalizedEnergy = 0;
  for (const value of normalized) normalizedEnergy += value * value;
  const rms = Math.sqrt(normalizedEnergy / normalized.length);
  const rmsScale = rms > runtime.weightRmsLimit ? runtime.weightRmsLimit / rms : 1;
  for (let component = 0; component < fitted.length; component += 1) {
    fitted[component] = runtime.priorWeights[component]
      + normalized[component] * rmsScale * runtime.weightStd[component];
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
      profileYaw: profile?.yawProxy ?? null,
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
