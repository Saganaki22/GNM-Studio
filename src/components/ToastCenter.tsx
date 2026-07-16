import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, FolderOpen, Info, X } from "lucide-react";

export type ToastMessage = {
  id: number;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  detail?: string;
  duration?: number;
  action?: { label: string; onClick: () => void | Promise<void> };
};

async function copyTextReliably(text: string) {
  if ("__TAURI_INTERNALS__" in window) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("The system clipboard rejected the copy request.");
  }
}

function ToastCard({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const Icon = toast.type === "error" || toast.type === "warning"
    ? AlertTriangle
    : toast.type === "success"
      ? CheckCircle2
      : Info;

  useEffect(() => {
    if (toast.duration === 0 || toast.type === "error") return;
    const timer = window.setTimeout(() => dismissRef.current(), toast.duration ?? 5_000);
    return () => clearTimeout(timer);
  }, [toast.duration, toast.type]);

  const copy = async () => {
    const text = [toast.title, toast.message, toast.detail].filter(Boolean).join("\n\n");
    try {
      await copyTextReliably(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_800);
    } catch (error) {
      setCopied(false);
      console.error("Could not copy toast details", error);
    }
  };

  return (
    <article className={`toast toast-${toast.type}`} role={toast.type === "error" ? "alert" : "status"}>
      <div className="toast-icon"><Icon size={18} /></div>
      <div className="toast-copy">
        <strong>{toast.title}</strong>
        <p>{toast.message}</p>
        {toast.detail && <details><summary>Technical details</summary><pre>{toast.detail}</pre></details>}
        {(toast.detail || toast.type === "error") && (
          <button className="toast-copy-button" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy details"}
          </button>
        )}
        {toast.action && (
          <button className="toast-action-button" onClick={() => void toast.action?.onClick()}>
            <FolderOpen size={13} />{toast.action.label}
          </button>
        )}
      </div>
      <button className="toast-close" onClick={onDismiss} aria-label="Dismiss notification"><X size={15} /></button>
    </article>
  );
}

export function ToastCenter({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-center" aria-live="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}
