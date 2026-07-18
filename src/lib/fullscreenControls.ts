export type FullscreenControlsOverride = "shown" | "hidden" | null;

export function pinnedFullscreenControlsState(
  override: FullscreenControlsOverride,
  alwaysHide: boolean,
) {
  if (override === "shown") return false;
  if (override === "hidden") return true;
  return alwaysHide ? true : null;
}

export function toggledFullscreenControlsOverride(currentlyHidden: boolean): FullscreenControlsOverride {
  return currentlyHidden ? "shown" : "hidden";
}
