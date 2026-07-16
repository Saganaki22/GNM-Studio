# Third-party notices

GNM Studio's own source code is licensed under Apache-2.0. Bundled dependencies remain under their respective licenses.

- Google GNM and MediaPipe Tasks: Apache-2.0.
- Tauri: Apache-2.0 and MIT.
- React, Three.js, Phosphor Icons, and other JavaScript dependencies: their package-declared licenses, primarily MIT.
- Mediabunny 1.50.8 and `@mediabunny/aac-encoder` 1.50.8: Mozilla Public License 2.0. Matching source is available at <https://github.com/Vanilagy/mediabunny/tree/v1.50.8>. GNM Studio does not modify those packages.
- The Mediabunny AAC extension contains a size-optimized build of FFmpeg's AAC encoder. FFmpeg is available under LGPL-2.1-or-later at <https://ffmpeg.org/>. No GPL FFmpeg core or x264 binary is bundled by GNM Studio.
- Experimental human-skin texture maps under `public/textures/skin/` were supplied by the project owner, who confirmed on 2026-07-17 that the source set is MIT-licensed. The original URL and author/copyright line are still required so the exact upstream MIT notice can be preserved before public redistribution. The four additional colour maps are deterministic colour-only derivatives and remain under the source texture terms; they are not relicensed as Apache-2.0.

The dependency versions used for a build are recorded in `package-lock.json` and `src-tauri/Cargo.lock`.
