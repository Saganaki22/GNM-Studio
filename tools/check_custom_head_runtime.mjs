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
import {
  buildCustomHeadTarget,
  canonicalizeCustomHeadLandmarks,
  solveCustomHeadGeometry,
  validateCustomHeadFitRuntime,
} from "../src/features/customHead/customHeadGeometryFit.ts";

const runtime = validateCustomHeadFitRuntime(JSON.parse(
  await readFile(new URL("../public/models/gnm_custom_head_fit.json", import.meta.url), "utf8"),
));
const featureCount = customHeadFeatureNames.length;
const pointCount = runtime.landmarkIndices.length;
const coordinateCount = pointCount * 3;

assert.equal(runtime.version, 2);
assert.equal(pointCount, 118);
assert.equal(runtime.latentDimensions, 48);
assert(runtime.explainedVariance > 0.8);
assert.equal(runtime.canonicalAnchors.length, coordinateCount);
assert.equal(runtime.baseAnchors.length, coordinateCount);
assert.equal(runtime.anchorModes.length, runtime.latentDimensions);
assert(runtime.anchorModes.every((mode) => mode.length === coordinateCount));
assert.equal(runtime.priorWeights.length, 253);
assert.equal(runtime.weightModes.length, runtime.latentDimensions);
assert(runtime.weightModes.every((mode) => mode.length === 253));
assert(runtime.priorWeights.every(Number.isFinite));
assert(runtime.weightModes.flat().every(Number.isFinite));
assert(runtime.oralValidation.randomSamples >= 5_000);
assert(runtime.oralValidation.maximumOutsideValidRangeRate <= 0.001);
for (const metric of [
  "teethFrontClearance", "gumsFrontClearance", "tongueFrontClearance", "sockFrontClearance",
]) {
  assert(runtime.oralValidation.metrics[metric].subspaceP001 > 0);
}

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

const canonical = new Float64Array(runtime.canonicalAnchors);

// Local XYZ extraction must remove source translation, scale, roll, pitch, and
// yaw. This keeps identity proportions independent from how the photo was held.
const rotation = [
  [0.81379768, -0.46984631, 0.34202014],
  [0.54383814, 0.82317294, -0.16317591],
  [-0.20487413, 0.31879578, 0.92541658],
];
const sourceAspect = 0.72;
const transformedLandmarks = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
for (let point = 0; point < pointCount; point += 1) {
  const source = canonical.subarray(point * 3, point * 3 + 3);
  const metric = rotation.map((row, axis) => (
    (row[0] * source[0] + row[1] * source[1] + row[2] * source[2]) * 0.43
    + [0.31, -0.24, 0.17][axis]
  ));
  transformedLandmarks[runtime.landmarkIndices[point]] = {
    x: metric[0] / sourceAspect,
    y: -metric[1],
    z: -metric[2] / sourceAspect,
  };
}
const recoveredCanonical = canonicalizeCustomHeadLandmarks(
  transformedLandmarks,
  sourceAspect,
  runtime.landmarkIndices,
);
assert(Math.max(...recoveredCanonical.map((value, index) => Math.abs(value - canonical[index]))) < 1e-7);

const canonicalTarget = buildCustomHeadTarget(
  runtime,
  { coordinates: canonical, neutralScore: 1 },
  null,
);
const canonicalFit = solveCustomHeadGeometry(
  runtime,
  canonicalTarget.target,
  canonicalTarget.coordinateWeights,
  null,
  1,
);
assert.equal(canonicalFit.diagnostics.initialRmse, 0);
assert.equal(canonicalFit.diagnostics.fittedRmse, 0);
assert.equal(canonicalFit.diagnostics.latentRms, 0);
assert(canonicalFit.weights.every((value, index) => Math.abs(value - runtime.priorWeights[index]) < 1e-5));

const predictAnchors = (latent) => {
  const anchors = new Float64Array(runtime.baseAnchors);
  for (let mode = 0; mode < runtime.latentDimensions; mode += 1) {
    for (let coordinate = 0; coordinate < coordinateCount; coordinate += 1) {
      anchors[coordinate] += latent[mode] * runtime.anchorModes[mode][coordinate];
    }
  }
  return anchors;
};
const coordinateOf = (landmark, axis = 0) => runtime.landmarkIndices.indexOf(landmark) * 3 + axis;
const faceWidth = (anchors) => anchors[coordinateOf(454)] - anchors[coordinateOf(234)];

// A deliberately long/narrow source must visibly change GNM proportions. The
// old 16-ratio/clamped fitter recovered only about 3% of this test delta.
const narrowCoordinates = canonical.slice();
for (let point = 0; point < pointCount; point += 1) narrowCoordinates[point * 3] *= 0.8;
const narrowTarget = buildCustomHeadTarget(
  runtime,
  { coordinates: narrowCoordinates, neutralScore: 1 },
  null,
);
const narrowFit = solveCustomHeadGeometry(
  runtime,
  narrowTarget.target,
  narrowTarget.coordinateWeights,
  null,
  1,
);
const narrowAnchors = predictAnchors(narrowFit.latent);
const baseWidth = faceWidth(runtime.baseAnchors);
const targetWidth = faceWidth(narrowTarget.target);
const fittedWidth = faceWidth(narrowAnchors);
const widthRecovery = (fittedWidth - baseWidth) / (targetWidth - baseWidth);
assert(widthRecovery > 0.45, `Expected >45% narrow-head recovery, received ${(widthRecovery * 100).toFixed(1)}%`);
assert(narrowFit.diagnostics.fittedRmse < narrowFit.diagnostics.initialRmse * 0.55);
assert(narrowFit.diagnostics.latentRms <= runtime.solver.latentRmsLimit + 1e-8);

// A three-quarter observation must carry more depth authority than a front-only
// estimate, while both remain inside the same bounded identity subspace.
const depthCoordinates = canonical.slice();
for (let point = 0; point < pointCount; point += 1) {
  if (runtime.landmarkRegions[point] === "nose") depthCoordinates[point * 3 + 2] += 0.06;
}
const frontDepthTarget = buildCustomHeadTarget(
  runtime,
  { coordinates: canonical, neutralScore: 1 },
  null,
);
const multiDepthTarget = buildCustomHeadTarget(
  runtime,
  { coordinates: canonical, neutralScore: 1 },
  { coordinates: depthCoordinates, neutralScore: 1 },
);
const frontDepthFit = solveCustomHeadGeometry(
  runtime, frontDepthTarget.target, frontDepthTarget.coordinateWeights, null, 1,
);
const multiDepthFit = solveCustomHeadGeometry(
  runtime, multiDepthTarget.target, multiDepthTarget.coordinateWeights, null, 1,
);
const noseTip = coordinateOf(1, 2);
const frontDepthChange = predictAnchors(frontDepthFit.latent)[noseTip] - runtime.baseAnchors[noseTip];
const multiDepthChange = predictAnchors(multiDepthFit.latent)[noseTip] - runtime.baseAnchors[noseTip];
assert(multiDepthChange > frontDepthChange + 0.015);

console.log(
  `Custom-head runtime checks passed (${pointCount} anchors, ${runtime.latentDimensions} valid-identity modes, `
  + `${(widthRecovery * 100).toFixed(1)}% narrow-head recovery).`,
);
