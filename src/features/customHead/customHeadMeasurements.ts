import type { Blendshape, Landmark } from "../../types";
import type { CustomHeadAnalysis, CustomHeadView } from "./customHeadTypes";

export const customHeadFeatureNames = [
  "face_width_height",
  "jaw_width",
  "chin_width",
  "eye_span",
  "eye_gap",
  "eye_width",
  "nose_width",
  "mouth_width",
  "lower_face",
  "nose_length",
  "eye_height",
  "profile_nose",
  "profile_brow",
  "profile_chin",
  "profile_lip",
  "profile_nose_lip",
] as const;

const point = (landmarks: Landmark[], index: number) => {
  const value = landmarks[index];
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(`MediaPipe did not return required face landmark ${index}.`);
  }
  return value;
};

const distance = (first: Landmark, second: Landmark) => Math.hypot(first.x - second.x, first.y - second.y);

function neutralScore(blendshapes: Blendshape[]) {
  const scores = Object.fromEntries(blendshapes.map(({ name, score }) => [name, score]));
  const smile = ((scores.mouthSmileLeft ?? 0) + (scores.mouthSmileRight ?? 0)) * 0.5;
  const activity = Math.max(
    scores.jawOpen ?? 0,
    scores.mouthPucker ?? 0,
    scores.mouthFunnel ?? 0,
    smile,
  );
  return Math.min(1, Math.max(0, 1 - activity));
}

function faceAxes(landmarks: Landmark[]) {
  const forehead = point(landmarks, 10);
  const chin = point(landmarks, 152);
  const positiveSide = point(landmarks, 234);
  const negativeSide = point(landmarks, 454);
  const nose = point(landmarks, 1);
  const height = Math.max(1e-5, distance(forehead, chin));
  const width = Math.max(1e-5, distance(positiveSide, negativeSide));
  const verticalX = (chin.x - forehead.x) / height;
  const verticalY = (chin.y - forehead.y) / height;
  let forwardX = verticalY;
  let forwardY = -verticalX;
  const reference = {
    x: (positiveSide.x + negativeSide.x) * 0.5,
    y: (positiveSide.y + negativeSide.y) * 0.5,
  };
  if ((nose.x - reference.x) * forwardX + (nose.y - reference.y) * forwardY < 0) {
    forwardX *= -1;
    forwardY *= -1;
  }
  const projectForward = (value: Landmark) => (
    (value.x - reference.x) * forwardX + (value.y - reference.y) * forwardY
  ) / height;
  return { height, width, projectForward, yawProxy: projectForward(nose) / Math.max(width / height, 1e-5) };
}

export function analyzeCustomHeadView(
  view: CustomHeadView,
  landmarks: Landmark[],
  blendshapes: Blendshape[],
): CustomHeadAnalysis {
  if (landmarks.length < 468) throw new Error("MediaPipe could not resolve a complete face mesh in this image.");
  const axes = faceAxes(landmarks);
  const ratio = (first: number, second: number, denominator = axes.width) => (
    distance(point(landmarks, first), point(landmarks, second)) / Math.max(denominator, 1e-5)
  );
  const neutral = neutralScore(blendshapes);

  if (view === "front") {
    if (Math.abs(axes.yawProxy) > 0.19) {
      throw new Error("The front image is turned too far sideways. Use a straight-on, neutral photo.");
    }
    if (neutral < 0.54) {
      throw new Error("The front image is too expressive. Relax the mouth and use a neutral face.");
    }
    return {
      landmarks,
      yawProxy: axes.yawProxy,
      neutralScore: neutral,
      measurements: [
        axes.width / axes.height,
        ratio(172, 397),
        ratio(149, 378),
        ratio(33, 263),
        ratio(133, 362),
        (ratio(33, 133) + ratio(362, 263)) * 0.5,
        ratio(98, 327),
        ratio(61, 291),
        ratio(2, 152, axes.height),
        ratio(168, 2, axes.height),
        (ratio(159, 145, axes.height) + ratio(386, 374, axes.height)) * 0.5,
      ],
    };
  }

  if (Math.abs(axes.yawProxy) < 0.17) {
    throw new Error("The side image is too frontal. Turn about 60–90° so the nose and chin profile are visible.");
  }
  if (neutral < 0.48) {
    throw new Error("The side image is too expressive. Keep the lips relaxed and the jaw closed.");
  }
  const nose = axes.projectForward(point(landmarks, 1));
  const lip = axes.projectForward(point(landmarks, 0));
  return {
    landmarks,
    yawProxy: axes.yawProxy,
    neutralScore: neutral,
    measurements: [
      nose,
      axes.projectForward(point(landmarks, 168)),
      axes.projectForward(point(landmarks, 152)),
      lip,
      nose - lip,
    ],
  };
}

