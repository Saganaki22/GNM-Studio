import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { ExpressionControl } from "../../components/ExpressionControl";
import { GnmExpressionEditor } from "../../components/GnmExpressionEditor";
import { JointControl } from "../../components/JointControl";
import { manualJointGroups } from "../../app/studioConfig";
import { facecapControlGroups } from "../../lib/avatarProfiles";
import { semanticExpressionNames } from "../../lib/retarget";
import type { AvatarKind } from "../../types";

export interface ExpressionPanelProps {
  avatarKind: AvatarKind;
  avatarLabel: string;
  expressionCount: number;
  manual: Record<string, number>;
  frozen: Record<string, number>;
  disabled: boolean;
  setManual: (name: string, value: number) => void;
  toggleFreeze: (name: string) => void;
  resetExpressions: () => void;
  resetJoints: () => void;
  gnm: {
    semanticA: string; semanticB: string; seedA: string; seedB: string; blend: number;
    weights: Float32Array; frozen: Record<number, number>; ready: boolean; busy: boolean; backend: string;
    setSemanticA: (value: string) => void; setSemanticB: (value: string) => void;
    setSeedA: (value: string) => void; setSeedB: (value: string) => void;
    resampleA: () => void; resampleB: () => void; setBlend: (value: number) => void;
    setWeight: (index: number, value: number) => void; toggleFreeze: (index: number) => void;
    mirror: (direction: "left-to-right" | "right-to-left") => void; reset: () => void;
  };
}

export function ExpressionPanel({ avatarKind, avatarLabel, expressionCount, manual, frozen, disabled, setManual, toggleFreeze, resetExpressions, resetJoints, gnm }: ExpressionPanelProps) {
  const control = (name: string) => <ExpressionControl key={name} name={name} value={name in frozen ? frozen[name] : manual[name] ?? 0} frozen={name in frozen} onChange={(value) => setManual(name, value)} onToggle={() => toggleFreeze(name)} />;
  return <section className="panel-section" data-workspace-target="edit">
    <div className="section-heading"><span>Expression</span><small>{Object.keys(frozen).length ? `${Object.keys(frozen).length} frozen` : `${expressionCount} ${avatarLabel} controls`}</small></div>
    {avatarKind === "gnm" && control("jaw_open")}
    {avatarKind === "gnm" && semanticExpressionNames.slice(0, 6).map(control)}
    {avatarKind === "gnm" && <details className="advanced-expression"><summary><SlidersHorizontal size={15} />All semantic controls</summary>{semanticExpressionNames.slice(6).map(control)}</details>}
    {avatarKind === "gnm" && <GnmExpressionEditor semanticNames={semanticExpressionNames} semanticA={gnm.semanticA} semanticB={gnm.semanticB} seedA={gnm.seedA} seedB={gnm.seedB} blend={gnm.blend} weights={gnm.weights} frozen={gnm.frozen} ready={gnm.ready} busy={gnm.busy} backend={gnm.backend} disabled={disabled} onSemanticA={gnm.setSemanticA} onSemanticB={gnm.setSemanticB} onSeedA={gnm.setSeedA} onSeedB={gnm.setSeedB} onResampleA={gnm.resampleA} onResampleB={gnm.resampleB} onBlend={gnm.setBlend} onWeight={gnm.setWeight} onToggleFreeze={gnm.toggleFreeze} onMirror={gnm.mirror} onReset={gnm.reset} />}
    <details className="advanced-expression manual-joint-controls"><summary><SlidersHorizontal size={15} />Neck, head, eyes and XYZ<small>Offsets</small></summary><p className="helper-copy">Signed offsets layer on top of webcam motion. Freeze any channel to keep that value while the remaining tracked controls continue moving.</p>{manualJointGroups.map((group) => <div className="joint-control-group" key={group.label}><strong>{group.label}</strong>{group.controls.map(([name, label]) => <JointControl key={name} name={name} label={label} value={name in frozen ? frozen[name] : manual[name] ?? 0} frozen={name in frozen} unit={group.unit ?? "°"} onChange={(value) => setManual(name, value)} onToggle={() => toggleFreeze(name)} />)}</div>)}<button type="button" className="secondary-button wide" onClick={resetJoints}><RotateCcw size={14} />Reset joint offsets and locks</button></details>
    {avatarKind === "facecap" && facecapControlGroups.map((group, index) => <details className="advanced-expression facecap-expression-group" open={index === 3 || index === 4} key={group.label}><summary><SlidersHorizontal size={15} />{group.label}<small>{group.names.length}</small></summary>{group.names.map(control)}</details>)}
    <button className="secondary-button wide" onClick={resetExpressions}><RotateCcw size={15} />Reset {avatarLabel} expressions and locks</button>
  </section>;
}
