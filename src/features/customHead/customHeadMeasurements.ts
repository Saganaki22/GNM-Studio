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

type MetricPoint = { x: number; y: number; z: number };

const metricPoint = (value: Landmark, imageAspect: number): MetricPoint => ({
  // MediaPipe x/y are normalized independently by image width/height, while z
  // uses approximately the same scale as x. Work in image-height units so a
  // portrait phone photo and a square crop produce the same proportions.
  x: value.x * imageAspect,
  y: value.y,
  z: value.z * imageAspect,
});

const distance = (first: MetricPoint, second: MetricPoint) => Math.hypot(first.x - second.x, first.y - second.y);

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

function faceAxes(landmarks: Landmark[], imageAspect: number) {
  const metric = (index: number) => metricPoint(point(landmarks, index), imageAspect);
  const forehead = metric(10);
  const chin = metric(152);
  const positiveSide = metric(234);
  const negativeSide = metric(454);
  const nose = metric(1);
  const height = Math.max(1e-5, distance(forehead, chin));
  const width = Math.max(1e-5, distance(positiveSide, negativeSide));
  const verticalX = (chin.x - forehead.x) / height;
  const verticalY = (chin.y - forehead.y) / height;
  let forwardX = verticalY;
  let forwardY = -verticalX;
  const reference = {
    x: (positiveSide.x + negativeSide.x) * 0.5,
    y: (positiveSide.y + negativeSide.y) * 0.5,
    z: (positiveSide.z + negativeSide.z) * 0.5,
  };
  if ((nose.x - reference.x) * forwardX + (nose.y - reference.y) * forwardY < 0) {
    forwardX *= -1;
    forwardY *= -1;
  }
  const projectTurn = (value: MetricPoint) => (
    (value.x - reference.x) * forwardX + (value.y - reference.y) * forwardY
  ) / height;
  // MediaPipe depth is negative toward the camera. Measuring from the temple
  // plane gives the same nose/lip/chin projection semantics as the GNM anchors.
  const projectDepth = (value: MetricPoint) => (reference.z - value.z) / height;
  return {
    height,
    width,
    metric,
    projectDepth,
    yawProxy: projectTurn(nose) / Math.max(width / height, 1e-5),
  };
}

export function analyzeCustomHeadView(
  view: CustomHeadView,
  landmarks: Landmark[],
  blendshapes: Blendshape[],
  imageAspect = 1,
): CustomHeadAnalysis {
  if (landmarks.length < 468) throw new Error("MediaPipe could not resolve a complete face mesh in this image.");
  if (!Number.isFinite(imageAspect) || imageAspect <= 0) throw new Error("The source image has an invalid aspect ratio.");
  const axes = faceAxes(landmarks, imageAspect);
  const ratio = (first: number, second: number, denominator = axes.width) => (
    distance(axes.metric(first), axes.metric(second)) / Math.max(denominator, 1e-5)
  );
  const depthMeasurements = () => {
    const nose = axes.projectDepth(axes.metric(1));
    const lip = axes.projectDepth(axes.metric(0));
    return [
      nose,
      axes.projectDepth(axes.metric(168)),
      axes.projectDepth(axes.metric(152)),
      lip,
      nose - lip,
    ];
  };
  const neutral = neutralScore(blendshapes);

  if (view === "front") {
    if (Math.abs(axes.yawProxy) > 0.19) {
      throw new Error("The front image is turned too far sideways. Use a straight-on, neutral photo.");
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
        ...depthMeasurements(),
      ],
    };
  }

  if (Math.abs(axes.yawProxy) < 0.1) {
    throw new Error("The three-quarter image is too frontal. Turn about 45–60° so both eyes and the nose profile remain visible.");
  }
  return {
    landmarks,
    yawProxy: axes.yawProxy,
    neutralScore: neutral,
    measurements: depthMeasurements(),
  };
}
