export async function convertToMp4(
  source: Blob,
  quality: { videoBitrate: number; audioBitrate: number },
  onProgress?: (progress: number) => void,
) {
  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    Mp4OutputFormat,
    Output,
    canEncodeAudio,
    canEncodeVideo,
  } = await import("mediabunny");

  if (!(await canEncodeVideo("avc", { bitrate: quality.videoBitrate }))) {
    throw new Error("This Windows WebView2 runtime does not expose an H.264 WebCodecs encoder. Update Microsoft Edge WebView2 and retry.");
  }
  if (!(await canEncodeAudio("aac", { bitrate: quality.audioBitrate }))) {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  }

  const input = new Input({
    source: new BlobSource(source),
    formats: ALL_FORMATS,
  });
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });

  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: {
        codec: "avc",
        bitrate: quality.videoBitrate,
        alpha: "discard",
        keyFrameInterval: 2,
        hardwareAcceleration: "prefer-hardware",
        forceTranscode: true,
      },
      audio: {
        codec: "aac",
        bitrate: quality.audioBitrate,
        forceTranscode: true,
      },
      showWarnings: false,
    });
    if (!conversion.isValid) {
      const reasons = [...new Set(conversion.discardedTracks.map((item) => item.reason))].join(", ");
      throw new Error(`The MP4 conversion pipeline could not use the recorded tracks${reasons ? ` (${reasons})` : ""}.`);
    }
    conversion.onProgress = (progress) => onProgress?.(Math.min(1, Math.max(0, progress)));
    await conversion.execute();
    if (!target.buffer?.byteLength) throw new Error("The MP4 encoder produced an empty file.");
    onProgress?.(1);
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}
