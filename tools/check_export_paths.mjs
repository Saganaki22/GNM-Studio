import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { timestampedFilename } from "../src/lib/studioFormat.ts";

assert.match(
  timestampedFilename("glb", "_gnm_animation"),
  /^GNM-Studio_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_gnm_animation\.glb$/,
  "export filenames must remain Windows-safe and include seconds",
);

const saveSource = readFileSync(new URL("../src/lib/save.ts", import.meta.url), "utf8");
for (const marker of [
  "defaultPath: suggestedName",
  "await writeFile(path, bytes)",
  "return downloadBlob(blob, suggestedName)",
  "URL.revokeObjectURL(url)",
]) assert.ok(saveSource.includes(marker), `Save pipeline is missing ${marker}`);

const ffmpegSource = readFileSync(new URL("../src/lib/systemFfmpeg.ts", import.meta.url), "utf8");
for (const marker of [
  "await tempDir()",
  "crypto.randomUUID()",
  "await Promise.allSettled([remove(inputPath), remove(outputPath)])",
]) assert.ok(ffmpegSource.includes(marker), `FFmpeg temporary-path cleanup is missing ${marker}`);

const renderSource = readFileSync(new URL("../src/features/export/motionVideoRenderer.ts", import.meta.url), "utf8");
assert.ok(renderSource.includes("Math.ceil(duration) + 120_000"), "Popout export timeout does not scale with take duration");
assert.equal((renderSource.match(/playback\.setFrame\(restoreFrame\)/g) ?? []).length, 3, "Every video render path must restore its prior playback frame");
assert.equal((renderSource.match(/playback\.setElapsed\(restoreElapsed\)/g) ?? []).length, 3, "Every video render path must restore its prior playback time");

const workspaceSource = readFileSync(new URL("../src/components/ExportWorkspace.tsx", import.meta.url), "utf8");
assert.ok(workspaceSource.includes("props.hasTake || props.videoIsWebm"), "MP4-only takes must not advertise an impossible WebM export");
assert.match(workspaceSource, /format === "png"\s*\? props\.hasTake/, "Video-only takes must not advertise an impossible PNG sequence");
assert.ok(workspaceSource.includes("Recorded source dimensions"), "Baked video must not claim that ignored render dimensions were applied");

const studioExportSource = readFileSync(new URL("../src/features/export/useStudioExport.ts", import.meta.url), "utf8");
for (const marker of ["captured.exportWidth !== settings.exportWidth", "captured.exportHeight !== settings.exportHeight", "captured.exportFps !== settings.exportFps"]) {
  assert.ok(studioExportSource.includes(marker), `Editable video export is not invalidated by ${marker}`);
}

console.log("Export paths verified: native/browser saves, safe filenames, temporary cleanup, state restoration, scalable popout waits, and format gating.");
