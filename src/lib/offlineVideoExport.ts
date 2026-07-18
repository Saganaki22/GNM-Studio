export type OfflineVideoEncoder = {
  addCanvasFrame: (canvas: HTMLCanvasElement, frameIndex: number) => Promise<void>;
  finalize: () => Promise<Blob>;
  cancel: () => Promise<void>;
};

export async function createOfflineMp4Encoder(options: {
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  audio?: Blob | null;
}): Promise<OfflineVideoEncoder> {
  const {
    AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeAudio, canEncodeVideo,
  } = await import("mediabunny");
  if (!(await canEncodeVideo("avc", { bitrate: options.videoBitrate }))) {
    throw new Error("This Windows WebView2/browser does not expose an H.264 WebCodecs encoder. Update Edge WebView2 or select system FFmpeg.");
  }
  if (options.audio && !(await canEncodeAudio("aac", { bitrate: options.audioBitrate }))) {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  }

  const encodeCanvas = document.createElement("canvas");
  encodeCanvas.width = Math.max(64, Math.min(7680, Math.round(options.width / 2) * 2));
  encodeCanvas.height = Math.max(64, Math.min(4320, Math.round(options.height / 2) * 2));
  const context = encodeCanvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Could not create the offline video frame surface.");
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const video = new CanvasSource(encodeCanvas, {
    codec: "avc",
    bitrate: options.videoBitrate,
    keyFrameInterval: 2,
    hardwareAcceleration: "prefer-hardware",
    latencyMode: "quality",
  });
  output.addVideoTrack(video, { frameRate: options.fps });

  let audio: InstanceType<typeof AudioBufferSource> | null = null;
  let decodedAudio: AudioBuffer | null = null;
  let decodeContext: AudioContext | null = null;
  if (options.audio) {
    decodeContext = new AudioContext();
    decodedAudio = await decodeContext.decodeAudioData(await options.audio.arrayBuffer());
    audio = new AudioBufferSource({ codec: "aac", bitrate: options.audioBitrate });
    output.addAudioTrack(audio);
  }
  await output.start();
  if (audio && decodedAudio) await audio.add(decodedAudio);

  let finalized = false;
  return {
    async addCanvasFrame(sourceCanvas, frameIndex) {
      if (finalized) throw new Error("The offline MP4 encoder is already finalized.");
      context.clearRect(0, 0, encodeCanvas.width, encodeCanvas.height);
      context.drawImage(sourceCanvas, 0, 0, encodeCanvas.width, encodeCanvas.height);
      const duration = 1 / options.fps;
      await video.add(frameIndex * duration, duration, { keyFrame: frameIndex % Math.max(1, Math.round(options.fps * 2)) === 0 });
    },
    async finalize() {
      if (!finalized) {
        finalized = true;
        video.close();
        audio?.close();
        await output.finalize();
        if (decodeContext) await decodeContext.close();
      }
      if (!target.buffer?.byteLength) throw new Error("The deterministic MP4 encoder produced an empty file.");
      return new Blob([target.buffer], { type: "video/mp4" });
    },
    async cancel() {
      if (finalized) return;
      finalized = true;
      video.close();
      audio?.close();
      await output.cancel();
      if (decodeContext) await decodeContext.close();
    },
  };
}
