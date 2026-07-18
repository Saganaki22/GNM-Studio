import type { CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { eyeColorOptions } from "../../lib/gnmEyes";
import { skinToneOptions } from "../../lib/skinMaterial";
import type { AppSettings } from "../../types";

export interface AvatarAppearancePanelsProps {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function AvatarAppearancePanels({ settings, updateSetting }: AvatarAppearancePanelsProps) {
  return <>
    <details className="panel-section experimental-skin">
      <summary><span><strong>Skin material</strong><small>Experimental</small></span><span className={settings.skinTextureEnabled ? "skin-summary-state enabled" : "skin-summary-state"}>{settings.skinTextureEnabled ? "Microtexture on" : "Microtexture off"}<ChevronDown size={14} /></span></summary>
      <div className="experimental-skin-content">
        <label className={`toggle-row ${settings.skinTextureEnabled ? "is-active" : ""}`}><span>Skin microtexture<small>{settings.skinTextureEnabled ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.skinTextureEnabled} onChange={(event) => updateSetting("skinTextureEnabled", event.target.checked)} /></label>
        <div className="skin-tone-field"><span>Base colour · Neutral disables skin tint</span><div className="skin-tone-options" role="radiogroup" aria-label="Skin base colour">{skinToneOptions.map((tone) => <button type="button" key={tone.id} role="radio" aria-checked={settings.skinTone === tone.id} className={settings.skinTone === tone.id ? "active" : ""} style={{ "--skin-tone": tone.swatch } as CSSProperties} title={tone.label} onClick={() => updateSetting("skinTone", tone.id)}><span /><small>{tone.label}</small></button>)}</div></div>
        <label className="slider-row"><span>Texture scale</span><input type="range" min="2" max="20" step="0.5" disabled={!settings.skinTextureEnabled} value={settings.skinTextureScale} onChange={(event) => updateSetting("skinTextureScale", Number(event.target.value))} /><output>{settings.skinTextureScale.toFixed(1)}×</output></label>
        <label className="slider-row"><span>Rotation</span><input type="range" min="-180" max="180" step="1" disabled={!settings.skinTextureEnabled} value={settings.skinTextureRotation} onChange={(event) => updateSetting("skinTextureRotation", Number(event.target.value))} /><output>{settings.skinTextureRotation}°</output></label>
        <label className="slider-row"><span>Seam feather</span><input type="range" min="0" max="30" step="1" disabled={!settings.skinTextureEnabled} value={settings.skinTextureFeather * 100} onChange={(event) => updateSetting("skinTextureFeather", Number(event.target.value) / 100)} /><output>{Math.round(settings.skinTextureFeather * 100)}%</output></label>
        <p className="helper-copy">The base pigment works with texture on or off. Studio lighting still creates natural highlights and shadows. Feather blends opposite tile edges; high values soften pore contrast near each repeat.</p>
      </div>
    </details>
    <details className="panel-section experimental-skin eye-appearance">
      <summary><span><strong>Eye appearance</strong><small>Both avatars</small></span><span className={settings.eyeShaderEnabled ? "skin-summary-state enabled" : "skin-summary-state"}>{settings.eyeShaderEnabled ? eyeColorOptions.find((option) => option.id === settings.eyeColor)?.label : "Original eyes"}<ChevronDown size={14} /></span></summary>
      <div className="experimental-skin-content">
        <label className={`toggle-row ${settings.eyeShaderEnabled ? "is-active" : ""}`}><span>Eye shader<small>{settings.eyeShaderEnabled ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.eyeShaderEnabled} onChange={(event) => updateSetting("eyeShaderEnabled", event.target.checked)} /></label>
        <div className="skin-tone-field"><span>Iris colour</span><div className="eye-color-options" role="radiogroup" aria-label="Iris colour">{eyeColorOptions.map((option) => <button type="button" key={option.id} role="radio" aria-checked={settings.eyeColor === option.id} className={settings.eyeColor === option.id ? "active" : ""} disabled={!settings.eyeShaderEnabled} style={{ "--eye-color": option.swatch } as CSSProperties} title={option.label} onClick={() => updateSetting("eyeColor", option.id)}><span /><small>{option.label}</small></button>)}</div></div>
        <p className="helper-copy">The shader preserves black pupils, natural sclera, highlights and tracked gaze. Turn it off to use the model's original eye appearance.</p>
      </div>
    </details>
  </>;
}
