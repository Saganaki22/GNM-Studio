import { useCallback, useRef, useState } from "react";
import type { ToastMessage } from "../../components/ToastCenter";

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);
  const pushToast = useCallback((toast: Omit<ToastMessage, "id">) => {
    const message = { ...toast, id: ++toastIdRef.current };
    setToasts((current) => [...current.slice(-3), message]);
    return message.id;
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  return { toasts, pushToast, dismissToast };
}
