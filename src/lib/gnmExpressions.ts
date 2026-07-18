export const gnmExpressionComponentCount = 383;

export type GnmExpressionRegion = "left_eye" | "right_eye" | "lower_face" | "tongue" | "iris";

export const gnmExpressionRegions: ReadonlyArray<{
  id: GnmExpressionRegion;
  label: string;
  start: number;
  end: number;
}> = [
  { id: "left_eye", label: "Left eye", start: 0, end: 100 },
  { id: "right_eye", label: "Right eye", start: 100, end: 200 },
  { id: "lower_face", label: "Lower face", start: 200, end: 350 },
  { id: "tongue", label: "Tongue", start: 350, end: 382 },
  { id: "iris", label: "Iris / pupils", start: 382, end: 383 },
] as const;

export function gnmExpressionComponentName(index: number) {
  if (index >= 0 && index < 100) return `left_eye_region_${String(index).padStart(3, "0")}`;
  if (index >= 100 && index < 200) return `right_eye_region_${String(index - 100).padStart(3, "0")}`;
  if (index >= 200 && index < 350) return `lower_face_region_${String(index - 200).padStart(3, "0")}`;
  if (index === 350) return "tongue_mean";
  if (index > 350 && index < 382) return `tongue_${String(index - 351).padStart(3, "0")}`;
  if (index === 382) return "pupils_000";
  throw new Error(`GNM expression component ${index} is out of range.`);
}

export function blendGnmExpressions(a: Float32Array, b: Float32Array, amount: number) {
  if (a.length !== gnmExpressionComponentCount || b.length !== gnmExpressionComponentCount) {
    throw new Error("GNM expression endpoint size mismatch.");
  }
  const t = Math.min(1, Math.max(0, amount));
  const result = new Float32Array(gnmExpressionComponentCount);
  for (let index = 0; index < result.length; index += 1) result[index] = a[index] + (b[index] - a[index]) * t;
  return result;
}

export function mirrorGnmEyeRegion(weights: Float32Array, direction: "left-to-right" | "right-to-left") {
  if (weights.length !== gnmExpressionComponentCount) throw new Error("GNM expression state size mismatch.");
  const result = weights.slice();
  const source = direction === "left-to-right" ? 0 : 100;
  const target = direction === "left-to-right" ? 100 : 0;
  for (let index = 0; index < 100; index += 1) result[target + index] = weights[source + index];
  return result;
}

export function nonZeroExpressionComponentCount(weights: Float32Array, epsilon = 1e-5) {
  let count = 0;
  for (const value of weights) if (Math.abs(value) > epsilon) count += 1;
  return count;
}

export function applyFrozenGnmExpressionComponents(weights: Float32Array, frozen: Record<number, number>) {
  const result = weights.slice();
  for (const [rawIndex, value] of Object.entries(frozen)) {
    const index = Number(rawIndex);
    if (Number.isInteger(index) && index >= 0 && index < result.length && Number.isFinite(value)) result[index] = value;
  }
  return result;
}
