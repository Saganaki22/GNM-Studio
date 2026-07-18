import * as THREE from "three";
import type { EyeColor } from "../types";
import { anatomyMembership, type GnmAnatomy } from "./gnmAnatomy.ts";

type EyeSide = "left" | "right";

export const gnmNeutralEyeDivergence = 0.006;
const gnmGazeDeadZone = 0.055;

/** Keep neutral pupils optically centred while ignoring tiny false "look in" scores. */
export function gnmEyeTextureOffset(side: EyeSide, horizontalGaze: number) {
  const deadZonedGaze = Math.sign(horizontalGaze) * Math.max(0, Math.abs(horizontalGaze) - gnmGazeDeadZone);
  const opticalCenter = side === "left" ? gnmNeutralEyeDivergence : -gnmNeutralEyeDivergence;
  return opticalCenter - deadZonedGaze * 0.04;
}

export type GnmEyeMaterialSet = {
  left: THREE.MeshPhysicalMaterial;
  right: THREE.MeshPhysicalMaterial;
  teeth: THREE.MeshPhysicalMaterial;
  tongue: THREE.MeshPhysicalMaterial;
  gums: THREE.MeshPhysicalMaterial;
  mouthInterior: THREE.MeshPhysicalMaterial;
  textures: { left: THREE.CanvasTexture; right: THREE.CanvasTexture };
};

export const eyeColorOptions: ReadonlyArray<{
  id: EyeColor;
  label: string;
  swatch: string;
  inner: string;
  middle: string;
  outer: string;
}> = [
  { id: "green", label: "Green", swatch: "#718044", inner: "#364d27", middle: "#718044", outer: "#332416" },
  { id: "blue", label: "Blue", swatch: "#5388ad", inner: "#173a55", middle: "#5388ad", outer: "#162736" },
  { id: "light_brown", label: "Light brown", swatch: "#a97843", inner: "#5b351d", middle: "#a97843", outer: "#3a2418" },
  { id: "dark_brown", label: "Dark brown", swatch: "#51301f", inner: "#21130d", middle: "#51301f", outer: "#140c09" },
];

export function eyeColorPalette(color: EyeColor) {
  return eyeColorOptions.find((option) => option.id === color) ?? eyeColorOptions[0];
}

function drawEyeTexture(canvas: HTMLCanvasElement, enabled: boolean, color: EyeColor) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not create the GNM eye texture.");
  context.clearRect(0, 0, canvas.width, canvas.height);
  const sclera = context.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 18,
    canvas.width / 2, canvas.height / 2, canvas.height * 0.72,
  );
  sclera.addColorStop(0, "#f5f1e8");
  sclera.addColorStop(0.72, "#eee9df");
  sclera.addColorStop(1, "#d9b9b5");
  context.fillStyle = sclera;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!enabled) return;
  const palette = eyeColorPalette(color);
  const x = canvas.width / 2;
  const y = canvas.height / 2;
  const irisRadius = 33.35; // 15% larger than the previous GNM hazel iris.
  const pupilRadius = 14; // Preserve the existing black-pupil angle.

  // Low-contrast peripheral vessels keep the sclera from looking like plain
  // white plastic. The deterministic curves avoid texture flicker on redraw.
  context.save();
  context.lineCap = "round";
  for (let vessel = 0; vessel < 18; vessel += 1) {
    const angle = vessel * 2.3999632297 + 0.31;
    const startRadius = 68 + ((vessel * 17) % 25);
    const endRadius = Math.max(canvas.width, canvas.height) * 0.42;
    const bend = Math.sin(vessel * 4.71) * 9;
    context.beginPath();
    context.moveTo(x + Math.cos(angle) * startRadius, y + Math.sin(angle) * startRadius * 0.7);
    context.quadraticCurveTo(
      x + Math.cos(angle + 0.12) * (startRadius + endRadius) * 0.48,
      y + Math.sin(angle + 0.12) * (startRadius + endRadius) * 0.34 + bend,
      x + Math.cos(angle + 0.035) * endRadius,
      y + Math.sin(angle + 0.035) * endRadius * 0.68,
    );
    context.strokeStyle = vessel % 3 === 0 ? "rgba(142, 54, 58, 0.17)" : "rgba(174, 84, 83, 0.10)";
    context.lineWidth = vessel % 4 === 0 ? 0.75 : 0.45;
    context.stroke();
  }
  context.restore();

  context.fillStyle = "#11170f";
  context.beginPath();
  context.arc(x, y, irisRadius + 2, 0, Math.PI * 2);
  context.fill();
  const iris = context.createRadialGradient(x, y, pupilRadius, x, y, irisRadius);
  iris.addColorStop(0, palette.inner);
  iris.addColorStop(0.52, palette.middle);
  iris.addColorStop(0.8, palette.swatch);
  iris.addColorStop(1, palette.outer);
  context.fillStyle = iris;
  context.beginPath();
  context.arc(x, y, irisRadius, 0, Math.PI * 2);
  context.fill();

  // Layer fine radial fibres and an irregular collarette over the base iris.
  // This is generated locally and remains cheap because it only redraws when
  // the selected eye colour changes.
  context.save();
  context.beginPath();
  context.arc(x, y, irisRadius - 1, 0, Math.PI * 2);
  context.clip();
  for (let fibre = 0; fibre < 144; fibre += 1) {
    const angle = (fibre / 144) * Math.PI * 2 + Math.sin(fibre * 12.9898) * 0.018;
    const innerRadius = pupilRadius + 1.2 + (Math.sin(fibre * 4.17) + 1) * 1.2;
    const outerRadius = irisRadius - 1.4 - (Math.sin(fibre * 7.31) + 1) * 1.4;
    context.beginPath();
    context.moveTo(x + Math.cos(angle) * innerRadius, y + Math.sin(angle) * innerRadius);
    context.lineTo(x + Math.cos(angle + Math.sin(fibre) * 0.008) * outerRadius, y + Math.sin(angle + Math.sin(fibre) * 0.008) * outerRadius);
    context.strokeStyle = fibre % 4 === 0 ? `${palette.inner}b8` : fibre % 3 === 0 ? `${palette.outer}8f` : "rgba(245, 223, 170, 0.24)";
    context.lineWidth = fibre % 5 === 0 ? 1.15 : 0.58;
    context.stroke();
  }
  context.strokeStyle = `${palette.inner}d8`;
  context.lineWidth = 2.4;
  context.beginPath();
  context.arc(x, y, pupilRadius + 3.4, 0, Math.PI * 2);
  context.stroke();
  context.restore();

  context.strokeStyle = "rgba(12, 15, 13, 0.78)";
  context.lineWidth = 3.2;
  context.beginPath();
  context.arc(x, y, irisRadius - 0.8, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#010201";
  context.beginPath();
  context.arc(x, y, pupilRadius, 0, Math.PI * 2);
  context.fill();
}

