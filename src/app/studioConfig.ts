import type { CSSProperties } from "react";
import { assetUrl } from "../lib/assets";
import type { AppSettings } from "../types";

export const isDesktopRuntime = "__TAURI_INTERNALS__" in window;
export const isWebEdition = __GNM_WEB_BUILD__ || !isDesktopRuntime;
export const brandHeadIconStyle: CSSProperties = {
  WebkitMask: `url("${assetUrl("head-svgrepo-com.svg")}") center / contain no-repeat`,
  mask: `url("${assetUrl("head-svgrepo-com.svg")}") center / contain no-repeat`,
};

export const initialSettings: AppSettings = {
  avatarKind: "gnm",
  cameraId: "", microphoneId: "", cameraFps: 30, trackingFps: 30, trackingSmoothingEnabled: true, trackingSmoothing: 0.72, motionSmoothingEnabled: true, motionSmoothing: 0.35, mouthDeadZone: 0.16, trackingBackend: "auto",
  exportFps: 30, exportWidth: 1920, exportHeight: 1080, videoBitrateMbps: 12, audioBitrateKbps: 192, videoEncoderBackend: isDesktopRuntime ? "auto" : "webcodecs", ffmpegPath: "ffmpeg", showWebcam: true, showAvatar: true, showLandmarks: false,
  mirror: true, muted: false, avatarOpacity: 0.92, wireframe: false,
  skinTextureEnabled: false, skinTone: "light", skinTextureScale: 8, skinTextureRotation: 0, skinTextureFeather: 0.12,
  eyeShaderEnabled: true, eyeColor: "green",
  backgroundMode: "studio", backgroundColor: "#101820", backgroundImageZoom: 1,
  mouseLightEnabled: true, mouseLightIntensity: 1,
  headRotationEnabled: true, headYawStrength: 1, headPitchStrength: 1, headRollStrength: 1, headRotationDeadZone: 1.5, headRotationSmoothing: 0.35,
  outputAutoHideEnabled: true, outputAutoHideDelay: 2.5, outputAlwaysHideControls: false,
  recordingMode: "motion",
};

export const repositoryUrl = "https://github.com/Saganaki22/GNM-Studio";
export const releasesUrl = `${repositoryUrl}/releases`;
export const settingsStorageVersion = 3;
export const accentOptions = ["teal", "blue", "green", "red", "yellow"] as const;
export type AccentOption = (typeof accentOptions)[number];
export type Workspace = "capture" | "create" | "edit" | "export";
export type BackendProbe = { available: boolean | null; reason: string };
export type FfmpegProbe = { available: boolean; version?: string; error?: string };

export const manualJointGroups = [
  { label: "Neck", controls: [["joint_neck_pitch", "Pitch"], ["joint_neck_yaw", "Yaw"], ["joint_neck_roll", "Roll"]], unit: "°" as const },
  { label: "Head", controls: [["joint_head_pitch", "Pitch"], ["joint_head_yaw", "Yaw"], ["joint_head_roll", "Roll"]], unit: "°" as const },
  { label: "Left eye", controls: [["joint_left_eye_pitch", "Pitch"], ["joint_left_eye_yaw", "Yaw"]], unit: "°" as const },
  { label: "Right eye", controls: [["joint_right_eye_pitch", "Pitch"], ["joint_right_eye_yaw", "Yaw"]], unit: "°" as const },
  { label: "XYZ translation", controls: [["joint_translate_x", "X"], ["joint_translate_y", "Y"], ["joint_translate_z", "Z"]], unit: "%" as const },
] as const;
