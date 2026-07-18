import { useCallback } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import type { SaveResult } from "../../lib/save";

interface SaveFeedbackOptions {
  onToast(toast: Omit<ToastMessage, "id">): unknown;
  onError(message: string): void;
}

export function useSaveFeedback({ onToast, onError }: SaveFeedbackOptions) {
  const openExternal = useCallback(async (url: string) => {
    try {
      if ("__TAURI_INTERNALS__" in window) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      onError(`Open link: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [onError]);

  const revealSavedFile = useCallback(async (path: string) => {
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(path);
    } catch (error) {
      onError(`Show saved file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [onError]);

  const showSaveResult = useCallback((title: string, description: string, result: SaveResult) => {
    if (result.status === "cancelled") {
      onToast({ type: "info", title: "Export cancelled", message: "The save dialog was closed. No file was written.", duration: 3_000 });
      return;
    }
    const location = result.path ?? "your browser Downloads folder";
    onToast({
      type: "success",
      title,
      message: `${description} was saved to ${location}.`,
      duration: 9_000,
      action: result.path ? { label: "Show in folder", onClick: () => revealSavedFile(result.path!) } : undefined,
    });
  }, [onToast, revealSavedFile]);

  return { openExternal, revealSavedFile, showSaveResult };
}