function eyeTexture(side: EyeSide, enabled: boolean, color: EyeColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  drawEyeTexture(canvas, enabled, color);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.offset.x = gnmEyeTextureOffset(side, 0);
  texture.needsUpdate = true;
  return texture;
}

function eyeMaterial(texture: THREE.CanvasTexture, opacity: number) {
  return new THREE.MeshPhysicalMaterial({
    name: "GNM Studio hazel eye",
    color: 0xffffff,
    map: texture,
    roughness: 0.26,
    metalness: 0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.18,
    specularIntensity: 0.7,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });
}

function createMaterials(opacity: number, enabled: boolean, color: EyeColor): GnmEyeMaterialSet {
  const left = eyeTexture("left", enabled, color);
  const right = eyeTexture("right", enabled, color);
  return {
    left: eyeMaterial(left, opacity),
    right: eyeMaterial(right, opacity),
    teeth: new THREE.MeshPhysicalMaterial({
      name: "GNM Studio enamel",
      color: 0xf4eee5,
      roughness: 0.3,
      metalness: 0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.24,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    }),
    tongue: new THREE.MeshPhysicalMaterial({
      name: "GNM Studio tongue",
      color: 0xb6535f,
      roughness: 0.58,
      metalness: 0,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    }),
    gums: new THREE.MeshPhysicalMaterial({
      name: "GNM Studio gums",
      color: 0xc77982,
      roughness: 0.54,
      metalness: 0,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    }),
    mouthInterior: new THREE.MeshPhysicalMaterial({
      name: "GNM Studio mouth interior",
      color: 0x52282f,
      roughness: 0.7,
      metalness: 0,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    }),
    textures: { left, right },
  };
}

