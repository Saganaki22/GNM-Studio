import { Lock, Unlock } from "lucide-react";

export function JointControl({ name, label, value, frozen, unit = "°", onChange, onToggle }: {
  name: string;
  label: string;
  value: number;
  frozen: boolean;
  unit?: "°" | "%";
  onChange: (value: number) => void;
  onToggle: () => void;
}) {
  const inputId = `joint-${name}`;
  return <div className={`slider-row has-lock joint-control ${frozen ? "is-frozen" : ""}`}>
    <label htmlFor={inputId}>{label}</label>
    <input id={inputId} type="range" min="-100" max="100" value={value * 100} disabled={frozen} onChange={(event) => onChange(Number(event.target.value) / 100)} />
    <output>{unit === "°" ? `${Math.round(value * 30)}°` : `${Math.round(value * 100)}%`}</output>
    <button type="button" className="expression-lock" aria-pressed={frozen} title={frozen ? `Unfreeze ${label}` : `Freeze ${label}`} onClick={onToggle}>{frozen ? <Lock size={13} /> : <Unlock size={13} />}</button>
  </div>;
}
