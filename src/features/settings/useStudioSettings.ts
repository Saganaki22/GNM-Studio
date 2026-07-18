import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  accentOptions, initialSettings, isDesktopRuntime, isWebEdition, settingsStorageVersion,
  type AccentOption,
} from "../../app/studioConfig";
import type { AppSettings } from "../../types";

export interface StudioSettingsState {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  settingsOpen: boolean;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  theme: "dark" | "light";
  setTheme: Dispatch<SetStateAction<"dark" | "light">>;
  accent: AccentOption;
  setAccent: Dispatch<SetStateAction<AccentOption>>;
  uiScale: number;
  setUiScale: Dispatch<SetStateAction<number>>;
  leftSidebarCollapsed: boolean;
  setLeftSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  rightSidebarCollapsed: boolean;
  setRightSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
}

function loadSettings(): AppSettings {
  const saved = localStorage.getItem("gnm-studio-settings");
  if (!saved) return initialSettings;
  let parsed: Partial<AppSettings>;
  try {
    parsed = JSON.parse(saved) as Partial<AppSettings>;
  } catch {
    localStorage.removeItem("gnm-studio-settings");
    return initialSettings;
  }
  const savedStorageVersion = Number(localStorage.getItem("gnm-studio-settings-version") ?? 0);
  const upgradingSingleSmoothingControl = parsed.motionSmoothing === undefined;
  return {
    ...initialSettings,
    ...parsed,
    videoEncoderBackend: isDesktopRuntime ? parsed.videoEncoderBackend ?? initialSettings.videoEncoderBackend : "webcodecs",
    skinTextureEnabled: savedStorageVersion < 2 ? false : parsed.skinTextureEnabled ?? initialSettings.skinTextureEnabled,
    trackingSmoothing: upgradingSingleSmoothingControl
      ? Math.max(0.72, parsed.trackingSmoothing ?? initialSettings.trackingSmoothing)
      : parsed.trackingSmoothing ?? initialSettings.trackingSmoothing,
  };
}

export function useStudioSettings(): StudioSettingsState {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("gnm-studio-theme") === "light" ? "light" : "dark");
  const [accent, setAccent] = useState<AccentOption>(() => {
    const saved = localStorage.getItem("gnm-studio-accent") as AccentOption | null;
    return saved && accentOptions.includes(saved) ? saved : "teal";
  });
  const [uiScale, setUiScale] = useState(() => {
    const saved = Number(localStorage.getItem("gnm-studio-ui-scale") ?? 100);
    return Number.isFinite(saved) ? Math.min(125, Math.max(80, saved)) : 100;
  });
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => localStorage.getItem("gnm-studio-left-sidebar-collapsed") === "true");
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => localStorage.getItem("gnm-studio-right-sidebar-collapsed") === "true");

  useEffect(() => {
    localStorage.setItem("gnm-studio-settings", JSON.stringify(settings));
    localStorage.setItem("gnm-studio-settings-version", String(settingsStorageVersion));
  }, [settings]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accent;
    document.documentElement.dataset.edition = isWebEdition ? "web" : "desktop";
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("gnm-studio-theme", theme);
    localStorage.setItem("gnm-studio-accent", accent);
    localStorage.setItem("gnm-studio-ui-scale", String(uiScale));
  }, [accent, theme, uiScale]);

  useEffect(() => localStorage.setItem("gnm-studio-left-sidebar-collapsed", String(leftSidebarCollapsed)), [leftSidebarCollapsed]);
  useEffect(() => localStorage.setItem("gnm-studio-right-sidebar-collapsed", String(rightSidebarCollapsed)), [rightSidebarCollapsed]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  return {
    settings, setSettings, settingsOpen, setSettingsOpen, theme, setTheme, accent, setAccent,
    uiScale, setUiScale, leftSidebarCollapsed, setLeftSidebarCollapsed,
    rightSidebarCollapsed, setRightSidebarCollapsed,
  };
}
