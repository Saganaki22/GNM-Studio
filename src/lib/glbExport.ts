import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { configureFacecapLoader } from "./ktx2";
import { flattenIdentityVertices } from "./identityVertices";
import type {
  AvatarKind, HeadPoseSettings, IdentityVertices, RecordedFrame, SkinMaterialSettings, TrackingFrame,
} from "../types";
import { mouthOpenInfluence, semanticExpressionNames, semanticInfluences } from "./retarget";
import { assetUrl } from "./assets";
import { avatarProfiles, facecapInfluences, facecapTargetNames } from "./avatarProfiles";
import { resolveHeadPose } from "./headPose";
import {
  createFacecapMouthMaterials, normalizeFacecapSkinUvs, splitFacecapMouthMaterials,
} from "./facecapModel";
import { disposeGnmEyeMaterials, installGnmEyeMaterials, type GnmEyeMaterialSet } from "./gnmEyes";
import {
  configureSkinTextureSet, disposeSkinTextureSet, loadSkinTextureSet, skinToneColor,
  skinDisplacementScale,
  type SkinTextureSet,
} from "./skinMaterial";

const gnmMorphNames = [...semanticExpressionNames, "jaw_open"] as const;

export type AnimatedGlbOptions = {
  avatarKind: AvatarKind;
  neutralFrame?: TrackingFrame | null;
  mirror?: boolean;
  headPose?: HeadPoseSettings;
};

async function loadAvatarSource(source: ArrayBuffer, avatarKind: AvatarKind) {
  const loader = new GLTFLoader();
  if (avatarKind !== "facecap") return loader.parseAsync(source, "");

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
  const ktx2Loader = configureFacecapLoader(loader, renderer);
  try {
    return await loader.parseAsync(source, "");
  } finally {
    ktx2Loader.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

const defaultHeadPose: HeadPoseSettings = {
  enabled: true,
  yawStrength: 1,
  pitchStrength: 1,
  rollStrength: 1,
  deadZone: 1.5,
  smoothing: 0.35,
};

export async function createAnimatedGlb(
  frames: RecordedFrame[],
  identityVertices?: IdentityVertices | null,
  manualExpressions: Record<string, number> = {},
  frozenExpressions: Record<string, number> = {},
  skin?: SkinMaterialSettings,
  options: AnimatedGlbOptions = { avatarKind: "gnm" },
) {
  if (!frames.length) throw new Error("No motion frames were recorded.");
  const profile = avatarProfiles[options.avatarKind];
  const response = await fetch(assetUrl(profile.asset));
  if (!response.ok) throw new Error(`Could not load ${profile.label} (${response.status}).`);
  const source = await response.arrayBuffer();
  const gltf = await loadAvatarSource(source, options.avatarKind);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.morphTargetDictionary) meshes.push(object);
  });
  const mesh = meshes[0];
  if (!mesh) throw new Error(`${profile.label} did not contain a morphable head mesh.`);

  const meshName = options.avatarKind === "facecap" ? "FaceCap_Head" : "GNM_Head_v3";
  mesh.name = meshName;
  if (options.avatarKind === "facecap") normalizeFacecapSkinUvs(mesh);
  if (options.avatarKind === "gnm" && identityVertices?.length) {
    const positions = flattenIdentityVertices(identityVertices);
    mesh.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    mesh.geometry.computeVertexNormals();
  }

  let skinTextures: SkinTextureSet | null = null;
  let gnmEyeMaterials: GnmEyeMaterialSet | null = null;
  const createdMaterials: THREE.Material[] = [];
  const material = new THREE.MeshPhysicalMaterial({
    color: skin ? skinToneColor(skin.tone) : 0xd8dde5,
    roughness: 0.48,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  createdMaterials.push(material);
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
    const displacementScale = skinDisplacementScale(mesh);
    material.displacementScale = displacementScale;
    material.displacementBias = -displacementScale * 0.5;
    material.aoMap = skinTextures.occlusion;
    material.aoMapIntensity = 0.38;
    material.specularIntensityMap = skinTextures.specular;
    material.specularIntensity = 0.55;
    material.roughness = 0.54;
  }
  if (options.avatarKind === "facecap") {
    const mouthMaterials = createFacecapMouthMaterials();
    createdMaterials.push(mouthMaterials.oral, mouthMaterials.teeth);
    splitFacecapMouthMaterials(mesh, material, mouthMaterials);
    const upperTeeth = gltf.scene.getObjectByName("mesh_3") ?? gltf.scene.getObjectByName("teeth");
    if (upperTeeth instanceof THREE.Mesh) upperTeeth.material = mouthMaterials.teeth;
  } else {
    gnmEyeMaterials = installGnmEyeMaterials(mesh, material);
  }

  const performanceRoot = new THREE.Group();
  performanceRoot.name = "GNM_Studio_Performance";
  performanceRoot.add(gltf.scene);
  const exportScene = new THREE.Scene();
  exportScene.name = "GNM_Studio_Capture";
  exportScene.add(performanceRoot);
  const times = new Float32Array(frames.map((frame) => frame.timestamp / 1000));
  const morphNames = options.avatarKind === "facecap" ? facecapTargetNames : gnmMorphNames;
  const values = new Float32Array(frames.length * morphNames.length);
  frames.forEach((frame, frameIndex) => {
    if (options.avatarKind === "facecap") {
      const influences = facecapInfluences(frame.blendshapes);
      facecapTargetNames.forEach((name, targetIndex) => {
        values[frameIndex * morphNames.length + targetIndex] =
          frozenExpressions[name] ?? Math.min(1, influences[name] + (manualExpressions[name] ?? 0));
      });
      return;
    }
    const semantic = semanticInfluences(frame.blendshapes);
    semanticExpressionNames.forEach((name, targetIndex) => {
      values[frameIndex * morphNames.length + targetIndex] =
        frozenExpressions[name] ?? Math.min(1, semantic[name] + (manualExpressions[name] ?? 0));
    });
    values[frameIndex * morphNames.length + semanticExpressionNames.length] =
      frozenExpressions.surprise ?? Math.min(
        1,
        mouthOpenInfluence(frame.blendshapes) + (manualExpressions.surprise ?? 0),
      );
  });

  const tracks: THREE.KeyframeTrack[] = [
    new THREE.NumberKeyframeTrack(
      `${meshName}.morphTargetInfluences`,
      times,
      values,
      THREE.InterpolateLinear,
    ),
  ];
  const quaternionValues = new Float32Array(frames.length * 4);
  let previousQuaternion: THREE.Quaternion | null = null;
  frames.forEach((frame, index) => {
    const trackingFrame: TrackingFrame = {
      timestamp: frame.timestamp,
      landmarks: [],
      blendshapes: [],
      matrix: frame.matrix,
    };
    const quaternion = resolveHeadPose(
      trackingFrame,
      options.neutralFrame ?? null,
      options.mirror ?? false,
      options.headPose ?? defaultHeadPose,
      previousQuaternion,
    );
    previousQuaternion = quaternion;
    quaternion.toArray(quaternionValues, index * 4);
  });
  tracks.push(new THREE.QuaternionKeyframeTrack("GNM_Studio_Performance.quaternion", times, quaternionValues));

  const clip = new THREE.AnimationClip(`${profile.shortLabel} Capture`, -1, tracks);
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
    disposeGnmEyeMaterials(gnmEyeMaterials);
    createdMaterials.forEach((entry) => entry.dispose());
  }
}
