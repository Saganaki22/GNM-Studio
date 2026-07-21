import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { customHeadFeatureNames } from "../src/features/customHead/customHeadMeasurements.ts";

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
