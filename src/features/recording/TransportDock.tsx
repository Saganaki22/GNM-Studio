import type { RefObject } from "react";
import { CircleStop, Download, Pause, Play, RefreshCw, Upload, WandSparkles } from "lucide-react";
import { AudioMeter } from "../../components/AudioMeter";
import { FpsInput } from "../../components/FpsInput";
import { formatTime } from "../../lib/studioFormat";
import type { DeviceOption } from "../../types";

export interface TransportDockProps {
  audio: {
    devices: DeviceOption[]; selectedId: string; level: number; peak: number; muted: boolean; monitoring: boolean;
    select: (id: string) => void; toggleMute: () => void; toggleMonitoring: () => void; refresh: () => void;
  };
  recording: {
    state: "idle" | "recording" | "paused"; elapsed: number; frameCount: number; draftFrameCount: number;
    playing: boolean; playbackActive: boolean; calibrating: boolean; finalizing: boolean; videoBusy: boolean;
    popoutStarting: boolean; motionNeedsFace: boolean; start: () => void; stop: () => void; togglePause: () => void; returnLive: () => void;
  };
  timeline: {
    percent: number; duration: number; position: number; recordedDuration: number; playbackDuration: number;
    seek: (position: number) => void;
  };
  exports: {
    fps: number; motionInputRef: RefObject<HTMLInputElement | null>; hasTake: boolean; hasVideo: boolean; sourceIsWebm: boolean;
    videoProgress: number | null; backend: "webcodecs" | "ffmpeg" | null;
    setFps: (fps: number) => void; useCurrentLook: () => void; exportMotion: () => void; exportGlb: () => void;
    exportWebmSource: () => void; exportVideo: () => void;
  };
}

export function TransportDock({ audio, recording, timeline, exports }: TransportDockProps) {
  const recordTitle = recording.calibrating ? "Finish or cancel neutral calibration before recording" : recording.finalizing ? "Wait for the previous take to finish finalizing" : recording.videoBusy ? "Wait for video export to finish" : recording.popoutStarting ? "Wait for the output popout to connect" : recording.motionNeedsFace ? "Motion mode needs a detected face" : "Start recording";
  return <footer className="transport-dock">
    <AudioMeter devices={audio.devices} selectedId={audio.selectedId} onSelect={audio.select} level={audio.level} peak={audio.peak} muted={audio.muted} onToggleMute={audio.toggleMute} monitoring={audio.monitoring} onToggleMonitoring={audio.toggleMonitoring} onRefresh={audio.refresh} />
    <section className="transport">
      <div className="transport-main">
        {recording.state === "idle" ? <button className="record-button" onClick={recording.start} disabled={recording.calibrating || recording.finalizing || recording.videoBusy || recording.popoutStarting} title={recordTitle}><span />{recording.finalizing ? "Finalizing…" : "Record"}</button> : <button className="stop-button" onClick={recording.stop}><CircleStop size={18} />Stop</button>}
        <button className="icon-button transport-icon" onClick={recording.togglePause} disabled={recording.videoBusy || (recording.state === "idle" && !recording.frameCount)} title={recording.playing ? "Pause playback" : recording.state === "recording" ? "Pause recording" : recording.state === "paused" ? "Resume recording" : "Play recorded take"}>{recording.state === "recording" || recording.playing ? <Pause size={18} /> : <Play size={18} />}</button>
        {recording.playbackActive && <button className="secondary-button return-live" onClick={recording.returnLive} title="Stop playback and return the avatar to the active camera"><RefreshCw size={14} /><span>Return to Live</span></button>}
        <div className="timecode"><strong>{formatTime(recording.elapsed)}</strong><span>{recording.frameCount || recording.draftFrameCount} frames</span></div>
      </div>
      <div className={`timeline ${recording.frameCount && recording.state === "idle" ? "seekable" : ""}`}>
        <div className="timeline-track">
          <div className="timeline-progress" style={{ width: `${timeline.percent}%` }} />
          <span className="playhead" style={{ left: `${timeline.percent}%` }} />
          <input className="timeline-range" type="range" min="0" max={timeline.duration} step="1" value={timeline.position} disabled={recording.state !== "idle" || recording.videoBusy || !recording.frameCount} aria-label="Recorded motion position" aria-valuetext={`${formatTime(timeline.position)} of ${formatTime(timeline.recordedDuration)}`} onInput={(event) => timeline.seek(Number(event.currentTarget.value))} />
        </div>
        <div className="timeline-labels"><span>00:00</span><span>{formatTime(recording.frameCount ? timeline.playbackDuration : timeline.duration)}</span></div>
      </div>
      <div className="export-cluster" data-workspace-target="export">
        <FpsInput compact label="Export FPS" value={exports.fps} onChange={exports.setFps} />
        <button className="secondary-button motion-import" onClick={() => exports.motionInputRef.current?.click()} disabled={recording.state !== "idle" || recording.calibrating || recording.videoBusy} title="Import a GNM Studio motion JSON file"><Upload size={15} /><span>Import JSON</span></button>
        {exports.hasTake && <button className="secondary-button" onClick={exports.useCurrentLook} disabled={recording.state !== "idle" || recording.finalizing || recording.videoBusy} title="Replace the take's immutable appearance snapshot with the current avatar, materials, layers, lighting, and view"><WandSparkles size={15} /><span>Use current look</span></button>}
        <button className="secondary-button" onClick={exports.exportMotion} disabled={!exports.hasTake || recording.videoBusy} title="Export motion JSON"><Download size={16} /><span>JSON</span></button>
        <button className="secondary-button" onClick={exports.exportGlb} disabled={!exports.hasTake || recording.videoBusy} title="Export animated GLB for Blender"><Download size={16} /><span>GLB</span></button>
        {exports.sourceIsWebm && <button className="secondary-button source-export" onClick={exports.exportWebmSource} disabled={recording.videoBusy || recording.finalizing} title="Export optional unconverted WebM source"><Download size={14} /><span>WebM source</span></button>}
        <button className="primary-button" onClick={exports.exportVideo} disabled={(!exports.hasVideo && !exports.hasTake) || recording.finalizing || recording.videoBusy || recording.state !== "idle"} title={recording.finalizing ? "Wait for the recorded media and microphone tracks to finish finalizing" : exports.hasVideo ? "Export the directly recorded take as H.264/AAC MP4 without re-rendering" : exports.hasTake ? "Render the recorded motion, framing, view, and retained audio as MP4" : "Record a motion or video take before exporting MP4"}><Download size={16} /><span>{recording.finalizing ? "Finalizing…" : exports.videoProgress !== null ? exports.backend === "ffmpeg" ? "FFmpeg rendering…" : `Rendering ${Math.round(exports.videoProgress * 100)}%` : "MP4"}</span></button>
      </div>
    </section>
  </footer>;
}
