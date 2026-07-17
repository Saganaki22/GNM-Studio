import * as THREE from "three";

/**
 * The FaceCap sample stores the tongue in the same morphable mesh as the skin.
 * Split triangles driven by tongueOut into a second material group so skin PBR
 * maps never affect the tongue. The geometry and all morph targets stay intact.
 */
export function splitFacecapTongueMaterial(
  mesh: THREE.Mesh,
  skinMaterial: THREE.Material,
  tongueMaterial: THREE.Material,
) {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const dictionary = mesh.morphTargetDictionary;
  const tongueIndex = dictionary?.tongueOut;
  const positions = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  const tongue = tongueIndex === undefined
    ? undefined
    : geometry.morphAttributes.position?.[tongueIndex] as THREE.BufferAttribute | undefined;
  if (!positions || !tongue) {
    mesh.material = [skinMaterial, tongueMaterial];
    geometry.clearGroups();
    const count = geometry.index?.count ?? positions?.count ?? 0;
    geometry.addGroup(0, count, 0);
    return false;
  }

  const sourceIndex = geometry.index;
  const indexCount = sourceIndex?.count ?? positions.count;
  const moved = new Uint8Array(positions.count);
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const dx = geometry.morphTargetsRelative
      ? tongue.getX(vertex)
      : tongue.getX(vertex) - positions.getX(vertex);
    const dy = geometry.morphTargetsRelative
      ? tongue.getY(vertex)
      : tongue.getY(vertex) - positions.getY(vertex);
    const dz = geometry.morphTargetsRelative
      ? tongue.getZ(vertex)
      : tongue.getZ(vertex) - positions.getZ(vertex);
    if ((dx * dx + dy * dy + dz * dz) > 1e-10) moved[vertex] = 1;
  }

  const skinIndices: number[] = [];
  const tongueIndices: number[] = [];
  for (let offset = 0; offset + 2 < indexCount; offset += 3) {
    const a = sourceIndex ? sourceIndex.getX(offset) : offset;
    const b = sourceIndex ? sourceIndex.getX(offset + 1) : offset + 1;
    const c = sourceIndex ? sourceIndex.getX(offset + 2) : offset + 2;
    const destination = moved[a] + moved[b] + moved[c] >= 2 ? tongueIndices : skinIndices;
    destination.push(a, b, c);
  }
  if (!tongueIndices.length) {
    mesh.material = skinMaterial;
    return false;
  }

  const IndexArray = positions.count > 65_535 ? Uint32Array : Uint16Array;
  const combined = new IndexArray(skinIndices.length + tongueIndices.length);
  combined.set(skinIndices, 0);
  combined.set(tongueIndices, skinIndices.length);
  geometry.setIndex(new THREE.BufferAttribute(combined, 1));
  geometry.clearGroups();
  geometry.addGroup(0, skinIndices.length, 0);
  geometry.addGroup(skinIndices.length, tongueIndices.length, 1);
  mesh.material = [skinMaterial, tongueMaterial];
  return true;
}
