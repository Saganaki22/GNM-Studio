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
- [x] Add regression/performance tests proving one tracker and one renderer remain active.
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

## Version 1.2.1 hotfix

- [x] Record exact display-space head translation, scale, and smoothed rotation with every motion frame.
- [x] Derive neutral-relative XYZ from calibrated screen translation plus MediaPipe matrix depth and export Blender position/scale tracks.
- [x] Preserve the recording-time OrbitControls camera position, target, up axis, and zoom during playback and video export.
- [x] Return exact head-motion samples from the single-renderer popout to the main motion recorder.
- [x] Prevent MP4 export until MediaRecorder has completed asynchronous finalization.
- [x] Prefer audio-capable recorder codecs and verify that requested microphone tracks exist in desktop, web, and popout video.
- [x] Retain motion-mode microphone audio in memory and remux it into the rendered motion video.
- [x] Preserve backward compatibility with v1 motion JSON while extending new files with avatar motion and view state.
- [x] Add deterministic recording-pipeline checks for head motion, immutable view framing, finalization, and microphone routing.
- [x] Correct the slight GNM cross-eyed neutral look with per-eye outward optical centres and a small gaze dead zone.

## Version 1.2.2 pitch hotfix

- [x] Reproduce calibrated up/down suppression when MediaPipe matrix pitch remains near zero.
- [x] Prefer clear smoothed landmark pitch when calibrated matrix pitch is weak or contradictory.
- [x] Preserve matrix pitch when it remains responsive, plus existing yaw, roll, mirror, smoothing, XYZ, and recording behavior.
- [x] User-test the portable build before commit, tag, push, and release.
- [x] Rebuild and launch-smoke both standard and UPX portable packages after documentation freeze.

## Version 1.3.0

- [x] Complete the feature-based app composition refactor with pre/post safety branches.
- [x] Keep a single stage renderer across the studio and output popout with crash-safe recovery.
- [x] Render photo, PNG-sequence, WebM, and MP4 exports at the exact configured resolution without stretching or letterboxing.
- [x] Scale and pad system-FFmpeg and WebCodecs MP4 conversions to even export dimensions (fix odd-height libx264 failures).
- [x] Remux WebM exports so the saved files carry correct duration metadata in every player.
- [x] Enlarge the GNM procedural iris and pupil by 25% in the eye shader only.
- [x] Document the hands-on runtime smoke-test checklist for release acceptance.

## Next deformation and recording-correctness pass

### Fullscreen output controls

- [x] Make the `H` shortcut pin controls shown or hidden so mouse movement cannot immediately undo the user's choice; reset the override only when fullscreen exits.
- [x] Add a deterministic regression check for Auto-hide, Always clean, pinned shown, and pinned hidden states.

### Current UX and performance corrections

- [x] Shorten generated-identity morphing to 150 ms while retaining eased proportion changes.
- [x] Move native GNM evaluation off the Tauri command thread and optimize contiguous identity/expression basis loops.
- [x] Keep GNM Head v3 as the first-run default while preserving the user's last selected avatar afterward.
- [x] Give the Export workspace a complete padded highlight instead of clipping the glow against its controls.
- [x] Add an optional WebGPU identity/expression compute backend with parity checks and retain the worker CPU fallback for unsupported adapters. *(Broad lower-end hardware profiling remains deferred below.)*

### Neutral mouth and anatomical jaw deformation

- [x] Replace the low-threshold resting `jawOpen` curve with a calibrated mouth gate that combines neutral-relative MediaPipe scores, normalized inner-lip aperture, a configurable dead zone, and open/close hysteresis.
- [x] Guarantee that a relaxed closed mouth evaluates to zero after calibration and remains closed through normal tracker noise and smoothing drift.
- [x] Remove the duplicate mouth-opening path that currently drives both the semantic surprise target and the procedural jaw target from the same signal.
- [x] Replace the coordinate-masked procedural jaw morph with a canonical full 383-component GNM mouth-open expression evaluated by the released deformation basis.
- [x] Use bundled anatomical vertex groups for skin, upper/lower lips, mouth sock, tongue, gums, and upper/lower dental arches instead of inferring oral parts from position or connectivity.
- [x] Keep the upper dental arch stationary during jaw opening and move each lower tooth/gum island coherently without per-vertex stretching.
- [x] Add collision-safe opening limits so lower enamel cannot pass through the lower gum, lip, or chin at maximum tracked/manual input.
- [ ] Validate neutral, half-open, and fully-open poses across multiple generated identities in desktop, web, playback, MP4, JSON, and GLB output.
- [ ] Add numerical and visual regressions for closed-mouth neutrality, dental-arch rigidity, upper-teeth stability, lower-lip clearance, and wide-open silhouette.

### Full GNM expression and identity controls

- [x] Run the full 383-component expression state through the existing native Rust evaluator on desktop and an equivalent background-worker evaluator on the web.
- [x] Build a compact quantized browser expression runtime with parity tests against Rust and the released NumPy reference.
- [x] Load the converted local expression decoder without Python or TensorFlow at runtime and expose all 20 semantic expression classes with deterministic seed/resample controls.
- [x] Add cached Expression A/B endpoints with a live blend slider that does not resample while dragging.
- [x] Add weighted identity blending for the available gender and ethnicity labels, with deterministic seeds and explicit randomize controls.
- [x] Add an advanced raw-component editor grouped by left eye, right eye, lower face, tongue, and iris, with searchable component names and per-control reset/freeze.
- [x] Add left-to-right and right-to-left expression-region mirroring using the model's paired 100-component eye regions.
- [x] Expose separate neck, head, left-eye, right-eye, and XYZ translation controls while retaining webcam-driven values and per-channel freeze.
- [x] Add named full-state presets with create, load, rename, delete, import/export bundle, model-version validation, and backward-compatible JSON parsing.

