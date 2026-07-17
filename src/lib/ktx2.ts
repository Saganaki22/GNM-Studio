import type { WebGLRenderer } from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

/** Create a KTX2 loader backed by Three.js' Vite-bundled Basis transcoder. */
export function createKtx2Loader(renderer: WebGLRenderer) {
  const loader = new KTX2Loader();
  loader.detectSupport(renderer);
  return loader;
}
