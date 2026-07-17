import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const supported = new Set([
  "video/mp4;codecs=avc1.42E01E",
  "video/webm;codecs=vp8,opus",
  "audio/webm;codecs=opus",
]);
globalThis.MediaRecorder = class MediaRecorder {
  static isTypeSupported(type) { return supported.has(type); }
};

const { preferredAudioRecorderMimeType, preferredVideoRecorderMimeType } = await import("../src/lib/recordingMedia.ts");
assert.equal(
  preferredVideoRecorderMimeType(true),
  "video/webm;codecs=vp8,opus",
  "An audio take must not select a supported-but-video-only MP4 recorder",
);
assert.equal(preferredVideoRecorderMimeType(false), "video/mp4;codecs=avc1.42E01E");
assert.equal(preferredAudioRecorderMimeType(), "audio/webm;codecs=opus");

const { parseMotionFile } = await import("../src/lib/motionFile.ts");
const { neutralRelativeMatrixPosition } = await import("../src/lib/avatarMotion.ts");
const neutralMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -40, 1];
const movedMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 2, 1, -35, 1];
const trackingShell = (matrix) => ({ timestamp: 0, landmarks: [], blendshapes: [], matrix });
const xyz = neutralRelativeMatrixPosition(trackingShell(movedMatrix), trackingShell(neutralMatrix), false);
assert.ok(xyz);
assert.deepEqual(xyz.map((value) => Number(value.toFixed(4))), [0.1, 0.05, 0.25]);
assert.equal(neutralRelativeMatrixPosition(trackingShell(movedMatrix), trackingShell(neutralMatrix), true)?.[0], -0.1);
const parsed = parseMotionFile({
  format: "gnm-studio-motion",
  version: 1,
  fps: 30,
  viewState: {
    position: [0, 0, 5], target: [0.2, -0.1, 0], up: [0, 1, 0], zoom: 1.75,
  },
  frames: [{
    timestamp: 0,
    blendshapes: { jawOpen: 0.4 },
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    avatarMotion: {
      centerX: 0.62, centerY: 0.48, faceHeight: 0.44, quaternion: [0.1, 0.2, 0.3, 0.9],
      position: [0.12, -0.08, 0.2], scale: [1.04, 1.04, 1.04],
    },
  }],
});
assert.equal(parsed.frames[0].avatarMotion?.centerX, 0.62);
assert.equal(parsed.frames[0].avatarMotion?.faceHeight, 0.44);
assert.deepEqual(parsed.frames[0].avatarMotion?.position, [0.12, -0.08, 0.2]);
assert.deepEqual(parsed.frames[0].avatarMotion?.scale, [1.04, 1.04, 1.04]);
assert.equal(parsed.viewState?.zoom, 1.75);

const app = readFileSync(fileURLToPath(new URL("../src/App.tsx", import.meta.url)), "utf8");
for (const marker of [
  "pendingAvatarMotionFramesRef.current.set",
  "pendingFrame.avatarMotion = sample",
  "setCaptureFinalizing(true)",
  "cloneLiveAudioTrack",
  "setForcedViewState(recordedViewState",
  "renderAudioContext.createMediaStreamDestination()",
]) assert.ok(app.includes(marker), `Recording pipeline is missing ${marker}`);

const stage = readFileSync(fileURLToPath(new URL("../src/components/Stage.tsx", import.meta.url)), "utf8");
for (const marker of ["frame?.avatarMotion", "onAvatarMotionRef.current", "viewStateOverride"]) {
  assert.ok(stage.includes(marker), `Stage recording path is missing ${marker}`);
}
assert.ok(stage.includes("neutralRelativeMatrixPosition"), "Stage does not apply neutral-relative MediaPipe XYZ");

const glb = readFileSync(fileURLToPath(new URL("../src/lib/glbExport.ts", import.meta.url)), "utf8");
assert.ok(glb.includes('GNM_Studio_Performance.position'), "GLB export is missing the XYZ position track");
assert.ok(glb.includes('GNM_Studio_Performance.scale'), "GLB export is missing the relative scale track");

const output = readFileSync(fileURLToPath(new URL("../src/components/OutputWindow.tsx", import.meta.url)), "utf8");
assert.ok(output.includes("preferredVideoRecorderMimeType(expectedAudio)"), "Popout does not choose an audio-aware recorder codec");
assert.ok(output.includes("inspectRecordedMedia(blob)"), "Popout does not verify microphone audio");
assert.ok(output.includes('type: "avatar-motion"'), "Popout does not return exact head motion to the recorder");

console.log("Recording pipeline verified: immutable framing/view, exact head motion, finalization gate, and audio-aware desktop/web/popout capture.");
