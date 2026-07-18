import type { RecordedTakeSnapshot } from "../types";
import { parseMotionFile } from "./motionFile.ts";
import { cloneRecordedTakeSnapshot } from "./recordingAppearance.ts";

export const presetStorageKey = "gnm-studio-full-state-presets-v1";
export const presetModelVersion = "GNM-3.0";

export type FullStatePreset = {
  format: "gnm-studio-preset";
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  modelVersion: typeof presetModelVersion;
  snapshot: RecordedTakeSnapshot;
};

export type FullStatePresetBundle = {
  format: "gnm-studio-preset-bundle";
  version: 1;
  exportedAt: string;
  presets: FullStatePreset[];
};

function cleanName(value: unknown) {
  if (typeof value !== "string") throw new Error("Preset name must be text.");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) throw new Error("Preset name must contain 1–80 characters.");
  return name;
}

function parseSnapshot(value: unknown) {
  const parsed = parseMotionFile({
    format: "gnm-studio-motion",
    version: 2,
    fps: 30,
    frames: [{ timestamp: 0, blendshapes: {}, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
    appearance: value,
  });
  if (!parsed.appearance) throw new Error("Preset appearance snapshot is missing.");
  return parsed.appearance;
}

export function parseFullStatePreset(value: unknown): FullStatePreset {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Preset must be an object.");
  const source = value as Record<string, unknown>;
  if (source.format !== "gnm-studio-preset" || source.version !== 1) throw new Error("Unsupported GNM Studio preset format or version.");
  if (source.modelVersion !== presetModelVersion) throw new Error(`Preset targets ${String(source.modelVersion)}; this build requires ${presetModelVersion}.`);
  if (typeof source.id !== "string" || !source.id || source.id.length > 128) throw new Error("Preset id is invalid.");
  if (typeof source.createdAt !== "string" || Number.isNaN(Date.parse(source.createdAt))) throw new Error("Preset creation date is invalid.");
  if (typeof source.updatedAt !== "string" || Number.isNaN(Date.parse(source.updatedAt))) throw new Error("Preset update date is invalid.");
  return {
    format: "gnm-studio-preset",
    version: 1,
    id: source.id,
    name: cleanName(source.name),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    modelVersion: presetModelVersion,
    snapshot: parseSnapshot(source.snapshot),
  };
}

export function parseFullStatePresetBundle(value: unknown): FullStatePresetBundle {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Preset bundle must be an object.");
  const source = value as Record<string, unknown>;
  if (source.format !== "gnm-studio-preset-bundle" || source.version !== 1) throw new Error("Unsupported preset bundle format or version.");
  if (!Array.isArray(source.presets) || source.presets.length > 64) throw new Error("Preset bundle must contain no more than 64 presets.");
  return {
    format: "gnm-studio-preset-bundle",
    version: 1,
    exportedAt: typeof source.exportedAt === "string" && !Number.isNaN(Date.parse(source.exportedAt)) ? source.exportedAt : new Date().toISOString(),
    presets: source.presets.map(parseFullStatePreset),
  };
}

export function createFullStatePreset(name: string, snapshot: RecordedTakeSnapshot, existing?: FullStatePreset): FullStatePreset {
  const now = new Date().toISOString();
  const cleanSnapshot = cloneRecordedTakeSnapshot(snapshot);
  // Custom background files remain in the app's local background store. Object
  // URLs are session-scoped and must never be persisted in localStorage.
  cleanSnapshot.backgroundImageUrl = cleanSnapshot.backgroundImageUrl?.startsWith("data:") ? cleanSnapshot.backgroundImageUrl : null;
  cleanSnapshot.identityVertices = null;
  return {
    format: "gnm-studio-preset",
    version: 1,
    id: existing?.id ?? crypto.randomUUID(),
    name: cleanName(name),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    modelVersion: presetModelVersion,
    snapshot: cleanSnapshot,
  };
}

export function serializePresetBundle(presets: FullStatePreset[]) {
  const bundle: FullStatePresetBundle = {
    format: "gnm-studio-preset-bundle",
    version: 1,
    exportedAt: new Date().toISOString(),
    presets,
  };
  return JSON.stringify(bundle, (_key, value) => value instanceof Float32Array ? Array.from(value) : value, 2);
}

export function loadStoredPresets() {
  const value = localStorage.getItem(presetStorageKey);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 16).map(parseFullStatePreset);
  } catch {
    return [];
  }
}

export function saveStoredPresets(presets: FullStatePreset[]) {
  const safe = presets.slice(0, 16);
  localStorage.setItem(presetStorageKey, JSON.stringify(safe, (_key, value) => value instanceof Float32Array ? Array.from(value) : value));
}
