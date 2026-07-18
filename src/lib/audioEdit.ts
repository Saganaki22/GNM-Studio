function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function audioBufferToWav(buffer: AudioBuffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const bytesPerSample = 2;
  const dataBytes = buffer.length * channels * bytesPerSample;
  const bytes = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(bytes);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.min(1, Math.max(-1, channelData[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export async function trimAndRetimeAudio(
  source: Blob,
  trimStartMs: number,
  trimEndMs: number,
  speed: number,
) {
  const decodeContext = new AudioContext();
  try {
    const decoded = await decodeContext.decodeAudioData(await source.arrayBuffer());
    const start = Math.min(decoded.duration, Math.max(0, trimStartMs / 1_000));
    const requestedEnd = trimEndMs > 0 ? trimEndMs / 1_000 : decoded.duration;
    const end = Math.min(decoded.duration, Math.max(start, requestedEnd));
    const playbackRate = Math.min(4, Math.max(0.1, speed));
    const outputDuration = Math.max(1 / decoded.sampleRate, (end - start) / playbackRate);
    const outputFrames = Math.max(1, Math.ceil(outputDuration * decoded.sampleRate));
    const offline = new OfflineAudioContext(Math.min(2, decoded.numberOfChannels), outputFrames, decoded.sampleRate);
    const node = offline.createBufferSource();
    node.buffer = decoded;
    node.playbackRate.value = playbackRate;
    node.connect(offline.destination);
    node.start(0, start, end - start);
    return audioBufferToWav(await offline.startRendering());
  } finally {
    await decodeContext.close();
  }
}
