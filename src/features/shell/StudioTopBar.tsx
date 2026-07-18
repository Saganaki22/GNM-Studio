import { Camera, Microphone, Pause, Play } from "@phosphor-icons/react";
import { Settings2 } from "lucide-react";
import { brandHeadIconStyle, type Workspace } from "../../app/studioConfig";
import { formatTime } from "../../lib/studioFormat";

type AccessState = "idle" | "ready" | "unavailable";

export interface StudioTopBarProps {
  web: boolean;
  workspace: Workspace;
  activateWorkspace: (workspace: Workspace) => void;
  capture: {
    paused: boolean;
    calibrating: boolean;
    finalizing: boolean;
    cameraAccess: AccessState;
    microphoneAccess: AccessState;
    statusTitle: string;
    connectedCount: number;
    toggle: () => void;
  };
  backend: {
    menuOpen: boolean;
    trackerStatus: "idle" | "loading" | "ready" | "error";
    delegate: string;
    openMenu: (x: number, y: number) => void;
  };
  recording: { state: "idle" | "recording" | "paused"; elapsed: number };
  settings: { open: boolean; toggle: () => void };
}

export function StudioTopBar({ web, workspace: activeWorkspace, activateWorkspace, capture, backend, recording, settings }: StudioTopBarProps) {
  return <header className="topbar">
    <div className="brand"><span className="brand-mark"><span className="brand-head-icon" style={brandHeadIconStyle} /></span><div><strong>GNM</strong><span>Studio</span></div>{web && <small className="edition-badge">WEB</small>}</div>
    <nav className="workspace-tabs" aria-label="Workspace">
      {(["capture", "create", "edit", "export"] as Workspace[]).map((workspace) => <button type="button" key={workspace} className={activeWorkspace === workspace ? "active" : ""} aria-current={activeWorkspace === workspace ? "page" : undefined} onClick={() => activateWorkspace(workspace)}>{workspace[0].toUpperCase() + workspace.slice(1)}</button>)}
    </nav>
    <div className="system-status">
      <button type="button" className={`capture-pause-button ${capture.paused ? "paused" : ""}`} onClick={capture.toggle} disabled={capture.calibrating || capture.finalizing || (capture.cameraAccess !== "ready" && capture.microphoneAccess !== "ready")} title={capture.paused ? "Resume face tracking, microphone, and any active take (P)" : "Pause face tracking, microphone, and any active take (P)"} aria-label={capture.paused ? "Resume face tracking, microphone, and any active take" : "Pause face tracking, microphone, and any active take"} aria-keyshortcuts="P" aria-pressed={capture.paused}>{capture.paused ? <Play size={15} weight="fill" /> : <Pause size={15} weight="fill" />}</button>
      <span className="device-status" title={capture.statusTitle} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); backend.openMenu(event.clientX, event.clientY); }}><span className={`capture-device-icon ${capture.cameraAccess === "ready" ? capture.paused ? "paused" : "ready" : "unavailable"}`} title={`Camera ${capture.cameraAccess === "ready" ? capture.paused ? "paused" : "ready" : "not connected"}`}><Camera size={14} weight="fill" /></span><span className={`capture-device-icon ${capture.microphoneAccess === "ready" ? capture.paused ? "paused" : "ready" : "unavailable"}`} title={`Microphone ${capture.microphoneAccess === "ready" ? capture.paused ? "paused" : "ready" : "not connected"}`}><Microphone size={14} weight="fill" /></span><b>{capture.connectedCount}/2</b></span>
      <button className={`backend-status ${backend.menuOpen ? "active" : ""}`} title="Click or right-click to choose Auto, GPU, or CPU tracking" aria-haspopup="menu" aria-expanded={backend.menuOpen} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); backend.openMenu(rect.right - 232, rect.bottom + 7); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); backend.openMenu(event.clientX, event.clientY); }}><i className={backend.trackerStatus === "ready" ? capture.paused ? "paused" : "online" : ""} />{capture.paused && backend.trackerStatus === "ready" ? "Paused" : backend.delegate}</button>
      {recording.state !== "idle" && <span className="recording-pill">● REC {formatTime(recording.elapsed)}</span>}
      <button className={`icon-button ${settings.open ? "active" : ""}`} onClick={settings.toggle} title="Appearance settings" aria-expanded={settings.open}><Settings2 size={18} /></button>
    </div>
  </header>;
}
