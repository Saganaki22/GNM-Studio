import type { IdentityVertices } from "../types";

export function flattenIdentityVertices(vertices: IdentityVertices) {
  if (vertices instanceof Float32Array) return vertices;
  const flattened = new Float32Array(vertices.length * 3);
  vertices.forEach((vertex, index) => {
    flattened[index * 3] = vertex[0];
    flattened[index * 3 + 1] = vertex[1];
    flattened[index * 3 + 2] = vertex[2];
  });
  return flattened;
}

export function identityVertexCount(vertices: IdentityVertices) {
  return vertices instanceof Float32Array ? vertices.length / 3 : vertices.length;
}
