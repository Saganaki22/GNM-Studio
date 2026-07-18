import type { WebIdentityRuntime } from "./webIdentityRuntime";

const bufferUsage = {
  mapRead: 0x0001,
  copySource: 0x0004,
  copyDestination: 0x0008,
  uniform: 0x0040,
  storage: 0x0080,
} as const;

const mapModeRead = 0x0001;
const workgroupSize = 256;

const identityComputeShader = /* wgsl */ `
struct IdentityDimensions {
  coordinates: u32,
  components: u32,
  axes: u32,
  padding: u32,
}

@group(0) @binding(0) var<storage, read> templatePositions: array<f32>;
@group(0) @binding(1) var<storage, read> componentScales: array<f32>;
@group(0) @binding(2) var<storage, read> packedBasis: array<u32>;
@group(0) @binding(3) var<storage, read> identityWeights: array<f32>;
@group(0) @binding(4) var<storage, read_write> outputPositions: array<f32>;
@group(0) @binding(5) var<uniform> dimensions: IdentityDimensions;

@compute @workgroup_size(${workgroupSize})
fn evaluateIdentity(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let coordinate = invocation.x;
  if (coordinate >= dimensions.coordinates) {
    return;
  }
  let axis = coordinate % dimensions.axes;
  var value = templatePositions[coordinate];
  for (var component = 0u; component < dimensions.components; component += 1u) {
    let byteIndex = component * dimensions.coordinates + coordinate;
    let packed = packedBasis[byteIndex >> 2u];
    let shift = (byteIndex & 3u) * 8u;
    let unsignedValue = (packed >> shift) & 255u;
    let signedValue = select(i32(unsignedValue), i32(unsignedValue) - 256, unsignedValue >= 128u);
    let scale = componentScales[component * dimensions.axes + axis];
    value += f32(signedValue) * scale * identityWeights[component];
  }
  outputPositions[coordinate] = value;
}
`;

export function packQuantizedBasis(runtime: WebIdentityRuntime) {
  const source = new Uint8Array(
    runtime.quantized.buffer,
    runtime.quantized.byteOffset,
    runtime.quantized.byteLength,
  );
  const padded = new Uint8Array(Math.ceil(source.byteLength / 4) * 4);
  padded.set(source);
  return new Uint32Array(padded.buffer);
}

function uploadBuffer(device: GPUDevice, data: ArrayBufferView, usage: number) {
  const buffer = device.createBuffer({
    size: Math.max(4, Math.ceil(data.byteLength / 4) * 4),
    usage: usage | bufferUsage.copyDestination,
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

/** Quantized GNM identity evaluation on a dedicated worker's WebGPU device. */
export class WebGpuIdentityEvaluator {
  private readonly device: GPUDevice;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly weightsBuffer: GPUBuffer;
  private readonly outputBuffer: GPUBuffer;
  private readonly readbackBuffer: GPUBuffer;
  private readonly coordinates: number;
  private readonly ownedBuffers: GPUBuffer[];

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    bindGroup: GPUBindGroup,
    weightsBuffer: GPUBuffer,
    outputBuffer: GPUBuffer,
    readbackBuffer: GPUBuffer,
    coordinates: number,
    ownedBuffers: GPUBuffer[],
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.bindGroup = bindGroup;
    this.weightsBuffer = weightsBuffer;
    this.outputBuffer = outputBuffer;
    this.readbackBuffer = readbackBuffer;
    this.coordinates = coordinates;
    this.ownedBuffers = ownedBuffers;
  }

  static async create(runtime: WebIdentityRuntime) {
    const gpu = navigator.gpu;
    if (!gpu) throw new Error("WebGPU is unavailable in this browser or WebView.");
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No compatible WebGPU adapter was found.");
    const device = await adapter.requestDevice();
    const coordinates = runtime.vertices * runtime.axes;
    const templateBuffer = uploadBuffer(device, runtime.template, bufferUsage.storage);
    const scalesBuffer = uploadBuffer(device, runtime.scales, bufferUsage.storage);
    const basisBuffer = uploadBuffer(device, packQuantizedBasis(runtime), bufferUsage.storage);
    const weightsBuffer = device.createBuffer({
      size: runtime.components * Float32Array.BYTES_PER_ELEMENT,
      usage: bufferUsage.storage | bufferUsage.copyDestination,
    });
    const outputBytes = coordinates * Float32Array.BYTES_PER_ELEMENT;
    const outputBuffer = device.createBuffer({
      size: outputBytes,
      usage: bufferUsage.storage | bufferUsage.copySource,
    });
    const readbackBuffer = device.createBuffer({
      size: outputBytes,
      usage: bufferUsage.mapRead | bufferUsage.copyDestination,
    });
    const dimensionsBuffer = uploadBuffer(
      device,
      new Uint32Array([coordinates, runtime.components, runtime.axes, 0]),
      bufferUsage.uniform,
    );
    const shader = device.createShaderModule({ label: "GNM quantized identity evaluator", code: identityComputeShader });
    const pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: shader, entryPoint: "evaluateIdentity" },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [templateBuffer, scalesBuffer, basisBuffer, weightsBuffer, outputBuffer, dimensionsBuffer]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    return new WebGpuIdentityEvaluator(
      device,
      pipeline,
      bindGroup,
      weightsBuffer,
      outputBuffer,
      readbackBuffer,
      coordinates,
      [templateBuffer, scalesBuffer, basisBuffer, weightsBuffer, outputBuffer, readbackBuffer, dimensionsBuffer],
    );
  }

  async evaluate(weights: Float32Array) {
    this.device.queue.writeBuffer(this.weightsBuffer, 0, weights);
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.coordinates / workgroupSize));
    pass.end();
    encoder.copyBufferToBuffer(
      this.outputBuffer,
      0,
      this.readbackBuffer,
      0,
      this.coordinates * Float32Array.BYTES_PER_ELEMENT,
    );
    this.device.queue.submit([encoder.finish()]);
    await this.readbackBuffer.mapAsync(mapModeRead);
    const positions = new Float32Array(this.readbackBuffer.getMappedRange()).slice();
    this.readbackBuffer.unmap();
    return positions;
  }

  dispose() {
    this.ownedBuffers.forEach((buffer) => buffer.destroy());
  }
}
