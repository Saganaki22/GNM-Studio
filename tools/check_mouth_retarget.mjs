import assert from "node:assert/strict";
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
assert.equal(semanticInfluences({ jawOpen: 1 }).platysma, 0, "jaw tracking must not double-drive platysma");
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
assert.ok(builderSource.includes("anatomical_mouth_open_expression"));
assert.ok(builderSource.includes("21-degree anatomical jaw hinge target"));
assert.ok(!builderSource.includes("canonical_mouth_open_expression"), "jaw opening must not use the old sampled semantic expression");

console.log("GNM mouth retarget verified: anatomical hinge solve, constrained upper lip, rigid dental arch, neutral-relative gate, wide opening, and single jaw drive.");
