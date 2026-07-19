function clampedDimension(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) throw new Error("Output dimensions must be finite numbers.");
  return Math.round(Math.min(maximum, Math.max(minimum, value)) / 2) * 2;
}

/** Even-rounded export pixel size shared by the stage override and the capture surfaces. */
export function exportPixelSize(width: number, height: number) {
  return { width: clampedDimension(width, 64, 7680), height: clampedDimension(height, 64, 4320) };
}

/**
 * Draw the source canvas centred and aspect-preserved inside the output frame.
 * The stage canvas adapts its framing to the viewport aspect, so stretching it
 * into a fixed export size squashes the render; padding keeps the exact pixels
 * undistorted and lets the uncovered border stay transparent/black.
 */
export function drawCanvasContained(context: CanvasRenderingContext2D, source: HTMLCanvasElement, width: number, height: number) {
  const scale = Math.min(width / Math.max(1, source.width), height / Math.max(1, source.height));
  const drawWidth = Math.max(1, Math.round(source.width * scale));
  const drawHeight = Math.max(1, Math.round(source.height * scale));
  context.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

export async function canvasPngBlob(source: HTMLCanvasElement, requestedWidth: number, requestedHeight: number) {
  const width = clampedDimension(requestedWidth, 64, 7680);
  const height = clampedDimension(requestedHeight, 64, 4320);
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d", { alpha: true });
  if (!context) throw new Error("Could not create the PNG capture surface.");
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  drawCanvasContained(context, source, width, height);
  return new Promise<Blob>((resolve, reject) => output.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode the canvas as PNG.")),
    "image/png",
  ));
}
