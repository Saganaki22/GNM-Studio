import { useCallback, useRef } from "react";
import { captureRecordedTakeSnapshot } from "../../lib/recordingAppearance";
import type { MotionFile } from "../../lib/motionFile";
import type {
  AppSettings, IdentityVertices, RecordedIdentityParameters, RecordedTakeSnapshot, TrackingFrame,
} from "../../types";

interface RecordedAppearanceOptions {
  settings: AppSettings;
  identity: {
    vertices: IdentityVertices | null;
    parameters: RecordedIdentityParameters;
    weights: Float32Array | null;
  };
  expression: {
    gnmWeights: Float32Array | null;
    gnmFrozen: Record<string, number>;
    manual: Record<string, number>;
    frozen: Record<string, number>;
  };
  neutralFrame: TrackingFrame | null;
  backgroundImageUrl: string | null;
  getViewState(): RecordedTakeSnapshot["viewState"];
  restoreGnmState(snapshot: RecordedTakeSnapshot): void;
  restoreNeutralFrame(frame: TrackingFrame | null): void;
  setSettings(settings: AppSettings): void;
  setAvatarKind(avatarKind: AppSettings["avatarKind"]): void;
  setManual(expressions: Record<string, number>): void;
  setFrozen(expressions: Record<string, number>): void;
  setViewState(viewState: RecordedTakeSnapshot["viewState"]): void;
  adoptBackgroundImageUrl(url: string): void;
}

export function useRecordedAppearance(options: RecordedAppearanceOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const captureCurrent = useCallback(() => captureRecordedTakeSnapshot({
    settings: optionsRef.current.settings,
    identityVertices: optionsRef.current.identity.vertices,
    identityParameters: optionsRef.current.identity.parameters,
    identityWeights: optionsRef.current.identity.weights,
    gnmExpressionWeights: optionsRef.current.expression.gnmWeights,
    gnmFrozenExpressionComponents: optionsRef.current.expression.gnmFrozen,
    manualExpressions: optionsRef.current.expression.manual,
    frozenExpressions: optionsRef.current.expression.frozen,
    neutralFrame: optionsRef.current.neutralFrame,
    viewState: optionsRef.current.getViewState(),
    backgroundImageUrl: optionsRef.current.backgroundImageUrl,
  }), []);

  const createImported = useCallback((motion: MotionFile) => captureRecordedTakeSnapshot({
    settings: {
      ...optionsRef.current.settings,
      avatarKind: motion.avatarKind ?? optionsRef.current.settings.avatarKind,
      exportFps: motion.fps,
    },
    identityVertices: optionsRef.current.identity.vertices,
    identityParameters: optionsRef.current.identity.parameters,
    identityWeights: optionsRef.current.identity.weights,
    gnmExpressionWeights: optionsRef.current.expression.gnmWeights,
    gnmFrozenExpressionComponents: optionsRef.current.expression.gnmFrozen,
    manualExpressions: motion.manualExpressions,
    frozenExpressions: motion.frozenExpressions,
    neutralFrame: motion.neutral,
    viewState: motion.viewState,
    backgroundImageUrl: optionsRef.current.backgroundImageUrl,
  }), []);

  const applyImported = useCallback((snapshot: RecordedTakeSnapshot) => {
    const current = optionsRef.current;
    current.restoreNeutralFrame(snapshot.neutralFrame);
    current.setAvatarKind(snapshot.settings.avatarKind);
    current.setManual(snapshot.manualExpressions);
    current.setFrozen(snapshot.frozenExpressions);
    current.restoreGnmState(snapshot);
  }, []);

  const applyFullSnapshot = useCallback((snapshot: RecordedTakeSnapshot) => {
    const current = optionsRef.current;
    current.setSettings(snapshot.settings);
    current.restoreGnmState(snapshot);
    current.setManual({ ...snapshot.manualExpressions });
    current.setFrozen({ ...snapshot.frozenExpressions });
    current.restoreNeutralFrame(snapshot.neutralFrame);
    current.setViewState(snapshot.viewState);
    if (snapshot.backgroundImageUrl) current.adoptBackgroundImageUrl(snapshot.backgroundImageUrl);
  }, []);

  return { captureCurrent, createImported, applyImported, applyFullSnapshot };
}
