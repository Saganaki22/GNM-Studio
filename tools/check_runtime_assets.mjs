import assert from "node:assert/strict";
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

console.log("Runtime asset loading verified: raw gzip and host-decoded gzip both resolve under the configured web base path.");
