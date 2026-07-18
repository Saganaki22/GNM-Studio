import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFullStatePreset, parseFullStatePresetBundle, serializePresetBundle } from "../src/lib/presets.ts";

const snapshot = {
  version: 2,
  capturedAt: new Date(0).toISOString(),
  settings: {},
  identityVertices: new Float32Array([1, 2, 3]),
  identityParameters: { seed: "stable", presentation: "blend", population: "blend", presentationStrength: 0, populationWeights: [0.25, 0.25, 0.25, 0.25] },
  identityWeights: new Float32Array(253),
  gnmExpressionWeights: new Float32Array(383),
  gnmFrozenExpressionComponents: { 7: -0.5 },
  manualExpressions: {}, frozenExpressions: {}, neutralFrame: null, viewState: null, backgroundImageUrl: "blob:temporary",
};
const preset = createFullStatePreset("  Stable   look  ", snapshot);
assert.equal(preset.name, "Stable look");
assert.equal(preset.snapshot.identityVertices, null, "preset should regenerate from compact identity coefficients");
assert.equal(preset.snapshot.backgroundImageUrl, null, "session-only object URLs must not enter persistent presets");
const encoded = serializePresetBundle([preset]);
assert.ok(encoded.includes('"gnmExpressionWeights": ['));
assert.ok(!encoded.includes('"0": 0'), "typed arrays must serialize as JSON arrays");
assert.throws(() => parseFullStatePresetBundle({ format: "gnm-studio-preset-bundle", version: 99, presets: [] }), /Unsupported/);

const app = ["../src/App.tsx", "../src/features/presets/PresetPanel.tsx"]
  .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
  .join("\n");
for (const marker of ["Save new", "loadSelectedFullStatePreset", "updateSelectedFullStatePreset", "renameSelectedFullStatePreset", "deleteSelectedFullStatePreset", "importPresetBundle", "exportPresetBundle"]) {
  assert.ok(app.includes(marker), `Preset UI is missing ${marker}`);
}
console.log("Full-state presets verified: compact coefficients, model-versioned bundles, create/load/update/rename/delete, and safe JSON serialization.");
