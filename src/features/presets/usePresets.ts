import { useEffect, useRef, useState } from "react";
import { saveBytes, type SaveResult } from "../../lib/save";
import { timestampedFilename } from "../../lib/studioFormat";
import {
  createFullStatePreset, loadStoredPresets, parseFullStatePresetBundle,
  saveStoredPresets, serializePresetBundle, type FullStatePreset,
} from "../../lib/presets";
import type { RecordedTakeSnapshot } from "../../types";

type Toast = { type: "success" | "info"; title: string; message: string };

export interface PresetAdapters {
  captureSnapshot: () => RecordedTakeSnapshot;
  applySnapshot: (snapshot: RecordedTakeSnapshot) => void;
  onToast: (toast: Toast) => void;
  onError: (message: string) => void;
  onSaved: (result: SaveResult, count: number) => void;
}

export function usePresets(adapters: PresetAdapters) {
  const [presets, setPresets] = useState<FullStatePreset[]>(loadStoredPresets);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("My GNM look");
  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;

  useEffect(() => {
    try {
      saveStoredPresets(presets);
    } catch (error) {
      adaptersRef.current.onError(`Preset storage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [presets]);

  const select = (id: string) => {
    setSelectedId(id);
    const preset = presets.find((entry) => entry.id === id);
    if (preset) setName(preset.name);
  };

  const save = () => {
    try {
      const preset = createFullStatePreset(name, adaptersRef.current.captureSnapshot());
      setPresets((current) => [...current, preset]);
      setSelectedId(preset.id);
      setName(preset.name);
      adaptersRef.current.onToast({ type: "success", title: "Preset saved", message: `${preset.name} now stores the complete model, expression, material, layer, calibration and view state.` });
    } catch (error) {
      adaptersRef.current.onError(`Save preset: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const update = () => {
    const existing = presets.find((preset) => preset.id === selectedId);
    if (!existing) return;
    try {
      const updated = createFullStatePreset(existing.name, adaptersRef.current.captureSnapshot(), existing);
      setPresets((current) => current.map((preset) => preset.id === existing.id ? updated : preset));
      adaptersRef.current.onToast({ type: "success", title: "Preset updated", message: `${existing.name} now reflects the current full model state.` });
    } catch (error) {
      adaptersRef.current.onError(`Update preset: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const rename = () => {
    const existing = presets.find((preset) => preset.id === selectedId);
    if (!existing) return;
    try {
      const renamed = createFullStatePreset(name, existing.snapshot, existing);
      setPresets((current) => current.map((preset) => preset.id === existing.id ? renamed : preset));
      setName(renamed.name);
      adaptersRef.current.onToast({ type: "success", title: "Preset renamed", message: `The preset is now named ${renamed.name}.` });
    } catch (error) {
      adaptersRef.current.onError(`Rename preset: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const load = () => {
    const preset = presets.find((entry) => entry.id === selectedId);
    if (!preset) return;
    adaptersRef.current.applySnapshot(preset.snapshot);
    adaptersRef.current.onToast({ type: "success", title: "Preset loaded", message: `${preset.name} was restored and is being evaluated locally.` });
  };

  const remove = () => {
    const preset = presets.find((entry) => entry.id === selectedId);
    if (!preset) return;
    setPresets((current) => current.filter((entry) => entry.id !== selectedId));
    setSelectedId("");
    adaptersRef.current.onToast({ type: "info", title: "Preset deleted", message: `${preset.name} was removed from local storage.` });
  };

  const importBundle = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error("The selected preset bundle exceeds the 64 MB safety limit.");
      const bundle = parseFullStatePresetBundle(JSON.parse(await file.text()));
      setPresets((current) => {
        const byId = new Map(current.map((preset) => [preset.id, preset]));
        for (const preset of bundle.presets) byId.set(preset.id, preset);
        return [...byId.values()].slice(0, 16);
      });
      if (bundle.presets[0]) { setSelectedId(bundle.presets[0].id); setName(bundle.presets[0].name); }
      adaptersRef.current.onToast({ type: "success", title: "Preset bundle imported", message: `${bundle.presets.length} validated preset${bundle.presets.length === 1 ? "" : "s"} are available locally.` });
    } catch (error) {
      adaptersRef.current.onError(`Import preset bundle: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const exportBundle = async () => {
    if (!presets.length) return;
    try {
      const bytes = new TextEncoder().encode(serializePresetBundle(presets));
      const result = await saveBytes(bytes, timestampedFilename("json", "_preset_bundle"), "application/json");
      adaptersRef.current.onSaved(result, presets.length);
    } catch (error) {
      adaptersRef.current.onError(`Export preset bundle: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return { presets, selectedId, name, setName, select, save, load, update, rename, remove, importBundle, exportBundle };
}
