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
    mouthOpen: 0.63,
  }],
});
assert.equal(parsed.frames[0].avatarMotion?.centerX, 0.62);
assert.equal(parsed.frames[0].avatarMotion?.faceHeight, 0.44);
assert.deepEqual(parsed.frames[0].avatarMotion?.position, [0.12, -0.08, 0.2]);
assert.deepEqual(parsed.frames[0].avatarMotion?.scale, [1.04, 1.04, 1.04]);
assert.equal(parsed.frames[0].mouthOpen, 0.63);
assert.equal(parsed.viewState?.zoom, 1.75);
assert.equal(parsed.version, 1);
assert.equal(parsed.appearance, null);

const settings = {
  avatarKind: "gnm", cameraId: "", microphoneId: "", cameraFps: 30, trackingFps: 30,
  trackingSmoothingEnabled: true, trackingSmoothing: 0.7, motionSmoothingEnabled: true, motionSmoothing: 0.3, mouthDeadZone: 0.16,
  trackingBackend: "auto", exportFps: 60, exportWidth: 1920, exportHeight: 1080, videoBitrateMbps: 12, audioBitrateKbps: 192,
  videoEncoderBackend: "webcodecs", ffmpegPath: "ffmpeg", showWebcam: false, showAvatar: true,
  showLandmarks: false, mirror: true, muted: false, avatarOpacity: 1, wireframe: false,
  skinTextureEnabled: true, skinTone: "medium", skinTextureScale: 8, skinTextureRotation: 0,
  skinTextureFeather: 0.12, eyeShaderEnabled: true, eyeColor: "blue", backgroundMode: "studio",
  backgroundColor: "#101820", backgroundImageZoom: 1, mouseLightEnabled: true, mouseLightIntensity: 1,
  headRotationEnabled: true, headYawStrength: 1, headPitchStrength: 1, headRollStrength: 1,
  headRotationDeadZone: 1.5, headRotationSmoothing: 0.35, outputAutoHideEnabled: true,
  outputAutoHideDelay: 2.5, outputAlwaysHideControls: false, recordingMode: "motion",
};
const parsedV2 = parseMotionFile({
  format: "gnm-studio-motion", version: 2, fps: 60, frames: [{
    timestamp: 0, blendshapes: {}, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  }],
  appearance: {
    version: 1, capturedAt: "2026-07-18T12:00:00.000Z", settings,
    identityVertices: [0, 1, 2],
    identityParameters: { seed: "same-seed", presentation: "female", population: "blend", presentationStrength: -0.75 },
    manualExpressions: { smile: 0.2 }, frozenExpressions: {}, neutralFrame: null,
    viewState: { position: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0], zoom: 1.2 },
    backgroundImageUrl: null,
  },
});
assert.equal(parsedV2.version, 2);
assert.equal(parsedV2.appearance?.settings.exportFps, 60);
assert.equal(parsedV2.appearance?.identityParameters.presentationStrength, -0.75);
assert.deepEqual(Array.from(parsedV2.appearance?.identityVertices ?? []), [0, 1, 2]);

const app = readFileSync(fileURLToPath(new URL("../src/App.tsx", import.meta.url)), "utf8");
for (const marker of [
  "pendingAvatarMotionFramesRef.current.set",
  "pendingFrame.avatarMotion = sample",
  "setCaptureFinalizing(true)",
  "cloneLiveAudioTrack",
  "setForcedViewState(appearance?.viewState ?? recordedViewState",
  "renderAudioContext.createMediaStreamDestination()",
  "captureRecordedTakeSnapshot({",
  "recordedAppearanceRef.current",
  "const stageSettings = stageAppearance?.settings ?? settings",
  "smoothed.mouthOpen = mouthOpenGateRef.current.update(",
]) assert.ok(app.includes(marker), `Recording pipeline is missing ${marker}`);
assert.ok(app.includes("captureFinalizing || motionVideoRendering"), "Recorded appearance must remain frozen through asynchronous recorder finalization");
assert.ok(app.includes("version: 2"), "Motion JSON export must use the appearance-snapshot format");
assert.ok(app.includes("value instanceof Float32Array ? Array.from(value) : value"), "Motion JSON must serialize typed coefficient arrays as JSON arrays");
assert.ok(app.includes("Use current look"), "A take cannot be deliberately restyled from the current UI");

const appearanceSource = readFileSync(fileURLToPath(new URL("../src/lib/recordingAppearance.ts", import.meta.url)), "utf8");
for (const marker of ["version: 2", "capturedAt", "identityParameters", "identityWeights", "gnmExpressionWeights", "gnmFrozenExpressionComponents", "skinTextureEnabled", "eyeShaderEnabled", "backgroundMode", "headRotationEnabled", "new Float32Array", "serializableRecordedTakeSnapshot"]) {
  assert.ok(appearanceSource.includes(marker), `Recorded appearance snapshot is missing ${marker}`);
}

const stage = readFileSync(fileURLToPath(new URL("../src/components/Stage.tsx", import.meta.url)), "utf8");
for (const marker of ["frame?.avatarMotion", "onAvatarMotionRef.current", "viewStateOverride"]) {
  assert.ok(stage.includes(marker), `Stage recording path is missing ${marker}`);
}
assert.ok(stage.includes("frame?.mouthOpen ?? mouthOpenInfluence"), "Stage playback does not preserve the recorded jaw channel");
assert.ok(stage.includes("neutralRelativeMatrixPosition"), "Stage does not apply neutral-relative MediaPipe XYZ");

const glb = readFileSync(fileURLToPath(new URL("../src/lib/glbExport.ts", import.meta.url)), "utf8");
assert.ok(glb.includes('GNM_Studio_Performance.position'), "GLB export is missing the XYZ position track");
assert.ok(glb.includes('GNM_Studio_Performance.scale'), "GLB export is missing the relative scale track");
assert.ok(glb.includes("frame.mouthOpen ?? mouthOpenInfluence"), "GLB export does not preserve the recorded jaw channel");

const output = readFileSync(fileURLToPath(new URL("../src/components/OutputWindow.tsx", import.meta.url)), "utf8");
assert.ok(output.includes("preferredVideoRecorderMimeType(expectedAudio)"), "Popout does not choose an audio-aware recorder codec");
assert.ok(output.includes("inspectRecordedMedia(blob)"), "Popout does not verify microphone audio");
assert.ok(output.includes('type: "avatar-motion"'), "Popout does not return exact head motion to the recorder");

console.log("Recording pipeline verified: immutable framing/view, exact head motion, finalization gate, and audio-aware desktop/web/popout capture.");
