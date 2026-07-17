import * as THREE from "three";

const fallbackUvOffset = new THREE.Vector2(0.00724834995, 0.0100790262);
const fallbackUvScale = new THREE.Vector2(0.000238723238, 0.000239208952);

/**
 * FaceCap stores quantized integer UVs and relies on KHR_texture_transform to
 * decode them. Bake that transform into float UVs before replacing the bundled
 * atlas material with GNM Studio's repeating skin maps.
 */
export function normalizeFacecapSkinUvs(mesh: THREE.Mesh) {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  if (geometry.userData.gnmStudioSkinUvsNormalized) return;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  if (!uv) return;

  const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const sourceMap = sourceMaterial instanceof THREE.MeshStandardMaterial ? sourceMaterial.map : null;
  sourceMap?.updateMatrix();
  const decoded = new Float32Array(uv.count * 2);
  const point = new THREE.Vector2();
  for (let index = 0; index < uv.count; index += 1) {
    point.set(uv.getX(index), uv.getY(index));
    if (sourceMap) point.applyMatrix3(sourceMap.matrix);
    else point.multiply(fallbackUvScale).add(fallbackUvOffset);
    decoded[index * 2] = point.x;
    decoded[index * 2 + 1] = point.y;
  }
  const normalized = new THREE.BufferAttribute(decoded, 2);
  geometry.setAttribute("uv", normalized);
  geometry.setAttribute("uv1", normalized.clone());
  geometry.userData.gnmStudioSkinUvsNormalized = true;
}

export type FacecapMouthMaterials = {
  oral: THREE.MeshPhysicalMaterial;
  teeth: THREE.MeshPhysicalMaterial;
};

export function createFacecapMouthMaterials(opacity = 1): FacecapMouthMaterials {
  return {
    oral: new THREE.MeshPhysicalMaterial({
      name: "GNM Studio FaceCap gums and tongue",
      color: 0xb85d68,
      roughness: 0.56,
      metalness: 0,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    }),
    teeth: new THREE.MeshPhysicalMaterial({
      name: "GNM Studio FaceCap enamel",
      color: 0xf4eee5,
      roughness: 0.3,
      metalness: 0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.24,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    }),
  };
}

/**
 * FaceCap stores its lower teeth and oral soft tissue as disconnected islands
 * inside the morphable head mesh. Partition those islands by topology so skin
 * colour/PBR stays on the face, enamel stays white, and gums/tongue stay pink.
 * Reordering the index buffer preserves every morph target and vertex index.
 */
export function splitFacecapMouthMaterials(
  mesh: THREE.Mesh,
  skinMaterial: THREE.Material,
  mouthMaterials: FacecapMouthMaterials,
) {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const sourceIndex = geometry.getIndex();
  if (!positions || !sourceIndex) {
    mesh.material = skinMaterial;
    return false;
  }

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

  const componentSizes = new Map<number, number>();
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const root = find(vertex);
    componentSizes.set(root, (componentSizes.get(root) ?? 0) + 1);
  }

  const groups = { skin: [] as number[], oral: [] as number[], teeth: [] as number[] };
  for (let offset = 0; offset + 2 < sourceIndex.count; offset += 3) {
    const a = sourceIndex.getX(offset);
    const b = sourceIndex.getX(offset + 1);
    const c = sourceIndex.getX(offset + 2);
    const componentSize = componentSizes.get(find(a)) ?? positions.count;
    // The bundled FaceCap topology has fourteen 34-49 vertex lower teeth and
    // one 166 vertex oral/tongue island. Wider bands leave minor asset revisions
    // room without mistaking the two large face shells for mouth geometry.
    const destination = componentSize >= 24 && componentSize <= 72
      ? groups.teeth
      : componentSize >= 96 && componentSize <= 320
        ? groups.oral
        : groups.skin;
    destination.push(a, b, c);
  }

  const IndexArray = positions.count > 65_535 ? Uint32Array : Uint16Array;
  const combined = new IndexArray(groups.skin.length + groups.oral.length + groups.teeth.length);
  combined.set(groups.skin, 0);
  combined.set(groups.oral, groups.skin.length);
  combined.set(groups.teeth, groups.skin.length + groups.oral.length);
  geometry.setIndex(new THREE.BufferAttribute(combined, 1));
  geometry.clearGroups();
  geometry.addGroup(0, groups.skin.length, 0);
  geometry.addGroup(groups.skin.length, groups.oral.length, 1);
  geometry.addGroup(groups.skin.length + groups.oral.length, groups.teeth.length, 2);
  mesh.material = [skinMaterial, mouthMaterials.oral, mouthMaterials.teeth];
  return groups.oral.length > 0 && groups.teeth.length > 0;
}
