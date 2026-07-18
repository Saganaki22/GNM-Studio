import { useEffect, useState } from "react";
import type { ToastMessage } from "../../components/ToastCenter";

interface StudioMetadataOptions {
  deviceError: string;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
  onError(message: string): void;
}

export function useStudioMetadata({ deviceError, onToast, onError }: StudioMetadataOptions) {
  const [gnmInfo, setGnmInfo] = useState<{
    vertices: number;
    identityDimensions: number;
    expressionDimensions: number;
  } | null>(null);
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);

  useEffect(() => {
    const suppressContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", suppressContextMenu);
    return () => window.removeEventListener("contextmenu", suppressContextMenu);
  }, []);

  useEffect(() => {
    if (!deviceError) return;
    onToast({
      type: "error",
      title: "GNM Studio needs attention",
      message: "The last operation could not be completed. Review the details below and retry.",
      detail: deviceError,
      duration: 0,
    });
  }, [deviceError, onToast]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<{ vertices: number; identityDimensions: number; expressionDimensions: number }>("gnm_model_info"))
      .then(setGnmInfo)
      .catch((error) => onError(`GNM runtime: ${String(error)}`));
  }, [onError]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch((error) => onError(`App manifest version: ${String(error)}`));
  }, [onError]);

  return { gnmInfo, appVersion };
}
