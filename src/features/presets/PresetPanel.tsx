import type { RefObject } from "react";
import { ChevronDown, Download, Upload } from "lucide-react";
import type { FullStatePreset } from "../../lib/presets";

export interface PresetPanelProps {
  presets: FullStatePreset[];
  selectedId: string;
  name: string;
  recordingIdle: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  select: (id: string) => void;
  setName: (name: string) => void;
  save: () => void;
  load: () => void;
  update: () => void;
  rename: () => void;
  remove: () => void;
  exportBundle: () => void;
}

export function PresetPanel({ presets, selectedId, name, recordingIdle, inputRef, select, setName, save, load, update, rename, remove, exportBundle }: PresetPanelProps) {
  return <details className="panel-section experimental-skin full-state-presets"><summary><span><strong>Named presets</strong><small>Full model state</small></span><span className="skin-summary-state">{presets.length} saved<ChevronDown size={14} /></span></summary><div className="experimental-skin-content"><label className="field-label">Saved preset<select value={selectedId} disabled={!presets.length || !recordingIdle} onChange={(event) => select(event.target.value)}><option value="">{presets.length ? "Choose a preset" : "No presets saved"}</option>{presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label><label className="field-label">Preset name<input value={name} maxLength={80} disabled={!recordingIdle} onChange={(event) => setName(event.target.value)} /></label><div className="preset-action-grid"><button type="button" className="primary-button" disabled={!recordingIdle || !name.trim()} onClick={save}>Save new</button><button type="button" className="secondary-button" disabled={!recordingIdle || !selectedId} onClick={load}>Load</button><button type="button" className="secondary-button" disabled={!recordingIdle || !selectedId} onClick={update}>Update</button><button type="button" className="secondary-button" disabled={!recordingIdle || !selectedId || !name.trim()} onClick={rename}>Rename</button><button type="button" className="secondary-button danger" disabled={!recordingIdle || !selectedId} onClick={remove}>Delete</button></div><div className="preset-bundle-actions"><button type="button" className="secondary-button" disabled={!recordingIdle} onClick={() => inputRef.current?.click()}><Upload size={13} />Import bundle</button><button type="button" className="secondary-button" disabled={!presets.length} onClick={exportBundle}><Download size={13} />Export bundle</button></div><p className="helper-copy">Presets include the avatar, identity conditioning, all 383 GNM values, manual/frozen controls, materials, layers, calibration and view. Bundles are version-checked before loading.</p></div></details>;
}
