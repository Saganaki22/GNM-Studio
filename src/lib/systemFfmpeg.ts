export type SystemFfmpegProbe = {
  available: boolean;
  version?: string;
  error?: string;
};

export async function probeSystemFfmpeg(path: string) {
  if (!("__TAURI_INTERNALS__" in window)) {
    return { available: false, error: "System FFmpeg is available only in the Tauri desktop app." } satisfies SystemFfmpegProbe;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SystemFfmpegProbe>("ffmpeg_probe", { path });
}

export async function convertWithSystemFfmpeg(
  source: Blob,
  ffmpegPath: string,
  quality: { videoBitrate: number; audioBitrate: number },
  onProgress?: (progress: number) => void,
) {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("System FFmpeg requires the Tauri desktop app.");
  const [{ invoke }, { join, tempDir }, { readFile, remove, writeFile }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const nonce = crypto.randomUUID();
  const directory = await tempDir();
  const inputPath = await join(directory, `gnm-studio-${nonce}.webm`);
  const outputPath = await join(directory, `gnm-studio-${nonce}.mp4`);
  onProgress?.(0.04);
  try {
    await writeFile(inputPath, new Uint8Array(await source.arrayBuffer()));
    onProgress?.(0.12);
    await invoke("ffmpeg_transcode", {
      ffmpegPath,
      inputPath,
      outputPath,
      videoBitrateKbps: Math.round(quality.videoBitrate / 1_000),
      audioBitrateKbps: Math.round(quality.audioBitrate / 1_000),
    });
    onProgress?.(0.92);
    const bytes = await readFile(outputPath);
    if (!bytes.byteLength) throw new Error("System FFmpeg produced an empty MP4 file.");
    onProgress?.(1);
    return new Blob([bytes.slice().buffer], { type: "video/mp4" });
  } finally {
    await Promise.allSettled([remove(inputPath), remove(outputPath)]);
  }
}
