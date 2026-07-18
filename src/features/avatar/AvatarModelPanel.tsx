import { Aperture, Box, Check } from "lucide-react";
import type { AppSettings, AvatarKind } from "../../types";

export interface AvatarModelPanelProps {
  avatarKind: AvatarKind;
  gnmInfo: { vertices: number; identityDimensions: number; expressionDimensions: number } | null;
  select: (avatarKind: AvatarKind) => void;
}

export function AvatarModelPanel({ avatarKind: activeKind, gnmInfo, select }: AvatarModelPanelProps) {
  return <section className="panel-section model-picker" data-workspace-target="create"><div className="section-heading"><span>Mocap model</span><small>Local avatars</small></div><div className="model-choice-list" role="radiogroup" aria-label="Mocap avatar model">{(["gnm", "facecap"] as AppSettings["avatarKind"][]).map((avatarKind) => { const selected = activeKind === avatarKind; const facecap = avatarKind === "facecap"; return <button type="button" role="radio" aria-checked={selected} className={`model-choice-card ${selected ? "active" : ""}`} key={avatarKind} onClick={() => { if (!selected) select(avatarKind); }}><span className="model-choice-icon">{facecap ? <Aperture size={20} /> : <Box size={20} />}</span><span className="model-choice-copy"><strong>{facecap ? "FaceCap 52" : "GNM Head v3"}</strong><small>{facecap ? "Direct 52-channel tracking" : "Seeded identity + semantic controls"}</small></span><span className="model-choice-meta"><em>{facecap ? "MIT" : "GNM"}</em>{selected && <Check size={15} />}</span></button>; })}</div><p className="model-choice-detail">{activeKind === "gnm" ? `${(gnmInfo?.vertices ?? 17_821).toLocaleString()} vertices · ${(gnmInfo?.identityDimensions ?? 253) + (gnmInfo?.expressionDimensions ?? 383)} native controls` : "52 MediaPipe/ARKit morph targets · bundled offline KTX2 materials"}</p></section>;
}
