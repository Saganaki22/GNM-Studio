import { Aperture, Download, RefreshCw, SlidersHorizontal } from "lucide-react";
import { FpsInput } from "../../components/FpsInput";
import type { AppSettings, DeviceOption, RecordingMode, VideoEncoderBackend } from "../../types";

export interface CaptureSidebarContentProps {
  web: boolean;
  settings: AppSettings;
  cameras: DeviceOption[];
  cameraReady: boolean;
  permissionAsking: boolean;
  ffmpegStatus: "unknown" | "checking" | "available" | "unavailable";
  ffmpegVersion: string;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  enumerateDevices: () => void;
  requestAccess: () => void;
  checkFfmpeg: () => void;
  chooseFfmpeg: () => void;
  openFfmpegDownload: () => void;
}

export function CaptureSidebarContent({ web, settings, cameras, cameraReady, permissionAsking, ffmpegStatus, ffmpegVersion, updateSetting, enumerateDevices, requestAccess, checkFfmpeg, chooseFfmpeg, openFfmpegDownload }: CaptureSidebarContentProps) {
  return <>
    <section className="panel-section" data-workspace-target="capture"><div className="section-heading"><span>Camera input</span><button onClick={enumerateDevices}><RefreshCw size={14} /></button></div><label className="field-label">Device<select value={settings.cameraId} disabled={!cameras.length} onChange={(event) => updateSetting("cameraId", event.target.value)}>{!cameras.length && <option value="">No camera available</option>}{cameras.map((device) => <option value={device.id} key={device.id}>{device.label}</option>)}</select></label><FpsInput label="Requested FPS" value={settings.cameraFps} onChange={(value) => updateSetting("cameraFps", value)} />{!cameraReady && <button className="secondary-button wide" onClick={requestAccess} disabled={permissionAsking}><Aperture size={15} />{permissionAsking ? "Waiting for access…" : "Connect capture devices"}</button>}<p className="helper-copy capture-optional">Camera access is optional. The avatar editor and avatar-video recording work without it.</p></section>
    <section className="panel-section">
      <div className="section-heading"><span>Record type</span><small>What the red button captures</small></div>
      <div className="record-type-picker" role="radiogroup" aria-label="Record type">{(["motion", "avatar", "composite"] as RecordingMode[]).map((mode) => { const label = mode === "motion" ? "Motion" : mode === "avatar" ? "Avatar" : "Composite"; return <button type="button" role="radio" aria-checked={settings.recordingMode === mode} className={settings.recordingMode === mode ? "active" : ""} key={mode} onClick={() => updateSetting("recordingMode", mode)}>{label}</button>; })}</div>
      <p className="record-type-description">{settings.recordingMode === "motion" ? "Editable mocap, neutral-relative XYZ, rotation, scale and optional microphone audio for JSON, GLB or later video rendering." : settings.recordingMode === "avatar" ? "A flattened recording of the rendered avatar and its selected background, without the webcam layer." : "A flattened recording of the exact camera + avatar composition shown by the enabled layers."}</p>
      <details className="advanced-expression encoder-quality">
        <summary><SlidersHorizontal size={15} />Encoder quality</summary>
        <label className="field-label encoder-backend">MP4 backend<select value={settings.videoEncoderBackend} disabled={web} onChange={(event) => updateSetting("videoEncoderBackend", event.target.value as VideoEncoderBackend)}>{!web && <option value="auto">Auto · FFmpeg then WebCodecs</option>}<option value="webcodecs">Portable WebCodecs</option>{!web && <option value="ffmpeg">System FFmpeg</option>}</select></label>
        {!web && settings.videoEncoderBackend !== "webcodecs" && <div className="ffmpeg-controls"><label className="field-label">FFmpeg command or path<input type="text" value={settings.ffmpegPath} spellCheck={false} onChange={(event) => updateSetting("ffmpegPath", event.target.value)} /></label><div className={`ffmpeg-status ${ffmpegStatus}`}><i /><span>{ffmpegStatus === "checking" ? "Checking…" : ffmpegStatus === "available" ? "FFmpeg available" : ffmpegStatus === "unavailable" ? settings.videoEncoderBackend === "auto" ? "Unavailable · Auto will use WebCodecs" : "FFmpeg unavailable" : "Not checked"}</span></div>{ffmpegVersion && <small className="ffmpeg-version" title={ffmpegVersion}>{ffmpegVersion}</small>}<div className="encoder-backend-actions"><button type="button" className="secondary-button" onClick={checkFfmpeg}><RefreshCw size={13} />Check</button><button type="button" className="secondary-button" onClick={chooseFfmpeg}>Choose .exe</button><button type="button" className="secondary-button" onClick={openFfmpegDownload}><Download size={13} />Get FFmpeg</button></div></div>}
        <label className="slider-row bitrate-slider"><span>Video</span><input type="range" min="1" max="50" step="1" value={settings.videoBitrateMbps} onChange={(event) => updateSetting("videoBitrateMbps", Number(event.target.value))} /><output>{settings.videoBitrateMbps} Mbps</output></label>
        <label className="slider-row bitrate-slider"><span>Audio</span><input type="range" min="64" max="320" step="16" value={settings.audioBitrateKbps} onChange={(event) => updateSetting("audioBitrateKbps", Number(event.target.value))} /><output>{settings.audioBitrateKbps} kbps</output></label>
        <p className="helper-copy">{web ? "The web edition uses local browser WebCodecs; availability depends on the browser and GPU driver. " : "Applied to direct recording and offline MP4 conversion. "}Defaults: 12 Mbps H.264 and 192 kbps AAC.</p>
      </details>
    </section>
  </>;
}
