export type Landmark = { x: number; y: number; z: number };

export type AvatarMotionSample = {
  /** Display-space values after camera cover-cropping and mirroring. */
  centerX: number;
  centerY: number;
  faceHeight: number;
  /** Neutral-relative scene translation, including camera-depth Z. */
  position?: [number, number, number];
  /** Neutral-relative uniform scale for editable 3D export. */
  scale?: [number, number, number];
  /** The exact smoothed head pose shown by the live Stage. */
  quaternion: [number, number, number, number];
};

export type CameraViewState = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  zoom: number;
};

export type Blendshape = {
  name: string;
  score: number;
};

export type TrackingFrame = {
  timestamp: number;
  landmarks: Landmark[];
  poseLandmarks?: Landmark[];
  blendshapes: Blendshape[];
  matrix: number[];
  avatarMotion?: AvatarMotionSample;
};

export type FaceAlignment = {
  status: "missing" | "adjust" | "ready";
  message: string;
  centerX?: number;
  centerY?: number;
  sizeRatio?: number;
};

export type RecordedFrame = {
  timestamp: number;
  blendshapes: Record<string, number>;
  matrix: number[];
  avatarMotion?: AvatarMotionSample;
};

export type IdentityVertices = number[][] | Float32Array;

export type DeviceOption = {
  id: string;
  label: string;
};

export type RecordingMode = "motion" | "avatar" | "composite";
export type AvatarKind = "gnm" | "facecap";
export type BackgroundMode = "studio" | "solid" | "image" | "transparent";
export type TrackingBackend = "auto" | "gpu" | "cpu";
export type VideoEncoderBackend = "auto" | "webcodecs" | "ffmpeg";
export type SkinTone = "neutral" | "light" | "warm" | "medium" | "deep" | "rich";

export type SkinMaterialSettings = {
  enabled: boolean;
  tone: SkinTone;
  scale: number;
  rotation: number;
  feather: number;
};

export type HeadPoseSettings = {
  enabled: boolean;
  yawStrength: number;
  pitchStrength: number;
  rollStrength: number;
  deadZone: number;
  smoothing: number;
};

export type AppSettings = {
  avatarKind: AvatarKind;
  cameraId: string;
  microphoneId: string;
  cameraFps: number;
  trackingFps: number;
  trackingSmoothingEnabled: boolean;
  trackingSmoothing: number;
  motionSmoothingEnabled: boolean;
  motionSmoothing: number;
  trackingBackend: TrackingBackend;
  exportFps: number;
  videoBitrateMbps: number;
  audioBitrateKbps: number;
  videoEncoderBackend: VideoEncoderBackend;
  ffmpegPath: string;
  showWebcam: boolean;
  showAvatar: boolean;
  showLandmarks: boolean;
  mirror: boolean;
  muted: boolean;
  avatarOpacity: number;
  wireframe: boolean;
  skinTextureEnabled: boolean;
  skinTone: SkinTone;
  skinTextureScale: number;
  skinTextureRotation: number;
  skinTextureFeather: number;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  backgroundImageZoom: number;
  mouseLightEnabled: boolean;
  mouseLightIntensity: number;
  headRotationEnabled: boolean;
  headYawStrength: number;
  headPitchStrength: number;
  headRollStrength: number;
  headRotationDeadZone: number;
  headRotationSmoothing: number;
  outputAutoHideEnabled: boolean;
  outputAutoHideDelay: number;
  outputAlwaysHideControls: boolean;
  recordingMode: RecordingMode;
};
