import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../public/models/facecap.glb", import.meta.url));
const source = readFileSync(path);
if (source.toString("ascii", 0, 4) !== "glTF") throw new Error("facecap.glb has an invalid GLB header");
const declaredLength = source.readUInt32LE(8);
if (declaredLength !== source.length) throw new Error(`facecap.glb length mismatch: ${declaredLength} != ${source.length}`);
const jsonLength = source.readUInt32LE(12);
const jsonType = source.toString("ascii", 16, 20);
if (jsonType !== "JSON") throw new Error("facecap.glb does not begin with a JSON chunk");
const gltf = JSON.parse(source.toString("utf8", 20, 20 + jsonLength).trim());
for (const extension of ["KHR_texture_basisu", "EXT_meshopt_compression"]) {
  if (!gltf.extensionsUsed?.includes(extension)) {
    throw new Error(`facecap.glb no longer declares its required ${extension} extension`);
  }
}
const loaderSource = readFileSync(fileURLToPath(new URL("../src/lib/ktx2.ts", import.meta.url)), "utf8");
for (const setupCall of ["setKTX2Loader", "setMeshoptDecoder"]) {
  if (!loaderSource.includes(setupCall)) throw new Error(`FaceCap runtime loader is missing ${setupCall}`);
}
const eyeSource = readFileSync(fileURLToPath(new URL("../src/lib/facecapEyes.ts", import.meta.url)), "utf8");
for (const marker of ["eyeLeft", "eyeRight", "pupilMask", "irisMask"]) {
  if (!eyeSource.includes(marker)) throw new Error(`FaceCap procedural pupil layer is missing ${marker}`);
}
const stageSource = readFileSync(fileURLToPath(new URL("../src/components/Stage.tsx", import.meta.url)), "utf8");
if (!stageSource.includes("installFacecapPupils(model)")) throw new Error("FaceCap Stage does not install its pupil layer");
for (const marker of [
  "normalizeFacecapSkinUvs(face)", "skinDisplacementScale(faceRef.current)",
  "splitFacecapMouthMaterials(face", "createFacecapMouthMaterials",
]) {
  if (!stageSource.includes(marker)) throw new Error(`FaceCap Stage PBR path is missing ${marker}`);
}
const exportSource = readFileSync(fileURLToPath(new URL("../src/lib/glbExport.ts", import.meta.url)), "utf8");
for (const marker of [
  "normalizeFacecapSkinUvs(mesh)", "skinDisplacementScale(mesh)",
  "splitFacecapMouthMaterials(mesh", "mouthMaterials.teeth",
]) {
  if (!exportSource.includes(marker)) throw new Error(`FaceCap GLB PBR path is missing ${marker}`);
}

const expectedTargets = [
  "browInnerUp", "browDown_L", "browDown_R", "browOuterUp_L", "browOuterUp_R",
  "eyeLookUp_L", "eyeLookUp_R", "eyeLookDown_L", "eyeLookDown_R", "eyeLookIn_L",
  "eyeLookIn_R", "eyeLookOut_L", "eyeLookOut_R", "eyeBlink_L", "eyeBlink_R",
  "eyeSquint_L", "eyeSquint_R", "eyeWide_L", "eyeWide_R", "cheekPuff",
  "cheekSquint_L", "cheekSquint_R", "noseSneer_L", "noseSneer_R", "jawOpen",
  "jawForward", "jawLeft", "jawRight", "mouthFunnel", "mouthPucker", "mouthLeft",
  "mouthRight", "mouthRollUpper", "mouthRollLower", "mouthShrugUpper", "mouthShrugLower",
  "mouthClose", "mouthSmile_L", "mouthSmile_R", "mouthFrown_L", "mouthFrown_R",
  "mouthDimple_L", "mouthDimple_R", "mouthUpperUp_L", "mouthUpperUp_R",
  "mouthLowerDown_L", "mouthLowerDown_R", "mouthPress_L", "mouthPress_R",
  "mouthStretch_L", "mouthStretch_R", "tongueOut",
];
const morphMesh = gltf.meshes.find((mesh) => mesh.primitives?.some((primitive) => primitive.targets?.length === 52));
if (!morphMesh) throw new Error("facecap.glb is missing its 52-target morph mesh");
const names = morphMesh.extras?.targetNames;
if (!Array.isArray(names) || names.length !== 52) throw new Error("facecap.glb is missing 52 named morph targets");
for (const name of expectedTargets) if (!names.includes(name)) throw new Error(`facecap.glb is missing morph target ${name}`);
const morphPrimitive = morphMesh.primitives.find((primitive) => primitive.targets?.length === 52);
if (morphPrimitive.attributes?.POSITION === undefined || morphPrimitive.attributes?.NORMAL === undefined || morphPrimitive.attributes?.TEXCOORD_0 === undefined) {
  throw new Error("facecap.glb morph mesh requires positions, normals and UVs for PBR rendering");
}
const nodeNames = new Set(gltf.nodes.map((node) => node.name));
for (const name of ["head", "teeth", "eyeLeft", "eyeRight"]) {
  if (!nodeNames.has(name)) throw new Error(`facecap.glb is missing required node ${name}`);
}
const mouthSource = readFileSync(fileURLToPath(new URL("../src/lib/facecapModel.ts", import.meta.url)), "utf8");
for (const marker of ["GNM Studio FaceCap gums and tongue", "GNM Studio FaceCap enamel", "componentSize >= 24", "componentSize >= 96"]) {
  if (!mouthSource.includes(marker)) throw new Error(`FaceCap oral material implementation is missing ${marker}`);
}
console.log(`FaceCap asset verified: ${source.length.toLocaleString()} bytes, 52 named morphs, KTX2 + Meshopt ready, white upper/lower teeth, pink oral tissue, and procedural pupils.`);
