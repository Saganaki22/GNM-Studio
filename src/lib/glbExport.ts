import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { RecordedFrame, SkinMaterialSettings } from "../types";
import { mouthOpenInfluence, semanticExpressionNames, semanticInfluences } from "./retarget";
import { assetUrl } from "./assets";
import {
  configureSkinTextureSet, disposeSkinTextureSet, loadSkinTextureSet, skinToneColor,
  type SkinTextureSet,
} from "./skinMaterial";

const runtimeMorphNames = [...semanticExpressionNames, "jaw_open"] as const;

export async function createAnimatedGlb(
  frames: RecordedFrame[],
  identityVertices?: number[][] | null,
  manualExpressions: Record<string, number> = {},
  frozenExpressions: Record<string, number> = {},
  skin?: SkinMaterialSettings,
) {
  if (!frames.length) throw new Error("No motion frames were recorded.");
  const response = await fetch(assetUrl("models/gnm_head_runtime.glb"));
  const source = await response.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(source, "");
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.morphTargetDictionary) meshes.push(object);
  });
  const mesh = meshes[0];
  if (!mesh) throw new Error("The GNM runtime mesh did not contain morph targets.");

  mesh.name = "GNM_Head_v3";
  if (identityVertices?.length) {
    const positions = new Float32Array(identityVertices.length * 3);
    identityVertices.forEach((vertex, index) => {
      positions[index * 3] = vertex[0];
      positions[index * 3 + 1] = vertex[1];
      positions[index * 3 + 2] = vertex[2];
    });
    mesh.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    mesh.geometry.computeVertexNormals();
  }

  let skinTextures: SkinTextureSet | null = null;
  const material = new THREE.MeshPhysicalMaterial({
    color: skin ? skinToneColor(skin.tone) : 0xd8dde5,
    roughness: 0.48,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  if (skin?.enabled) {
    skinTextures = await loadSkinTextureSet(skin.tone, skin.feather);
    configureSkinTextureSet(skinTextures, skin.scale, skin.rotation);
    const uv = mesh.geometry.getAttribute("uv");
    if (uv && !mesh.geometry.getAttribute("uv1")) mesh.geometry.setAttribute("uv1", uv.clone());
    material.color.setHex(0xffffff);
    material.map = skinTextures.color;
    material.normalMap = skinTextures.normal;
    material.normalScale.set(0.42, 0.42);
    material.displacementMap = skinTextures.displacement;
    material.displacementScale = 0.00055;
    material.displacementBias = -0.000275;
    material.aoMap = skinTextures.occlusion;
    material.aoMapIntensity = 0.38;
    material.specularIntensityMap = skinTextures.specular;
    material.specularIntensity = 0.55;
    material.roughness = 0.54;
  }
  mesh.material = material;

  const performanceRoot = new THREE.Group();
  performanceRoot.name = "GNM_Performance";
  performanceRoot.add(gltf.scene);
  const exportScene = new THREE.Scene();
  exportScene.name = "GNM_Studio_Capture";
  exportScene.add(performanceRoot);
  const times = new Float32Array(frames.map((frame) => frame.timestamp / 1000));
  const values = new Float32Array(frames.length * runtimeMorphNames.length);
  frames.forEach((frame, frameIndex) => {
    const semantic = semanticInfluences(frame.blendshapes);
    semanticExpressionNames.forEach((name, targetIndex) => {
      values[frameIndex * runtimeMorphNames.length + targetIndex] =
        frozenExpressions[name] ?? Math.min(1, semantic[name] + (manualExpressions[name] ?? 0));
    });
    values[frameIndex * runtimeMorphNames.length + semanticExpressionNames.length] =
      frozenExpressions.surprise ?? Math.min(
        1,
        mouthOpenInfluence(frame.blendshapes) + (manualExpressions.surprise ?? 0),
      );
  });

  const tracks: THREE.KeyframeTrack[] = [
    new THREE.NumberKeyframeTrack(
      "GNM_Head_v3.morphTargetInfluences",
      times,
      values,
      THREE.InterpolateLinear,
    ),
  ];
  const quaternionValues = new Float32Array(frames.length * 4);
  frames.forEach((frame, index) => {
    const quaternion = new THREE.Quaternion();
    if (frame.matrix.length === 16) {
      const matrix = new THREE.Matrix4().fromArray(frame.matrix);
      const ignoredPosition = new THREE.Vector3();
      const ignoredScale = new THREE.Vector3();
      matrix.decompose(ignoredPosition, quaternion, ignoredScale);
      const sourceEuler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
      quaternion.setFromEuler(new THREE.Euler(-sourceEuler.x, sourceEuler.y, sourceEuler.z, "XYZ"));
    }
    quaternion.toArray(quaternionValues, index * 4);
  });
  tracks.push(new THREE.QuaternionKeyframeTrack("GNM_Performance.quaternion", times, quaternionValues));

  const clip = new THREE.AnimationClip("GNM Capture", -1, tracks);
  const exporter = new GLTFExporter();
  try {
    const exported = await exporter.parseAsync(exportScene, {
      binary: true,
      animations: [clip],
      onlyVisible: false,
      trs: true,
    });
    if (!(exported instanceof ArrayBuffer)) throw new Error("Expected a binary GLB export.");
    return new Uint8Array(exported);
  } finally {
    disposeSkinTextureSet(skinTextures);
    material.dispose();
  }
}
