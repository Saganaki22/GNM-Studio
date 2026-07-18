import { Moon, RotateCcw, Settings2, Sun, X } from "lucide-react";
import { accentOptions, brandHeadIconStyle, releasesUrl, repositoryUrl, type AccentOption } from "../../app/studioConfig";
import { GithubMark } from "../../components/GithubMark";
import type { AppSettings } from "../../types";

export interface SettingsPopoverProps {
  web: boolean;
  theme: "dark" | "light";
  accent: AccentOption;
  uiScale: number;
  settings: AppSettings;
  appVersion: string;
  close: () => void;
  setTheme: (theme: "dark" | "light") => void;
  setAccent: (accent: AccentOption) => void;
  setUiScale: (scale: number) => void;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  openExternal: (url: string) => void;
}

export function SettingsPopover({ web, theme, accent, uiScale, settings, appVersion, close, setTheme, setAccent, setUiScale, updateSetting, openExternal }: SettingsPopoverProps) {
  return <div className="settings-portal">
    <button className="settings-scrim" aria-label="Close settings" onClick={close} />
    <aside className="settings-popover" role="dialog" aria-modal="true" aria-label="Appearance settings">
      <header className="settings-head"><div><Settings2 size={17} /><span><strong>Settings</strong><small>Appearance and interface</small></span></div><button className="popover-close" onClick={close} aria-label="Close settings"><X size={16} /></button></header>
      <section className="settings-group"><div className="settings-label"><span>Theme</span><small>Choose the application surface</small></div><div className="settings-segmented"><button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}><Moon size={14} />Dark</button><button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}><Sun size={14} />Light</button></div></section>
      <section className="settings-group"><div className="settings-label"><span>Accent colour</span><small>Applied to active controls and meters</small></div><div className="accent-picker">{accentOptions.map((option) => <button key={option} className={`accent-dot accent-${option} ${accent === option ? "active" : ""}`} onClick={() => setAccent(option)} title={option} aria-label={`${option} accent`} aria-pressed={accent === option} />)}</div></section>
      <section className="settings-group"><div className="settings-label"><span>Interface scale</span><small>The settings window remains stationary while the studio scales</small></div><div className="settings-scale"><input type="range" min="80" max="125" step="1" value={uiScale} onChange={(event) => setUiScale(Number(event.target.value))} /><output>{uiScale}%</output></div><button className="settings-reset" onClick={() => setUiScale(100)} disabled={uiScale === 100}><RotateCcw size={13} />Reset to 100%</button></section>
      <section className="settings-group"><div className="settings-label"><span>Fullscreen output</span><small>Clean controls for capture and OBS</small></div><label className={`toggle-row ${settings.outputAutoHideEnabled ? "is-active" : ""}`}><span>Auto-hide controls<small>{settings.outputAutoHideEnabled ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.outputAutoHideEnabled} onChange={(event) => updateSetting("outputAutoHideEnabled", event.target.checked)} /></label><label className="slider-row"><span>Hide delay</span><input type="range" min="0.5" max="10" step="0.5" disabled={!settings.outputAutoHideEnabled || settings.outputAlwaysHideControls} value={settings.outputAutoHideDelay} onChange={(event) => updateSetting("outputAutoHideDelay", Number(event.target.value))} /><output>{settings.outputAutoHideDelay.toFixed(1)}s</output></label><label className={`toggle-row ${settings.outputAlwaysHideControls ? "is-active" : ""}`}><span>Always clean<small>{settings.outputAlwaysHideControls ? "ON" : "OFF"}</small></span><input type="checkbox" checked={settings.outputAlwaysHideControls} onChange={(event) => updateSetting("outputAlwaysHideControls", event.target.checked)} /></label><p className="helper-copy">Move the pointer to reveal controls, press H to toggle them, and press Esc to exit fullscreen.</p></section>
      <footer className="settings-about"><span className="settings-about-icon"><span className="brand-head-icon" style={brandHeadIconStyle} /></span><span className="settings-about-copy"><strong>GNM Studio {web ? "Web" : "Desktop"}</strong><small>Apache-2.0 · {web ? "GitHub Pages build" : "Manifest build"}</small></span><span className="settings-about-links"><button onClick={() => openExternal(repositoryUrl)} title="Open GNM Studio on GitHub"><GithubMark />GitHub</button><button onClick={() => openExternal(releasesUrl)} title="Open GNM Studio releases">v{appVersion}</button></span></footer>
    </aside>
  </div>;
}
