import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { configureFacecapLoader } from "./ktx2";
import { flattenIdentityVertices } from "./identityVertices";
import type {
  AvatarKind, EyeColor, HeadPoseSettings, IdentityVertices, RecordedFrame, SkinMaterialSettings,
  TrackingFrame,
} from "../types";
import { mouthOpenInfluence, semanticExpressionNames, semanticInfluences } from "./retarget";
import { assetUrl } from "./assets";
import { avatarProfiles, facecapInfluences, facecapTargetNames } from "./avatarProfiles";
import { resolveHeadPose } from "./headPose";
import {
  createFacecapMouthMaterials, normalizeFacecapSkinUvs, splitFacecapMouthMaterials,
} from "./facecapModel";
import { disposeGnmEyeMaterials, installGnmEyeMaterials, type GnmEyeMaterialSet } from "./gnmEyes";
import { loadGnmAnatomy } from "./gnmAnatomy";
import { splitGnmHeadPose } from "./gnmPose";
import {
  configureSkinTextureSet, disposeSkinTextureSet, loadSkinTextureSet, skinToneColor,
  skinDisplacementScale,
  type SkinTextureSet,
} from "./skinMaterial";

export type AnimatedGlbOptions = {
  avatarKind: AvatarKind;
  neutralFrame?: TrackingFrame | null;
  mirror?: boolean;
  headPose?: HeadPoseSettings;
  eyeShaderEnabled?: boolean;
  eyeColor?: EyeColor;
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
    const anatomy = await loadGnmAnatomy();
    gnmEyeMaterials = installGnmEyeMaterials(
      mesh,
      material,
      1,
      options.eyeShaderEnabled ?? true,
      options.eyeColor ?? "green",
      anatomy,
    );
  }

  const performanceRoot = new THREE.Group();
  performanceRoot.name = "GNM_Studio_Performance";
  performanceRoot.add(gltf.scene);
  const exportScene = new THREE.Scene();
  exportScene.name = "GNM_Studio_Capture";
  exportScene.add(performanceRoot);
  const times = new Float32Array(frames.map((frame) => frame.timestamp / 1000));
  const morphNames = options.avatarKind === "facecap"
    ? [...facecapTargetNames]
    : Object.entries(mesh.morphTargetDictionary ?? {})
      .sort(([, first], [, second]) => first - second)
      .map(([name]) => name);
  const morphIndex = new Map(morphNames.map((name, index) => [name, index]));
  const values = new Float32Array(frames.length * morphNames.length);
  const setMorph = (frameIndex: number, name: string, value: number) => {
    const targetIndex = morphIndex.get(name);
    if (targetIndex !== undefined) values[frameIndex * morphNames.length + targetIndex] = value;
  };
  frames.forEach((frame, frameIndex) => {
    if (options.avatarKind === "facecap") {
      const influences = facecapInfluences(frame.blendshapes);
      facecapTargetNames.forEach((name) => {
        setMorph(frameIndex, name, frozenExpressions[name] ?? Math.min(1, influences[name] + (manualExpressions[name] ?? 0)));
      });
      return;
    }
    const semantic = semanticInfluences(frame.blendshapes);
    semanticExpressionNames.forEach((name) => {
      setMorph(frameIndex, name, frozenExpressions[name] ?? Math.min(1, semantic[name] + (manualExpressions[name] ?? 0)));
    });
    setMorph(
      frameIndex,
      "jaw_open",
      frozenExpressions.jaw_open ?? Math.min(
        1,
        (frame.mouthOpen ?? mouthOpenInfluence(frame.blendshapes)) + (manualExpressions.jaw_open ?? 0),
      ),
    );
  });

  const tracks: THREE.KeyframeTrack[] = [];
  const jointValue = (name: string) => frozenExpressions[name] ?? manualExpressions[name] ?? 0;
  const jointLimit = THREE.MathUtils.degToRad(30);
  const neckOffset = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    jointValue("joint_neck_pitch") * jointLimit,
    jointValue("joint_neck_yaw") * jointLimit,
    jointValue("joint_neck_roll") * jointLimit,
    "YXZ",
  ));
  const headOffset = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    jointValue("joint_head_pitch") * jointLimit,
    jointValue("joint_head_yaw") * jointLimit,
    jointValue("joint_head_roll") * jointLimit,
    "YXZ",
  ));
  const eyeLimit = THREE.MathUtils.degToRad(28);
  const leftEyeOffset = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    jointValue("joint_left_eye_pitch") * eyeLimit,
    jointValue("joint_left_eye_yaw") * eyeLimit,
    0,
    "YXZ",
  ));
  const rightEyeOffset = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    jointValue("joint_right_eye_pitch") * eyeLimit,
    jointValue("joint_right_eye_yaw") * eyeLimit,
    0,
    "YXZ",
  ));
  const rootQuaternionValues = new Float32Array(frames.length * 4);
  const jointQuaternionValues = options.avatarKind === "gnm"
    ? {
        neck: new Float32Array(frames.length * 4),
        head: new Float32Array(frames.length * 4),
        left_eye: new Float32Array(frames.length * 4),
        right_eye: new Float32Array(frames.length * 4),
      }
    : null;
  const setPoseMorphs = (frameIndex: number, name: string, quaternion: THREE.Quaternion) => {
    const matrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        setMorph(frameIndex, `pose_${name}_${row}${column}`, matrix.elements[column * 4 + row] - (row === column ? 1 : 0));
      }
    }
  };
  let previousQuaternion: THREE.Quaternion | null = null;
  frames.forEach((frame, index) => {
    const trackingFrame: TrackingFrame = {
      timestamp: frame.timestamp,
      landmarks: [],
      blendshapes: [],
      matrix: frame.matrix,
    };
    const quaternion = frame.avatarMotion
      ? new THREE.Quaternion().fromArray(frame.avatarMotion.quaternion).normalize()
      : resolveHeadPose(
        trackingFrame,
        options.neutralFrame ?? null,
        options.mirror ?? false,
        options.headPose ?? defaultHeadPose,
        previousQuaternion,
      );
    previousQuaternion = quaternion.clone();
    if (options.avatarKind === "gnm" && jointQuaternionValues) {
      const tracked = frame.avatarMotion?.gnmJoints ?? splitGnmHeadPose(quaternion);
      const local = {
        neck: new THREE.Quaternion().fromArray(tracked.neck).multiply(neckOffset).normalize(),
        head: new THREE.Quaternion().fromArray(tracked.head).multiply(headOffset).normalize(),
        left_eye: new THREE.Quaternion().fromArray(tracked.leftEye).multiply(leftEyeOffset).normalize(),
        right_eye: new THREE.Quaternion().fromArray(tracked.rightEye).multiply(rightEyeOffset).normalize(),
      };
      for (const [name, value] of Object.entries(local) as [keyof typeof local, THREE.Quaternion][]) {
        value.toArray(jointQuaternionValues[name], index * 4);
        setPoseMorphs(index, name, value);
      }
    } else {
      quaternion.multiply(neckOffset).multiply(headOffset).normalize();
      quaternion.toArray(rootQuaternionValues, index * 4);
    }
  });
  tracks.push(new THREE.NumberKeyframeTrack(
    `${meshName}.morphTargetInfluences`,
    times,
    values,
    THREE.InterpolateLinear,
  ));
  if (jointQuaternionValues) {
    for (const [name, value] of Object.entries(jointQuaternionValues)) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, value));
    }
  } else {
    tracks.push(new THREE.QuaternionKeyframeTrack("GNM_Studio_Performance.quaternion", times, rootQuaternionValues));
  }
  const positionValues = new Float32Array(frames.length * 3);
  const scaleValues = new Float32Array(frames.length * 3);
  const firstPosition = frames.find((frame) => frame.avatarMotion?.position)?.avatarMotion?.position ?? [0, 0, 0];
  const firstFaceHeight = Math.max(0.001, frames.find((frame) => frame.avatarMotion)?.avatarMotion?.faceHeight ?? 1);
  frames.forEach((frame, index) => {
    const position = frame.avatarMotion?.position ?? [0, 0, 0];
    const exportedPosition = options.neutralFrame
      ? position
      : position.map((value, axis) => value - firstPosition[axis]);
    positionValues.set([
      exportedPosition[0] + jointValue("joint_translate_x") * 0.65,
      exportedPosition[1] + jointValue("joint_translate_y") * 0.65,
      exportedPosition[2] + jointValue("joint_translate_z") * 0.65,
    ], index * 3);
    const fallbackScale = frame.avatarMotion ? frame.avatarMotion.faceHeight / firstFaceHeight : 1;
    const scale = options.neutralFrame && frame.avatarMotion?.scale
      ? frame.avatarMotion.scale
      : [fallbackScale, fallbackScale, fallbackScale];
    scaleValues.set(scale, index * 3);
  });
  tracks.push(new THREE.VectorKeyframeTrack("GNM_Studio_Performance.position", times, positionValues));
  tracks.push(new THREE.VectorKeyframeTrack("GNM_Studio_Performance.scale", times, scaleValues));

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