/** Split GNM's disconnected eyes, dental arches and tongue from the skin. */
export function installGnmEyeMaterials(
  mesh: THREE.Mesh,
  skinMaterial: THREE.Material,
  opacity = 1,
  eyeShaderEnabled = true,
  eyeColor: EyeColor = "green",
  anatomy: GnmAnatomy | null = null,
) {
  const materials = createMaterials(opacity, eyeShaderEnabled, eyeColor);
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const sourceIndex = geometry.getIndex();
  if (!positions || !sourceIndex) {
    mesh.material = skinMaterial;
    return materials;
  }

  if (!geometry.userData.gnmStudioFeatureMaterialsPartitioned && anatomy?.vertexCount === positions.count) {
    const left = anatomyMembership(anatomy, "left_eye");
    const right = anatomyMembership(anatomy, "right_eye");
    const teeth = anatomyMembership(anatomy, "teeth");
    const tongue = anatomyMembership(anatomy, "tongue");
    const gums = anatomyMembership(anatomy, "gums");
    const mouth = anatomyMembership(anatomy, "mouth_sock");
    const feature = new Uint8Array(positions.count);
    const eyeCenters = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    const eyeCounts = { left: 0, right: 0 };
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      if (left[vertex]) {
        feature[vertex] = 1;
        eyeCenters.left.add(new THREE.Vector3(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)));
        eyeCounts.left += 1;
      } else if (right[vertex]) {
        feature[vertex] = 2;
        eyeCenters.right.add(new THREE.Vector3(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)));
        eyeCounts.right += 1;
      } else if (tongue[vertex]) feature[vertex] = 4;
      else if (mouth[vertex]) feature[vertex] = 6;
      else if (gums[vertex]) feature[vertex] = 5;
      else if (teeth[vertex]) feature[vertex] = 3;
    }
    eyeCenters.left.multiplyScalar(1 / Math.max(1, eyeCounts.left));
    eyeCenters.right.multiplyScalar(1 / Math.max(1, eyeCounts.right));

    const originalUv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
    const uvArray = new Float32Array(positions.count * 2);
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      uvArray[vertex * 2] = originalUv?.getX(vertex) ?? 0;
      uvArray[vertex * 2 + 1] = originalUv?.getY(vertex) ?? 0;
      const side = feature[vertex] === 1 ? "left" : feature[vertex] === 2 ? "right" : null;
      if (!side) continue;
      const direction = new THREE.Vector3(
        positions.getX(vertex) - eyeCenters[side].x,
        positions.getY(vertex) - eyeCenters[side].y,
        positions.getZ(vertex) - eyeCenters[side].z,
      ).normalize();
      uvArray[vertex * 2] = 0.5 + Math.atan2(direction.x, direction.z) / (Math.PI * 2);
      uvArray[vertex * 2 + 1] = 0.5 - Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) / Math.PI;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));

    const groups = Array.from({ length: 7 }, () => [] as number[]);
    for (let offset = 0; offset + 2 < sourceIndex.count; offset += 3) {
      const vertices = [sourceIndex.getX(offset), sourceIndex.getX(offset + 1), sourceIndex.getX(offset + 2)];
      const votes = new Uint8Array(7);
      for (const vertex of vertices) votes[feature[vertex]] += 1;
      let category = feature[vertices[0]];
      for (let candidate = 0; candidate < votes.length; candidate += 1) {
        if (votes[candidate] > votes[category]) category = candidate;
      }
      groups[category].push(...vertices);
    }
    const totalIndices = groups.reduce((sum, group) => sum + group.length, 0);
    const IndexArray = positions.count > 65_535 ? Uint32Array : Uint16Array;
    const combined = new IndexArray(totalIndices);
    geometry.clearGroups();
    let offset = 0;
    groups.forEach((group, materialIndex) => {
      combined.set(group, offset);
      geometry.addGroup(offset, group.length, materialIndex);
      offset += group.length;
    });
    geometry.setIndex(new THREE.BufferAttribute(combined, 1));
    geometry.userData.gnmStudioFeatureMaterialsPartitioned = "official-anatomy-v1";
  }

  if (!geometry.userData.gnmStudioFeatureMaterialsPartitioned) {
    const parent = Int32Array.from({ length: positions.count }, (_, index) => index);
    const size = new Int32Array(positions.count).fill(1);
    const find = (input: number) => {
      let value = input;
      while (parent[value] !== value) {
        parent[value] = parent[parent[value]];
        value = parent[value];
      }
      return value;
    };
    const join = (first: number, second: number) => {
      let a = find(first);
      let b = find(second);
      if (a === b) return;
      if (size[a] < size[b]) [a, b] = [b, a];
      parent[b] = a;
      size[a] += size[b];
    };
    for (let offset = 0; offset + 2 < sourceIndex.count; offset += 3) {
      const a = sourceIndex.getX(offset);
      const b = sourceIndex.getX(offset + 1);
      const c = sourceIndex.getX(offset + 2);
      join(a, b);
      join(b, c);
    }

    const components = new Map<number, { vertices: number[]; center: THREE.Vector3 }>();
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      const root = find(vertex);
      const component = components.get(root) ?? { vertices: [], center: new THREE.Vector3() };
      component.vertices.push(vertex);
      component.center.x += positions.getX(vertex);
      component.center.y += positions.getY(vertex);
      component.center.z += positions.getZ(vertex);
      components.set(root, component);
    }
    const eyeRoots = new Map<number, EyeSide>();
    const mouthRoots = new Map<number, "teeth" | "tongue">();
    for (const [root, component] of components) {
      component.center.multiplyScalar(1 / component.vertices.length);
      if (component.vertices.length >= 350 && component.vertices.length <= 420 && component.center.y > 0.27) {
        eyeRoots.set(root, component.center.x < 0 ? "left" : "right");
      } else if (component.vertices.length >= 1_200 && component.vertices.length <= 1_700 && component.center.y < 0.27) {
        mouthRoots.set(root, "teeth");
      } else if (component.vertices.length >= 800 && component.vertices.length <= 1_100 && component.center.y < 0.27) {
        mouthRoots.set(root, "tongue");
      }
    }

    const originalUv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
    const uvArray = new Float32Array(positions.count * 2);
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      uvArray[vertex * 2] = originalUv?.getX(vertex) ?? 0;
      uvArray[vertex * 2 + 1] = originalUv?.getY(vertex) ?? 0;
      const root = find(vertex);
      if (!eyeRoots.has(root)) continue;
      const center = components.get(root)!.center;
      const direction = new THREE.Vector3(
        positions.getX(vertex) - center.x,
        positions.getY(vertex) - center.y,
        positions.getZ(vertex) - center.z,
      ).normalize();
      uvArray[vertex * 2] = 0.5 + Math.atan2(direction.x, direction.z) / (Math.PI * 2);
      uvArray[vertex * 2 + 1] = 0.5 - Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) / Math.PI;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));

    const groups: Record<"skin" | EyeSide | "teeth" | "tongue", number[]> = {
      skin: [], left: [], right: [], teeth: [], tongue: [],
    };
    for (let offset = 0; offset + 2 < sourceIndex.count; offset += 3) {
      const a = sourceIndex.getX(offset);
      const side = eyeRoots.get(find(a));
      const mouth = mouthRoots.get(find(a));
      const destination = side ? groups[side] : mouth ? groups[mouth] : groups.skin;
      destination.push(a, sourceIndex.getX(offset + 1), sourceIndex.getX(offset + 2));
    }
    const IndexArray = positions.count > 65_535 ? Uint32Array : Uint16Array;
    const combined = new IndexArray(
      groups.skin.length + groups.left.length + groups.right.length + groups.teeth.length + groups.tongue.length,
    );
    combined.set(groups.skin, 0);
    combined.set(groups.left, groups.skin.length);
    combined.set(groups.right, groups.skin.length + groups.left.length);
    combined.set(groups.teeth, groups.skin.length + groups.left.length + groups.right.length);
    combined.set(
      groups.tongue,
      groups.skin.length + groups.left.length + groups.right.length + groups.teeth.length,
    );
    geometry.setIndex(new THREE.BufferAttribute(combined, 1));
    geometry.clearGroups();
    geometry.addGroup(0, groups.skin.length, 0);
    geometry.addGroup(groups.skin.length, groups.left.length, 1);
    geometry.addGroup(groups.skin.length + groups.left.length, groups.right.length, 2);
    geometry.addGroup(groups.skin.length + groups.left.length + groups.right.length, groups.teeth.length, 3);
    geometry.addGroup(
      groups.skin.length + groups.left.length + groups.right.length + groups.teeth.length,
      groups.tongue.length,
      4,
    );
    geometry.userData.gnmStudioFeatureMaterialsPartitioned = true;
  }

  mesh.material = [
    skinMaterial, materials.left, materials.right, materials.teeth,
    materials.tongue, materials.gums, materials.mouthInterior,
  ];
  return materials;
}

export function updateGnmEyeMaterials(materials: GnmEyeMaterialSet | null, enabled: boolean, color: EyeColor) {
  if (!materials) return;
  drawEyeTexture(materials.textures.left.image as HTMLCanvasElement, enabled, color);
  drawEyeTexture(materials.textures.right.image as HTMLCanvasElement, enabled, color);
  materials.textures.left.needsUpdate = true;
  materials.textures.right.needsUpdate = true;
  const label = enabled ? eyeColorPalette(color).label : "original";
  materials.left.name = `GNM Studio ${label} eye`;
  materials.right.name = `GNM Studio ${label} eye`;
}

export function disposeGnmEyeMaterials(materials: GnmEyeMaterialSet | null) {
  if (!materials) return;
  materials.left.dispose();
  materials.right.dispose();
  materials.teeth.dispose();
  materials.tongue.dispose();
  materials.gums.dispose();
  materials.mouthInterior.dispose();
  materials.textures.left.dispose();
  materials.textures.right.dispose();
}
