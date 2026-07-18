function clampedDimension(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) throw new Error("Output dimensions must be finite numbers.");
  return Math.round(Math.min(maximum, Math.max(minimum, value)) / 2) * 2;
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
  context.drawImage(source, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => output.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode the canvas as PNG.")),
    "image/png",
  ));
}
