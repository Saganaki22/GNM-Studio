import { semanticExpressionNames } from "./retarget";
import type { AvatarKind } from "../types";

export const facecapBlendshapeMap = {
  browDownLeft: "browDown_L",
  browDownRight: "browDown_R",
  browInnerUp: "browInnerUp",
  browOuterUpLeft: "browOuterUp_L",
  browOuterUpRight: "browOuterUp_R",
  cheekPuff: "cheekPuff",
  cheekSquintLeft: "cheekSquint_L",
  cheekSquintRight: "cheekSquint_R",
  eyeBlinkLeft: "eyeBlink_L",
  eyeBlinkRight: "eyeBlink_R",
  eyeLookDownLeft: "eyeLookDown_L",
  eyeLookDownRight: "eyeLookDown_R",
  eyeLookInLeft: "eyeLookIn_L",
  eyeLookInRight: "eyeLookIn_R",
  eyeLookOutLeft: "eyeLookOut_L",
  eyeLookOutRight: "eyeLookOut_R",
  eyeLookUpLeft: "eyeLookUp_L",
  eyeLookUpRight: "eyeLookUp_R",
  eyeSquintLeft: "eyeSquint_L",
  eyeSquintRight: "eyeSquint_R",
  eyeWideLeft: "eyeWide_L",
  eyeWideRight: "eyeWide_R",
  jawForward: "jawForward",
  jawLeft: "jawLeft",
  jawOpen: "jawOpen",
  jawRight: "jawRight",
  mouthClose: "mouthClose",
  mouthDimpleLeft: "mouthDimple_L",
  mouthDimpleRight: "mouthDimple_R",
  mouthFrownLeft: "mouthFrown_L",
  mouthFrownRight: "mouthFrown_R",
  mouthFunnel: "mouthFunnel",
  mouthLeft: "mouthLeft",
  mouthLowerDownLeft: "mouthLowerDown_L",
  mouthLowerDownRight: "mouthLowerDown_R",
  mouthPressLeft: "mouthPress_L",
  mouthPressRight: "mouthPress_R",
  mouthPucker: "mouthPucker",
  mouthRight: "mouthRight",
  mouthRollLower: "mouthRollLower",
  mouthRollUpper: "mouthRollUpper",
  mouthShrugLower: "mouthShrugLower",
  mouthShrugUpper: "mouthShrugUpper",
  mouthSmileLeft: "mouthSmile_L",
  mouthSmileRight: "mouthSmile_R",
  mouthStretchLeft: "mouthStretch_L",
  mouthStretchRight: "mouthStretch_R",
  mouthUpperUpLeft: "mouthUpperUp_L",
  mouthUpperUpRight: "mouthUpperUp_R",
  noseSneerLeft: "noseSneer_L",
  noseSneerRight: "noseSneer_R",
  tongueOut: "tongueOut",
} as const;

export const facecapTargetNames = [
  "browInnerUp", "browDown_L", "browDown_R", "browOuterUp_L", "browOuterUp_R",
  "eyeLookUp_L", "eyeLookUp_R", "eyeLookDown_L", "eyeLookDown_R", "eyeLookIn_L",
  "eyeLookIn_R", "eyeLookOut_L", "eyeLookOut_R", "eyeBlink_L", "eyeBlink_R",
  "eyeSquint_L", "eyeSquint_R", "eyeWide_L", "eyeWide_R", "cheekPuff",
  "cheekSquint_L", "cheekSquint_R", "noseSneer_L", "noseSneer_R", "jawOpen",
  "jawForward", "jawLeft", "jawRight", "mouthFunnel", "mouthPucker", "mouthLeft",
  "mouthRight", "mouthRollUpper", "mouthRollLower", "mouthShrugUpper", "mouthShrugLower",
  "mouthClose", "mouthSmile_L", "mouthSmile_R", "mouthFrown_L", "mouthFrown_R",
  "mouthDimple_L", "mouthDimple_R", "mouthUpperUp_L", "mouthUpperUp_R",
  "mouthLowerDown_L", "mouthLowerDown_R", "mouthPress_L", "mouthPress_R",
  "mouthStretch_L", "mouthStretch_R", "tongueOut",
] as const;

export const facecapControlGroups = [
  { label: "Eyes and gaze", names: facecapTargetNames.filter((name) => name.startsWith("eye")) },
  { label: "Brows", names: facecapTargetNames.filter((name) => name.startsWith("brow")) },
  { label: "Cheeks and nose", names: facecapTargetNames.filter((name) => name.startsWith("cheek") || name.startsWith("nose")) },
  { label: "Jaw", names: facecapTargetNames.filter((name) => name.startsWith("jaw")) },
  { label: "Mouth", names: facecapTargetNames.filter((name) => name.startsWith("mouth")) },
  { label: "Tongue", names: facecapTargetNames.filter((name) => name.startsWith("tongue")) },
] as const;

export type AvatarProfile = {
  kind: AvatarKind;
  label: string;
  shortLabel: string;
  asset: string;
  supportsIdentity: boolean;
  expressionCount: number;
  expressionNames: readonly string[];
};

export const avatarProfiles: Record<AvatarKind, AvatarProfile> = {
  gnm: {
    kind: "gnm",
    label: "GNM Head v3",
    shortLabel: "GNM",
    asset: "models/gnm_head_runtime.glb",
    supportsIdentity: true,
    expressionCount: semanticExpressionNames.length,
    expressionNames: semanticExpressionNames,
  },
  facecap: {
    kind: "facecap",
    label: "FaceCap 52",
    shortLabel: "FaceCap",
    asset: "models/facecap.glb",
    supportsIdentity: false,
    expressionCount: facecapTargetNames.length,
    expressionNames: facecapTargetNames,
  },
};

export function facecapInfluences(blendshapes: Record<string, number>) {
  const result: Record<string, number> = {};
  for (const [source, target] of Object.entries(facecapBlendshapeMap)) {
    result[target] = Math.min(1, Math.max(0, blendshapes[source] ?? 0));
  }
  return result;
}
