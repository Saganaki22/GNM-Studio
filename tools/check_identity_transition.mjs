import assert from "node:assert/strict";
import {
  identityTransitionProgress,
  interpolateIdentityPositions,
} from "../src/lib/identityTransition.ts";

assert.equal(identityTransitionProgress(-1), 0, "negative elapsed time must stay at the source identity");
assert.equal(identityTransitionProgress(0), 0, "the transition must begin at the source identity");
assert.equal(identityTransitionProgress(150), 1, "the transition must finish exactly at the target identity");
assert.equal(identityTransitionProgress(1_000), 1, "late frames must remain at the target identity");
assert.ok(identityTransitionProgress(75) > 0.49 && identityTransitionProgress(75) < 0.51, "the midpoint must remain visually comparable");

const source = new Float32Array([0, 2, 4, 6, 8, 10]);
const target = new Float32Array([10, 8, 6, 4, 2, 0]);
const output = new Float32Array(source.length);
interpolateIdentityPositions(source, target, 0.5, output);
assert.deepEqual([...output], [5, 5, 5, 5, 5, 5], "identity vertices must interpolate coordinate by coordinate");
interpolateIdentityPositions(source, target, 2, output);
assert.deepEqual([...output], [...target], "progress must clamp to the exact target identity");
assert.throws(
  () => interpolateIdentityPositions(source, target.subarray(1), 0.5, output),
  /position counts do not match/,
  "mismatched topology must fail clearly",
);

console.log("GNM identity transition verified: eased endpoints, exact midpoint, clamping, and topology validation.");
