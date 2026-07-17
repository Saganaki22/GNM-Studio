import assert from "node:assert/strict";
import * as THREE from "three";
import { normalizeFacecapSkinUvs } from "../src/lib/facecapModel.ts";

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 10_000, 0, 1, 0, 0], 3));
geometry.setAttribute("uv", new THREE.Uint16BufferAttribute([1_000, 2_000, 2_000, 3_000, 3_000, 4_000], 2));
const texture = new THREE.Texture();
texture.offset.set(0.1, 0.2);
texture.repeat.set(0.01, 0.02);
texture.updateMatrix();
const material = new THREE.MeshStandardMaterial({ map: texture });
const mesh = new THREE.Mesh(geometry, material);

normalizeFacecapSkinUvs(mesh);
const uv = geometry.getAttribute("uv");
assert.ok(Math.abs(uv.getX(0) - 10.1) < 1e-5 && Math.abs(uv.getY(0) - 40.2) < 1e-5, "FaceCap atlas transform must be baked into float UVs");
assert.equal(uv.array.constructor, Float32Array, "custom PBR maps require decoded float UVs");
assert.equal(geometry.getAttribute("uv1").count, uv.count, "occlusion needs a matching normalized uv1 channel");
const firstValue = uv.getX(0);
normalizeFacecapSkinUvs(mesh);
assert.equal(geometry.getAttribute("uv").getX(0), firstValue, "FaceCap UV normalization must be idempotent");

console.log("Skin material verified: FaceCap quantized UV transform is baked once and AO receives normalized UV1.");
