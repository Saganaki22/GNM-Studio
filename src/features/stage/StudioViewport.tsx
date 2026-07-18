import type { ComponentProps, ReactNode } from "react";
import { Camera as PhosphorCamera } from "@phosphor-icons/react";
import { Download, FlipHorizontal2, Maximize2, Minimize2, PictureInPicture2, RotateCcw } from "lucide-react";
import { ExportWorkspace } from "../../components/ExportWorkspace";
import { Stage } from "../../components/Stage";
import type { Workspace } from "../../app/studioConfig";
import type { AppSettings } from "../../types";

export interface StudioViewportProps {
  workspace: Workspace;
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  calibrating: boolean;
  exportBusy: boolean;
  pngBusy: boolean;
  fullscreen: boolean;
  popout: {
    state: "idle" | "starting" | "active"; recordingIdle: boolean;
    open: () => void; close: () => void; focus: () => void;
  };
  captureStill: () => void;
  resetView: () => void;
  toggleFullscreen: () => void;
  stageProps: ComponentProps<typeof Stage>;
  exportProps: ComponentProps<typeof ExportWorkspace>;
  accessPrompt?: ReactNode;
}

export function StudioViewport({ workspace, settings, updateSetting, calibrating, exportBusy, pngBusy, fullscreen, popout, captureStill, resetView, toggleFullscreen, stageProps, exportProps, accessPrompt }: StudioViewportProps) {
  return <section className="viewport-column">
    <div className="viewport-toolbar">
      {workspace === "export" ? <div className="export-toolbar-title"><Download size={16} /><span>Export workspace</span><small>The renderer stays mounted behind this panel so captures retain the exact take state.</small></div> : <><div className="segmented view-mode-switch" aria-label="Viewport layers"><button disabled={calibrating} className={settings.showWebcam && settings.showAvatar ? "active" : ""} aria-pressed={settings.showWebcam && settings.showAvatar} onClick={() => { updateSetting("showWebcam", true); updateSetting("showAvatar", true); }}>Overlay</button><button disabled={calibrating} className={settings.showWebcam && !settings.showAvatar ? "active" : ""} aria-pressed={settings.showWebcam && !settings.showAvatar} onClick={() => { updateSetting("showWebcam", true); updateSetting("showAvatar", false); }}>Camera</button><button disabled={calibrating} className={!settings.showWebcam && settings.showAvatar ? "active" : ""} aria-pressed={!settings.showWebcam && settings.showAvatar} onClick={() => { updateSetting("showWebcam", false); updateSetting("showAvatar", true); }}>Avatar</button></div><div className="toolbar-actions"><button className="icon-button" title="Save a PNG photo of the exact canvas" disabled={calibrating || exportBusy || pngBusy} onClick={captureStill}><PhosphorCamera size={17} weight="duotone" /></button><button disabled={calibrating} className={`icon-button ${settings.mirror ? "active" : ""}`} title={settings.mirror ? "Mirrored camera and motion" : "Raw camera and motion"} aria-pressed={settings.mirror} onClick={() => updateSetting("mirror", !settings.mirror)}><FlipHorizontal2 size={16} /></button><button className="icon-button" title="Reset view" onClick={resetView}><RotateCcw size={16} /></button><button className={`icon-button ${popout.state !== "idle" ? "active" : ""}`} title={popout.state === "idle" ? "Open a clean canvas-only output window" : popout.state === "starting" ? "Output popout is connecting" : "Focus output popout"} aria-pressed={popout.state !== "idle"} disabled={calibrating || popout.state === "starting" || (popout.state === "idle" && !popout.recordingIdle)} onClick={popout.open}><PictureInPicture2 size={16} /></button><button className={`icon-button ${fullscreen ? "active" : ""}`} title={fullscreen ? "Exit fullscreen output (Esc)" : "Fullscreen canvas output"} aria-pressed={fullscreen} disabled={popout.state !== "idle"} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button></div></>}
    </div>
    {popout.state !== "idle" && <video ref={stageProps.videoRef} className="tracking-video-hidden" autoPlay muted playsInline />}
    {popout.state === "idle" ? <Stage {...stageProps} /> : <div className="popout-placeholder"><PictureInPicture2 size={38} /><strong>{popout.state === "starting" ? "Opening output canvas…" : "Canvas is live in the popout"}</strong><span>The popout owns the only 3D renderer. Camera tracking, editing and exports continue here without duplicate GPU work.</span><div><button className="secondary-button" disabled={popout.state !== "active"} onClick={popout.focus}>Focus popout</button><button className="primary-button" disabled={popout.state !== "active" || !popout.recordingIdle} onClick={popout.close} title={!popout.recordingIdle ? "Stop the current recording before closing the output" : "Close the popout and restore this canvas"}>Bring canvas back</button></div></div>}
    {workspace === "export" && <ExportWorkspace {...exportProps} />}
    {accessPrompt}
  </section>;
}
