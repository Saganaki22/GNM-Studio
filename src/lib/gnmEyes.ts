import * as THREE from "three";

type EyeSide = "left" | "right";

export type GnmEyeMaterialSet = {
  left: THREE.MeshPhysicalMaterial;
  right: THREE.MeshPhysicalMaterial;
  teeth: THREE.MeshPhysicalMaterial;
  tongue: THREE.MeshPhysicalMaterial;
  textures: { left: THREE.CanvasTexture; right: THREE.CanvasTexture };
};

function eyeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not create the GNM eye texture.");

  context.fillStyle = "#eeeae0";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const x = canvas.width / 2;
  const y = canvas.height / 2;
  const irisRadius = 33.35; // 15% larger than the previous GNM hazel iris.
  const pupilRadius = 14; // Preserve the existing black-pupil angle.
  context.fillStyle = "#11170f";
  context.beginPath();
  context.arc(x, y, irisRadius + 2, 0, Math.PI * 2);
  context.fill();
  const iris = context.createRadialGradient(x, y, pupilRadius, x, y, irisRadius);
  iris.addColorStop(0, "#364d27");
  iris.addColorStop(0.52, "#718044");
  iris.addColorStop(0.8, "#8a5a27");
  iris.addColorStop(1, "#332416");
  context.fillStyle = iris;
  context.beginPath();
  context.arc(x, y, irisRadius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#010201";
  context.beginPath();
  context.arc(x, y, pupilRadius, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
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

function createMaterials(opacity: number): GnmEyeMaterialSet {
  const left = eyeTexture();
  const right = eyeTexture();
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
    textures: { left, right },
  };
}

/** Split GNM's disconnected eyes, dental arches and tongue from the skin. */
export function installGnmEyeMaterials(
  mesh: THREE.Mesh,
  skinMaterial: THREE.Material,
  opacity = 1,
) {
  const materials = createMaterials(opacity);
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const sourceIndex = geometry.getIndex();
  if (!positions || !sourceIndex) {
    mesh.material = skinMaterial;
    return materials;
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

  mesh.material = [skinMaterial, materials.left, materials.right, materials.teeth, materials.tongue];
  return materials;
}

export function disposeGnmEyeMaterials(materials: GnmEyeMaterialSet | null) {
  if (!materials) return;
  materials.left.dispose();
  materials.right.dispose();
  materials.teeth.dispose();
  materials.tongue.dispose();
  materials.textures.left.dispose();
  materials.textures.right.dispose();
}
