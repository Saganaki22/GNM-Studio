export const CUSTOM_HEAD_MAX_EDGE = 1600;
export const CUSTOM_HEAD_MAX_PIXELS = 1_500_000;

export function fitCustomHeadImageSize(sourceWidth: number, sourceHeight: number) {
  const inputWidth = Math.max(1, Math.floor(sourceWidth));
  const inputHeight = Math.max(1, Math.floor(sourceHeight));
  const edgeScale = CUSTOM_HEAD_MAX_EDGE / Math.max(inputWidth, inputHeight);
  const areaScale = Math.sqrt(CUSTOM_HEAD_MAX_PIXELS / (inputWidth * inputHeight));
  const scale = Math.min(1, edgeScale, areaScale);

  if (scale === 1) return { width: inputWidth, height: inputHeight };

  // Flooring guarantees that neither constraint is crossed after converting
  // the scaled dimensions back to integer canvas pixels.
  return {
    width: Math.max(1, Math.floor(inputWidth * scale)),
    height: Math.max(1, Math.floor(inputHeight * scale)),
  };
}
