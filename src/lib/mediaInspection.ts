/** Read container metadata locally so a requested microphone track cannot fail silently. */
export async function inspectRecordedMedia(source: Blob) {
  const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  try {
    const [video, audio] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);
    return { hasVideo: Boolean(video), hasAudio: Boolean(audio) };
  } finally {
    input.dispose();
  }
}
