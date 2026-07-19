/**
 * Chromium MediaRecorder writes WebM without a Duration element, which makes
 * Windows players report (or play) only the first second of a take. Remuxing
 * through mediabunny copies the packets untouched while writing proper
 * duration and cue metadata, so the saved file shows its real length
 * everywhere. A remux failure never breaks the export: the original blob is
 * returned instead.
 */
export async function remuxWebmWithDuration(source: Blob): Promise<Blob> {
  try {
    const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Output, WebMOutputFormat } = await import("mediabunny");
    const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
    const target = new BufferTarget();
    const output = new Output({ format: new WebMOutputFormat(), target });
    try {
      const conversion = await Conversion.init({ input, output, showWarnings: false });
      if (!conversion.isValid) return source;
      await conversion.execute();
      if (!target.buffer?.byteLength) return source;
      return new Blob([target.buffer], { type: "video/webm" });
    } finally {
      input.dispose();
    }
  } catch {
    return source;
  }
}
