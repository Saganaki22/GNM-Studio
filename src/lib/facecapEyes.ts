import * as THREE from "three";

const eyeNames = ["eyeLeft", "eyeRight"] as const;

function pupilMaterial(source: THREE.Material, geometry: THREE.BufferGeometry) {
  const material = source.clone();
  material.name = `${source.name || "FaceCap eye"} + GNM Studio pupils`;

  geometry.computeBoundingBox();
  const center = geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.facecapEyeCenter = { value: center };
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
        "#include <common>\nvarying vec3 vFacecapEyeDirection;",
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
        vec3 irisInner = vec3(0.055, 0.078, 0.040);
        vec3 irisOuter = vec3(0.235, 0.145, 0.055);
        vec3 irisColour = mix(irisInner, irisOuter, smoothstep(0.072, 0.306, eyeRadius));
        diffuseColor.rgb = mix(diffuseColor.rgb, irisColour, irisMask);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.004, 0.006, 0.005), pupilMask);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.025, 0.021), limbalMask * 0.82);`,
      );
  };
  material.customProgramCacheKey = () => "gnm-studio-facecap-pupils-v1";
  material.needsUpdate = true;
  return material;
}

/** Preserve FaceCap's eye texture while adding a reliable procedural iris/pupil layer. */
export function installFacecapPupils(model: THREE.Object3D) {
  for (const name of eyeNames) {
    model.getObjectByName(name)?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => pupilMaterial(material, object.geometry))
        : pupilMaterial(object.material, object.geometry);
    });
  }
}
