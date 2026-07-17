export type ViewportSize = { width: number; height: number };
export type CameraDimensions = Pick<HTMLVideoElement, "videoWidth" | "videoHeight">;

/** Project a normalized camera point through the same object-fit: cover crop used by the stage. */
export function projectCoverPoint(
  video: CameraDimensions | null,
  targetWidth: number,
  targetHeight: number,
  x: number,
  y: number,
  mirror: boolean,
) {
  if (!video?.videoWidth || !video.videoHeight) {
    return { x: (mirror ? 1 - x : x) * targetWidth, y: y * targetHeight };
  }
  const scale = Math.max(targetWidth / video.videoWidth, targetHeight / video.videoHeight);
  const renderedWidth = video.videoWidth * scale;
  const renderedHeight = video.videoHeight * scale;
  const offsetX = (targetWidth - renderedWidth) / 2;
  const offsetY = (targetHeight - renderedHeight) / 2;
  const projectedX = offsetX + x * renderedWidth;
  return {
    x: mirror ? targetWidth - projectedX : projectedX,
    y: offsetY + y * renderedHeight,
  };
}
