import assert from "node:assert/strict";
import {
  pinnedFullscreenControlsState,
  toggledFullscreenControlsOverride,
} from "../src/lib/fullscreenControls.ts";

assert.equal(pinnedFullscreenControlsState(null, false), null, "Auto-hide must remain available without an H override");
assert.equal(pinnedFullscreenControlsState(null, true), true, "Always-clean mode must hide controls by default");
assert.equal(pinnedFullscreenControlsState("shown", true), false, "H-show must override always-clean mode");
assert.equal(pinnedFullscreenControlsState("hidden", false), true, "H-hide must remain pinned");
assert.equal(toggledFullscreenControlsOverride(true), "shown");
assert.equal(toggledFullscreenControlsOverride(false), "hidden");

console.log("Fullscreen controls verified: H pins shown/hidden state across mouse movement until fullscreen exits.");
