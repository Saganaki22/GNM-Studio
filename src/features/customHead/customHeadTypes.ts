import type { Landmark } from "../../types";

export type CustomHeadView = "front" | "profile";
export type CustomHeadBackend = "webgpu" | "wasm" | "unavailable";

export type CustomHeadImage = {
  blob: Blob;
  url: string;
  name: string;
  width: number;
  height: number;
  source: "upload" | "camera";
};

export type CustomHeadProgress = {
  stage: "landmarks" | "model" | "features" | "fitting";
  message: string;
  percent: number | null;
};

export type CustomHeadAnalysis = {
  landmarks: Landmark[];
  measurements: number[];
  yawProxy: number;
  neutralScore: number;
};

export type CustomHeadFitResult = {
  weights: Float32Array;
  backend: CustomHeadBackend;
  consistency: number | null;
  warnings: string[];
  frontYaw: number;
  profileYaw: number | null;
};
