type DenseLayer = {
  rows: number;
  columns: number;
  kernel: Float32Array;
  bias: Float32Array;
};

export class DenseDecoder {
  private readonly layers: DenseLayer[];

  private constructor(layers: DenseLayer[]) {
    this.layers = layers;
  }

  static async load(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load decoder: ${response.status}`);
    const buffer = await response.arrayBuffer();
    const view = new DataView(buffer);
    const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
    if (magic !== "GND1") throw new Error("Unsupported GNM decoder asset.");
    let offset = 4;
    const count = view.getUint32(offset, true); offset += 4;
    const layers: DenseLayer[] = [];
    for (let layerIndex = 0; layerIndex < count; layerIndex += 1) {
      const rows = view.getUint32(offset, true); offset += 4;
      const columns = view.getUint32(offset, true); offset += 4;
      const kernel = new Float32Array(buffer.slice(offset, offset + rows * columns * 4));
      offset += rows * columns * 4;
      const bias = new Float32Array(buffer.slice(offset, offset + columns * 4));
      offset += columns * 4;
      layers.push({ rows, columns, kernel, bias });
    }
    return new DenseDecoder(layers);
  }

  evaluate(input: Float32Array) {
    let current = input;
    this.layers.forEach((layer, layerIndex) => {
      if (current.length !== layer.rows) throw new Error("GNM decoder input size mismatch.");
      const next = new Float32Array(layer.columns);
      for (let column = 0; column < layer.columns; column += 1) {
        let value = layer.bias[column];
        for (let row = 0; row < layer.rows; row += 1) {
          value += current[row] * layer.kernel[row * layer.columns + column];
        }
        next[column] = layerIndex === this.layers.length - 1 ? value : Math.max(0, value);
      }
      current = next;
    });
    return current;
  }
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string) {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussianLatent(seed: string, count = 64) {
  const random = seededRandom(seed);
  const result = new Float32Array(count);
  for (let index = 0; index < count; index += 2) {
    const first = Math.max(random(), 1e-8);
    const second = random();
    const magnitude = Math.sqrt(-2 * Math.log(first));
    result[index] = magnitude * Math.cos(2 * Math.PI * second);
    if (index + 1 < count) result[index + 1] = magnitude * Math.sin(2 * Math.PI * second);
  }
  return result;
}

export function identityDecoderInput(
  seed: string,
  gender: "female" | "male" | "blend",
  ethnicity: "middle_eastern" | "asian" | "white" | "black" | "blend",
) {
  const input = new Float32Array(70);
  input.set(gaussianLatent(seed), 0);
  if (gender === "female") input[64] = 1;
  else if (gender === "male") input[65] = 1;
  else { input[64] = 0.5; input[65] = 0.5; }

  const ethnicityOffset = { middle_eastern: 0, asian: 1, white: 2, black: 3 } as const;
  if (ethnicity === "blend") {
    for (let index = 0; index < 4; index += 1) input[66 + index] = 0.25;
  } else {
    input[66 + ethnicityOffset[ethnicity]] = 1;
  }
  return input;
}

/** Build the released expression-decoder input: 64 seeded latent values plus
 * one of the 20 semantic class conditions. */
export function expressionDecoderInput(seed: string, semanticClassIndex: number) {
  if (!Number.isInteger(semanticClassIndex) || semanticClassIndex < 0 || semanticClassIndex >= 20) {
    throw new Error("GNM semantic expression class must be between 0 and 19.");
  }
  const input = new Float32Array(84);
  input.set(gaussianLatent(seed), 0);
  input[64 + semanticClassIndex] = 1;
  return input;
}

export function weightedIdentityDecoderInput(
  seed: string,
  presentationStrength: number,
  populationWeights: readonly [number, number, number, number],
) {
  const input = new Float32Array(70);
  input.set(gaussianLatent(seed), 0);
  const strength = Math.min(1, Math.max(-1, presentationStrength));
  input[64] = (1 - strength) * 0.5;
  input[65] = (1 + strength) * 0.5;
  const total = populationWeights.reduce((sum, value) => sum + Math.max(0, value), 0);
  for (let index = 0; index < 4; index += 1) {
    input[66 + index] = total > 0 ? Math.max(0, populationWeights[index]) / total : 0.25;
  }
  return input;
}
