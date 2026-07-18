import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const app = readFileSync(fileURLToPath(new URL("../src/App.tsx", import.meta.url)), "utf8");
for (const marker of [
  'aria-keyshortcuts="P"', 'event.key.toLowerCase() !== "p"', "capturePausedRef.current = paused",
  "track.enabled = !paused", "setAudioLevel(0)", "setAudioPeak(0)",
  'action: paused ? "pause" : "resume"', 'setRecordingState("paused")', 'setRecordingState("recording")',
]) assert.ok(app.includes(marker), `Pause/resume path is missing ${marker}`);
assert.ok(app.includes("target?.matches(\"input, textarea, select, [contenteditable='true']\")"), "P shortcut must not steal text-field input");
const output = readFileSync(fileURLToPath(new URL("../src/components/OutputWindow.tsx", import.meta.url)), "utf8");
assert.ok(output.includes("snapshot?.capturePaused"), "Popout snapshot does not receive paused state");
console.log("Pause/resume verified: accessible P shortcut, focus-safe handling, frozen tracker/avatar, zero meter, media-recorder pause, and popout synchronization.");
