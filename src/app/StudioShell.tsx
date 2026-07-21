import { createPortal } from "react-dom";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { AvatarAppearancePanels } from "../features/avatar/AvatarAppearancePanels";
import { AvatarModelPanel } from "../features/avatar/AvatarModelPanel";
import { CaptureSidebarContent } from "../features/devices/CaptureSidebarContent";
import { DeviceAccessPrompt } from "../features/devices/DeviceAccessPrompt";
import { ExpressionPanel } from "../features/expression/ExpressionPanel";
import { IdentityPanel } from "../features/identity/IdentityPanel";
import { CustomHeadPanel } from "../features/customHead/CustomHeadPanel";
import { PresetPanel } from "../features/presets/PresetPanel";
import { TransportDock } from "../features/recording/TransportDock";
import { LeftSidebar } from "../features/shell/LeftSidebar";
import { StudioFileInputs } from "../features/shell/StudioFileInputs";
import { StudioTopBar } from "../features/shell/StudioTopBar";
import { SettingsPopover } from "../features/settings/SettingsPopover";
import { RightSidebar } from "../features/stage/RightSidebar";
import { StudioViewport } from "../features/stage/StudioViewport";
import { BackendMenu } from "../features/tracking/BackendMenu";
import { ToastCenter } from "../components/ToastCenter";
import { avatarProfiles } from "../lib/avatarProfiles";
import { isDesktopRuntime, isWebEdition, manualJointGroups, type Workspace } from "./studioConfig";
import type { AppSettings } from "../types";
import type { useBackgroundImage } from "../features/background/useBackgroundImage";
import type { useFfmpegEncoder } from "../features/export/useFfmpegEncoder";
import type { useSaveFeedback } from "../features/export/useSaveFeedback";
import type { useFullscreenControls } from "../features/fullscreen/useFullscreenControls";
import type { useGnmRuntime } from "../features/gnm/useGnmRuntime";
import type { useTakePipeline } from "../features/recording/useTakePipeline";
import type { useStudioControls } from "../features/shell/useStudioControls";
import type { useStudioDerivedState } from "../features/shell/useStudioDerivedState";
import type { useStudioMetadata } from "../features/shell/useStudioMetadata";
import type { useStudioSettings } from "../features/settings/useStudioSettings";
import type { useStageOutputSync } from "../features/stage/useStageOutputSync";
import type { useStagePresentation } from "../features/stage/useStagePresentation";
import type { useCaptureTrackingPipeline } from "../features/tracking/useCaptureTrackingPipeline";
import type { useToasts } from "../features/toasts/useToasts";

interface StudioShellProps {
  settingsController: ReturnType<typeof useStudioSettings>;
  fullscreenController: ReturnType<typeof useFullscreenControls>;
  metadata: ReturnType<typeof useStudioMetadata>;
  captureTracking: ReturnType<typeof useCaptureTrackingPipeline>;
  gnm: ReturnType<typeof useGnmRuntime>;
  take: ReturnType<typeof useTakePipeline>;
  controls: ReturnType<typeof useStudioControls>;
  derived: ReturnType<typeof useStudioDerivedState>;
  stage: ReturnType<typeof useStagePresentation>;
  stageOutput: ReturnType<typeof useStageOutputSync>;
  background: ReturnType<typeof useBackgroundImage>;
  ffmpeg: ReturnType<typeof useFfmpegEncoder>;
  saveFeedback: ReturnType<typeof useSaveFeedback>;
  notifications: ReturnType<typeof useToasts>;
  activePanel: "avatar" | "capture";
  activeWorkspace: Workspace;
  manualExpressions: Record<string, number>;
  frozenExpressions: Record<string, number>;
  setManualExpressions: Dispatch<SetStateAction<Record<string, number>>>;
  setFrozenExpressions: Dispatch<SetStateAction<Record<string, number>>>;
  backgroundInputRef: RefObject<HTMLInputElement | null>;
  motionInputRef: RefObject<HTMLInputElement | null>;
  presetInputRef: RefObject<HTMLInputElement | null>;
  deviceError: string;
  updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void;
}

