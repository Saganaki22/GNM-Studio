import { useCallback, useEffect, useRef, useState } from "react";
import { loadBackgroundImage, removeBackgroundImage, saveBackgroundImage } from "../../lib/backgroundStore";

export interface BackgroundImageAdapters {
  getRetainedUrl: () => string | null;
  setImageMode: () => void;
  setStudioMode: () => void;
  onSuccess: (title: string, message: string) => void;
  onInfo: (title: string, message: string) => void;
  onError: (message: string) => void;
}

export function useBackgroundImage(adapters: BackgroundImageAdapters) {
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const objectUrlRef = useRef<string | null>(null);
  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;

  const revokeCurrentUnlessRetained = useCallback(() => {
    const current = objectUrlRef.current;
    if (current && current !== adaptersRef.current.getRetainedUrl()) URL.revokeObjectURL(current);
  }, []);

  useEffect(() => {
    let disposed = false;
    loadBackgroundImage()
      .then((stored) => {
        if (disposed || !stored?.blob) return;
        const nextUrl = URL.createObjectURL(stored.blob);
        objectUrlRef.current = nextUrl;
        setUrl(nextUrl);
        setName(stored.name);
      })
      .catch((error) => adaptersRef.current.onError(`Custom background: ${String(error)}`));
    return () => {
      disposed = true;
      const current = objectUrlRef.current;
      const retained = adaptersRef.current.getRetainedUrl();
      if (current) URL.revokeObjectURL(current);
      if (retained && retained !== current) URL.revokeObjectURL(retained);
      objectUrlRef.current = null;
    };
  }, []);

  const choose = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      adaptersRef.current.onError(`Custom background: ${file.name} is not a supported image file.`);
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      adaptersRef.current.onError("Custom background: choose an image smaller than 50 MB.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = `${bitmap.width} × ${bitmap.height}`;
      bitmap.close();
      await saveBackgroundImage({ blob: file, name: file.name });
      const replacing = Boolean(objectUrlRef.current);
      revokeCurrentUnlessRetained();
      const nextUrl = URL.createObjectURL(file);
      objectUrlRef.current = nextUrl;
      setUrl(nextUrl);
      setName(file.name);
      adaptersRef.current.setImageMode();
      adaptersRef.current.onSuccess(replacing ? "Background replaced" : "Background added", `${file.name} (${dimensions}) is stored locally. Its aspect ratio will be preserved.`);
    } catch (error) {
      adaptersRef.current.onError(`Custom background: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [revokeCurrentUnlessRetained]);

  const clear = useCallback(async () => {
    try {
      await removeBackgroundImage();
      revokeCurrentUnlessRetained();
      objectUrlRef.current = null;
      setUrl(null);
      setName("");
      adaptersRef.current.setStudioMode();
      adaptersRef.current.onInfo("Custom background removed", "The locally stored image was cleared.");
    } catch (error) {
      adaptersRef.current.onError(`Remove custom background: ${String(error)}`);
    }
  }, [revokeCurrentUnlessRetained]);

  const adopt = useCallback((nextUrl: string) => {
    revokeCurrentUnlessRetained();
    objectUrlRef.current = nextUrl;
    setUrl(nextUrl);
  }, [revokeCurrentUnlessRetained]);

  return { backgroundImageUrl: url, backgroundImageName: name, chooseBackgroundImage: choose, clearBackgroundImage: clear, adoptBackgroundImageUrl: adopt };
}
