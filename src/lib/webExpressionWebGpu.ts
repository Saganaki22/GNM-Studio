import type { WebExpressionRuntime } from "./webExpressionRuntime";

const usage = { mapRead: 0x0001, copySource: 0x0004, copyDestination: 0x0008, uniform: 0x0040, storage: 0x0080 } as const;
const workgroupSize = 256;

const shaderSource = /* wgsl */ `
struct Dimensions { coordinates: u32, components: u32, axes: u32, padding: u32 }
@group(0) @binding(0) var<storage, read> basePositions: array<f32>;
@group(0) @binding(1) var<storage, read> scales: array<f32>;
@group(0) @binding(2) var<storage, read> packedBasis: array<u32>;
@group(0) @binding(3) var<storage, read> weights: array<f32>;
@group(0) @binding(4) var<storage, read_write> outputPositions: array<f32>;
@group(0) @binding(5) var<uniform> dimensions: Dimensions;

@compute @workgroup_size(${workgroupSize})
fn evaluateExpression(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let coordinate = invocation.x;
  if (coordinate >= dimensions.coordinates) { return; }
  let axis = coordinate % dimensions.axes;
  var value = basePositions[coordinate];
  for (var component = 0u; component < dimensions.components; component += 1u) {
    let byteIndex = component * dimensions.coordinates + coordinate;
    let packed = packedBasis[byteIndex >> 2u];
    let shift = (byteIndex & 3u) * 8u;
    let unsignedValue = (packed >> shift) & 255u;
    let signedValue = select(i32(unsignedValue), i32(unsignedValue) - 256, unsignedValue >= 128u);
    value += f32(signedValue) * scales[component * dimensions.axes + axis] * weights[component];
  }
  outputPositions[coordinate] = value;
}`;

function upload(device: GPUDevice, data: ArrayBufferView, bufferUsage: number) {
  const buffer = device.createBuffer({ size: Math.max(4, Math.ceil(data.byteLength / 4) * 4), usage: bufferUsage | usage.copyDestination });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function pack(source: Int8Array) {
  const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
  padded.set(bytes);
  return new Uint32Array(padded.buffer);
}

export class WebGpuExpressionEvaluator {
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly baseBuffer: GPUBuffer;
  private readonly weightsBuffer: GPUBuffer;
  private readonly outputBuffer: GPUBuffer;
  private readonly readbackBuffer: GPUBuffer;
  private readonly coordinates: number;
  private readonly owned: GPUBuffer[];

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    bindGroup: GPUBindGroup,
    baseBuffer: GPUBuffer,
    weightsBuffer: GPUBuffer,
    outputBuffer: GPUBuffer,
    readbackBuffer: GPUBuffer,
    coordinates: number,
    owned: GPUBuffer[],
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.bindGroup = bindGroup;
    this.baseBuffer = baseBuffer;
    this.weightsBuffer = weightsBuffer;
    this.outputBuffer = outputBuffer;
    this.readbackBuffer = readbackBuffer;
    this.coordinates = coordinates;
    this.owned = owned;
  }

  static async create(runtime: WebExpressionRuntime) {
    if (!navigator.gpu) throw new Error("WebGPU is unavailable.");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No compatible WebGPU adapter was found.");
    const device = await adapter.requestDevice();
    const coordinates = runtime.vertices * runtime.axes;
    const baseBuffer = device.createBuffer({ size: coordinates * 4, usage: usage.storage | usage.copyDestination });
    const scalesBuffer = upload(device, runtime.scales, usage.storage);
    const basisBuffer = upload(device, pack(runtime.quantized), usage.storage);
    const weightsBuffer = device.createBuffer({ size: runtime.components * 4, usage: usage.storage | usage.copyDestination });
    const outputBuffer = device.createBuffer({ size: coordinates * 4, usage: usage.storage | usage.copySource });
    const readbackBuffer = device.createBuffer({ size: coordinates * 4, usage: usage.mapRead | usage.copyDestination });
    const dimensionsBuffer = upload(device, new Uint32Array([coordinates, runtime.components, runtime.axes, 0]), usage.uniform);
    const module = device.createShaderModule({ label: "GNM quantized expression evaluator", code: shaderSource });
    const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "evaluateExpression" } });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [baseBuffer, scalesBuffer, basisBuffer, weightsBuffer, outputBuffer, dimensionsBuffer]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    return new WebGpuExpressionEvaluator(
      device, pipeline, bindGroup, baseBuffer, weightsBuffer, outputBuffer, readbackBuffer, coordinates,
      [baseBuffer, scalesBuffer, basisBuffer, weightsBuffer, outputBuffer, readbackBuffer, dimensionsBuffer],
    );
  }

  async evaluate(basePositions: Float32Array, weights: Float32Array) {
    if (basePositions.length !== this.coordinates) throw new Error("WebGPU expression base-mesh size mismatch.");
    this.device.queue.writeBuffer(this.baseBuffer, 0, basePositions);
    this.device.queue.writeBuffer(this.weightsBuffer, 0, weights);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.coordinates / workgroupSize));
    pass.end();
    encoder.copyBufferToBuffer(this.outputBuffer, 0, this.readbackBuffer, 0, this.coordinates * 4);
    this.device.queue.submit([encoder.finish()]);
    await this.readbackBuffer.mapAsync(0x0001);
    const positions = new Float32Array(this.readbackBuffer.getMappedRange()).slice();
    this.readbackBuffer.unmap();
    return positions;
  }

  dispose() { this.owned.forEach((buffer) => buffer.destroy()); }
}