export function StudioShell(props: StudioShellProps) {
  const {
    settings, settingsOpen, setSettingsOpen, theme, setTheme, accent, setAccent,
    uiScale, setUiScale, leftSidebarCollapsed, setLeftSidebarCollapsed,
    rightSidebarCollapsed, setRightSidebarCollapsed,
  } = props.settingsController;
  const {
    fullscreen, controlsHidden: outputControlsHidden, scheduleControls: scheduleOutputControls,
    toggle: toggleFullscreen,
  } = props.fullscreenController;
  const { gnmInfo, appVersion } = props.metadata;
  const { videoRef, capture: captureDevices, playback, tracker, calibration } = props.captureTracking;
  const {
    cameras, microphones, permissionState, cameraAccess, microphoneAccess, devicePromptDismissed,
    paused: capturePaused, monitoring, audioLevel, audioPeak,
  } = captureDevices;
  const { identity, expression } = props.gnm;
  const {
    seed: identitySeed, presentation: identityGender, population: identityEthnicity,
    presentationStrength: identityPresentationStrength, populationWeights: identityPopulationWeights,
    status: identityStatus, webBackend: webIdentityBackend,
  } = identity;
  const {
    ready: expressionDecoderReady, status: gnmExpressionStatus, weights: gnmExpressionWeights,
    frozen: gnmFrozenExpressionComponents, semanticA: gnmExpressionA, semanticB: gnmExpressionB,
    seedA: gnmExpressionSeedA, seedB: gnmExpressionSeedB, blend: gnmExpressionBlend,
  } = expression;
  const { recording, output, exporter, presets: presetController } = props.take;
  const {
    state: recordingState, frames: recordedFrames, lastVideo, finalizing: captureFinalizing,
  } = recording;
  const { popoutState } = output;
  const {
    videoExportProgress, videoExportBackend, motionVideoRendering, pngSequenceRendering,
    pngExportProgress, exportRenderSize, exportTrimStartMs, exportTrimEndMs, exportPlaybackSpeed,
    setExportTrimStartMs, setExportTrimEndMs, setExportPlaybackSpeed, exportMotion,
    captureStill, exportWebm, exportPngSequence, exportVideo, exportWebmSource, exportGlb,
  } = exporter;
  const { presets: fullStatePresets, selectedId: selectedPresetId, name: presetName } = presetController;
  const { activateWorkspace, showAvatar, showCapture, toggleCaptureProcessing, togglePause } = props.controls;
  const {
    faceConfidence, trackingQualityLabel, recordedDuration, playbackDuration,
    timelineDuration, timelinePosition, timelinePercent, connectedCaptureCount,
    captureStatusTitle, displayedFrame, activeProfile, toggleExpressionFreeze,
    resetActiveExpressions,
  } = props.derived;
  const {
    settings: stageSettings, identityVertices: stageIdentityVertices,
    manualExpressions: stageManualExpressions, frozenExpressions: stageFrozenExpressions,
    neutralFrame: stageNeutralFrame, backgroundImageUrl: stageBackgroundImageUrl,
  } = props.stageOutput;
  const {
    forcedViewState, resetViewSignal, resetView, handleCanvas, handleError,
    handleResize, handleViewState,
  } = props.stage;
  const { backgroundImageUrl, backgroundImageName, chooseBackgroundImage, clearBackgroundImage } = props.background;
  const { status: ffmpegStatus, version: ffmpegVersion } = props.ffmpeg;
  const { openExternal } = props.saveFeedback;
  const { toasts, pushToast, dismissToast } = props.notifications;
  const { playing, frame: playbackFrame, elapsed: recordingElapsed } = playback;
  const {
    frame: trackingFrame, status: trackerStatus, delegate: trackerDelegate,
    fallbackReason: trackerFallbackReason, gpuProbe, cpuProbe, backendMenu,
  } = tracker;
  const {
    neutralFrame, calibrating, complete: calibrationComplete, countdown,
    faceAlignment: calibrationFaceAlignment, readiness: calibrationReadiness,
  } = calibration;

  return (
    <>
    <main
      className={`app-shell ${isWebEdition ? "web-edition" : "desktop-edition"} ${leftSidebarCollapsed ? "left-sidebar-collapsed" : ""} ${rightSidebarCollapsed ? "right-sidebar-collapsed" : ""} ${recordingState === "recording" ? "is-recording" : ""} ${fullscreen ? "viewport-focus" : ""} ${outputControlsHidden ? "output-controls-hidden" : ""}`}
      style={{ "--ui-scale": (uiScale / 100).toFixed(2) } as React.CSSProperties}
      onPointerMove={fullscreen ? scheduleOutputControls : undefined}
    >
      <StudioTopBar
        web={isWebEdition}
        workspace={props.activeWorkspace}
        activateWorkspace={activateWorkspace}
        capture={{ paused: capturePaused, calibrating, finalizing: captureFinalizing, cameraAccess, microphoneAccess, statusTitle: captureStatusTitle, connectedCount: connectedCaptureCount, toggle: toggleCaptureProcessing }}
        backend={{ menuOpen: Boolean(backendMenu), trackerStatus, delegate: trackerDelegate, openMenu: (x, y) => { setSettingsOpen(false); tracker.openBackendMenu(x, y); } }}
        recording={{ state: recordingState, elapsed: recordingElapsed }}
        settings={{ open: settingsOpen, toggle: () => setSettingsOpen((value) => !value) }}
      />

      <LeftSidebar
        collapsed={leftSidebarCollapsed}
        activePanel={props.activePanel}
        toggleCollapsed={() => setLeftSidebarCollapsed((value) => !value)}
        showAvatar={showAvatar}
        showCapture={showCapture}
        avatarContent={<>
          <AvatarModelPanel avatarKind={settings.avatarKind} gnmInfo={gnmInfo} select={(avatarKind) => { props.updateSetting("avatarKind", avatarKind); pushToast({ type: "info", title: `${avatarProfiles[avatarKind].label} selected`, message: avatarKind === "facecap" ? "MediaPipe now drives all 52 FaceCap morph targets directly." : "GNM semantic deformation and seeded desktop identities are active." }); }} />
          {activeProfile.supportsIdentity && <IdentityPanel seed={identitySeed} presentation={identityGender} population={identityEthnicity} presentationStrength={identityPresentationStrength} populationWeights={identityPopulationWeights} status={identityStatus} recordingIdle={recordingState === "idle"} web={isWebEdition} webBackend={webIdentityBackend} setSeed={identity.setSeed} setPresentation={identity.choosePresentation} setPopulation={identity.choosePopulation} setPresentationStrength={identity.setPresentationStrength} setPopulationWeight={identity.updatePopulationWeight} randomize={identity.randomize} comparePresentation={identity.comparePresentation} generate={() => void identity.generate()} />}
          {activeProfile.supportsIdentity && <CustomHeadPanel videoRef={videoRef} cameraReady={cameraAccess === "ready"} recordingIdle={recordingState === "idle" && !captureFinalizing} currentWeights={identity.weights} applyWeights={identity.applyWeights} onToast={pushToast} onError={handleError} />}
          <PresetPanel presets={fullStatePresets} selectedId={selectedPresetId} name={presetName} recordingIdle={recordingState === "idle"} inputRef={props.presetInputRef} select={presetController.select} setName={presetController.setName} save={presetController.save} load={presetController.load} update={presetController.update} rename={presetController.rename} remove={presetController.remove} exportBundle={() => void presetController.exportBundle()} />
          <AvatarAppearancePanels settings={settings} updateSetting={props.updateSetting} />
          <ExpressionPanel avatarKind={settings.avatarKind} avatarLabel={activeProfile.shortLabel} expressionCount={activeProfile.expressionCount} manual={props.manualExpressions} frozen={props.frozenExpressions} disabled={recordingState !== "idle" || captureFinalizing} setManual={(name, value) => props.setManualExpressions((current) => ({ ...current, [name]: value }))} toggleFreeze={toggleExpressionFreeze} resetExpressions={resetActiveExpressions} resetJoints={() => { const names = new Set<string>(manualJointGroups.flatMap((group) => group.controls.map(([name]) => name))); props.setManualExpressions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !names.has(name)))); props.setFrozenExpressions((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !names.has(name)))); }} gnm={{ semanticA: gnmExpressionA, semanticB: gnmExpressionB, seedA: gnmExpressionSeedA, seedB: gnmExpressionSeedB, blend: gnmExpressionBlend, weights: gnmExpressionWeights, frozen: gnmFrozenExpressionComponents, ready: expressionDecoderReady, busy: gnmExpressionStatus === "evaluating", backend: isDesktopRuntime ? "Native Rust" : webIdentityBackend === "webgpu" ? "WebGPU worker" : "CPU worker", setSemanticA: expression.setSemanticA, setSemanticB: expression.setSemanticB, setSeedA: expression.setSeedA, setSeedB: expression.setSeedB, resampleA: expression.resampleA, resampleB: expression.resampleB, setBlend: expression.setBlend, setWeight: expression.setWeight, toggleFreeze: expression.toggleFreeze, mirror: expression.mirror, reset: expression.reset }} />
        </>}
        captureContent={<CaptureSidebarContent web={isWebEdition} settings={settings} cameras={cameras} cameraReady={cameraAccess === "ready"} permissionAsking={permissionState === "asking"} ffmpegStatus={ffmpegStatus} ffmpegVersion={ffmpegVersion} updateSetting={props.updateSetting} enumerateDevices={() => void captureDevices.enumerateDevices()} requestAccess={() => void captureDevices.requestAccess()} checkFfmpeg={() => void props.ffmpeg.check()} chooseFfmpeg={() => void props.ffmpeg.choose()} openFfmpegDownload={() => void openExternal("https://ffmpeg.org/download.html")} />}
      />
      <StudioViewport
        workspace={props.activeWorkspace}
        settings={settings}
        updateSetting={props.updateSetting}
        calibrating={calibrating}
        exportBusy={videoExportProgress !== null}
        pngBusy={pngSequenceRendering}
        fullscreen={fullscreen}
        popout={{ state: popoutState, recordingIdle: recordingState === "idle", open: () => void output.open(activeProfile.label), close: output.close, focus: output.focus }}
        captureStill={() => void captureStill()}
        resetView={resetView}
        toggleFullscreen={() => void toggleFullscreen()}
        stageProps={{
          avatarKind: stageSettings.avatarKind,
          videoRef,
          frame: displayedFrame,
          neutralFrame: stageNeutralFrame,
          showWebcam: calibrating || stageSettings.showWebcam,
          showAvatar: !calibrating && (motionVideoRendering || pngSequenceRendering || stageSettings.showAvatar),
          showLandmarks: !calibrating && stageSettings.showLandmarks,
          mirror: stageSettings.mirror,
          opacity: stageSettings.avatarOpacity,
          wireframe: stageSettings.wireframe,
          skinTextureEnabled: stageSettings.skinTextureEnabled,
          skinTone: stageSettings.skinTone,
          skinTextureScale: stageSettings.skinTextureScale,
          skinTextureRotation: stageSettings.skinTextureRotation,
          skinTextureFeather: stageSettings.skinTextureFeather,
          eyeShaderEnabled: stageSettings.eyeShaderEnabled,
          eyeColor: stageSettings.eyeColor,
          backgroundMode: stageSettings.backgroundMode,
          backgroundColor: stageSettings.backgroundColor,
          backgroundImageUrl: stageBackgroundImageUrl,
          backgroundImageZoom: stageSettings.backgroundImageZoom,
          mouseLightEnabled: stageSettings.mouseLightEnabled,
          mouseLightIntensity: stageSettings.mouseLightIntensity,
          headPoseSettings: { enabled: stageSettings.headRotationEnabled, yawStrength: stageSettings.headYawStrength, pitchStrength: stageSettings.headPitchStrength, rollStrength: stageSettings.headRollStrength, deadZone: stageSettings.headRotationDeadZone, smoothing: stageSettings.headRotationSmoothing },
          calibrating,
          calibrationComplete,
          faceAlignment: calibrationFaceAlignment,
          countdown,
          trackingReady: Boolean(trackingFrame),
          identityVertices: stageIdentityVertices,
          manualExpressions: stageManualExpressions,
          frozenExpressions: stageFrozenExpressions,
          recordingMode: motionVideoRendering || pngSequenceRendering ? "avatar" : stageSettings.recordingMode,
          recordingActive: motionVideoRendering || pngSequenceRendering || recordingState !== "idle",
          resetViewSignal,
          viewStateOverride: forcedViewState,
          exportRenderSize,
          onCancelCalibration: calibration.cancel,
          onCompositeCanvas: handleCanvas,
          onStageError: handleError,
          onViewportResize: handleResize,
          onViewStateChange: handleViewState,
          onAvatarMotion: recording.storeAvatarMotion,
        }}
        exportProps={{
          hasTake: recordedFrames.length > 0,
          hasVideo: Boolean(lastVideo),
          videoIsWebm: Boolean(lastVideo?.type.includes("webm")),
          durationMs: recordedDuration,
          frameCount: recordedFrames.length,
          width: settings.exportWidth,
          height: settings.exportHeight,
          fps: settings.exportFps,
          trimStartMs: exportTrimStartMs,
          trimEndMs: exportTrimEndMs || recordedDuration,
          speed: exportPlaybackSpeed,
          busy: captureFinalizing || videoExportProgress !== null || pngSequenceRendering,
          progress: pngExportProgress ?? videoExportProgress,
          onWidthChange: (value) => props.updateSetting("exportWidth", Math.min(7680, Math.max(64, Math.round(value / 2) * 2))),
          onHeightChange: (value) => props.updateSetting("exportHeight", Math.min(4320, Math.max(64, Math.round(value / 2) * 2))),
          onFpsChange: (value) => props.updateSetting("exportFps", Math.min(120, Math.max(1, Math.round(value)))),
          onTrimStartChange: (value) => { setExportTrimStartMs(Math.min(exportTrimEndMs || recordedDuration, Math.max(0, value))); playback.setElapsed(0); playback.setFrame(null); },
          onTrimEndChange: (value) => { setExportTrimEndMs(Math.min(recordedDuration, Math.max(exportTrimStartMs, value))); playback.setElapsed(0); playback.setFrame(null); },
          onSpeedChange: (value) => { setExportPlaybackSpeed(Math.min(4, Math.max(0.1, value))); playback.setElapsed(0); playback.setFrame(null); },
          onExportMp4: () => void exportVideo(),
          onExportWebm: () => void exportWebm(),
          onExportPng: () => void exportPngSequence(),
          onReturn: () => activateWorkspace("capture"),
        }}
        accessPrompt={props.activeWorkspace !== "export" && permissionState !== "ready" && !devicePromptDismissed ? <DeviceAccessPrompt permissionState={permissionState} error={props.deviceError} requestAccess={() => void captureDevices.requestAccess()} continueWithoutCapture={captureDevices.continueWithoutCapture} /> : undefined}
      />
      <RightSidebar
        collapsed={rightSidebarCollapsed}
        toggleCollapsed={() => setRightSidebarCollapsed((value) => !value)}
        tracking={{ status: trackerStatus, score: faceConfidence, label: trackingQualityLabel, fallbackReason: trackerFallbackReason, delegate: trackerDelegate, cameraReady: cameraAccess === "ready", reload: () => tracker.reload() }}
        settings={settings}
        updateSetting={props.updateSetting}
        avatarLabel={activeProfile.shortLabel}
        calibrating={calibrating}
        calibration={{ neutralFrame, readiness: calibrationReadiness, recordingIdle: recordingState === "idle", trackerReady: trackerStatus === "ready", hasFrame: Boolean(trackingFrame), start: () => void calibration.calibrate() }}
        background={{ url: backgroundImageUrl, name: backgroundImageName, inputRef: props.backgroundInputRef, clear: () => void clearBackgroundImage() }}
      />
      <TransportDock
        audio={{ devices: microphones, selectedId: settings.microphoneId, level: audioLevel, peak: audioPeak, muted: settings.muted, monitoring, select: (id) => props.updateSetting("microphoneId", id), toggleMute: () => props.updateSetting("muted", !settings.muted), toggleMonitoring: () => captureDevices.setMonitoring((value) => !value), refresh: () => void captureDevices.enumerateDevices() }}
        recording={{ state: recordingState, elapsed: recordingElapsed, frameCount: recordedFrames.length, draftFrameCount: recording.draftFrameCount, playing, playbackActive: Boolean(playbackFrame || playing), calibrating, finalizing: captureFinalizing, videoBusy: videoExportProgress !== null, popoutStarting: popoutState === "starting", motionNeedsFace: !trackingFrame && settings.recordingMode === "motion", start: () => void recording.start(), stop: recording.stop, togglePause, returnLive: playback.returnToLive }}
        timeline={{ percent: timelinePercent, duration: timelineDuration, position: timelinePosition, recordedDuration, playbackDuration, seek: playback.seek }}
        exports={{ fps: settings.exportFps, motionInputRef: props.motionInputRef, hasTake: recordedFrames.length > 0, hasVideo: Boolean(lastVideo), sourceIsWebm: Boolean(lastVideo && !lastVideo.type.includes("mp4")), videoProgress: videoExportProgress, backend: videoExportBackend, setFps: (value) => props.updateSetting("exportFps", value), useCurrentLook: recording.useCurrentAppearance, exportMotion: () => void exportMotion(), exportGlb: () => void exportGlb(), exportWebmSource: () => void exportWebmSource(), exportVideo: () => void exportVideo() }}
      />
      <ToastCenter toasts={toasts} onDismiss={dismissToast} />
      <StudioFileInputs motionRef={props.motionInputRef} backgroundRef={props.backgroundInputRef} presetRef={props.presetInputRef} importMotion={(file) => void recording.importMotionJson(file)} chooseBackground={(file) => void chooseBackgroundImage(file)} importPresets={(file) => void presetController.importBundle(file)} />
    </main>
    {backendMenu && createPortal(<BackendMenu position={backendMenu} backend={settings.trackingBackend} gpuProbe={gpuProbe} cpuProbe={cpuProbe} close={tracker.closeBackendMenu} select={tracker.selectBackend} />, document.body)}
    {settingsOpen && createPortal(<SettingsPopover web={isWebEdition} theme={theme} accent={accent} uiScale={uiScale} settings={settings} appVersion={appVersion} close={() => setSettingsOpen(false)} setTheme={setTheme} setAccent={setAccent} setUiScale={setUiScale} updateSetting={props.updateSetting} openExternal={(url) => void openExternal(url)} />, document.body)}
    </>
  );
}
