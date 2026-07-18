export type WebExpressionRuntime = {
  components: number;
  vertices: number;
  axes: number;
  scales: Float32Array;
  quantized: Int8Array;
};

export function parseWebExpressionRuntime(buffer: ArrayBuffer): WebExpressionRuntime {
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
  if (magic !== "GNE1") throw new Error("The web expression runtime has an unsupported format.");
  const view = new DataView(buffer);
  const components = view.getUint32(4, true);
  const vertices = view.getUint32(8, true);
  const axes = view.getUint32(12, true);
  if (components !== 383 || vertices !== 17_821 || axes !== 3) {
    throw new Error(`Unexpected web expression dimensions: ${components} × ${vertices} × ${axes}.`);
  }
  const scalesOffset = 16;
  const scales = new Float32Array(buffer, scalesOffset, components * axes);
  const quantizedOffset = scalesOffset + scales.byteLength;
  const expectedBytes = quantizedOffset + components * vertices * axes;
  if (buffer.byteLength !== expectedBytes) throw new Error(`Web expression runtime length mismatch: ${buffer.byteLength} bytes; expected ${expectedBytes}.`);
  return { components, vertices, axes, scales, quantized: new Int8Array(buffer, quantizedOffset) };
}

export function addWebExpression(runtime: WebExpressionRuntime, basePositions: Float32Array, weights: Float32Array) {
  if (weights.length !== runtime.components) throw new Error(`Expression state has ${weights.length} values; expected ${runtime.components}.`);
  const coordinates = runtime.vertices * runtime.axes;
  if (basePositions.length !== coordinates) throw new Error(`Expression base mesh has ${basePositions.length} coordinates; expected ${coordinates}.`);
  const positions = new Float32Array(basePositions);
  for (let component = 0; component < runtime.components; component += 1) {
    const weight = weights[component];
    if (Math.abs(weight) <= 1e-8) continue;
    const basisOffset = component * coordinates;
    const scaleOffset = component * runtime.axes;
    const scaleX = runtime.scales[scaleOffset] * weight;
    const scaleY = runtime.scales[scaleOffset + 1] * weight;
    const scaleZ = runtime.scales[scaleOffset + 2] * weight;
    for (let coordinate = 0; coordinate < coordinates; coordinate += 3) {
      positions[coordinate] += runtime.quantized[basisOffset + coordinate] * scaleX;
      positions[coordinate + 1] += runtime.quantized[basisOffset + coordinate + 1] * scaleY;
      positions[coordinate + 2] += runtime.quantized[basisOffset + coordinate + 2] * scaleZ;
    }
  }
  return positions;
}
