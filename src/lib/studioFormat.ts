export function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function timestampedFilename(extension: string, suffix = "") {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `GNM-Studio_${timestamp}${suffix}.${extension}`;
}

export function afterBrowserPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
