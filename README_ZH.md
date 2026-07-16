# GNM Studio

<p align="center">
  <img src="public/head-svgrepo-com%20(2).svg" width="92" alt="GNM Studio 头像图标">
</p>

<p align="center">
  一个本地优先的桌面与网页 Google GNM 头像创建、摄像头动捕工作室。
</p>

<p align="center">
  <a href="https://github.com/Saganaki22/GNM-Studio/releases"><img src="https://img.shields.io/badge/release-v1.0.0-54ddb2" alt="版本 v1.0.0"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-0078D4" alt="Windows x64">
  <a href="https://drbaph.is-a.dev/GNM-Studio/"><img src="https://img.shields.io/badge/web-GitHub%20Pages-222222" alt="GitHub Pages 网页版"></a>
  <img src="https://img.shields.io/badge/UI-Tauri%202%20%2B%20React-24C8DB" alt="Tauri 2 与 React">
  <img src="https://img.shields.io/badge/core-Rust-orange" alt="Rust 核心">
  <img src="https://img.shields.io/badge/tracking-MediaPipe-4285F4" alt="MediaPipe 跟踪">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-green" alt="Apache 2.0"></a>
</p>

[English README](README.md) · [在线体验](https://drbaph.is-a.dev/GNM-Studio/) · [下载页面](https://github.com/Saganaki22/GNM-Studio/releases) · [Google GNM](https://github.com/google/GNM)

作者：[Saganaki22](https://github.com/Saganaki22)

GNM Studio `1.0.0` 将 Google GNM Head v3、MediaPipe Face Landmarker、
Three.js、Rust 与 Tauri 整合到便携式 Windows 应用，并提供用于在线体验跟踪与
动画流程的 GitHub Pages 版本。它可通过摄像头驱动头像、录制面部动作和视频，
并把动画导出到 Blender。普通用户无需安装 Python、Node.js、Rust 或 CUDA；
桌面版还提供原生的带种子身份生成。

## 下载与运行

1. 从 [GitHub Releases](https://github.com/Saganaki22/GNM-Studio/releases)
   下载最新的 Windows x64 压缩包。
2. 解压到可写目录，例如 `C:\AI\GNM-Studio\`。
3. 运行 `GNM-Studio-v1.0.0.exe`。
4. 如需实时捕捉，请允许摄像头和/或麦克风权限；手动编辑可选择
   **Continue without capture**。
5. 跟踪录制前保持放松的中性表情，并点击 **Calibrate neutral**。

可能会提供两种便携包：

| 软件包 | 适用情况 |
| --- | --- |
| 标准便携 ZIP | 推荐，杀毒软件与代码签名兼容性最好。 |
| UPX 便携 ZIP | 可执行文件更小；请在杀毒软件接受 UPX 打包时使用。 |

应用与全部模型资源都已嵌入，无需安装程序。

## 网页版

使用当前版本的 Chromium 内核浏览器打开
[drbaph.is-a.dev/GNM-Studio](https://drbaph.is-a.dev/GNM-Studio/)。摄像头与
麦克风需要 HTTPS 权限，GitHub Pages 会提供 HTTPS。所有画面与音频处理都在浏览器
本地完成，不会上传到应用服务器。

网页版包含基础 GNM 头像、MediaPipe GPU/CPU 跟踪、校准、叠加、关键点、智能
平滑、表情和冻结、PBR 皮肤、背景、动作/视频录制、回放、JSON 导入导出、动画
GLB 以及浏览器 MP4/WebM 保存。MP4 能力取决于浏览器编码器。原生带种子身份求值
与系统 FFmpeg 依赖 Rust/Tauri 进程，因此仅桌面版提供。

构建固定使用 `/GNM-Studio/` 基础路径，以便应用运行在现有自定义域名的子路径。
本项目不发布 `CNAME` 文件：`drbaph.is-a.dev` 属于父级 Pages 站点，本应用位于其
`GNM-Studio` 子路径。

## 主要功能

- 原生 Google GNM Head v3 网格：17,821 个顶点、35,324 个三角形。
- 带种子的身份生成，以及外观表达和人群混合控制。
- MediaPipe 摄像头跟踪：478 个面部关键点、52 个表情通道和面部变换矩阵，
  默认优先使用 GPU，失败时回退到 CPU。
- 右键点击 Devices 或后端状态可选择 Auto、仅 GPU 或仅 CPU；探测失败的后端会变灰。
- 类似身份验证的中性姿势校准：临时仅显示摄像头、橙色/绿色位置提示、稳定后
  3-2-1 倒计时、自动恢复原图层，并真正归零中性表情与头部方向。
- 分离的 0–100% 自适应面部与头部动作平滑，加入死区与单帧瞬态过滤；孤立的小幅
  抽动会被丢弃，持续的主动动作会快速打开滤波器。
- 20 个 GNM 语义表情滑块，每个通道都可独立冻结；另有增强的派生下颌形变目标，
  使 MediaPipe 检测到大幅张嘴时下颌打开得更明确。
- 仅摄像头、仅头像、或透明头像叠加摄像头三种显示模式。
- 与摄像头裁剪精确对齐的关键点、统一的摄像头/动作镜像、线框与头像透明度。
- 类似 Blender 的旋转、平移、滚轮缩放；基准视图会保留当前缩放和平移，重置视图独立恢复默认构图。
- 实验性重复 PBR 皮肤材质默认关闭并折叠：五种基础肤色、对齐的颜色/法线/位移/
  遮蔽/高光贴图、缩放与旋转、可调接缝羽化，以及无闪暗的实时调整。
- 鼠标跟随灯光；按 `L` 冻结或重新绑定，并可调整开关与强度。
- 工作室渐变、纯色、透明以及本地自定义图片背景；保持原始比例，支持替换、删除与 100–300% 缩放。
- 摄像头和麦克风设备选择、麦克风静音、监听及彩色输入电平表。
- 摄像头、跟踪和导出帧率可在 1–120 FPS 之间自定义。
- 面向高级用户的 1–50 Mbps 视频码率和 64–320 kbps 音频码率控制。
- MP4 后端可选 Auto、便携 WebCodecs 或系统 FFmpeg。可从 PATH 检测或手动选择
  `ffmpeg.exe`，且 FFmpeg 并非必需。
- 动作录制、暂停/继续、可拖动定位的回放、明确的 Return to Live 按钮、经过验证的
  JSON 重新导入，以及可复制的详细错误信息。
- 深色/浅色主题、五种强调色、可持久保存的 80–125% 界面缩放。
- GitHub 与版本链接始终通过 Windows 默认浏览器打开，而不是应用 WebView。

## 离线与隐私

Windows 版在运行时**不会下载模型**。发布版 EXE 已包含：

- MediaPipe Face Landmarker task 模型。
- MediaPipe WASM 加载器和二进制文件。
- Google GNM Head v3 NPZ 数据。
- GNM 运行时 GLB 与语义身份/表情解码器。
- 五种本地实验性皮肤颜色贴图及共享的 PBR 细节贴图。
- 本地 WebCodecs MP4 封装和 AAC 后备编码器。
- 完整的 Tauri/Vite 前端。

摄像头画面与麦克风数据都保留在本机。网页版首次加载时会从 GitHub Pages 下载
相同的模型、WASM、贴图与代码静态资源，随后在浏览器本地处理；浏览器可能缓存这些
资源。桌面版只有在用户主动打开外部链接时才会访问网络。极少数较旧的 Windows
系统可能需要单独安装 Microsoft WebView2。

## 基本工作流程

1. 如需面部跟踪，打开 **Capture**、选择摄像头/麦克风并启用权限；手动编辑可跳过。
2. 检查 `Capture 2/2`（或部分连接状态）以及跟踪器状态。
3. 在视口工具栏选择 **Overlay**、**Camera** 或 **Avatar**。
4. 以放松表情面对摄像头并校准中性姿势。
5. 使用 **Create** 调整身份，使用 **Edit** 调整表情。
6. 选择 Motion、Avatar video 或 Camera + avatar 录制模式。
7. 点击 **Record** 开始表演，完成后点击 **Stop**。
8. 打开 **Export** 并保存需要的格式。

### 视口控制

| 输入 | 操作 |
| --- | --- |
| 鼠标左键拖动 | 旋转头像视图 |
| Shift + 左键拖动 | 平移 |
| 鼠标滚轮 | 缩放 |
| `L` | 冻结或重新绑定鼠标灯光 |
| 右键点击 Devices/后端状态 | 选择 Auto、GPU 或 CPU 跟踪 |
| 方位控件 | 切换方向，同时保留当前缩放和平移目标 |
| 重置按钮 | 恢复默认相机视图 |
| 视口聚焦按钮 | 隐藏工作室面板并放大画布；按 `Esc` 退出 |

## 录制与导出

**Capture mode** 决定 Record 按钮保存什么，不会改变实时视口。**Motion data**
记录可编辑的跟踪通道用于 JSON/GLB；**Avatar video** 只录制渲染头像和背景；
**Camera + avatar** 把已启用的图层合成为一个视频。视频模式会录入麦克风，除非静音。

| 格式 | 内容 | 常见用途 |
| --- | --- | --- |
| JSON | 带时间戳的 MediaPipe 通道、中性校准和头部矩阵 | 重新导入、自定义重定向或分析 |
| GLB | GNM 网格、皮肤材质、语义/下颌形变目标和动画 | Blender、glTF 工具、后期编辑 |
| MP4 | H.264 视频与最高 320 kbps AAC；直接录制或用 WebCodecs 本地转换 | 分享与剪辑 |
| WebM 源文件 | WebView2 内部录制 WebM 时可选保存的未转换源文件 | 诊断或归档 |

Blender 可编辑动画推荐使用 GLB。通过 **File → Import → glTF 2.0** 导入。
`1.0.0` 暂不包含 Alembic 导出。
默认导出文件名包含精确到秒的本地日期与时间，例如
`GNM-Studio_2026-07-16_18-42-07_animation.glb`。

若要重新打开动作，请点击导出按钮旁的 **Import JSON**，选择
`gnm-studio-motion` version 1 文件。应用会验证文件、恢复中性校准和 FPS，
并立即启用时间轴拖动定位。JSON 只包含动作数据，无法恢复摄像头画面、麦克风音频
或原始 MP4/WebM 源文件。

<details>
<summary>模型与动作重定向细节</summary>

原生 Rust 核心直接读取内置 NPZ，执行 GNM 的身份、表情、姿势修正、正向运动学
与线性混合蒙皮流程。自动化测试会把中性与带姿势输出和原始 Python 实现进行比较。

实时视口使用由上游语义解码器生成的 20 个 GNM 语义形变目标。GNM 没有提供
ARKit 式下颌骨，因此 GNM Studio 额外加入平滑遮罩的下颌旋转形变，并由 MediaPipe
的 `jawOpen` 与嘴唇分离通道驱动。原始 52 通道仍会保存在 JSON 录制中。

</details>

## 系统要求

预构建桌面版需要：

- Windows 10 或 Windows 11 x64。
- Microsoft WebView2 运行时。
- 实时动捕需要摄像头；麦克风可选。
- 支持 WebGL 的现代 CPU 与显卡驱动。
- 不需要 CUDA Toolkit，也不需要 Python。

网页版需要：

- 支持 WebGL 2 的当前版 Chrome、Edge 或其他 Chromium 内核浏览器。
- 实时跟踪需要 HTTPS 与摄像头权限。
- MP4 转换需要 WebCodecs/H.264；浏览器缺少 H.264 时仍可使用 WebM、动作与 GLB 导出。

## 从源码构建

### 工具要求

| 工具 | 推荐版本 / 说明 |
| --- | --- |
| Windows | Windows 10/11 x64 |
| Visual Studio Build Tools | 2022，安装 **Desktop development with C++** 与 Windows SDK |
| Rust | 稳定 MSVC 工具链，Rust 1.85+ |
| Node.js | 20+；Node 24 已验证可用 |
| npm | 随 Node.js 安装 |
| WebView2 | Tauri 必需 |
| Python | 仅重新生成 GNM 运行时资源时需要 |

克隆并验证：

```powershell
git clone https://github.com/Saganaki22/GNM-Studio.git
cd GNM-Studio
npm ci
npm test
```

运行开发版：

```powershell
npm run tauri dev
```

本地运行网页版：

```powershell
npm run dev:web
```

构建并验证 GitHub Pages 文件夹：

```powershell
npm run build:web
npm run check:web
```

静态输出写入 `gh-pages/`，基础路径为 `/GNM-Studio/`。生成文件夹不会提交到 Git；
可重建源码保存在 `webapp-src` 分支。推送该分支后，`.github/workflows/pages.yml`
会为新仓库启用 Pages、重新构建并通过 GitHub Pages artifact 部署。若仓库策略阻止
自动启用，请在 **Settings → Pages** 中把 Source 设为 **GitHub Actions**。主 CI
会检查 lint、桌面/网页前端构建、Pages 路径以及 Rust 测试。

构建独立 EXE：

```powershell
npm run tauri build -- --no-bundle
```

输出文件：

```text
src-tauri\target\release\gnm-studio.exe
```

生成标准与 UPX 便携 ZIP，并写入 SHA-256 校验：

```powershell
powershell -ExecutionPolicy Bypass -File tools\package_portable.ps1
```

只需要标准便携包时可追加 `-SkipUpx`。

<details>
<summary>重新生成 GNM 运行时资源</summary>

普通源码构建直接使用仓库中的运行时资源，不需要 Python。若要重新生成 GLB
和解码器二进制文件，请安装 NumPy 与 h5py，把上游语义解码器 H5 文件放在
`tools/gnm_source/`，并保留 `src-tauri/resources/gnm_head.npz`，然后运行：

```powershell
python -m pip install numpy h5py
npm run build:gnm
```

转换器仅用于开发，Python 不会随应用发布。

</details>

<details>
<summary>项目目录</summary>

```text
src/                         React/TypeScript 工作室界面
src/components/              视口、音频电平和通知
src/lib/                     GNM 解码器、重定向、保存、GLB 导出
src-tauri/src/               Rust Tauri 命令与原生 GNM 求值器
src-tauri/resources/         内置的 GNM NPZ 模型
public/models/               MediaPipe 与生成后的 GNM 运行时资源
public/wasm/                 内置 MediaPipe WASM 运行时
gh-pages/                    生成的网页部署输出（已忽略）
.github/workflows/           主 CI 与 webapp-src Pages 部署
tools/build_gnm_runtime.py   开发期 NPZ/H5 转换器
tools/package_portable.ps1   标准与 UPX 便携打包脚本
third_party/google-gnm/      保留的 Google 上游许可证
```

</details>

## 常见问题

<details>
<summary>摄像头、跟踪器、控制和视频导出</summary>

### 找不到摄像头或麦克风

检查 Windows 隐私权限，重新连接设备，然后点击设备选择器旁的刷新按钮。

### 跟踪器报错

从通知中复制技术详情，然后点击 **Retry tracker**。应用使用 MediaPipe 的本地
模块化 WASM 加载器，不需要网络连接。

### 导出后头像或关键点停止

每次保存 JSON、GLB、WebM 或 MP4 后，应用都会检查 MediaPipe 是否恢复，并自动
重启卡住的 Worker。Tracking quality 卡片中也始终提供 **Reload tracker**，可重新
加载本地 MediaPipe 模型，而不会改变头像、校准、表情或应用设置。若问题重复出现，
可尝试 System FFmpeg 以减少 WebCodecs/GPU 资源竞争，或将跟踪后端从 GPU 切换为 CPU。

### 表情滑块变化不明显

切换到 **Avatar** 视图，提高头像透明度，然后一次调整一个表情。手动滑块在
没有摄像头时也可工作。锁发光表示该通道已冻结在当前实时值加手动值的位置。

### 无法导出 MP4

MP4 始终是主要视频导出格式。WebView2 无法直接录制 MP4 时，应用会先录制高质量
WebM 源文件，再使用 WebCodecs 在本地转换为 H.264/AAC。若系统没有 H.264 编码器，
请更新 Microsoft Edge WebView2 后重试；仍可导出可选的 WebM 源文件。

高级用户可在 **Encoder quality** 中选择 **System FFmpeg**。输入 `ffmpeg` 使用
PATH，或手动选择 `ffmpeg.exe`。Auto 会优先使用检测到的 FFmpeg，否则回退到
WebCodecs。FFmpeg 是可选外部工具，不会捆绑到应用中。

### Windows 杀毒软件提示 UPX 版本

请改用标准便携 ZIP。UPX 会改变 EXE 的压缩布局，即使解包后的程序相同，也可能
触发启发式扫描。

</details>

## 架构

```text
摄像头 / 麦克风
  → MediaPipe Face Landmarker Worker
    → 478 关键点 + 52 表情通道 + 头部变换
      → GNM 语义动作重定向
        → Three.js 实时视口与录制器

Tauri React 界面
  → Rust 命令
    → 原生 GNM Head v3 求值器
      → 身份 / 表情 / 关节 / 蒙皮
```

## 上游项目与致谢

- [Google GNM](https://github.com/google/GNM)：GNM Head v3 与语义解码器。
- [Google AI Edge MediaPipe](https://github.com/google-ai-edge/mediapipe)：本地面部跟踪。
- [Mediabunny](https://github.com/Vanilagy/mediabunny)：便携 WebCodecs 媒体转换与 AAC 后备编码。
- [FFmpeg](https://ffmpeg.org/)：可选的用户安装系统编码器及 AAC 编码基础。
- [Phosphor Icons](https://github.com/phosphor-icons/core) 与 [Lucide](https://github.com/lucide-icons/lucide)：界面图标。
- [Tauri](https://tauri.app/)、Rust、React、Vite 与 Three.js：桌面应用框架。
- 应用头像图形来自用户提供的 SVG Repo 素材。

## 引用

如果你在工作中使用了 GNM Ecosystem 的任何部分，请考虑引用对应的软件包。
相关 BibTeX 条目会列在下方以及各个软件包中。

**GNM Head**

即将提供。

## 许可证

本项目使用 Apache License, Version 2.0。详情见本地 [LICENSE](LICENSE)。

Google GNM 同样使用 Apache-2.0，其上游许可证位于
[Google GNM 仓库](https://github.com/google/GNM/blob/main/LICENSE)，并保存在
本仓库的 `third_party/google-gnm/LICENSE`。
捆绑依赖的许可证与对应源代码信息见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
根据提供的素材信息，实验性皮肤贴图使用 MIT 许可证；公开再分发前仍需补充原作者、
版权行与原始来源。
