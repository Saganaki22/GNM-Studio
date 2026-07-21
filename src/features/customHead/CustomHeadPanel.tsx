import { Camera, ChevronDown, Cpu, ImagePlus, ScanFace, Sparkles, Trash2 } from "lucide-react";
import { useRef, type RefObject } from "react";
import type { ToastMessage } from "../../components/ToastCenter";
import type { CustomHeadImage, CustomHeadView } from "./customHeadTypes";
import { useCustomHead } from "./useCustomHead";

interface CustomHeadPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraReady: boolean;
  recordingIdle: boolean;
  currentWeights: Float32Array | null;
  applyWeights(weights: Float32Array): Promise<void>;
  onToast(toast: Omit<ToastMessage, "id">): unknown;
  onError(message: string): void;
}

interface ViewCardProps {
  view: CustomHeadView;
  image: CustomHeadImage | null;
  cameraReady: boolean;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  choose(file: File | null): void;
  capture(): void;
  remove(): void;
}

function ViewCard(props: ViewCardProps) {
  const front = props.view === "front";
  return <article className={`custom-head-view ${props.image ? "has-image" : ""}`}>
    <input
      ref={props.inputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      hidden
      onChange={(event) => {
        props.choose(event.target.files?.[0] ?? null);
        event.currentTarget.value = "";
      }}
    />
    <div className="custom-head-preview">
      {props.image
        ? <img src={props.image.url} alt={`${front ? "Front" : "Side"} head reference`} />
        : <><ScanFace size={25} /><span>{front ? "Front" : "3/4"}</span></>}
      <strong>{front ? "Straight-on" : "Optional 3/4"}</strong>
    </div>
    <div className="custom-head-view-copy">
      <span>{props.image?.name ?? (front ? "Neutral face, camera level" : "Turn 45–60° left or right")}</span>
      {props.image && <small>{props.image.width} × {props.image.height} · {props.image.source}</small>}
    </div>
    <div className="custom-head-view-actions">
      <button type="button" title={props.image ? "Replace image" : "Upload image"} disabled={props.busy} onClick={() => props.inputRef.current?.click()}><ImagePlus size={13} /></button>
      <button type="button" title="Capture current camera frame" disabled={props.busy || !props.cameraReady} onClick={props.capture}><Camera size={13} /></button>
      {props.image && <button type="button" title="Remove image" disabled={props.busy} onClick={props.remove}><Trash2 size={13} /></button>}
    </div>
  </article>;
}

export function CustomHeadPanel(props: CustomHeadPanelProps) {
  const frontInputRef = useRef<HTMLInputElement>(null);
  const profileInputRef = useRef<HTMLInputElement>(null);
  const customHead = useCustomHead(props);
  const busy = customHead.status === "fitting" || customHead.status === "applying";
  const ready = Boolean(customHead.images.front);
  const fitImprovement = customHead.lastResult && customHead.lastResult.geometry.initialRmse > 1e-8
    ? Math.max(0, 1 - customHead.lastResult.geometry.fittedRmse / customHead.lastResult.geometry.initialRmse)
    : customHead.lastResult ? 1 : null;
  return <details className="panel-section experimental-custom-head">
    <summary>
      <span><strong>Custom head</strong><small>Experimental · front + optional 3/4</small></span>
      <span className={customHead.lastResult ? "custom-head-summary-state ready" : "custom-head-summary-state"}>
        {customHead.lastResult ? "Fitted" : "Front required"}<ChevronDown size={13} />
      </span>
    </summary>
    <div className="custom-head-content">
      <p className="helper-copy">A straight-on photo is enough. Add an optional 45–60° three-quarter photo of the same person for stronger depth and identity validation. MediaPipe aligns 118 anatomical points in face-local XYZ; a robust solver fits them inside a 48-mode subspace sampled from valid GNM identities. DINOv3 Q4 only validates two-view agreement.</p>
      <div className="custom-head-views">
        <ViewCard view="front" image={customHead.images.front} cameraReady={customHead.cameraReady} busy={busy} inputRef={frontInputRef} choose={(file) => customHead.chooseFile("front", file)} capture={() => void customHead.capture("front")} remove={() => customHead.remove("front")} />
        <ViewCard view="profile" image={customHead.images.profile} cameraReady={customHead.cameraReady} busy={busy} inputRef={profileInputRef} choose={(file) => customHead.chooseFile("profile", file)} capture={() => void customHead.capture("profile")} remove={() => customHead.remove("profile")} />
      </div>
      {!customHead.cameraReady && <p className="custom-head-camera-note"><Camera size={12} />Camera capture is unavailable; image upload still works.</p>}
      <label className="slider-row custom-head-strength"><span>Shape match</span><input type="range" min="35" max="100" step="1" value={Math.round(customHead.strength * 100)} disabled={busy || !customHead.recordingIdle} onChange={(event) => customHead.setStrength(Number(event.target.value) / 100)} /><output>{Math.round(customHead.strength * 100)}%</output></label>
      {customHead.progress && <div className="custom-head-progress" aria-live="polite">
        <span>{customHead.progress.stage === "model" || customHead.progress.stage === "features" ? <Cpu size={12} /> : <Sparkles size={12} />}{customHead.progress.message}</span>
        {customHead.progress.percent !== null && <i><b style={{ width: `${customHead.progress.percent}%` }} /></i>}
      </div>}
      {customHead.lastResult && <div className="custom-head-result"><Sparkles size={12} /><span>GNM geometry fit{fitImprovement === null ? "" : ` · ${(fitImprovement * 100).toFixed(0)}% residual reduction`}{customHead.lastResult.consistency === null ? "" : ` · ${(customHead.lastResult.consistency * 100).toFixed(0)}% DINO view match`}</span></div>}
      <button type="button" className="primary-button wide" disabled={!ready || busy || !customHead.recordingIdle} onClick={() => void customHead.fit()}>
        <ScanFace size={14} />{busy ? customHead.status === "applying" ? "Applying custom head…" : customHead.images.profile ? "Analyzing both views…" : "Analyzing front view…" : "Fit custom GNM head"}
      </button>
      <p className="helper-copy custom-head-model-note">With two views, first use downloads and caches the optional DINOv3 ViT-S/16 Q4 ONNX model. Front-only fitting does not download DINOv3. Photos and fitted coefficients stay on this device. DINOv3 model weights use Meta’s DINOv3 license.</p>
    </div>
  </details>;
}
