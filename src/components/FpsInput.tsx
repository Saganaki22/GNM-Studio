import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

export function FpsInput({
  label, value, onChange, compact = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const next = Math.min(120, Math.max(1, Number.isFinite(parsed) ? parsed : value));
    setDraft(String(next));
    onChange(next);
  };
  return (
    <div className={`fps-control ${compact ? "compact" : ""}`}>
      <span>{label}</span>
      <span className="fps-stepper">
        <button type="button" onClick={() => commit(String(value - 1))} disabled={value <= 1} aria-label={`Decrease ${label}`}><Minus size={12} /></button>
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ""))}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          aria-label={`${label}, frames per second`}
        />
        <button type="button" onClick={() => commit(String(value + 1))} disabled={value >= 120} aria-label={`Increase ${label}`}><Plus size={12} /></button>
      </span>
    </div>
  );
}
