import { Lock, Unlock } from "lucide-react";

export function ExpressionControl({
  name, value, frozen, onChange, onToggle,
}: {
  name: string;
  value: number;
  frozen: boolean;
  onChange: (value: number) => void;
  onToggle: () => void;
}) {
  const inputId = `expression-${name}`;
  return (
    <div className={`slider-row has-lock ${frozen ? "is-frozen" : ""}`}>
      <label htmlFor={inputId}>{name.replaceAll("_", " ")}</label>
      <input
        id={inputId}
        type="range"
        min="0"
        max="100"
        disabled={frozen}
        value={value * 100}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <output>{Math.round(value * 100)}</output>
      <button
        type="button"
        className="expression-lock"
        aria-pressed={frozen}
        onClick={onToggle}
        title={frozen ? `Unfreeze ${name}` : `Freeze ${name} at its current value`}
      >
        {frozen ? <Lock size={13} /> : <Unlock size={13} />}
      </button>
    </div>
  );
}
