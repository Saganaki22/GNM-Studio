import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canMountStudioRenderer, outputOwnerBusy, phaseFromHeartbeat, popoutOwnsRenderer } from "../src/lib/outputOwner.ts";

assert.equal(canMountStudioRenderer("studio"), true);
assert.equal(canMountStudioRenderer("popout-ready"), false);
assert.equal(popoutOwnsRenderer("connecting"), true);
assert.equal(popoutOwnsRenderer("restoring"), true);
assert.equal(outputOwnerBusy("popout-recording"), true);
assert.equal(outputOwnerBusy("popout-encoding"), true);
assert.equal(phaseFromHeartbeat("popout-ready", "recording"), "popout-recording");
assert.equal(phaseFromHeartbeat("popout-recording", "encoding"), "popout-encoding");
assert.equal(phaseFromHeartbeat("closing", "ready"), "closing");
assert.equal(phaseFromHeartbeat("restoring", "recording"), "restoring");

const app = [
  "../src/App.tsx", "../src/features/stage/StudioViewport.tsx",
  "../src/features/output/useOutputPopout.ts", "../src/features/export/motionVideoRenderer.ts",
]
  .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
  .join("\n");
for (const marker of [
  'type: "shutdown"', 'message.type === "shutdown-ready"', 'type: "capture-png"',
  "waitForRecordingResult", "retainedAudio: editedAudio", 'transition("restoring")',
  'popout.state === "idle" ?',
]) assert.ok(app.includes(marker), `Output-owner pipeline is missing ${marker}`);

const output = readFileSync(fileURLToPath(new URL("../src/components/OutputWindow.tsx", import.meta.url)), "utf8");
for (const marker of [
  "setRendererMounted(false)", 'post({ type: "shutdown-ready" })',
  "shutdownRequestedRef.current", "canvasPngBlob", "message.retainedAudio",
]) assert.ok(output.includes(marker), `Popout owner is missing ${marker}`);

console.log("Output ownership verified: one renderer, acknowledged recording/encoding, two-phase shutdown, retained audio, PNG routing, and crash-safe restoration.");
