import { Mic, MicOff, RefreshCw, Volume2, VolumeX } from "lucide-react";
import type { DeviceOption } from "../types";

type Props = {
  devices: DeviceOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  level: number;
  peak: number;
  muted: boolean;
  onToggleMute: () => void;
  monitoring: boolean;
  onToggleMonitoring: () => void;
  onRefresh: () => void;
};

export function AudioMeter({
  devices,
  selectedId,
  onSelect,
  level,
  peak,
  muted,
  onToggleMute,
  monitoring,
  onToggleMonitoring,
  onRefresh,
}: Props) {
  const normalized = muted ? 0 : Math.min(1, level);
  const peakPosition = muted ? 0 : Math.min(1, peak);

  return (
    <section className="audio-strip" aria-label="Audio input controls">
      <div className="audio-device">
        <span className={`status-orb ${muted ? "off" : "live"}`} />
        <div className="select-stack">
          <label htmlFor="microphone-select">Microphone</label>
          <select
            id="microphone-select"
            value={selectedId}
            onChange={(event) => onSelect(event.target.value)}
          >
            {devices.length === 0 && <option value="">No microphone</option>}
            {devices.map((device) => (
              <option value={device.id} key={device.id}>
                {device.label}
              </option>
            ))}
          </select>
        </div>
        <button className="icon-button" onClick={onRefresh} title="Refresh devices">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className={`meter-wrap ${muted ? "muted" : ""}`}>
        <div className="meter-labels">
          <span>Input level</span>
          <span>{muted ? "Muted" : peak > 0.94 ? "Clipping" : "Live"}</span>
        </div>
        <div className="audio-meter" role="meter" aria-valuenow={normalized * 100}>
          <div className="meter-zones" />
          <div
            className="meter-mask"
            style={{ transform: `translateX(${normalized * 100}%)` }}
          />
          <div className="peak-marker" style={{ left: `${peakPosition * 100}%` }} />
        </div>
        <div className="db-scale">
          <span>-60</span><span>-24</span><span>-12</span><span>-6</span><span>0 dB</span>
        </div>
      </div>

      <div className="audio-actions">
        <button
          className={`control-button ${muted ? "danger" : ""}`}
          onClick={onToggleMute}
          aria-pressed={muted}
        >
          {muted ? <MicOff size={17} /> : <Mic size={17} />}
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          className={`icon-button ${monitoring ? "active" : ""}`}
          onClick={onToggleMonitoring}
          title="Monitor microphone"
          aria-pressed={monitoring}
        >
          {monitoring ? <Volume2 size={17} /> : <VolumeX size={17} />}
        </button>
      </div>
    </section>
  );
}

