const videoWithAudioMimeTypes = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

const videoOnlyMimeTypes = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

const audioMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

function firstSupported(candidates: string[], fallback: string) {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("This browser does not provide MediaRecorder capture. Use a current Chromium-based browser.");
  }
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? fallback;
}

/** Never prefer an explicitly video-only codec when a microphone track exists. */
export function preferredVideoRecorderMimeType(withAudio: boolean) {
  return firstSupported(withAudio ? videoWithAudioMimeTypes : videoOnlyMimeTypes, "video/webm");
}

export function preferredWebmRecorderMimeType(withAudio: boolean) {
  const candidates = withAudio
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const selected = firstSupported(candidates, "");
  if (!selected) throw new Error("This browser cannot encode WebM video through MediaRecorder.");
  return selected;
}

export function preferredAudioRecorderMimeType() {
  return firstSupported(audioMimeTypes, "audio/webm");
}

export function cloneLiveAudioTrack(stream: MediaStream | null, muted: boolean) {
  if (muted) return null;
  const source = stream?.getAudioTracks().find((track) => track.readyState === "live");
  if (!source) return null;
  const clone = source.clone();
  clone.enabled = true;
  return clone;
}
