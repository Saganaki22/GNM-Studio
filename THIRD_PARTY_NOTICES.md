# Third-party notices

GNM Studio's own source code is licensed under Apache-2.0. Bundled dependencies remain under their respective licenses.

- Google GNM and MediaPipe Tasks: Apache-2.0. The web edition's compressed,
  quantized identity basis is derived from the released Google GNM model data
  and remains subject to the same GNM Apache-2.0 terms and attribution.
- Tauri: Apache-2.0 and MIT.
- React, Three.js, Phosphor Icons, and other JavaScript dependencies: their package-declared licenses, primarily MIT.
- Basis Universal's KTX2 transcoder is bundled through Three.js for offline FaceCap texture decoding and is licensed under Apache-2.0: <https://github.com/BinomialLLC/basis_universal>.
- Mediabunny 1.50.8 and `@mediabunny/aac-encoder` 1.50.8: Mozilla Public License 2.0. Matching source is available at <https://github.com/Vanilagy/mediabunny/tree/v1.50.8>. GNM Studio does not modify those packages.
- The Mediabunny AAC extension contains a size-optimized build of FFmpeg's AAC encoder. FFmpeg is available under LGPL-2.1-or-later at <https://ffmpeg.org/>. No GPL FFmpeg core or x264 binary is bundled by GNM Studio.
- The bundled FaceCap 52-morph avatar is MIT-licensed, as confirmed by the project owner on 2026-07-17. The model was supplied to the Three.js project by the creator of the [Face Cap app](https://www.bannaflak.com/face-cap/) and is credited to Face Cap in the Three.js example. GNM Studio vendors the exact [Three.js r184 asset](https://github.com/mrdoob/three.js/blob/r184/examples/models/gltf/facecap.glb) at `public/models/facecap.glb` (SHA-256 `6BFCE6D0FCBB5839F5102B79733007859FEF7C5DF6D9EB49E2264542810B5F64`). Face Cap credit, Three.js source attribution, the pinned revision, and MIT status must be preserved in derivative distributions.
- Experimental human-skin texture maps under `public/textures/skin/` were supplied by the project owner, who confirmed on 2026-07-17 that the source set is MIT-licensed. The original URL and author/copyright line are still required so the exact upstream MIT notice can be preserved before public redistribution. The four additional colour maps and runtime-neutralized no-tint variant are deterministic colour-only derivatives and remain under the source texture terms; they are not relicensed as Apache-2.0.

The dependency versions used for a build are recorded in `package-lock.json` and `src-tauri/Cargo.lock`.
