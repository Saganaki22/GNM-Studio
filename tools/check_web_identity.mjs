import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { evaluateWebIdentity, parseWebIdentityRuntime } from "../src/lib/webIdentityRuntime.ts";
import { packQuantizedBasis } from "../src/lib/webIdentityWebGpu.ts";
import { weightedIdentityDecoderInput } from "../src/lib/decoder.ts";

const path = fileURLToPath(new URL("../webapp-assets/models/gnm_identity_basis.gni.gz", import.meta.url));
const compressed = readFileSync(path);
assert.ok(compressed.length < 8_000_000, "web identity runtime should remain below 8 MB compressed");
const decoded = gunzipSync(compressed);
const buffer = decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength);
const runtime = parseWebIdentityRuntime(buffer);
const weights = new Float32Array(runtime.components);
weights[0] = 1;
weights[17] = -0.35;
weights[252] = 0.75;
const positions = evaluateWebIdentity(runtime, weights);
assert.equal(positions.length, 17_821 * 3);
assert.ok(positions.every(Number.isFinite), "web identity output must contain only finite positions");
assert.notDeepEqual(Array.from(positions.slice(0, 30)), Array.from(runtime.template.slice(0, 30)), "identity weights must deform the template");
const digest = createHash("sha256").update(new Uint8Array(positions.buffer)).digest("hex");
assert.equal(digest, "abd692c88b00b16ac089ab3779d787a3aaea9902cc09f8857cf168b46e79dfde");
const packed = packQuantizedBasis(runtime);
for (let sample = 0; sample < 2_000; sample += 1) {
  const byteIndex = (sample * 7_919) % runtime.quantized.length;
  const unsigned = (packed[byteIndex >>> 2] >>> ((byteIndex & 3) * 8)) & 255;
  const unpacked = unsigned >= 128 ? unsigned - 256 : unsigned;
  assert.equal(unpacked, runtime.quantized[byteIndex], `Packed WebGPU basis mismatch at ${byteIndex}`);
}
const gpuSource = readFileSync(fileURLToPath(new URL("../src/lib/webIdentityWebGpu.ts", import.meta.url)), "utf8");
const workerSource = readFileSync(fileURLToPath(new URL("../src/identity.worker.ts", import.meta.url)), "utf8");
for (const marker of ["@compute @workgroup_size", "packedBasis", "requestAdapter", "mapAsync"]) {
  assert.ok(gpuSource.includes(marker), `WebGPU identity implementation is missing ${marker}`);
}
assert.ok(workerSource.includes('backend: "cpu"'), "Web identity worker is missing its CPU fallback");
const feminine = weightedIdentityDecoderInput("same", -1, [1, 0, 0, 0]);
const masculine = weightedIdentityDecoderInput("same", 1, [0, 0, 0, 1]);
const blended = weightedIdentityDecoderInput("same", 0.25, [1, 1, 2, 0]);
assert.deepEqual(Array.from(feminine.slice(64)), [1, 0, 1, 0, 0, 0]);
assert.deepEqual(Array.from(masculine.slice(64)), [0, 1, 0, 0, 0, 1]);
assert.deepEqual(Array.from(blended.slice(64)), [0.375, 0.625, 0.25, 0.25, 0.5, 0]);
const appSource = ["../src/App.tsx", "../src/features/identity/IdentityPanel.tsx"]
  .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
  .join("\n");
for (const marker of ["identityPresentationStrength", "identityPopulationWeights", "weightedIdentityDecoderInput", "Compare feminine / masculine with this seed"]) {
  assert.ok(appSource.includes(marker), `Weighted identity UI/evaluation is missing ${marker}`);
}
console.log(`Web identity verified: ${runtime.components} components, ${runtime.vertices} vertices, CPU/WebGPU packing, SHA-256 ${digest}.`);
