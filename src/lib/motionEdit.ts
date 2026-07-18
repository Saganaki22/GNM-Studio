import type { AvatarMotionSample, RecordedFrame } from "../types";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function nlerpQuaternion(a: readonly number[], b: readonly number[], t: number): [number, number, number, number] {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  dot = Math.abs(dot);
  const value = [
    lerp(a[0], b[0] * sign, t),
    lerp(a[1], b[1] * sign, t),
    lerp(a[2], b[2] * sign, t),
    lerp(a[3], b[3] * sign, t),
  ];
  const length = Math.hypot(...value) || 1;
  return value.map((entry) => entry / length) as [number, number, number, number];
}

function interpolateAvatarMotion(a: AvatarMotionSample | undefined, b: AvatarMotionSample | undefined, t: number): AvatarMotionSample | undefined {
  if (!a && !b) return undefined;
  const left = a ?? b!;
  const right = b ?? a!;
  return {
    centerX: lerp(left.centerX, right.centerX, t),
    centerY: lerp(left.centerY, right.centerY, t),
    faceHeight: lerp(left.faceHeight, right.faceHeight, t),
    position: lerpOptionalTuple(left.position, right.position, t, 3) as [number, number, number] | undefined,
    scale: lerpOptionalTuple(left.scale, right.scale, t, 3) as [number, number, number] | undefined,
    quaternion: nlerpQuaternion(left.quaternion, right.quaternion, t),
  };
}

function lerpOptionalTuple(a: readonly number[] | undefined, b: readonly number[] | undefined, t: number, length: number) {
  if (!a && !b) return undefined;
  const left = a ?? b!;
  const right = b ?? a!;
  return Array.from({ length }, (_, index) => lerp(left[index], right[index], t));
}

export function interpolateRecordedFrame(frames: RecordedFrame[], sourceTimestamp: number): RecordedFrame {
  if (!frames.length) throw new Error("Cannot interpolate an empty motion take.");
  if (frames.length === 1 || sourceTimestamp <= frames[0].timestamp) return { ...frames[0], timestamp: sourceTimestamp };
  const last = frames.at(-1)!;
  if (sourceTimestamp >= last.timestamp) return { ...last, timestamp: sourceTimestamp };
  let low = 0;
  let high = frames.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (frames[middle].timestamp <= sourceTimestamp) low = middle;
    else high = middle;
  }
  const left = frames[low];
  const right = frames[high];
  const t = clamp((sourceTimestamp - left.timestamp) / Math.max(1e-6, right.timestamp - left.timestamp), 0, 1);
  const names = new Set([...Object.keys(left.blendshapes), ...Object.keys(right.blendshapes)]);
  const blendshapes: Record<string, number> = {};
  for (const name of names) blendshapes[name] = lerp(left.blendshapes[name] ?? 0, right.blendshapes[name] ?? 0, t);
  return {
    timestamp: sourceTimestamp,
    blendshapes,
    matrix: Array.from({ length: 16 }, (_, index) => lerp(left.matrix[index] ?? 0, right.matrix[index] ?? 0, t)),
    avatarMotion: interpolateAvatarMotion(left.avatarMotion, right.avatarMotion, t),
    mouthOpen: left.mouthOpen === undefined && right.mouthOpen === undefined
      ? undefined
      : lerp(left.mouthOpen ?? right.mouthOpen ?? 0, right.mouthOpen ?? left.mouthOpen ?? 0, t),
  };
}

export function trimAndRetimeMotion(
  frames: RecordedFrame[],
  trimStartMs: number,
  trimEndMs: number,
  speed: number,
  outputFps: number,
) {
  if (!frames.length) return [];
  const sourceEnd = frames.at(-1)!.timestamp;
  const start = clamp(trimStartMs, 0, sourceEnd);
  const end = clamp(trimEndMs || sourceEnd, start, sourceEnd);
  const rate = clamp(speed, 0.1, 4);
  const fps = clamp(Math.round(outputFps), 1, 120);
  const outputDuration = (end - start) / rate;
  const interval = 1_000 / fps;
  const count = Math.max(1, Math.floor(outputDuration / interval) + 1);
  const result = Array.from({ length: count }, (_, index) => {
    const outputTimestamp = Math.min(outputDuration, index * interval);
    const frame = interpolateRecordedFrame(frames, start + outputTimestamp * rate);
    frame.timestamp = outputTimestamp;
    return frame;
  });
  if (result.at(-1)!.timestamp < outputDuration - 0.01) {
    const frame = interpolateRecordedFrame(frames, end);
    frame.timestamp = outputDuration;
    result.push(frame);
  }
  return result;
}
