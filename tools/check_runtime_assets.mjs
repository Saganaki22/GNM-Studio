import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { readMaybeGzippedRuntime } from "../src/lib/runtimeAsset.ts";

const compressed = readFileSync(new URL("../webapp-assets/models/gnm_identity_basis.gni.gz", import.meta.url));
const decoded = gunzipSync(compressed);

const fromGzip = new Uint8Array(await readMaybeGzippedRuntime(new Response(compressed), "GNI1"));
assert.deepEqual([...fromGzip.subarray(0, 16)], [...decoded.subarray(0, 16)], "raw gzip hosting did not decode the identity runtime");

const fromEncodedResponse = new Uint8Array(await readMaybeGzippedRuntime(new Response(decoded), "GNI1"));
assert.deepEqual([...fromEncodedResponse.subarray(0, 16)], [...decoded.subarray(0, 16)], "HTTP-decoded gzip data was decompressed a second time");

await assert.rejects(
  readMaybeGzippedRuntime(new Response(new Uint8Array([1, 2, 3, 4])), "GNI1"),
  /neither GNI1 data nor gzip data/,
);

const dinoRoot = new URL(
  "../desktop-assets/models/huggingface/onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX/",
  import.meta.url,
);
const dinoFiles = new Map([
  ["config.json", [835, "e9f41d1c030ec6589280ba417e630b916d6e4d0e38a3efae15c11aa12c22c984"]],
  ["preprocessor_config.json", [585, "960c41d1f3a7778b936365769a2d90550b318a6c0a53a0296957adacfe5e0dd7"]],
  ["LICENSE.md", [7502, "aa878c2fe56729d87f735e1cab375b27079aa2ef5f9a06e85456a4ba2c89e7b8"]],
  ["onnx/model_q4.onnx", [152401, "48272ed591191c5fb85d5c300192324205155079ff32ff8b3bb305445f64ea3c"]],
  ["onnx/model_q4.onnx_data", [14684160, "4a9337a591b7d4b7ede09b57fb455f9a7ebc8adc15c27c92031f57a2a870c29c"]],
]);
for (const [path, [expectedSize, expectedHash]] of dinoFiles) {
  const data = readFileSync(new URL(path, dinoRoot));
  assert.equal(data.length, expectedSize, `${path} has an unexpected size`);
  assert.equal(createHash("sha256").update(data).digest("hex"), expectedHash, `${path} failed SHA-256 verification`);
}

console.log(
  "Runtime assets verified: gzip handling and the pinned offline DINOv3 Q4 desktop bundle are intact.",
);
