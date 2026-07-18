import { Aperture } from "lucide-react";

export interface DeviceAccessPromptProps {
  permissionState: "idle" | "asking" | "ready" | "error";
  error: string;
  requestAccess: () => void;
  continueWithoutCapture: () => void;
}

export function DeviceAccessPrompt({ permissionState, error, requestAccess, continueWithoutCapture }: DeviceAccessPromptProps) {
  return <div className="permission-card"><Aperture size={28} /><div><strong>Connect capture devices (optional)</strong><span>Camera and microphone are only needed for live tracking and audio. Manual avatar tools remain available.</span>{error && <small className="error-text">{error}</small>}</div><div className="permission-actions"><button className="primary-button" onClick={requestAccess} disabled={permissionState === "asking"}>{permissionState === "asking" ? "Waiting…" : "Enable camera & microphone"}</button><button className="secondary-button" onClick={continueWithoutCapture}>Continue without capture</button></div></div>;
}
