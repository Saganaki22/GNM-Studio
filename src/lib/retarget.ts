export const semanticExpressionNames = [
  "surprise", "disgust", "suck", "compress_face", "stretch_face",
  "happy", "squint", "platysma", "blow", "funneler", "smile_wide",
  "corners_down", "pucker", "wink_left", "wink_right", "mouth_left",
  "mouth_right", "lips_roll_in", "snarl", "tongue_center",
] as const;

const clamp01 = (score: number) => Math.min(1, Math.max(0, score));

export function mouthOpenInfluence(blendshapes: Record<string, number>) {
  const average = (...names: string[]) => names.reduce((sum, name) => sum + (blendshapes[name] ?? 0), 0) / names.length;
  const jawOpen = Math.max(0, blendshapes.jawOpen ?? 0);
  const lipSeparation = Math.max(
    average("mouthLowerDownLeft", "mouthLowerDownRight") * 0.9,
    average("mouthUpperUpLeft", "mouthUpperUpRight") * 0.7,
  );
  const mouthClose = blendshapes.mouthClose ?? 0;
  const mouthOpenRaw = Math.max(jawOpen, lipSeparation) * (1 - clamp01(mouthClose) * 0.55);
  return Math.pow(clamp01((mouthOpenRaw - 0.025) / 0.675), 0.58);
}

export function semanticInfluences(blendshapes: Record<string, number>) {
  const value = (...names: string[]) => Math.max(0, ...names.map((name) => blendshapes[name] ?? 0));
  const average = (...names: string[]) => names.reduce((sum, name) => sum + (blendshapes[name] ?? 0), 0) / names.length;
  // GNM exposes a semantic "surprise" target rather than a dedicated ARKit
  // jawOpen target. MediaPipe jawOpen usually tops out below 1, so use a
  // responsive curve that gives visible separation early and reaches the full
  // GNM mouth opening when the user's jaw is wide open.
  const mouthOpen = mouthOpenInfluence(blendshapes);
  const upperFaceSurprise = Math.max(
    (blendshapes.browInnerUp ?? 0) * 0.7,
    average("eyeWideLeft", "eyeWideRight") * 0.62,
  );
  return {
    surprise: clamp01(Math.max(mouthOpen, upperFaceSurprise)),
    disgust: value("noseSneerLeft", "noseSneerRight", "mouthFrownLeft", "mouthFrownRight"),
    suck: value("mouthFunnel", "mouthPucker") * 0.75,
    compress_face: value("eyeSquintLeft", "eyeSquintRight", "mouthPressLeft", "mouthPressRight"),
    stretch_face: value("mouthStretchLeft", "mouthStretchRight"),
    happy: Math.min(1, average("mouthSmileLeft", "mouthSmileRight") + average("cheekSquintLeft", "cheekSquintRight") * 0.35),
    squint: value("eyeSquintLeft", "eyeSquintRight"),
    platysma: average("mouthFrownLeft", "mouthFrownRight", "jawOpen") * 0.45,
    blow: blendshapes.cheekPuff ?? 0,
    funneler: blendshapes.mouthFunnel ?? 0,
    smile_wide: Math.min(1, average("mouthSmileLeft", "mouthSmileRight") + average("mouthStretchLeft", "mouthStretchRight") * 0.4),
    corners_down: average("mouthFrownLeft", "mouthFrownRight"),
    pucker: blendshapes.mouthPucker ?? 0,
    wink_left: blendshapes.eyeBlinkLeft ?? 0,
    wink_right: blendshapes.eyeBlinkRight ?? 0,
    mouth_left: blendshapes.mouthLeft ?? 0,
    mouth_right: blendshapes.mouthRight ?? 0,
    lips_roll_in: average("mouthRollLower", "mouthRollUpper"),
    snarl: value("noseSneerLeft", "noseSneerRight"),
    tongue_center: 0,
  } satisfies Record<(typeof semanticExpressionNames)[number], number>;
}
