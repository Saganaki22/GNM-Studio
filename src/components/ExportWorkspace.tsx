import { useState } from "react";
import { DownloadSimple, FileArchive, FilmStrip, ImageSquare, VideoCamera } from "@phosphor-icons/react";

export type ExportFormat = "mp4" | "webm" | "png";

type Props = {
  hasTake: boolean;
  hasVideo: boolean;
  videoIsWebm: boolean;
  durationMs: number;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
  trimStartMs: number;
  trimEndMs: number;
  speed: number;
  busy: boolean;
  progress: number | null;
  onWidthChange: (value: number) => void;
  onHeightChange: (value: number) => void;
  onFpsChange: (value: number) => void;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
  onExportMp4: () => void;
  onExportWebm: () => void;
  onExportPng: () => void;
  onReturn: () => void;
};

const formatCopy: Record<ExportFormat, { title: string; summary: string; icon: typeof VideoCamera }> = {
  mp4: { title: "H.264 MP4", summary: "Broadly compatible video with retained microphone audio when the take contains it.", icon: VideoCamera },
  webm: { title: "WebM", summary: "Save the browser-native recording or render the editable motion take without MP4 conversion.", icon: FilmStrip },
  png: { title: "PNG sequence", summary: "Render every sampled frame as lossless PNG and package the numbered sequence into one ZIP.", icon: ImageSquare },
};

export function ExportWorkspace(props: Props) {
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const selected = formatCopy[format];
  const Icon = selected.icon;
  const editedDurationMs = Math.max(0, props.trimEndMs - props.trimStartMs) / props.speed;
  const sequenceFrames = editedDurationMs > 0 ? Math.floor(editedDurationMs / (1000 / props.fps)) + 1 : props.frameCount;
  const exportAction = format === "mp4" ? props.onExportMp4 : format === "webm" ? props.onExportWebm : props.onExportPng;
  const formatAvailable = format === "png"
    ? props.hasTake
    : format === "webm"
      ? props.hasTake || props.videoIsWebm
      : props.hasTake || props.hasVideo;
  const unavailableReason = format === "png"
    ? "PNG sequences require an editable motion take."
    : format === "webm"
      ? "This baked take is already MP4 and has no motion frames to render as WebM."
      : "Record a motion or video take before exporting.";

  return (
    <div className="export-workspace" data-workspace-target="export">
      <div className="export-workspace-card">
        <header>
          <div><small>DELIVER</small><h2>Export recorded take</h2><p>Choose a format, confirm output dimensions, then save through the native or browser file picker.</p></div>
          <button type="button" className="secondary-button" onClick={props.onReturn}>Back to canvas</button>
        </header>
        <div className="export-format-tabs" role="tablist" aria-label="Export format">
          {(Object.keys(formatCopy) as ExportFormat[]).map((key) => {
            const ItemIcon = formatCopy[key].icon;
            const available = key === "png" ? props.hasTake : key === "webm" ? props.hasTake || props.videoIsWebm : props.hasTake || props.hasVideo;
            return <button type="button" role="tab" aria-selected={format === key} className={format === key ? "active" : ""} key={key} disabled={!available} title={available ? formatCopy[key].summary : key === "png" ? "Requires an editable motion take" : key === "webm" ? "Unavailable for an MP4-only baked take" : "Record a take first"} onClick={() => setFormat(key)}><ItemIcon size={20} /><span>{key === "png" ? "PNG sequence" : key.toUpperCase()}</span></button>;
          })}
        </div>
        <section className="export-format-panel">
          <div className="export-format-heading"><span><Icon size={28} /></span><div><h3>{selected.title}</h3><p>{selected.summary}</p></div></div>
          <div className="export-dimensions">
            <label><span>Width</span><input type="number" min="64" max="7680" step="2" value={props.width} disabled={!props.hasTake} onChange={(event) => props.onWidthChange(Number(event.target.value))} /><small>px</small></label>
            <i>×</i>
            <label><span>Height</span><input type="number" min="64" max="4320" step="2" value={props.height} disabled={!props.hasTake} onChange={(event) => props.onHeightChange(Number(event.target.value))} /><small>px</small></label>
            <label><span>FPS</span><input type="number" min="1" max="120" step="1" value={props.fps} disabled={!props.hasTake} onChange={(event) => props.onFpsChange(Number(event.target.value))} /><small>fps</small></label>
          </div>
          <div className="export-edit-controls">
            <label><span>Trim in</span><input type="number" min="0" max={props.durationMs / 1000} step="0.01" value={(props.trimStartMs / 1000).toFixed(2)} disabled={!props.hasTake} onChange={(event) => props.onTrimStartChange(Number(event.target.value) * 1000)} /><small>sec</small></label>
            <label><span>Trim out</span><input type="number" min="0" max={props.durationMs / 1000} step="0.01" value={(props.trimEndMs / 1000).toFixed(2)} disabled={!props.hasTake} onChange={(event) => props.onTrimEndChange(Number(event.target.value) * 1000)} /><small>sec</small></label>
            <label><span>Playback speed</span><select value={props.speed} disabled={!props.hasTake} onChange={(event) => props.onSpeedChange(Number(event.target.value))}><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option><option value="4">4×</option></select></label>
            <p>{props.hasTake ? "Edits are non-destructive. Every export samples interpolated motion from the original take." : "This is a baked video take. Export preserves its recorded timing and pixels."}</p>
          </div>
          <div className="export-summary-grid">
            <span><small>TAKE</small><strong>{props.hasTake ? `${props.frameCount.toLocaleString()} motion frames` : props.hasVideo ? "Recorded video" : "Nothing recorded"}</strong></span>
            <span><small>{props.hasTake ? "EDITED DURATION" : "TIMING"}</small><strong>{props.hasTake ? `${(editedDurationMs / 1000).toFixed(2)} seconds` : props.hasVideo ? "Recorded source" : "No take"}</strong></span>
            <span><small>{format === "png" ? "ZIP CONTENTS" : "OUTPUT"}</small><strong>{format === "png" ? `${sequenceFrames.toLocaleString()} numbered PNGs` : props.hasTake ? `${props.width} × ${props.height} · ${props.fps} FPS` : "Recorded source dimensions"}</strong></span>
          </div>
          {props.progress !== null && <div className="export-progress" aria-label="Export progress"><span style={{ width: `${Math.round(props.progress * 100)}%` }} /><output>{Math.round(props.progress * 100)}%</output></div>}
          {!formatAvailable && <p className="helper-copy">{unavailableReason}</p>}
          <button type="button" className="primary-button export-primary" disabled={props.busy || !formatAvailable} onClick={exportAction}>
            {format === "png" ? <FileArchive size={18} /> : <DownloadSimple size={18} />}
            {props.busy ? "Rendering…" : format === "png" ? "Render and save ZIP" : `Export ${format.toUpperCase()}`}
          </button>
        </section>
      </div>
    </div>
  );
}
