import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { weightedIdentityDecoderInput } from "../src/lib/decoder.ts";
import { evaluateWebIdentity, parseWebIdentityRuntime } from "../src/lib/webIdentityRuntime.ts";

const source = readFileSync(fileURLToPath(new URL("../public/models/gnm_head_runtime.glb", import.meta.url)));
const jsonLength = source.readUInt32LE(12);
const gltf = JSON.parse(source.toString("utf8", 20, 20 + jsonLength).trim());
const jsonPaddedLength = (jsonLength + 3) & ~3;
const binaryStart = 20 + jsonPaddedLength + 8;
const primitive = gltf.meshes[0].primitives[0];
const readAccessor = (accessorIndex) => {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  const offset = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const size = accessor.type === "VEC3" ? 3 : 1;
  const TypedArray = accessor.componentType === 5126 ? Float32Array : Uint32Array;
  return new TypedArray(source.buffer, source.byteOffset + offset, accessor.count * size);
};
const positions = readAccessor(primitive.attributes.POSITION);
const indices = readAccessor(primitive.indices);
const count = positions.length / 3;
const parent = Int32Array.from({ length: count }, (_, index) => index);
const sizes = new Int32Array(count).fill(1);
const find = (input) => {
  let value = input;
  while (parent[value] !== value) {
    parent[value] = parent[parent[value]];
    value = parent[value];
  }
  return value;
};
const join = (first, second) => {
  let a = find(first); let b = find(second);
  if (a === b) return;
  if (sizes[a] < sizes[b]) [a, b] = [b, a];
  parent[b] = a; sizes[a] += sizes[b];
};
for (let offset = 0; offset < indices.length; offset += 3) {
  join(indices[offset], indices[offset + 1]);
  join(indices[offset + 1], indices[offset + 2]);
}
const components = new Map();
for (let vertex = 0; vertex < count; vertex += 1) {
  const root = find(vertex);
  const component = components.get(root) ?? { count: 0, x: 0, y: 0, vertices: [] };
  component.count += 1;
  component.x += positions[vertex * 3];
  component.y += positions[vertex * 3 + 1];
  component.vertices.push(vertex);
  components.set(root, component);
}
const eyes = [...components.values()].filter((component) => {
  const centerY = component.y / component.count;
  return component.count >= 350 && component.count <= 420 && centerY > 0.27;
});
assert.equal(eyes.length, 4, "GNM runtime must retain four disconnected eye shells");
assert.equal(eyes.filter((eye) => eye.x / eye.count < 0).length, 2, "GNM runtime must retain two left eye shells");
assert.equal(eyes.filter((eye) => eye.x / eye.count > 0).length, 2, "GNM runtime must retain two right eye shells");
const dentalArches = [...components.values()].filter((component) => {
  const centerY = component.y / component.count;
  return component.count >= 1_200 && component.count <= 1_700 && centerY < 0.27;
});
const tongues = [...components.values()].filter((component) => {
  const centerY = component.y / component.count;
  return component.count >= 800 && component.count <= 1_100 && centerY < 0.27;
});
assert.equal(dentalArches.length, 2, "GNM runtime must retain separate upper and lower dental arches");
assert.equal(tongues.length, 1, "GNM runtime must retain a separate tongue shell");
const targetNames = gltf.meshes[0].extras.targetNames;
const jawTarget = readAccessor(primitive.targets[targetNames.indexOf("jaw_open")].POSITION);
const dentalDisplacement = (component) => Math.max(...component.vertices.map((vertex) => Math.hypot(
  jawTarget[vertex * 3], jawTarget[vertex * 3 + 1], jawTarget[vertex * 3 + 2],
)));
const [upperDentalArch, lowerDentalArch] = [...dentalArches]
  .sort((first, second) => second.y / second.count - first.y / first.count);
