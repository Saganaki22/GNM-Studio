# GNM Studio build checklist

## Completed in the first implementation pass

- [x] Scaffold Tauri 2, Vite, React, and TypeScript.
- [x] Build a modern responsive three-panel creator UI.
- [x] Persist UI and capture preferences locally.
- [x] Add camera and microphone dropdowns with device hot-plug handling.
- [x] Add microphone mute, monitoring, RMS meter, peak hold, and clipping state.
- [x] Bundle MediaPipe WASM and Face Landmarker model for offline use.
- [x] Run face inference in a worker and expose 478 landmarks, 52 blendshapes, and pose matrix.
- [x] Add webcam, landmark, avatar, mirror, opacity, and wireframe toggles.
- [x] Add neutral-pose countdown and calibration state.
- [x] Add Blender-style orbit, pan, zoom, cardinal views, and reset controls.
- [x] Add a pointer-following light with button and `L`-key bind/freeze controls.
- [x] Add per-expression freeze locks.
- [x] Add informative copyable error toasts through the native Tauri clipboard API.
- [x] Fix MediaPipe ES-module worker loading (`ModuleFactory not set`) with the module-aware WASM loader.
- [x] Repair viewport Overlay/Camera/Avatar mode buttons and active-state indicators.
- [x] Make Capture/Create/Edit/Export navigation and fullscreen controls functional.
- [x] Decouple manual expression sliders from live tracker availability and add illuminated freeze locks.
- [x] Add dark/light themes, five accents, and stationary 80–125% interface scaling.
- [x] Add studio/solid/transparent head backgrounds and pointer-light enable/intensity controls.
- [x] Replace default Tauri branding with the supplied head SVG and generated Windows icon set.
- [x] Show the manifest version with native GitHub/release links in Settings.
- [x] Add root Apache-2.0 licensing and normal plus UPX portable packaging.
- [x] Replace native FPS spinners with clamped minus/value/plus controls.
- [x] Explain motion-recording readiness and allow manual Avatar/Composite recording without tracking.
- [x] Return real save paths, distinguish cancellation from failure, and add Show in folder export toasts.
- [x] Add Windows-safe local date/time-to-seconds suffixes to every export filename.
- [x] Add post-export MediaPipe health checks, stalled-frame recovery, and an always-available Reload tracker control.
- [x] Return the viewport to live tracking when recorded-performance playback stops instead of retaining a stale final frame.
- [x] Add validated GNM motion JSON import with neutral/FPS restoration and clear motion-only diagnostics.
- [x] Make recorded-motion playback seekable by click/drag and resume from the selected timestamp.
- [x] Add a Return to Live control that clears playback override without deleting the take.
- [x] Keep recording, playback, timeline, FPS, import, and export controls aligned on one responsive row.
- [x] Add a dedicated lower-jaw morph driven by MediaPipe jaw/lip separation for visible wide-mouth opening.
- [x] Preserve zoom and pan when snapping cardinal views; reserve full reframing for Reset view.
- [x] Remove the redundant aggregate capture dot while preserving per-camera, per-microphone, and tracker status.
- [x] Add an experimental neutral/no-tint plus five-tone repeated PBR skin material with scale, rotation, and seam-feather controls.
- [x] Make experimental skin collapsed/off by default and prevent tone/feather updates from darkening the live material.
- [x] Restore GPU-first MediaPipe tracking with explicit CPU fallback diagnostics.
- [x] Match landmarks and avatar placement to the webcam's object-fit cover crop.
- [x] Unify mirrored webcam, landmarks, translation, yaw, and roll with a quick mirror control.
- [x] Gate neutral calibration on orange/green face placement and reset the countdown when alignment is lost.
- [x] Add a persisted right-click Auto/GPU/CPU selector with checked and unavailable states.
- [x] Correct the MediaPipe pitch sign so looking up/down matches the user in both mirror modes.
- [x] Cache-bust the packaged EXE filename so Windows shows the embedded head icon immediately.
- [x] Add independent camera, tracking, and export FPS controls.
- [x] Add optional capture permissions so camera-less users can keep using manual GNM tools.
- [x] Add stronger adaptive 0–100% facial smoothing plus separate head-motion smoothing and bypass toggles.
- [x] Reject small one-frame face/head tracking spikes while preserving sustained motion response.
- [x] Add persistent aspect-preserving custom image backgrounds with replace/remove and zoom controls.
- [x] Make recording composition obey the enabled camera/avatar layer switches.
- [x] Add adjustable 1–50 Mbps video and 64–320 kbps audio encoder quality controls.
- [x] Add Auto/WebCodecs/System FFmpeg MP4 backends with PATH probing and executable selection.
- [x] Make calibration a temporary camera-only view and apply its neutral expression/orientation baseline.
- [x] Record timestamped motion channels and optional composited video.
- [x] Add basic recorded-performance playback.
- [x] Export raw motion JSON.
- [x] Export H.264/AAC MP4 using direct WebView2 recording or a local WebCodecs conversion fallback, with optional WebM source export.
- [x] Convert the GNM H5 semantic decoder into 20 stable runtime expressions.
- [x] Generate and render an actual GNM v3 GLB rather than the prototype Facecap mesh.
- [x] Export animated GNM GLB files for Blender.
- [x] Implement the full released GNM deformation path in native Rust.
- [x] Wire identity seed and demographic controls to the extracted semantic decoder.
- [x] Verify Rust NPZ loading plus neutral and posed Python parity with automated tests.
- [x] Build a self-contained release EXE and portable ZIP/checksum workflow.
- [x] Add a `/GNM-Studio/` GitHub Pages web build, static-path verification, CI, and `webapp-src` deployment workflow.
- [x] Let recorded motion render to MP4 in the web/desktop UI instead of leaving video export disabled.
- [x] Migrate existing preferences once so experimental skin microtexture starts disabled while remaining user-toggleable.

