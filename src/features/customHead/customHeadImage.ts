export async function inspectCustomHeadImage(blob: Blob) {
  if (!blob.type.startsWith("image/")) throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (blob.size > 25 * 1024 * 1024) throw new Error("The image is larger than 25 MB. Resize it and try again.");
  const bitmap = await createImageBitmap(blob);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  if (Math.min(dimensions.width, dimensions.height) < 256) {
    throw new Error("The image is too small. Use an image at least 256 pixels on its shortest side.");
  }
  return dimensions;
}

export function captureVideoFrame(video: HTMLVideoElement) {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return Promise.reject(new Error("The camera preview is not ready yet."));
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Could not create a camera snapshot canvas."));
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The camera frame could not be encoded."));
    }, "image/jpeg", 0.94);
  });
}

