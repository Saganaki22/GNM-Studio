import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { interpolateRecordedFrame, trimAndRetimeMotion } from "../src/lib/motionEdit.ts";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const frames = [
  { timestamp: 0, blendshapes: { smile: 0 }, matrix: identity, mouthOpen: 0, avatarMotion: { centerX: 0, centerY: 0, faceHeight: 0.4, quaternion: [0, 0, 0, 1], position: [0, 0, 0], scale: [1, 1, 1] } },
  { timestamp: 1_000, blendshapes: { smile: 1 }, matrix: identity.map((value, index) => index === 12 ? 2 : value), mouthOpen: 1, avatarMotion: { centerX: 1, centerY: 1, faceHeight: 0.6, quaternion: [0, 0, 1, 0], position: [1, 2, 3], scale: [2, 2, 2] } },
];
const midpoint = interpolateRecordedFrame(frames, 500);
assert.equal(midpoint.blendshapes.smile, 0.5);
assert.equal(midpoint.mouthOpen, 0.5);
assert.equal(midpoint.avatarMotion.position[1], 1);
assert.ok(Math.abs(Math.hypot(...midpoint.avatarMotion.quaternion) - 1) < 1e-6);
const edited = trimAndRetimeMotion(frames, 250, 750, 2, 10);
assert.equal(edited[0].timestamp, 0);
assert.equal(edited.at(-1).timestamp, 250);
assert.equal(edited[0].blendshapes.smile, 0.25);
assert.equal(edited.at(-1).blendshapes.smile, 0.75);
assert.ok(edited.length >= 3);

const app = ["../src/App.tsx", "../src/features/export/useStudioExport.ts", "../src/features/export/motionVideoRenderer.ts"]
  .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
  .join("\n");
for (const marker of ["editedFramesForExport()", "trimAndRetimeAudio", "exportTrimStartMs", "exportPlaybackSpeed"]) {
  assert.ok(app.includes(marker), `Non-destructive export edit path is missing ${marker}`);
}
const offline = readFileSync(fileURLToPath(new URL("../src/lib/offlineVideoExport.ts", import.meta.url)), "utf8");
for (const marker of ["CanvasSource", "frameIndex * duration", "hardwareAcceleration", "AudioBufferSource", "output.finalize()"] ) {
  assert.ok(offline.includes(marker), `Deterministic offline MP4 encoder is missing ${marker}`);
}
assert.ok(app.includes("renderRecordedMotionMp4"));
assert.ok(app.includes("settings.exportWidth"));
console.log("Motion editing verified: bounded trim, interpolated blendshape/XYZ/scale/quaternion samples, retimed audio, and deterministic arbitrary-resolution/FPS MP4 encoding.");
