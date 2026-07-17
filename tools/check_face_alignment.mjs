import assert from "node:assert/strict";
import { assessFaceAlignment } from "../src/lib/faceAlignment.ts";

const viewport = { width: 900, height: 600 };
const camera = { videoWidth: 1280, videoHeight: 720 };

function frame(centerX = 0.5, centerY = 0.5, width = 0.22, height = 0.568) {
  const landmarks = Array.from({ length: 478 }, (_, index) => ({
    x: centerX + (index % 2 ? width : -width) * 0.5,
    y: centerY + (Math.floor(index / 2) % 2 ? height : -height) * 0.5,
    z: 0,
  }));
  return { timestamp: 1, landmarks, blendshapes: [], matrix: [] };
}

assert.equal(assessFaceAlignment(frame(), false, camera, viewport).status, "ready", "a face closely matching the oval must pass");
assert.match(assessFaceAlignment(frame(0.5, 0.5, 0.12, 0.3), false, camera, viewport).message, /closer/i);
assert.match(assessFaceAlignment(frame(0.5, 0.5, 0.28, 0.7), false, camera, viewport).message, /farther/i);
assert.match(assessFaceAlignment(frame(0.40), false, camera, viewport).message, /right/i);
assert.match(assessFaceAlignment(frame(0.40), true, camera, viewport).message, /left/i);

console.log("Face alignment verified: guide-sized gating, cover-crop projection, distance guidance, centering, and mirror direction.");