## Version 1.1.0 roadmap

Detailed design: [V1.1.0_PLAN.md](V1.1.0_PLAN.md)

- [x] Confirm the FaceCap model's MIT redistribution status and upstream attribution.
- [x] Preserve the Face Cap credit, Three.js source, pinned revision, and MIT notice in release documentation.
- [x] Vendor and validate the Three.js/Face Cap `facecap.glb` as an offline local asset.
- [x] Add a persistent GNM Head v3 / FaceCap 52 avatar selector.
- [x] Refactor Stage around typed model profiles instead of GNM-specific node names.
- [x] Map all 52 MediaPipe channels directly to FaceCap morph targets.
- [x] Add grouped FaceCap manual controls and per-channel freeze locks.
- [x] Add a shared face-only head-pose controller with matrix primary and landmark fallback.
- [x] Add head rotation toggle plus yaw/pitch/roll strength, dead-zone, and smoothing controls.
- [x] Apply the current PBR skin system to FaceCap's skin mesh only.
- [x] Build a material split that excludes eyes, teeth, and tongue from the skin PBR material.
- [x] Extend motion JSON metadata while preserving v1 backward compatibility.
- [x] Generalize animated GLB export for GNM semantic and FaceCap 52-target profiles.
- [ ] Verify MP4/WebM recording and motion-to-video rendering with either avatar.
- [x] Add true fullscreen clean-output mode with configurable control auto-hide and `H` toggle.
- [x] Add a single-renderer desktop/web popout with heartbeat and automatic main-canvas restoration.
- [x] Show an actionable **Output is in the popout** placeholder in the main viewport.
- [x] Route recording commands to whichever window currently owns the output canvas.
- [ ] Add regression/performance tests proving one tracker and one renderer remain active.
- [ ] Validate both exported avatars in Blender, including pose, jaw, tongue, timing, and PBR materials.
- [x] Update permissions, third-party notices, English/Chinese READMEs, CI, Pages, and portable packaging.
- [x] Bump all manifests and portable packaging defaults to 1.1.0 at feature freeze.
- [x] Build, tag, and publish the v1.1.0 release after validation.

## Version 1.1.1 hotfix

- [x] Stop the popout Stage from rebuilding on every tracking frame.
- [x] Keep live face/head motion flowing to the popout renderer.
- [x] Mirror the selected webcam, avatar, landmark, background, material, and display layers in the popout.
- [x] Acquire the selected camera in the output window only when its Webcam layer is enabled.
- [x] Attach an offline Basis/KTX2 transcoder before loading or exporting FaceCap textures.
- [x] Validate the FaceCap `KHR_texture_basisu` requirement and hosted transcoder artifacts in CI.
- [x] Replace the basic model dropdown with an accessible card-based GNM/FaceCap picker.
- [x] Add a scoped phone/tablet layout to the web edition without changing desktop window behavior.
- [x] Run frontend, web, Rust, portable package, and launch-smoke validation.
- [x] Tag and publish v1.1.1, update `webapp-src`, and verify GitHub Actions and Pages.

## Version 1.2.0

- [x] Attach both Basis/KTX2 and Meshopt decoders before FaceCap load/export.
- [x] Report FaceCap model-load failures separately from experimental skin-material failures.
- [x] Prevent uncalibrated absolute matrices from permanently suppressing face-only head rotation.
- [x] Add browser GNM identity evaluation through a lazy compressed basis and dedicated Web Worker.
- [x] Keep desktop identity on the exact native Rust/NPZ path without bundling the web basis.
- [x] Replace the web favicon with GNM branding and add canonical, Open Graph, Twitter, JSON-LD, manifest, robots, sitemap, and social image metadata.
- [x] Add deterministic asset, head-pose, browser-identity, and Pages metadata checks.
- [x] Hide GNM-only identity controls completely while the fixed-identity FaceCap avatar is selected.
- [x] Restore visible FaceCap irises/pupils with a gaze-following procedural material layer.
- [x] Tune the FaceCap iris to a 10% smaller hazel/green-brown ring while preserving the black pupil.
- [x] Partition GNM's four disconnected eye shells into gaze-aware left/right hazel eye materials without applying skin PBR to the eyeballs.
- [x] Decode FaceCap's quantized atlas UV transform before applying repeated colour, normal, AO, specular, and displacement skin maps.
- [x] Scale skin displacement from mesh-local height so depth remains visible on both float GNM and quantized FaceCap geometry.
- [x] Match calibration against the visible oval size after camera cover-cropping and reject movement during countdown.
- [x] Correct image-space roll sign and prevent calibrated/mirrored roll from being inverted twice.
- [x] Remove the foreground viewport vignette so studio gradients remain strictly behind camera/avatar layers.
- [x] Align recording, playback, timeline, FPS, import, and export controls on one 44px desktop toolbar baseline.
- [x] Separate FaceCap upper/lower enamel and oral tissue from skin PBR; separate GNM dental arches and tongue from skin PBR.
- [x] Complete manual FaceCap, head rotation, web identity, popout, recording, eye, and oral-material tests before publication.

## Remaining production work

- [ ] Fit a high-quality 52-to-383 MediaPipe/GNM retargeting matrix from matched landmarks.
- [ ] Add non-destructive playback trimming and interpolated retiming.
- [ ] Add deterministic offline MP4 rendering at arbitrary resolution/FPS.
- [ ] Add exact baked Alembic export through a statically linked Alembic writer.
- [ ] Add transparent PNG/WebM/ProRes output modes.
- [ ] Add code signing and automated NSIS/MSI release jobs.
- [ ] Profile lower-end Intel/AMD/NVIDIA systems before considering optional GPU compute.
