import { ArrowLeftRight, RefreshCw, SlidersHorizontal } from "lucide-react";

export interface IdentityPanelProps {
  seed: string;
  presentation: "female" | "male" | "blend";
  population: "middle_eastern" | "asian" | "white" | "black" | "blend";
  presentationStrength: number;
  populationWeights: [number, number, number, number];
  status: "ready" | "generating" | "error";
  recordingIdle: boolean;
  web: boolean;
  webBackend: "detecting" | "webgpu" | "cpu";
  setSeed: (seed: string) => void;
  setPresentation: (presentation: "female" | "male" | "blend") => void;
  setPopulation: (population: "middle_eastern" | "asian" | "white" | "black" | "blend") => void;
  setPresentationStrength: (value: number) => void;
  setPopulationWeight: (index: number, value: number) => void;
  randomize: () => void;
  comparePresentation: () => void;
  generate: () => void;
}

export function IdentityPanel(props: IdentityPanelProps) {
  const disabled = !props.recordingIdle;
  return <section className="panel-section">
    <div className="section-heading"><span>Identity</span><button onClick={props.randomize} disabled={props.status === "generating" || disabled}><RefreshCw size={14} />{props.status === "generating" ? "Generating" : "Randomize"}</button></div>
    <label className="field-label">Seed<input className="text-input" value={props.seed} disabled={disabled} onChange={(event) => props.setSeed(event.target.value)} /></label>
    <div className="two-up"><label className="field-label">Presentation<select value={props.presentation} disabled={disabled} onChange={(event) => props.setPresentation(event.target.value as IdentityPanelProps["presentation"])}><option value="blend">Blend</option><option value="female">Feminine</option><option value="male">Masculine</option></select></label><label className="field-label">Population<select value={props.population} disabled={disabled} onChange={(event) => props.setPopulation(event.target.value as IdentityPanelProps["population"])}><option value="blend">Blend</option><option value="asian">Asian</option><option value="black">Black</option><option value="middle_eastern">Middle Eastern</option><option value="white">White</option></select></label></div>
    <label className="slider-row identity-presentation-strength"><span>Feminine</span><input type="range" min="-100" max="100" step="1" value={props.presentationStrength * 100} disabled={disabled} onChange={(event) => props.setPresentationStrength(Number(event.target.value) / 100)} /><output>{Math.round(props.presentationStrength * 100)}</output><small>Masculine</small></label>
    <button type="button" className="secondary-button wide identity-compare" disabled={disabled} onClick={props.comparePresentation}><ArrowLeftRight size={13} />Compare feminine / masculine with this seed</button>
    <details className="advanced-expression identity-population-blend"><summary><SlidersHorizontal size={14} />Population blend<small>Weighted</small></summary>{(["Middle Eastern", "Asian", "White", "Black"] as const).map((label, index) => <label className="slider-row" key={label}><span>{label}</span><input type="range" min="0" max="100" value={props.populationWeights[index] * 100} disabled={disabled} onChange={(event) => props.setPopulationWeight(index, Number(event.target.value) / 100)} /><output>{Math.round(props.populationWeights[index] * 100)}</output></label>)}</details>
    <button className="secondary-button wide" onClick={props.generate} disabled={props.status === "generating" || disabled}>{props.status === "generating" ? props.web ? props.webBackend === "webgpu" ? "Building with WebGPU…" : "Building in web worker…" : "Building GNM mesh…" : props.web ? "Apply identity locally" : "Apply identity"}</button>
    {props.web && <p className="helper-copy web-edition-note">The compressed identity runtime evaluates locally in a dedicated worker. {props.webBackend === "webgpu" ? "WebGPU compute is active." : props.webBackend === "cpu" ? "This device is using the compatible CPU-worker fallback." : "WebGPU is selected automatically when this browser supports it."} Camera tracking and the interface remain responsive.</p>}
  </section>;
}