### Identity presentation and eyes

- [x] Keep explicit **Feminine**, **Masculine**, and **Blend** GNM identity choices and verify that each sends the correct released-model conditioning vector in desktop Rust and the web worker.
- [x] Regenerate the identity automatically after a short debounce when Presentation or Population changes, with a visible generating state; do not require an easy-to-miss second click on **Apply identity**.
- [x] Morph smoothly between generated GNM identities so proportion changes are visible instead of snapping, while snapping during capture and reduced-motion mode.
- [x] Add a continuous Feminine ↔ Masculine presentation-strength control so users can make the distinction stronger or subtler instead of relying only on three dropdown values.
- [x] Preserve the same seed while comparing presentation choices so only the conditioning changes; add a side-by-side preview or comparison action.
- [ ] Audit representative seeds and add numerical/visual regressions proving feminine, masculine, and blended output meshes are distinct and identical between desktop and web evaluators.
- [x] Include identity presentation and strength in presets, motion appearance snapshots, JSON, GLB, popout, playback, and repeated video exports.
- [x] Add an **Eye shader** toggle for both avatars; when disabled, restore each model's original eye materials without changing gaze tracking.
- [x] Provide Green, Blue, Light Brown, and Dark Brown iris presets while retaining black pupils, natural sclera, corneal highlights, current pupil alignment, and tracked eye rotation.
- [x] Keep eye settings independent from skin tone and microtexture, and reproduce them exactly in the popout, recordings, MP4 rendering, presets, screenshots, and GLB export.
- [x] Build avatar-specific procedural masks/materials rather than stretching one model's UV coordinates onto the other, and test every style/colour in light and dark studio backgrounds.

### Immutable recording appearance and popout encoding

- [x] Introduce a versioned `RecordedTakeSnapshot` captured atomically when Record starts.
- [x] Store avatar kind, identity vertices/parameters, manual/frozen expressions, neutral calibration, head-pose settings, skin toggle/tone/PBR scale/rotation/feather, background, lighting, enabled layers, mirror state, view transform, FPS, and quality settings in the take snapshot.
- [x] Make playback, MP4 rendering, GLB export, and motion JSON use the take snapshot rather than whichever UI settings happen to be active at export time.
- [x] Allow current UI settings to change after a take without mutating the recorded appearance; provide an explicit **Use current appearance** action when the user intentionally wants to restyle a take.
- [x] Extend motion JSON to a new version containing the appearance snapshot while preserving import compatibility with existing version-1 files.
- [x] Replace the popout `idle/starting/active` flags with an acknowledged output-owner state machine covering connect, ready, recording, encoding, closing, restored, and failed states.
- [x] Keep recording and encoding on the renderer that currently owns the canvas; do not tear down the popout renderer during an active capture or offline motion render.
- [x] Add a two-phase renderer handoff so the studio canvas is mounted only after the popout confirms recorder finalization and renderer shutdown.
- [x] Freeze the popout's take snapshot for the entire recording and queue live appearance changes until the take has stopped.
- [x] Add recovery for popout closure/crash during recording without flashing, duplicate renderers, lost skin textures, or an indefinitely blocked encoder.
- [x] Add deterministic tests for popout recording, popout-to-studio handoff, retained PBR/background/view state, repeated exports, and identical desktop/web rendering state.

### Header pause control and semantic device indicators

- [x] Decouple camera, microphone, and GPU status-dot colours from the user-selectable accent palette.
- [x] Give device indicators fixed semantic colours for active, paused, unavailable, and error states in both light and dark themes.
- [x] Add a Phosphor `Pause` icon button immediately to the left of the header camera icon; replace it with Phosphor `Play` while paused.
- [x] Suspend face inference, avatar tracking updates, microphone capture/analyser updates, and audio metering without losing the selected devices or requiring permissions again on resume.
- [x] Freeze the avatar on the last valid pose while paused, show zero microphone level, and mark the camera/microphone indicators as paused rather than disconnected.
- [x] Propagate pause/play state to the output popout so its avatar and recording state cannot diverge from the studio.
- [x] Define recording behavior atomically: pausing capture also pauses the active media recorder and motion timeline, and Play resumes all of them together.
- [x] Add accessible labels, tooltips, keyboard focus, and deterministic pause/resume tests for desktop and web builds.

## Remaining production work

- [ ] Fit a high-quality 52-to-383 MediaPipe/GNM retargeting matrix from matched landmarks.
- [x] Add non-destructive playback trimming and interpolated retiming.
- [x] Add deterministic offline MP4 rendering at arbitrary resolution/FPS.
- [x] Replace the center canvas with a dedicated MP4/WebM/PNG-sequence export workspace when Export is selected.
- [x] Save numbered alpha-aware PNG sequences in a single ZIP and add an exact-canvas single-photo control.
- [x] Add independently persisted, animated left/right sidebar collapse so the canvas expands into the released space.

The following four items are explicitly deferred from the current implementation pass by user request:

- [ ] Add exact baked Alembic export through a statically linked Alembic writer. *(Deferred.)*
- [ ] Add transparent video WebM/ProRes output modes. *(Deferred; exact-canvas PNG and PNG sequences already preserve alpha.)*
- [ ] Add code signing and automated NSIS/MSI release jobs. *(Deferred.)*
- [ ] Profile lower-end Intel/AMD/NVIDIA systems before considering optional GPU compute. *(Deferred.)*
