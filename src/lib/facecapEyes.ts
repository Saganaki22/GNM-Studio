import * as THREE from "three";
import type { EyeColor } from "../types";
import { eyeColorPalette } from "./gnmEyes";

const eyeNames = ["eyeLeft", "eyeRight"] as const;

export type FacecapEyeMaterialSet = { materials: THREE.Material[] };

function pupilMaterial(source: THREE.Material, geometry: THREE.BufferGeometry, enabled: boolean, color: EyeColor) {
  const material = source.clone();
  material.name = `${source.name || "FaceCap eye"} + GNM Studio pupils`;
  if (material instanceof THREE.MeshPhysicalMaterial) {
    material.clearcoat = Math.max(material.clearcoat, 0.34);
    material.clearcoatRoughness = Math.min(material.clearcoatRoughness, 0.16);
  }

  geometry.computeBoundingBox();
  const center = geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  const palette = eyeColorPalette(color);
  const uniforms = {
    enabled: { value: enabled ? 1 : 0 },
    inner: { value: new THREE.Color(palette.inner) },
    outer: { value: new THREE.Color(palette.swatch) },
  };
  material.userData.gnmStudioEyeUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.facecapEyeCenter = { value: center };
    shader.uniforms.facecapEyeShaderEnabled = uniforms.enabled;
    shader.uniforms.facecapIrisInner = uniforms.inner;
    shader.uniforms.facecapIrisOuter = uniforms.outer;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 facecapEyeCenter;\nvarying vec3 vFacecapEyeDirection;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFacecapEyeDirection = normalize(transformed - facecapEyeCenter);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vFacecapEyeDirection;\nuniform float facecapEyeShaderEnabled;\nuniform vec3 facecapIrisInner;\nuniform vec3 facecapIrisOuter;",
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        vec3 eyeDirection = normalize(vFacecapEyeDirection);
        float eyeFront = smoothstep(0.04, 0.20, eyeDirection.y);
        float eyeRadius = length(eyeDirection.xz);
        float irisMask = (1.0 - smoothstep(0.27, 0.351, eyeRadius)) * eyeFront;
        float pupilMask = (1.0 - smoothstep(0.105, 0.17, eyeRadius)) * eyeFront;
        float limbalMask = smoothstep(0.261, 0.3015, eyeRadius)
          * (1.0 - smoothstep(0.3285, 0.3645, eyeRadius)) * eyeFront;
        vec3 irisColour = mix(facecapIrisInner, facecapIrisOuter, smoothstep(0.072, 0.306, eyeRadius));
        float irisAngle = atan(eyeDirection.z, eyeDirection.x);
        float fibre = sin(irisAngle * 67.0 + eyeRadius * 146.0) * 0.5
          + sin(irisAngle * 113.0 - eyeRadius * 91.0) * 0.28;
        float fibreBand = smoothstep(0.145, 0.20, eyeRadius) * (1.0 - smoothstep(0.31, 0.345, eyeRadius));
        irisColour *= 0.91 + fibre * fibreBand * 0.16;
        float collaretteMask = smoothstep(0.145, 0.175, eyeRadius)
          * (1.0 - smoothstep(0.19, 0.218, eyeRadius)) * eyeFront;
        diffuseColor.rgb = mix(diffuseColor.rgb, irisColour, irisMask * facecapEyeShaderEnabled);
        diffuseColor.rgb = mix(diffuseColor.rgb, facecapIrisInner * 1.18, collaretteMask * 0.48 * facecapEyeShaderEnabled);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.004, 0.006, 0.005), pupilMask * facecapEyeShaderEnabled);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.025, 0.021), limbalMask * 0.82 * facecapEyeShaderEnabled);`,
      );
  };
  material.customProgramCacheKey = () => "gnm-studio-facecap-pupils-v3";
  material.needsUpdate = true;
  return material;
}

/** Preserve FaceCap's eye texture while adding a reliable procedural iris/pupil layer. */
export function installFacecapPupils(
  model: THREE.Object3D,
  enabled = true,
  color: EyeColor = "green",
): FacecapEyeMaterialSet {
  const materials: THREE.Material[] = [];
  for (const name of eyeNames) {
    model.getObjectByName(name)?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => {
          const created = pupilMaterial(material, object.geometry, enabled, color);
          materials.push(created);
          return created;
        })
        : pupilMaterial(object.material, object.geometry, enabled, color);
      if (!Array.isArray(object.material)) materials.push(object.material);
    });
  }
  return { materials };
}

export function updateFacecapPupils(materials: FacecapEyeMaterialSet | null, enabled: boolean, color: EyeColor) {
  if (!materials) return;
  const palette = eyeColorPalette(color);
  for (const material of materials.materials) {
    const uniforms = material.userData.gnmStudioEyeUniforms as {
      enabled: { value: number };
      inner: { value: THREE.Color };
      outer: { value: THREE.Color };
    } | undefined;
    if (!uniforms) continue;
    uniforms.enabled.value = enabled ? 1 : 0;
    uniforms.inner.value.set(palette.inner);
    uniforms.outer.value.set(palette.swatch);
  }
}

export function disposeFacecapPupils(materials: FacecapEyeMaterialSet | null) {
  materials?.materials.forEach((material) => material.dispose());
}
