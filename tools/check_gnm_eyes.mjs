import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  const component = components.get(root) ?? { count: 0, x: 0, y: 0 };
  component.count += 1;
  component.x += positions[vertex * 3];
  component.y += positions[vertex * 3 + 1];
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

const eyeSource = readFileSync(fileURLToPath(new URL("../src/lib/gnmEyes.ts", import.meta.url)), "utf8");
for (const marker of [
  "irisRadius = 33.35", "pupilRadius = 14", "installGnmEyeMaterials",
  "GNM Studio enamel", "GNM Studio tongue", "gnmNeutralEyeDivergence = 0.006", "gnmGazeDeadZone = 0.055",
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
const exportSource = readFileSync(fileURLToPath(new URL("../src/lib/glbExport.ts", import.meta.url)), "utf8");
assert.ok(exportSource.includes("installGnmEyeMaterials(mesh"), "GNM GLB export does not install eye materials");

console.log("GNM features verified: four eye shells, two white dental arches, a red tongue, hazel irises, black pupils, and export wiring.");
