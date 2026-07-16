# GNM Studio

<p align="center">
  <img src="public/head-svgrepo-com%20(2).svg" width="92" alt="GNM Studio head icon">
</p>

<p align="center">
  A local-first desktop and web studio for creating and animating Google GNM heads with webcam motion capture.
</p>

<p align="center">
  <a href="https://github.com/Saganaki22/GNM-Studio/releases"><img src="https://img.shields.io/badge/release-v1.0.0-54ddb2" alt="Release v1.0.0"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-0078D4" alt="Windows x64">
  <a href="https://drbaph.is-a.dev/GNM-Studio/"><img src="https://img.shields.io/badge/web-GitHub%20Pages-222222" alt="GitHub Pages web edition"></a>
  <img src="https://img.shields.io/badge/UI-Tauri%202%20%2B%20React-24C8DB" alt="Tauri 2 and React">
  <img src="https://img.shields.io/badge/core-Rust-orange" alt="Rust core">
  <img src="https://img.shields.io/badge/tracking-MediaPipe-4285F4" alt="MediaPipe tracking">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-green" alt="Apache 2.0"></a>
</p>

[中文说明](README_ZH.md) · [Try the Web Edition](https://drbaph.is-a.dev/GNM-Studio/) · [Releases](https://github.com/Saganaki22/GNM-Studio/releases) · [Google GNM](https://github.com/google/GNM)

Author: [Saganaki22](https://github.com/Saganaki22)

GNM Studio `1.0.0` combines Google GNM Head v3, MediaPipe Face Landmarker,
Three.js, Rust, and Tauri in a portable Windows application, with a companion
GitHub Pages edition for trying the tracking and animation workflow online. It
can drive a head from a webcam, record facial motion and video, and export
animation for Blender without requiring Python, Node.js, Rust, CUDA, or model
downloads. The desktop edition also provides native seeded identity generation.

## Download and Run

1. Download the latest Windows x64 archive from
   [GitHub Releases](https://github.com/Saganaki22/GNM-Studio/releases).
2. Extract it to a writable folder such as `C:\AI\GNM-Studio\`.
3. Run `GNM-Studio-v1.0.0.exe`.
4. Approve camera and/or microphone access if you want live capture, or choose
   **Continue without capture** for manual avatar work.
5. For tracked performances, hold a neutral expression and use **Calibrate neutral**.

Two portable archives may be published:

| Package | Use it when |
| --- | --- |
| Standard portable ZIP | Recommended. Best compatibility with antivirus and code signing. |
| Portable UPX ZIP | Smaller packed executable. Use if your antivirus accepts UPX-packed apps. |

The application and all model assets are embedded. No installer is required.

## Web Edition

Open [drbaph.is-a.dev/GNM-Studio](https://drbaph.is-a.dev/GNM-Studio/) in a
current Chromium-based browser. Camera and microphone capture require HTTPS,
which GitHub Pages provides. Processing remains in the browser; frames and
audio are not uploaded to an application server.

The web edition includes the base GNM head, MediaPipe GPU/CPU tracking,
calibration, overlays, landmarks, smoothing, expressions and locks, PBR skin,
backgrounds, motion/video recording, playback, JSON import/export, animated GLB
export, and browser-based MP4/WebM saving. Browser codec support determines MP4
availability. Native seeded identity evaluation and system FFmpeg are desktop
only because they use the Rust/Tauri process.

The project is deliberately built with the `/GNM-Studio/` base path so it works
below the existing custom-domain root. This project does not publish a `CNAME`
file because `drbaph.is-a.dev` belongs to the parent Pages site, while this app
lives at its `GNM-Studio` subpath.

## Features

- Native Google GNM Head v3 mesh with 17,821 vertices and 35,324 triangles.
- Seeded identity creation with presentation and population blending controls.
- MediaPipe webcam tracking with 478 face landmarks, 52 tracking blendshapes,
  a facial transformation matrix, GPU-first execution, and CPU fallback.
- Right-click tracking selector for persisted Auto, GPU-only, or CPU-only mode,
  with unavailable backends disabled after probing.
- Verification-style neutral calibration with orange/green face placement,
  stable 3-2-1 gating, temporary camera-only verification, restored layers,
  and a real neutral expression/head-orientation baseline.
- Separate adaptive 0–100% facial and head-motion smoothing with deadbands and
  one-frame transient rejection. Tiny isolated twitches are discarded while
  sustained deliberate motion opens the filter quickly.
- Twenty GNM semantic expression sliders with independent illuminated freeze locks,
  plus a stronger derived lower-jaw morph for decisive wide-mouth opening.
- Webcam-only, avatar-only, or transparent avatar-over-webcam viewing modes.
- Cover-crop-correct landmark display, unified camera/motion mirroring,
  wireframe, and avatar opacity controls.
- Blender-style orbit, pan, wheel zoom, cardinal views that preserve framing,
  and a separate full reset view.
- Experimental repeated PBR skin material, off and collapsed by default, with
  five base tones, aligned colour/normal/displacement/occlusion/specular maps,
  scale/rotation controls, adjustable seam feathering, and flicker-free live updates.
- Mouse-following point light with `L` to freeze/rebind, plus enable and power controls.
- Studio gradient, solid colour, transparent, and locally stored custom image
  backgrounds with aspect-preserving cover fit, replace/remove, and 100–300% zoom.
- Camera and microphone device selectors, microphone mute, monitoring, and a
  green/yellow/orange/red input meter.
- Custom camera, tracking, and export frame rates from 1–120 FPS.
- Power-user video bitrate (1–50 Mbps) and audio bitrate (64–320 kbps) controls.
- Auto, portable WebCodecs, or optional system FFmpeg MP4 backends. FFmpeg can
  be found through PATH or selected as an executable and is never required.
- Motion recording, pause/resume, seekable playback, an explicit Return to Live
  control, validated JSON re-import, and copyable detailed error messages.
- Dark/light themes, five accents, and persistent 80–125% interface scaling.
- Native default-browser links for GitHub and Releases.

## Offline and Privacy

The Windows edition does **not** download models at runtime. The following files
are bundled into the release executable:

- MediaPipe Face Landmarker task model.
- MediaPipe WASM loaders and binaries.
- Google GNM Head v3 NPZ data.
- Runtime GNM GLB and semantic identity/expression decoders.
- Five local experimental skin colour variants and their shared PBR detail maps.
- Local WebCodecs MP4 muxing and AAC fallback encoder code.
- The complete Tauri/Vite frontend.

Camera frames and microphone samples remain on the local computer. The web
edition downloads the same static model, WASM, texture, and code assets from
GitHub Pages on first load and processes capture locally afterward; browser
caching may retain those assets. The desktop edition only uses internet access
when you deliberately open an external link. On an unusually old Windows
installation, Microsoft WebView2 may need to be installed separately.

## Main Workflow

1. For face tracking, select **Capture**, choose a camera/microphone, and enable
   device access. Skip this for manual avatar work.
2. Check `Capture 2/2` (or the applicable partial state) and tracker status.
3. Choose **Overlay**, **Camera**, or **Avatar** in the viewport toolbar.
4. Face the camera with a relaxed expression and calibrate the neutral pose.
5. Use **Create** for identity controls and **Edit** for expression controls.
6. Choose Motion, Avatar video, or Camera + avatar recording mode.
7. Press **Record**, perform, then press **Stop**.
8. Open **Export** and save the required format.

### Viewport controls

| Input | Action |
| --- | --- |
| Left drag | Orbit the head view |
| Shift + left drag | Pan |
| Mouse wheel | Zoom |
| `L` | Freeze or rebind the pointer light |
| Right-click Devices/backend | Choose Auto, GPU, or CPU tracking |
| Cardinal gizmo | Snap direction while preserving the current zoom and pan target |
| Reset button | Restore the default camera view |
| View-focus button | Hide the studio panels and focus the canvas; `Esc` exits |

## Recording and Export

**Capture mode** controls what the Record button stores; it does not change the
live viewport. **Motion data** records editable tracking channels for JSON/GLB,
**Avatar video** records only the rendered head/background, and **Camera +
avatar** records the enabled layers as one composited video. Microphone audio is
included in video modes unless muted.

| Format | Contents | Typical use |
| --- | --- | --- |
| JSON | Timestamped MediaPipe channels, neutral calibration, and head matrix | Re-import, custom retargeting, or analysis |
| GLB | GNM mesh, skin material, semantic/jaw morph targets, and animation | Blender, glTF tools, editing |
| MP4 | H.264 video and up to 320 kbps AAC, direct or converted locally with WebCodecs | Sharing and editing |
| WebM source | Optional unconverted source when WebView2 recorded WebM internally | Diagnostics or archival |

For Blender, animated GLB is the recommended editable export. Import it with
**File → Import → glTF 2.0**. Alembic export is not part of `1.0.0`.
Export defaults include local date and time down to seconds, for example
`GNM-Studio_2026-07-16_18-42-07_animation.glb`.

To reopen a motion take, click **Import JSON** beside the export buttons and
choose a `gnm-studio-motion` version 1 file. The app validates it, restores its
neutral calibration and FPS, and makes the timeline immediately seekable. JSON
contains motion only, so it cannot restore camera pixels, microphone audio, or
the original MP4/WebM source.

<details>
<summary>Model and retargeting details</summary>

The native Rust core evaluates the released GNM identity, expression, pose
correctives, forward kinematics, and linear-blend skinning path directly from
the bundled NPZ model. Automated tests compare neutral and posed output against
the original Python implementation.

The live viewport uses 20 semantic GNM morph targets derived from the upstream
semantic decoder. Because GNM does not expose an ARKit-style jaw bone, GNM
Studio adds a smoothly masked lower-jaw rotation morph and drives it from
MediaPipe `jawOpen` plus lip-separation channels. The raw 52 channels remain
available in JSON recordings for future or custom retargeting.

</details>

## System Requirements

For the prebuilt desktop app:

- Windows 10 or Windows 11, x64.
- Microsoft WebView2 runtime.
- A webcam for live motion capture; microphone is optional.
- A modern CPU and graphics driver capable of WebGL.
- No CUDA toolkit and no Python installation are required.

For the web edition:

- Current Chrome, Edge, or another Chromium-based browser with WebGL 2.
- HTTPS and permission to access a camera for live tracking.
- WebCodecs/H.264 support for MP4 conversion; WebM and motion/GLB exports remain
  available when a browser lacks H.264 encoding.

## Build from Source

### Required tools

| Tool | Recommended version / notes |
| --- | --- |
| Windows | Windows 10/11 x64 |
| Visual Studio Build Tools | 2022 with **Desktop development with C++** and Windows SDK |
| Rust | Stable MSVC toolchain, Rust 1.85+ |
| Node.js | 20+; Node 24 is known to work |
| npm | Included with Node.js |
| WebView2 | Required by Tauri |
| Python | Only needed when regenerating GNM runtime assets |

Clone and verify:

```powershell
git clone https://github.com/Saganaki22/GNM-Studio.git
cd GNM-Studio
npm ci
npm test
```

Run the development app:

```powershell
npm run tauri dev
```

Run the browser edition locally:

```powershell
npm run dev:web
```

Build and verify the GitHub Pages folder:

```powershell
npm run build:web
npm run check:web
```

The static output is written to `gh-pages/` with a `/GNM-Studio/` base path.
The generated folder is intentionally ignored by Git; rebuildable source lives
on `webapp-src`. The Pages workflow runs from `main` (as required by GitHub's
default Pages environment policy), explicitly checks out `webapp-src`, builds
the folder, enables Pages for a new repository, and deploys it through GitHub
Pages artifacts. Keep both branches synchronized when publishing web changes.
If repository policy blocks automatic enablement, select
**GitHub Actions** under **Settings → Pages** once. The main CI workflow validates
lint, desktop/web frontend builds, Pages paths, and Rust tests.

Build the standalone release executable:

```powershell
npm run tauri build -- --no-bundle
```

The output is:

```text
src-tauri\target\release\gnm-studio.exe
```

Create the normal and UPX portable ZIPs with SHA-256 checksums:

```powershell
powershell -ExecutionPolicy Bypass -File tools\package_portable.ps1
```

Pass `-SkipUpx` if only the standard portable archive is wanted.

<details>
<summary>Regenerating GNM runtime assets</summary>

Normal source builds use the committed runtime assets and do not need Python.
To regenerate the GLB and decoder binaries, install Python with NumPy and h5py,
place the upstream semantic decoder H5 files under `tools/gnm_source/`, keep
`gnm_head.npz` under `src-tauri/resources/`, then run:

```powershell
python -m pip install numpy h5py
npm run build:gnm
```

The converter is development-only. Python is never shipped to end users.

</details>

<details>
<summary>Project layout</summary>

```text
src/                         React/TypeScript studio UI
src/components/              Viewport, audio meter, and notifications
src/lib/                     GNM decoders, retargeting, saves, GLB export
src-tauri/src/               Rust Tauri commands and native GNM evaluator
src-tauri/resources/         Embedded released GNM NPZ model
public/models/               MediaPipe and generated GNM runtime assets
public/wasm/                 Bundled MediaPipe WASM runtime
gh-pages/                    Generated web deployment output (ignored)
.github/workflows/           Main CI and webapp-src Pages deployment
tools/build_gnm_runtime.py   Development-time NPZ/H5 converter
tools/package_portable.ps1   Standard and UPX portable packager
third_party/google-gnm/      Preserved upstream Google license
```

</details>

## Troubleshooting

<details>
<summary>Camera, tracker, controls, and video export</summary>

### Camera or microphone is missing

Check Windows privacy permissions, reconnect the device, then use the refresh
button beside the device selector.

### Tracker reports an error

Copy the technical details from the notification and click **Retry tracker**.
The app uses MediaPipe's module-aware local WASM loader and does not need a
network connection.

### Avatar or landmarks stop after an export

The app checks that MediaPipe resumes after every JSON, GLB, WebM, or MP4 save
and automatically restarts a stalled worker. **Reload tracker** is also always
available in the Tracking quality card. It reloads the local MediaPipe model
without changing the avatar, calibration, expressions, or app settings. If the
problem repeats, try System FFmpeg to reduce WebCodecs/GPU contention or switch
the tracking backend from GPU to CPU.

### Expression sliders appear subtle

Switch to **Avatar** view, increase avatar opacity, and move one expression at a
time. Manual controls work without a webcam. A glowing lock means that channel
is frozen at its current live-plus-manual value.

### MP4 is unavailable

GNM Studio always presents MP4 as the primary video export. When WebView2 cannot
record MP4 directly, the app records a high-quality WebM source and locally
transcodes it to H.264/AAC with WebCodecs. If H.264 itself is unavailable, update
Microsoft Edge WebView2 and retry; the optional WebM source remains exportable.

Power users may select **System FFmpeg** under **Encoder quality**. Enter `ffmpeg`
to use PATH or choose `ffmpeg.exe`. Auto uses a detected FFmpeg installation and
falls back to WebCodecs. FFmpeg is external and is not required or bundled.

### Windows antivirus flags the UPX build

Use the standard portable ZIP. UPX changes the executable's packed layout and
can trigger heuristic scanners even when the unpacked program is identical.

</details>

## Architecture

```text
Webcam / microphone
  → MediaPipe Face Landmarker worker
    → 478 landmarks + 52 blendshapes + head transform
      → semantic GNM retargeting
        → Three.js live viewport and recorder

Tauri React UI
  → Rust commands
    → native GNM Head v3 evaluator
      → identity / expression / joints / skinning
```

## Upstream and Credits

GNM Studio builds on:

- [Google GNM](https://github.com/google/GNM) for GNM Head v3 and semantic decoders.
- [Google AI Edge MediaPipe](https://github.com/google-ai-edge/mediapipe) for local face tracking.
- [Mediabunny](https://github.com/Vanilagy/mediabunny) for portable WebCodecs media conversion and AAC fallback.
- [FFmpeg](https://ffmpeg.org/) for the optional user-installed system encoder and AAC encoder foundation.
- [Phosphor Icons](https://github.com/phosphor-icons/core) and [Lucide](https://github.com/lucide-icons/lucide) for interface icons.
- [Tauri](https://tauri.app/), Rust, React, Vite, and Three.js for the desktop application.
- The supplied head artwork from SVG Repo.

## Citation

If you use any part of the GNM Ecosystem in your work, please consider citing
the corresponding package. Relevant BibTeX entries are listed below as well as
within the individual packages.

**GNM Head**

Coming soon.

## License

This project is licensed under the Apache License, Version 2.0. See the local
[LICENSE](LICENSE) file for details.

Google GNM is also distributed under Apache-2.0. Its upstream license is
available in [Google's GNM repository](https://github.com/google/GNM/blob/main/LICENSE)
and is preserved locally at `third_party/google-gnm/LICENSE`.
Bundled dependency licenses and matching-source information are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
The experimental skin maps are MIT-licensed according to the supplied asset
information; their original author/copyright attribution must be added before
public redistribution.
