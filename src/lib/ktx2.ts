import type { WebGLRenderer } from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/** Create a KTX2 loader backed by Three.js' Vite-bundled Basis transcoder. */
export function createKtx2Loader(renderer: WebGLRenderer) {
  const loader = new KTX2Loader();
  loader.detectSupport(renderer);
  return loader;
}

/** Attach every decoder required by the FaceCap GLB and return the disposable KTX2 loader. */
export function configureFacecapLoader(loader: GLTFLoader, renderer: WebGLRenderer) {
  const ktx2Loader = createKtx2Loader(renderer);
  loader.setKTX2Loader(ktx2Loader);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return ktx2Loader;
}
