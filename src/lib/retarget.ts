export const semanticExpressionNames = [
  "surprise", "disgust", "suck", "compress_face", "stretch_face",
  "happy", "squint", "platysma", "blow", "funneler", "smile_wide",
  "corners_down", "pucker", "wink_left", "wink_right", "mouth_left",
  "mouth_right", "lips_roll_in", "snarl", "tongue_center",
] as const;

const clamp01 = (score: number) => Math.min(1, Math.max(0, score));

type MouthLandmark = { x: number; y: number; z?: number };

function distance(first: MouthLandmark | undefined, second: MouthLandmark | undefined) {
  if (!first || !second) return null;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function smoothstep(value: number) {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

export function mouthOpenInfluence(
  blendshapes: Record<string, number>,
  landmarks?: MouthLandmark[],
  neutralBlendshapes?: Record<string, number>,
  neutralLandmarks?: MouthLandmark[],
  deadZone = 0.16,
) {
  const average = (...names: string[]) => names.reduce((sum, name) => sum + (blendshapes[name] ?? 0), 0) / names.length;
  const neutralAverage = (...names: string[]) => names.reduce((sum, name) => sum + (neutralBlendshapes?.[name] ?? 0), 0) / names.length;
  const jawOpen = Math.max(0, blendshapes.jawOpen ?? 0);
  const lipSeparation = Math.max(
    average("mouthLowerDownLeft", "mouthLowerDownRight") * 0.9,
    average("mouthUpperUpLeft", "mouthUpperUpRight") * 0.7,
  );
  const mouthClose = blendshapes.mouthClose ?? 0;
  const mouthOpenRaw = Math.max(jawOpen, lipSeparation) * (1 - clamp01(mouthClose) * 0.55);
  const neutralJawOpen = Math.max(0, neutralBlendshapes?.jawOpen ?? 0);
  const neutralLipSeparation = Math.max(
    neutralAverage("mouthLowerDownLeft", "mouthLowerDownRight") * 0.9,
    neutralAverage("mouthUpperUpLeft", "mouthUpperUpRight") * 0.7,
  );
  const neutralClose = neutralBlendshapes?.mouthClose ?? 0;
  const neutralRaw = Math.max(neutralJawOpen, neutralLipSeparation) * (1 - clamp01(neutralClose) * 0.55);
  const normalizedDeadZone = clamp01(deadZone);
  const scoreThreshold = 0.055 + normalizedDeadZone * 0.12;
  const scoreOpening = smoothstep((Math.max(0, mouthOpenRaw - neutralRaw) - scoreThreshold) / 0.52);

  const innerLipDistance = distance(landmarks?.[13], landmarks?.[14]);
  const mouthWidth = distance(landmarks?.[78], landmarks?.[308]);
  if (innerLipDistance === null || mouthWidth === null || mouthWidth < 1e-5) return scoreOpening;
  const aperture = innerLipDistance / mouthWidth;
  const neutralInnerLipDistance = distance(neutralLandmarks?.[13], neutralLandmarks?.[14]);
  const neutralMouthWidth = distance(neutralLandmarks?.[78], neutralLandmarks?.[308]);
  const neutralAperture = neutralInnerLipDistance !== null && neutralMouthWidth !== null && neutralMouthWidth > 1e-5
    ? neutralInnerLipDistance / neutralMouthWidth
    : 0.055;
  const apertureThreshold = 0.008 + normalizedDeadZone * 0.045;
  const apertureOpening = smoothstep((Math.max(0, aperture - neutralAperture) - apertureThreshold) / 0.34);
  // Landmark aperture confirms that the lips are physically separating. Keep
  // a little headroom for delegates whose mouth landmarks under-report depth.
  return Math.min(clamp01(scoreOpening * 1.12), clamp01(apertureOpening * 1.25));
}

export class MouthOpenGate {
  private value = 0;
  private open = false;
  private candidateSince: number | null = null;
  private closeSince: number | null = null;
  private lastTimestamp: number | null = null;

  reset() {
    this.value = 0;
    this.open = false;
    this.candidateSince = null;
    this.closeSince = null;
    this.lastTimestamp = null;
  }

  update(frame: { timestamp: number; blendshapes: { name: string; score: number }[]; landmarks?: MouthLandmark[] }, neutral: typeof frame | null, deadZone = 0.16) {
    const scores = Object.fromEntries(frame.blendshapes.map(({ name, score }) => [name, score]));
    const neutralScores = neutral
      ? Object.fromEntries(neutral.blendshapes.map(({ name, score }) => [name, score]))
      : undefined;
    const target = mouthOpenInfluence(scores, frame.landmarks, neutralScores, neutral?.landmarks, deadZone);
    const timestamp = frame.timestamp;
    if (!this.open) {
      if (target >= 0.055) {
        this.candidateSince ??= timestamp;
        if (timestamp - this.candidateSince >= 34) {
          this.open = true;
          this.closeSince = null;
        }
      } else {
        this.candidateSince = null;
      }
    } else if (target <= 0.022) {
      this.closeSince ??= timestamp;
      if (timestamp - this.closeSince >= 50) {
        this.open = false;
        this.candidateSince = null;
      }
    } else {
      this.closeSince = null;
    }

    const gatedTarget = this.open ? target : 0;
    const elapsed = this.lastTimestamp === null ? 33 : Math.min(100, Math.max(1, timestamp - this.lastTimestamp));
    this.lastTimestamp = timestamp;
    const timeConstant = gatedTarget > this.value ? 42 : 68;
    const alpha = 1 - Math.exp(-elapsed / timeConstant);
    this.value += (gatedTarget - this.value) * alpha;
    if (!this.open && this.value < 0.006) this.value = 0;
    return clamp01(this.value);
  }
}

export function semanticInfluences(blendshapes: Record<string, number>) {
  const value = (...names: string[]) => Math.max(0, ...names.map((name) => blendshapes[name] ?? 0));
  const average = (...names: string[]) => names.reduce((sum, name) => sum + (blendshapes[name] ?? 0), 0) / names.length;
  const upperFaceSurprise = Math.max(
    (blendshapes.browInnerUp ?? 0) * 0.7,
    average("eyeWideLeft", "eyeWideRight") * 0.62,
  );
  return {
    surprise: clamp01(upperFaceSurprise),
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
