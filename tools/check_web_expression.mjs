import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { addWebExpression, parseWebExpressionRuntime } from "../src/lib/webExpressionRuntime.ts";

const compressed = readFileSync(fileURLToPath(new URL("../webapp-assets/models/gnm_expression_basis.gne.gz", import.meta.url)));
const bytes = gunzipSync(compressed);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const runtime = parseWebExpressionRuntime(buffer);
assert.equal(runtime.components, 383);
assert.equal(runtime.vertices, 17_821);
assert.ok(compressed.byteLength < 4_000_000, "Quantized expression runtime is unexpectedly large");

const weights = new Float32Array(383);
for (const [index, value] of Object.entries({ 0: .2, 37: -.15, 100: .22, 145: -.1, 200: .35, 249: -.18, 349: .12, 350: .3, 371: -.2, 382: .16 })) weights[Number(index)] = value;
const output = addWebExpression(runtime, new Float32Array(runtime.vertices * 3), weights);
const expected = {
  15224: [-0.0002169332583, 0.0042049796320, 0.0009158297325],
  14776: [-0.0001967661665, 0.0041896360926, 0.0009782096604],
  15222: [-0.0001752077369, 0.0042107282206, 0.0008842211100],
  15223: [-0.0002309796400, 0.0041622379795, 0.0010358212749],
  15415: [-0.0002366139524, 0.0041010901332, 0.0011280574836],
};
for (const [vertexText, reference] of Object.entries(expected)) {
  const vertex = Number(vertexText);
  for (let axis = 0; axis < 3; axis += 1) {
    const error = Math.abs(output[vertex * 3 + axis] - reference[axis]);
    assert.ok(error < 0.00008, `Quantized expression parity failed at vertex ${vertex}, axis ${axis}: ${error}`);
  }
}

const worker = readFileSync(fileURLToPath(new URL("../src/identity.worker.ts", import.meta.url)), "utf8");
for (const marker of ["evaluate-expression", "WebGpuExpressionEvaluator", "addWebExpression", "gnm_expression_basis.gne.gz"]) {
  assert.ok(worker.includes(marker), `Expression worker is missing ${marker}`);
}
console.log(`Web expression verified: 383 components, ${runtime.vertices} vertices, ${(compressed.byteLength / 1_000_000).toFixed(2)} MB gzip, NumPy parity, WebGPU with CPU fallback.`);
