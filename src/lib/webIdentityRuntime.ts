export type WebIdentityRuntime = {
  components: number;
  vertices: number;
  axes: number;
  scales: Float32Array;
  template: Float32Array;
  quantized: Int8Array;
};

export function parseWebIdentityRuntime(buffer: ArrayBuffer): WebIdentityRuntime {
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
  if (magic !== "GNI1") throw new Error("The web identity runtime has an unsupported format.");
  const view = new DataView(buffer);
  const components = view.getUint32(4, true);
  const vertices = view.getUint32(8, true);
  const axes = view.getUint32(12, true);
  if (components !== 253 || vertices !== 17_821 || axes !== 3) {
    throw new Error(`Unexpected web identity dimensions: ${components} × ${vertices} × ${axes}.`);
  }
  const scalesOffset = 16;
  const scales = new Float32Array(buffer, scalesOffset, components * axes);
  const templateOffset = scalesOffset + scales.byteLength;
  const template = new Float32Array(buffer, templateOffset, vertices * axes);
  const quantizedOffset = templateOffset + template.byteLength;
  const expectedBytes = quantizedOffset + components * vertices * axes;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`Web identity runtime length mismatch: ${buffer.byteLength} bytes; expected ${expectedBytes}.`);
  }
  const quantized = new Int8Array(buffer, quantizedOffset, components * vertices * axes);
  return { components, vertices, axes, scales, template, quantized };
}

export function evaluateWebIdentity(runtime: WebIdentityRuntime, weights: Float32Array) {
  if (weights.length !== runtime.components) {
    throw new Error(`Identity decoder returned ${weights.length} values; expected ${runtime.components}.`);
  }
  const positions = new Float32Array(runtime.template);
  const coordinates = runtime.vertices * runtime.axes;
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