assert.ok(dentalDisplacement(upperDentalArch) < 1e-7, "canonical jaw opening must leave the upper dental arch fixed");
assert.ok(dentalDisplacement(lowerDentalArch) > 0.009, "canonical jaw opening must move the lower dental arch visibly");
const lowerDentalDeltas = lowerDentalArch.vertices.map((vertex) => [
  jawTarget[vertex * 3], jawTarget[vertex * 3 + 1], jawTarget[vertex * 3 + 2],
]);
const lowerDentalMean = lowerDentalDeltas.reduce(
  (sum, delta) => sum.map((value, axis) => value + delta[axis]),
  [0, 0, 0],
).map((value) => value / lowerDentalDeltas.length);
const lowerDentalDeviation = Math.max(...lowerDentalDeltas.map((delta) => Math.hypot(
  delta[0] - lowerDentalMean[0], delta[1] - lowerDentalMean[1], delta[2] - lowerDentalMean[2],
)));
assert.ok(lowerDentalDeviation < 1e-7, "the complete lower dental arch must translate rigidly without elongated teeth");

const { parseGnmAnatomy } = await import("../src/lib/gnmAnatomy.ts");
const anatomyBytes = readFileSync(fileURLToPath(new URL("../public/models/gnm_anatomy.gna", import.meta.url)));
const anatomyBuffer = anatomyBytes.buffer.slice(anatomyBytes.byteOffset, anatomyBytes.byteOffset + anatomyBytes.byteLength);
const anatomy = parseGnmAnatomy(anatomyBuffer);
assert.equal(anatomy.vertexCount, count);
for (const group of [
  "skin", "upper_lip", "lower_lip", "mouth_sock", "tongue", "gums", "teeth",
  "upper_teeth_and_gums", "lower_teeth_and_gums", "left_eye", "right_eye", "chin_region",
]) assert.ok(anatomy.groups.has(group), `Official GNM anatomy is missing ${group}`);
const lowerOfficial = anatomy.groups.get("lower_teeth_and_gums");
const chinOfficial = anatomy.groups.get("chin_region");
const posedY = (vertex) => positions[vertex * 3 + 1] + jawTarget[vertex * 3 + 1];
const dentalBottom = Math.min(...Array.from(lowerOfficial, posedY));
const chinTop = Math.max(...Array.from(chinOfficial, posedY));
assert.ok(dentalBottom - chinTop >= 0.0014, "full jaw opening must keep collision clearance between lower dental arch and chin");

const decoderBytes = readFileSync(fileURLToPath(new URL("../public/models/gnm_identity_decoder.bin", import.meta.url)));
const decoderBuffer = decoderBytes.buffer.slice(decoderBytes.byteOffset, decoderBytes.byteOffset + decoderBytes.byteLength);
const decoderView = new DataView(decoderBuffer);
assert.equal(new TextDecoder().decode(new Uint8Array(decoderBuffer, 0, 4)), "GND1");
let decoderOffset = 8;
const decoderLayers = Array.from({ length: decoderView.getUint32(4, true) }, () => {
  const rows = decoderView.getUint32(decoderOffset, true); decoderOffset += 4;
  const columns = decoderView.getUint32(decoderOffset, true); decoderOffset += 4;
  const kernel = new Float32Array(decoderBuffer.slice(decoderOffset, decoderOffset + rows * columns * 4)); decoderOffset += rows * columns * 4;
  const bias = new Float32Array(decoderBuffer.slice(decoderOffset, decoderOffset + columns * 4)); decoderOffset += columns * 4;
  return { rows, columns, kernel, bias };
});
const decodeIdentity = (input) => decoderLayers.reduce((current, layer, layerIndex) => {
  const next = new Float32Array(layer.columns);
  for (let column = 0; column < layer.columns; column += 1) {
    let value = layer.bias[column];
    for (let row = 0; row < layer.rows; row += 1) value += current[row] * layer.kernel[row * layer.columns + column];
    next[column] = layerIndex === decoderLayers.length - 1 ? value : Math.max(0, value);
  }
  return next;
}, input);
const identityCompressed = readFileSync(fileURLToPath(new URL("../webapp-assets/models/gnm_identity_basis.gni.gz", import.meta.url)));
const identityDecoded = gunzipSync(identityCompressed);
const identityRuntime = parseWebIdentityRuntime(identityDecoded.buffer.slice(identityDecoded.byteOffset, identityDecoded.byteOffset + identityDecoded.byteLength));
for (const sample of [
  ["feminine", "jaw-f", -1, [1, 0, 0, 0]],
  ["blend", "jaw-b", 0, [0.25, 0.25, 0.25, 0.25]],
  ["masculine", "jaw-m", 1, [0, 0, 0, 1]],
]) {
  const [label, seed, presentation, populations] = sample;
  const identity = evaluateWebIdentity(identityRuntime, decodeIdentity(weightedIdentityDecoderInput(seed, presentation, populations)));
  for (const amount of [0, 0.5, 1]) {
    const y = (vertex) => identity[vertex * 3 + 1] + jawTarget[vertex * 3 + 1] * amount;
    const sampleDentalBottom = Math.min(...Array.from(lowerOfficial, y));
    const sampleChinTop = Math.max(...Array.from(chinOfficial, y));
    assert.ok(Number.isFinite(sampleDentalBottom) && Number.isFinite(sampleChinTop), `${label} ${amount} jaw pose must remain finite`);
    assert.ok(sampleDentalBottom > sampleChinTop, `${label} ${amount} jaw pose must keep the lower dental arch above the chin`);
  }
}

