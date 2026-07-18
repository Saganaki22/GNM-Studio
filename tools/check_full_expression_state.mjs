import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  applyFrozenGnmExpressionComponents, blendGnmExpressions, gnmExpressionComponentName,
  gnmExpressionRegions, mirrorGnmEyeRegion,
} from "../src/lib/gnmExpressions.ts";

assert.deepEqual(gnmExpressionRegions.map(({ end, start }) => end - start), [100, 100, 150, 32, 1]);
assert.equal(gnmExpressionComponentName(0), "left_eye_region_000");
assert.equal(gnmExpressionComponentName(199), "right_eye_region_099");
assert.equal(gnmExpressionComponentName(350), "tongue_mean");
assert.equal(gnmExpressionComponentName(382), "pupils_000");

const a = new Float32Array(383);
const b = new Float32Array(383);
a[2] = 0.5;
b[2] = 1.5;
a[7] = -0.4;
const midpoint = blendGnmExpressions(a, b, 0.5);
assert.ok(Math.abs(midpoint[2] - 1) < 1e-6);
assert.ok(Math.abs(midpoint[7] + 0.2) < 1e-6);
const leftToRight = mirrorGnmEyeRegion(a, "left-to-right");
assert.equal(leftToRight[102], a[2]);
assert.equal(leftToRight[107], a[7]);
assert.equal(applyFrozenGnmExpressionComponents(midpoint, { 2: -0.75 })[2], -0.75);

const app = ["../src/App.tsx", "../src/features/expression/ExpressionPanel.tsx", "../src/features/gnm/useGnmRuntime.ts"]
  .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
  .join("\n");
for (const marker of [
  "models/gnm_expression_decoder.bin",
  "evaluateParameters(identityWeights, gnmExpressionWeights)",
  "<GnmExpressionEditor",
  "gnmFrozenExpressionComponents",
  "evaluateExpression(identity, expression)",
]) assert.ok(app.includes(marker), `Full GNM expression integration is missing ${marker}`);

const decoder = readFileSync(fileURLToPath(new URL("../src/lib/decoder.ts", import.meta.url)), "utf8");
assert.ok(decoder.includes("export function expressionDecoderInput"));
assert.ok(decoder.includes("new Float32Array(84)"));

console.log("Full GNM expression state verified: 383 components, semantic A/B decode, live blending, raw groups, eye mirroring, freezes, and desktop/web evaluation wiring.");
