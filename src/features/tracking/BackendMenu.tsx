import { Check, Cpu, RefreshCw, Zap } from "lucide-react";
import type { BackendProbe } from "../../app/studioConfig";
import type { TrackingBackend } from "../../types";

export interface BackendMenuProps {
  position: { x: number; y: number };
  backend: TrackingBackend;
  gpuProbe: BackendProbe;
  cpuProbe: BackendProbe;
  close: () => void;
  select: (backend: TrackingBackend) => void;
}

export function BackendMenu({ position, backend, gpuProbe, cpuProbe, close, select }: BackendMenuProps) {
  return <div className="backend-menu-portal">
    <button className="backend-menu-scrim" aria-label="Close tracking backend menu" onClick={close} />
    <div className="backend-menu" role="menu" aria-label="Tracking backend" style={{ left: position.x, top: position.y }}>
      <header><span>Tracking backend</span><small>Right-click selector</small></header>
      <button role="menuitemradio" aria-checked={backend === "auto"} onClick={() => select("auto")}><RefreshCw size={15} /><span><strong>Auto</strong><small>GPU first, CPU fallback</small></span>{backend === "auto" && <Check size={14} />}</button>
      <button role="menuitemradio" aria-checked={backend === "gpu"} disabled={gpuProbe.available === false} title={gpuProbe.reason} onClick={() => select("gpu")}><Zap size={15} /><span><strong>GPU</strong><small>{gpuProbe.available === true ? "Available" : gpuProbe.available === false ? "Unavailable" : "Not tested yet"}</small></span>{backend === "gpu" && <Check size={14} />}</button>
      <button role="menuitemradio" aria-checked={backend === "cpu"} disabled={cpuProbe.available === false} title={cpuProbe.reason} onClick={() => select("cpu")}><Cpu size={15} /><span><strong>CPU</strong><small>{cpuProbe.available === true ? "Available" : cpuProbe.available === false ? "Unavailable" : "Not tested yet"}</small></span>{backend === "cpu" && <Check size={14} />}</button>
    </div>
  </div>;
}
