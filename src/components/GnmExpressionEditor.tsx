import { useMemo, useState } from "react";
import { ArrowLeftRight, Lock, RefreshCw, RotateCcw, Search, Unlock } from "lucide-react";
import {
  gnmExpressionComponentName, gnmExpressionRegions, nonZeroExpressionComponentCount,
} from "../lib/gnmExpressions";

type Props = {
  semanticNames: readonly string[];
  semanticA: string;
  semanticB: string;
  seedA: string;
  seedB: string;
  blend: number;
  weights: Float32Array;
  frozen: Record<number, number>;
  ready: boolean;
  busy: boolean;
  backend: string;
  disabled: boolean;
  onSemanticA: (value: string) => void;
  onSemanticB: (value: string) => void;
  onSeedA: (value: string) => void;
  onSeedB: (value: string) => void;
  onResampleA: () => void;
  onResampleB: () => void;
  onBlend: (value: number) => void;
  onWeight: (index: number, value: number) => void;
  onToggleFreeze: (index: number) => void;
  onMirror: (direction: "left-to-right" | "right-to-left") => void;
  onReset: () => void;
};

function readable(value: string) {
  return value.replaceAll("_", " ");
}

export function GnmExpressionEditor(props: Props) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const activeCount = nonZeroExpressionComponentCount(props.weights);
  const regionEntries = useMemo(() => gnmExpressionRegions.map((region) => ({
    ...region,
    indices: Array.from({ length: region.end - region.start }, (_, offset) => region.start + offset)
      .filter((index) => !query || gnmExpressionComponentName(index).includes(query)),
  })).filter((region) => region.indices.length), [query]);

  return (
    <details className="advanced-expression gnm-full-expression">
      <summary><ArrowLeftRight size={15} />GNM 383-component editor<small>{props.busy ? "Evaluating…" : `${activeCount} active`}</small></summary>
      <div className="gnm-expression-editor">
        <div className="gnm-expression-status"><i className={props.ready ? "ready" : ""} /><span>{props.ready ? `${props.backend} evaluator ready` : "Loading local expression decoder…"}</span></div>
        <div className="expression-ab-grid">
          <div className="expression-endpoint">
            <strong>Expression A</strong>
            <select value={props.semanticA} disabled={!props.ready || props.disabled} onChange={(event) => props.onSemanticA(event.target.value)}>{props.semanticNames.map((name) => <option value={name} key={name}>{readable(name)}</option>)}</select>
            <span><input value={props.seedA} disabled={!props.ready || props.disabled} aria-label="Expression A seed" onChange={(event) => props.onSeedA(event.target.value)} /><button type="button" disabled={!props.ready || props.disabled} title="Resample Expression A" onClick={props.onResampleA}><RefreshCw size={13} /></button></span>
          </div>
          <div className="expression-endpoint">
            <strong>Expression B</strong>
            <select value={props.semanticB} disabled={!props.ready || props.disabled} onChange={(event) => props.onSemanticB(event.target.value)}>{props.semanticNames.map((name) => <option value={name} key={name}>{readable(name)}</option>)}</select>
            <span><input value={props.seedB} disabled={!props.ready || props.disabled} aria-label="Expression B seed" onChange={(event) => props.onSeedB(event.target.value)} /><button type="button" disabled={!props.ready || props.disabled} title="Resample Expression B" onClick={props.onResampleB}><RefreshCw size={13} /></button></span>
          </div>
        </div>
        <label className="slider-row expression-blend"><span>A / B blend</span><input type="range" min="0" max="100" value={props.blend * 100} disabled={!props.ready || props.disabled} onChange={(event) => props.onBlend(Number(event.target.value) / 100)} /><output>{Math.round(props.blend * 100)}%</output></label>
        <div className="expression-editor-actions">
          <button type="button" disabled={props.disabled} onClick={() => props.onMirror("left-to-right")}><ArrowLeftRight size={12} />L → R</button>
          <button type="button" disabled={props.disabled} onClick={() => props.onMirror("right-to-left")}><ArrowLeftRight size={12} />R → L</button>
          <button type="button" disabled={props.disabled} onClick={props.onReset}><RotateCcw size={12} />Reset 383</button>
        </div>
        <label className="expression-search"><Search size={13} /><input type="search" placeholder="Search raw components" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="raw-expression-regions">
          {regionEntries.map((region) => (
            <details key={region.id} open={Boolean(query)}>
              <summary>{region.label}<small>{region.indices.length}</small></summary>
              {region.indices.map((index) => {
                const frozen = index in props.frozen;
                const value = frozen ? props.frozen[index] : props.weights[index];
                return <div className={`raw-expression-row ${frozen ? "is-frozen" : ""}`} key={index}>
                  <label htmlFor={`gnm-raw-${index}`} title={gnmExpressionComponentName(index)}>{gnmExpressionComponentName(index)}</label>
                  <input id={`gnm-raw-${index}`} type="range" min="-2" max="2" step="0.01" value={value} disabled={props.disabled || frozen} onChange={(event) => props.onWeight(index, Number(event.target.value))} />
                  <output>{value.toFixed(2)}</output>
                  <button type="button" disabled={props.disabled} title={frozen ? "Unfreeze component" : "Freeze component"} aria-pressed={frozen} onClick={() => props.onToggleFreeze(index)}>{frozen ? <Lock size={12} /> : <Unlock size={12} />}</button>
                  <button type="button" disabled={props.disabled || frozen || Math.abs(value) < 1e-6} title="Reset component" onClick={() => props.onWeight(index, 0)}><RotateCcw size={11} /></button>
                </div>;
              })}
            </details>
          ))}
        </div>
      </div>
    </details>
  );
}
