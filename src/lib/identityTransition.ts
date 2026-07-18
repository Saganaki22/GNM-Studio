const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** A short smoothstep shows proportion changes without making identity generation feel sluggish. */
export function identityTransitionProgress(elapsedMs: number, durationMs = 150) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  const linear = clamp01(elapsedMs / durationMs);
  return linear * linear * (3 - 2 * linear);
}

export function interpolateIdentityPositions(
  from: ArrayLike<number>,
  to: ArrayLike<number>,
  progress: number,
  output: Float32Array,
) {
  if (from.length !== to.length || output.length !== to.length) {
    throw new Error("GNM identity transition position counts do not match.");
  }
  const amount = clamp01(progress);
  const inverse = 1 - amount;
  for (let index = 0; index < output.length; index += 1) {
    output[index] = from[index] * inverse + to[index] * amount;
  }
  return output;
}