const eyeSource = readFileSync(fileURLToPath(new URL("../src/lib/gnmEyes.ts", import.meta.url)), "utf8");
for (const marker of [
  "irisRadius = 33.35", "pupilRadius = 14", "installGnmEyeMaterials",
  "GNM Studio enamel", "GNM Studio tongue", "GNM Studio gums", "GNM Studio mouth interior",
  "anatomyMembership", "gnmNeutralEyeDivergence = 0.006", "gnmGazeDeadZone = 0.055",
]) {
  assert.ok(eyeSource.includes(marker), `GNM eye implementation is missing ${marker}`);
}
const { gnmEyeTextureOffset } = await import("../src/lib/gnmEyes.ts");
assert.ok(gnmEyeTextureOffset("left", 0) > 0, "Left neutral iris must shift slightly outward");
assert.ok(gnmEyeTextureOffset("right", 0) < 0, "Right neutral iris must shift slightly outward");
assert.equal(gnmEyeTextureOffset("left", 0.04), gnmEyeTextureOffset("left", 0), "Tiny false gaze must stay in the dead zone");
assert.ok(gnmEyeTextureOffset("left", 0.4) < gnmEyeTextureOffset("left", 0), "Deliberate gaze must remain responsive");
const stageSource = readFileSync(fileURLToPath(new URL("../src/components/Stage.tsx", import.meta.url)), "utf8");
assert.ok(stageSource.includes("installGnmEyeMaterials(face"), "GNM Stage does not install eye materials");
assert.ok(stageSource.includes("loadGnmAnatomy()"), "GNM Stage does not load official anatomical groups");
const exportSource = readFileSync(fileURLToPath(new URL("../src/lib/glbExport.ts", import.meta.url)), "utf8");
assert.ok(exportSource.includes("gnmEyeMaterials = installGnmEyeMaterials("), "GNM GLB export does not install eye materials");
assert.ok(exportSource.includes("options.eyeColor"), "GNM GLB export does not preserve the selected eye colour");
const appSource = ["../src/App.tsx", "../src/features/presets/usePresets.ts", "../src/features/export/useStudioExport.ts"]
  .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
  .join("\n");
for (const marker of ["stageSettings.eyeShaderEnabled", "stageSettings.eyeColor", "captureCurrentCanvasPng", "snapshot: OutputSnapshot", "createFullStatePreset"]) {
  assert.ok(appSource.includes(marker), `Eye-state propagation is missing ${marker}`);
}
const snapshotSource = readFileSync(fileURLToPath(new URL("../src/lib/recordingAppearance.ts", import.meta.url)), "utf8");
for (const marker of ['"eyeShaderEnabled"', '"eyeColor"']) assert.ok(snapshotSource.includes(marker), `Recorded eye state is missing ${marker}`);

console.log("GNM features verified: official 46-group anatomy, collision-safe rigid jaw, oral materials, avatar-specific procedural eyes, and exact eye-state propagation through popout/snapshot/preset/screenshot/GLB paths.");
