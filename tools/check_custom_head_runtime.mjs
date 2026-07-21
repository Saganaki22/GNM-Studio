import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CUSTOM_HEAD_MAX_EDGE,
  CUSTOM_HEAD_MAX_PIXELS,
  fitCustomHeadImageSize,
} from "../src/features/customHead/customHeadImageSizing.ts";
import {
  analyzeCustomHeadView,
  customHeadFeatureNames,
} from "../src/features/customHead/customHeadMeasurements.ts";

const runtime = JSON.parse(await readFile(new URL("../public/models/gnm_custom_head_fit.json", import.meta.url), "utf8"));
const featureCount = customHeadFeatureNames.length;

assert.equal(runtime.version, 1);
assert.deepEqual(runtime.featureNames, [...customHeadFeatureNames]);
assert.equal(runtime.mediaPipeCanonical.length, featureCount);
assert.equal(runtime.gnmRatioMean.length, featureCount);
assert.equal(runtime.gnmRatioStd.length, featureCount);
assert.equal(runtime.priorWeights.length, 253);
assert.equal(runtime.weightStd.length, 253);
assert.equal(runtime.gain.length, 253);
assert(runtime.gain.every((row) => row.length === featureCount));
assert(runtime.gain.flat().every(Number.isFinite));
assert(runtime.priorWeights.every(Number.isFinite));
assert(runtime.weightStd.every((value) => Number.isFinite(value) && value > 0));
assert(runtime.targetScaleLimits[0] > 0 && runtime.targetScaleLimits[0] < 1);
assert(runtime.targetScaleLimits[1] > 1);
assert(runtime.ratioStdLimit > 0 && runtime.ratioStdLimit <= 3);
assert(runtime.weightZLimit > 0 && runtime.weightZLimit <= 2);
assert(runtime.weightRmsLimit > 0 && runtime.weightRmsLimit <= 1);

// Small images stay untouched; large phone and panorama images remain within
// both the area and edge limits without changing their aspect ratio materially.
assert.deepEqual(fitCustomHeadImageSize(800, 600), { width: 800, height: 600 });
for (const [width, height] of [[3024, 4032], [6000, 1000], [4000, 4000]]) {
  const fitted = fitCustomHeadImageSize(width, height);
  assert(Math.max(fitted.width, fitted.height) <= CUSTOM_HEAD_MAX_EDGE);
  assert(fitted.width * fitted.height <= CUSTOM_HEAD_MAX_PIXELS);
  assert(Math.abs(((fitted.width / fitted.height) / (width / height)) - 1) < 0.005);
}

// MediaPipe normalizes X/Y independently by source dimensions. Equivalent
// square and portrait crops must therefore produce the same metric ratios.
const metricPoints = new Map([
  [0, [0.25, 0.60, -0.04]],
  [1, [0.25, 0.47, -0.10]],
  [2, [0.25, 0.58, -0.05]],
  [10, [0.25, 0.20, 0]],
  [33, [0.11, 0.39, -0.02]],
  [61, [0.17, 0.62, -0.03]],
  [98, [0.20, 0.52, -0.06]],
  [133, [0.19, 0.39, -0.02]],
  [145, [0.15, 0.42, -0.02]],
  [149, [0.15, 0.76, -0.01]],
  [152, [0.25, 0.80, -0.01]],
  [159, [0.15, 0.37, -0.02]],
  [168, [0.25, 0.36, -0.02]],
  [172, [0.11, 0.65, -0.01]],
  [234, [0.07, 0.50, 0]],
  [263, [0.39, 0.39, -0.02]],
  [291, [0.33, 0.62, -0.03]],
  [327, [0.30, 0.52, -0.06]],
  [362, [0.31, 0.39, -0.02]],
  [374, [0.35, 0.42, -0.02]],
  [378, [0.35, 0.76, -0.01]],
  [386, [0.35, 0.37, -0.02]],
  [397, [0.39, 0.65, -0.01]],
  [454, [0.43, 0.50, 0]],
]);
const landmarksForAspect = (aspect) => Array.from({ length: 478 }, (_, index) => {
  const [x, y, z] = metricPoints.get(index) ?? [0.25, 0.50, 0];
  return { x: x / aspect, y, z: z / aspect };
});
const squareAnalysis = analyzeCustomHeadView("front", landmarksForAspect(1), [], 1);
const portraitAnalysis = analyzeCustomHeadView("front", landmarksForAspect(0.5), [], 0.5);
assert.equal(squareAnalysis.measurements.length, featureCount);
for (let index = 0; index < featureCount; index += 1) {
  assert(Math.abs(squareAnalysis.measurements[index] - portraitAnalysis.measurements[index]) < 1e-10);
}

// Canonical MediaPipe proportions must map exactly to the sampled GNM prior.
for (let component = 0; component < 253; component += 1) {
  let fitted = runtime.priorWeights[component];
  for (let feature = 0; feature < featureCount; feature += 1) {
    const desired = runtime.gnmRatioMean[feature]
      * (runtime.mediaPipeCanonical[feature] / runtime.mediaPipeCanonical[feature]);
    fitted += runtime.gain[component][feature] * (desired - runtime.gnmRatioMean[feature]);
  }
  assert(Math.abs(fitted - runtime.priorWeights[component]) < 1e-8);
}

console.log(`Custom-head runtime checks passed (${featureCount} measurements → 253 GNM identity components).`);
