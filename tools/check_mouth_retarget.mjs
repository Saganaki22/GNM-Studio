import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MouthOpenGate, mouthOpenInfluence, semanticInfluences } from "../src/lib/retarget.ts";

const points = (innerGap, width = 0.2) => {
  const result = Array.from({ length: 309 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  result[13] = { x: 0.5, y: 0.5 - innerGap / 2, z: 0 };
  result[14] = { x: 0.5, y: 0.5 + innerGap / 2, z: 0 };
  result[78] = { x: 0.5 - width / 2, y: 0.5, z: 0 };
  result[308] = { x: 0.5 + width / 2, y: 0.5, z: 0 };
  return result;
};

assert.ok(mouthOpenInfluence({ jawOpen: 0.1 }) < 0.01, "resting jaw noise must not create an O mouth");
assert.equal(mouthOpenInfluence({ jawOpen: 0.05 }, points(0.002)), 0, "closed inner lips must remain closed");
assert.ok(mouthOpenInfluence({ jawOpen: 0.72 }, points(0.13)) > 0.95, "a clearly open tracked mouth must reach the canonical pose");
assert.ok(
  mouthOpenInfluence({ jawOpen: 0.6, mouthClose: 1 }, points(0.1))
    < mouthOpenInfluence({ jawOpen: 0.6 }, points(0.1)),
  "mouthClose must continue to suppress opening",
);
assert.equal(semanticInfluences({ jawOpen: 1 }).surprise, 0, "jaw tracking must not also drive full-face surprise");
assert.ok(semanticInfluences({ browInnerUp: 1 }).surprise > 0, "upper-face surprise must remain available");

const frame = (timestamp, jawOpen, gap) => ({
  timestamp, landmarks: points(gap), matrix: [],
  blendshapes: [{ name: "jawOpen", score: jawOpen }],
});
const neutral = frame(0, 0.11, 0.012);
const gate = new MouthOpenGate();
for (const timestamp of [0, 33, 66, 99]) {
  assert.equal(gate.update(frame(timestamp, 0.12, 0.013), neutral), 0, "neutral-relative tracker drift must remain closed");
}
let opened = 0;
for (const timestamp of [132, 165, 198, 231, 264, 297, 330]) opened = gate.update(frame(timestamp, 0.86, 0.12), neutral);
assert.ok(opened > 0.9, "sustained wide opening must pass the temporal gate");
let closing = opened;
for (const timestamp of [363, 396, 429, 462, 495, 528, 561, 594, 627, 660]) closing = gate.update(frame(timestamp, 0.11, 0.012), neutral);
assert.ok(closing < 0.05, "sustained closure must cross the lower hysteresis threshold and settle to neutral");

const stageSource = await import("node:fs").then(({ readFileSync }) => readFileSync(new URL("../src/components/Stage.tsx", import.meta.url), "utf8"));
assert.ok(stageSource.includes("frozenExpressions.jaw_open"));
assert.ok(stageSource.includes("manualExpressions.jaw_open"));
assert.ok(!stageSource.includes("frozenExpressions.surprise ?? Math.min"), "manual surprise must not duplicate jaw opening");
const builderSource = await import("node:fs").then(({ readFileSync }) => readFileSync(new URL("./build_gnm_runtime.py", import.meta.url), "utf8"));
assert.ok(builderSource.includes("canonical_mouth_open_expression"));
assert.ok(builderSource.includes("deterministic lower-face opening shipped by v1.3.0"));
assert.ok(!builderSource.includes("np.linalg.lstsq"), "v1.3.1 must not restore the malformed least-squares mouth target");

const runtime = readFileSync(new URL("../public/models/gnm_head_runtime.glb", import.meta.url));
const jsonLength = runtime.readUInt32LE(12);
const gltf = JSON.parse(runtime.toString("utf8", 20, 20 + jsonLength).trim());
const binaryStart = 20 + ((jsonLength + 3) & ~3) + 8;
const primitive = gltf.meshes[0].primitives[0];
const jawIndex = gltf.meshes[0].extras.targetNames.indexOf("jaw_open");
const accessor = gltf.accessors[primitive.targets[jawIndex].POSITION];
const view = gltf.bufferViews[accessor.bufferView];
const jawOffset = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
const jawBytes = runtime.subarray(jawOffset, jawOffset + accessor.count * 12);
assert.equal(
  createHash("sha256").update(jawBytes).digest("hex"),
  "3e2f7be4c260bd694364772d5c8d2517b48e3016ea8894fe37755c51ba1555dd",
  "v1.3.1 must retain the byte-exact v1.3.0 jaw target",
);

console.log("GNM mouth retarget verified: restored v1.3.0 target, neutral-relative dead zone, temporal hysteresis, landmark gate, wide opening, and close suppression.");
