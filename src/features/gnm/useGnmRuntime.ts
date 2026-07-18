import { useCallback, useEffect, useRef, useState } from "react";
import { isDesktopRuntime } from "../../app/studioConfig";
import { DenseDecoder, expressionDecoderInput, weightedIdentityDecoderInput } from "../../lib/decoder";
import { applyFrozenGnmExpressionComponents, blendGnmExpressions, mirrorGnmEyeRegion } from "../../lib/gnmExpressions";
import { identityVertexCount } from "../../lib/identityVertices";
import { semanticExpressionNames } from "../../lib/retarget";
import { assetUrl } from "../../lib/assets";
import type { WebIdentityEvaluator } from "../../lib/webIdentity";
import type { AvatarKind, IdentityVertices, RecordedTakeSnapshot } from "../../types";

type Toast = { type: "success" | "info" | "warning" | "error"; title: string; message: string };
type Presentation = "female" | "male" | "blend";
type Population = "middle_eastern" | "asian" | "white" | "black" | "blend";

export interface GnmRuntimeOptions {
  avatarKind: AvatarKind;
  recordingIdle: boolean;
  onToast: (toast: Toast) => void;
  onError: (message: string) => void;
}

export function useGnmRuntime({ avatarKind, recordingIdle, onToast, onError }: GnmRuntimeOptions) {
  const [identitySeed, setIdentitySeed] = useState("GNM-2048");
  const [identityGender, setIdentityGender] = useState<Presentation>("blend");
  const [identityEthnicity, setIdentityEthnicity] = useState<Population>("blend");
  const [identityPresentationStrength, setIdentityPresentationStrength] = useState(0);
  const [identityPopulationWeights, setIdentityPopulationWeights] = useState<[number, number, number, number]>([0.25, 0.25, 0.25, 0.25]);
  const [identityVertices, setIdentityVertices] = useState<IdentityVertices | null>(null);
  const [identityStatus, setIdentityStatus] = useState<"ready" | "generating" | "error">("ready");
  const [webIdentityBackend, setWebIdentityBackend] = useState<"detecting" | "webgpu" | "cpu">("detecting");
  const [identityDecoderReady, setIdentityDecoderReady] = useState(false);
  const [identityWeights, setIdentityWeights] = useState<Float32Array | null>(null);
  const [expressionDecoderReady, setExpressionDecoderReady] = useState(false);
  const [gnmExpressionStatus, setGnmExpressionStatus] = useState<"ready" | "evaluating" | "error">("ready");
  const [gnmExpressionWeights, setGnmExpressionWeights] = useState<Float32Array>(() => new Float32Array(383));
  const [gnmFrozenExpressionComponents, setGnmFrozenExpressionComponents] = useState<Record<number, number>>({});
  const [gnmExpressionA, setGnmExpressionA] = useState("surprise");
  const [gnmExpressionB, setGnmExpressionB] = useState("happy");
  const [gnmExpressionSeedA, setGnmExpressionSeedA] = useState("GNM-EXP-A");
  const [gnmExpressionSeedB, setGnmExpressionSeedB] = useState("GNM-EXP-B");
  const [gnmExpressionBlend, setGnmExpressionBlend] = useState(0);
  const [gnmExpressionAbActive, setGnmExpressionAbActive] = useState(false);
  const [gnmExpressionEndpointA, setGnmExpressionEndpointA] = useState<Float32Array>(() => new Float32Array(383));
  const [gnmExpressionEndpointB, setGnmExpressionEndpointB] = useState<Float32Array>(() => new Float32Array(383));

  const identityDecoderRef = useRef<DenseDecoder | null>(null);
  const expressionDecoderRef = useRef<DenseDecoder | null>(null);
  const identityWeightsRef = useRef<Float32Array | null>(null);
  const identityEvaluationSkipRef = useRef<Float32Array | null>(null);
  const gnmExpressionWeightsRef = useRef(gnmExpressionWeights);
  const identityGenerationRef = useRef(0);
  const webIdentityEvaluatorRef = useRef<WebIdentityEvaluator | null>(null);
  const callbacksRef = useRef({ onToast, onError });
  callbacksRef.current = { onToast, onError };
  identityWeightsRef.current = identityWeights;
  gnmExpressionWeightsRef.current = gnmExpressionWeights;

  useEffect(() => {
    let disposed = false;
    Promise.all([
      DenseDecoder.load(assetUrl("models/gnm_identity_decoder.bin")),
      DenseDecoder.load(assetUrl("models/gnm_expression_decoder.bin")),
    ])
      .then(([identityDecoder, expressionDecoder]) => {
        if (disposed) return;
        identityDecoderRef.current = identityDecoder;
        expressionDecoderRef.current = expressionDecoder;
        setIdentityDecoderReady(true);
        setExpressionDecoderReady(true);
      })
      .catch((error) => callbacksRef.current.onError(`GNM decoder: ${String(error)}`));
    return () => {
      disposed = true;
      webIdentityEvaluatorRef.current?.dispose();
      webIdentityEvaluatorRef.current = null;
    };
  }, []);

  const evaluateParameters = useCallback(async (identity: Float32Array, expression: Float32Array) => {
    if (isDesktopRuntime) {
      const { invoke } = await import("@tauri-apps/api/core");
      const positions = await invoke<number[][]>("gnm_evaluate", { identity: Array.from(identity), expression: Array.from(expression), rotations: new Array(4).fill(null).map(() => [0, 0, 0]), translation: [0, 0, 0] });
      return { positions: positions as IdentityVertices, backend: "native Rust" };
    }
    if (!webIdentityEvaluatorRef.current) {
      const { WebIdentityEvaluator } = await import("../../lib/webIdentity");
      webIdentityEvaluatorRef.current = new WebIdentityEvaluator();
    }
    const evaluation = await webIdentityEvaluatorRef.current.evaluateExpression(identity, expression);
    setWebIdentityBackend(evaluation.backend);
    return { positions: evaluation.positions as IdentityVertices, backend: evaluation.backend === "webgpu" ? "worker WebGPU" : "worker CPU" };
  }, []);

  const generateIdentity = useCallback(async (seed = identitySeed, presentationStrength = identityPresentationStrength, populationWeights = identityPopulationWeights, announce = true) => {
    if (!identityDecoderRef.current) {
      callbacksRef.current.onError("Identity generation: the local identity decoder is still loading. Wait a moment and retry.");
      return;
    }
    const request = ++identityGenerationRef.current;
    setIdentityStatus("generating");
    try {
      const identity = identityDecoderRef.current.evaluate(weightedIdentityDecoderInput(seed, presentationStrength, populationWeights));
      identityWeightsRef.current = identity;
      identityEvaluationSkipRef.current = identity;
      setIdentityWeights(identity);
      const evaluation = await evaluateParameters(identity, gnmExpressionWeightsRef.current);
      if (request !== identityGenerationRef.current) return;
      setIdentityVertices(evaluation.positions);
      setIdentityStatus("ready");
      if (announce) callbacksRef.current.onToast({ type: "success", title: "Identity generated", message: `GNM rebuilt ${identityVertexCount(evaluation.positions).toLocaleString()} vertices from seed ${seed} with ${evaluation.backend}.` });
    } catch (error) {
      if (request !== identityGenerationRef.current) return;
      setIdentityStatus("error");
      callbacksRef.current.onError(`Identity generation: ${String(error)}`);
    }
  }, [evaluateParameters, identityPopulationWeights, identityPresentationStrength, identitySeed]);

  useEffect(() => {
    if (!identityDecoderReady || avatarKind !== "gnm" || !recordingIdle) return;
    const timer = window.setTimeout(() => { void generateIdentity(identitySeed, identityPresentationStrength, identityPopulationWeights, false); }, 220);
    return () => window.clearTimeout(timer);
  }, [avatarKind, generateIdentity, identityDecoderReady, identityEthnicity, identityGender, identityPopulationWeights, identityPresentationStrength, identitySeed, recordingIdle]);

  useEffect(() => {
    if (!expressionDecoderReady || !expressionDecoderRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        const indexA = semanticExpressionNames.findIndex((name) => name === gnmExpressionA);
        const indexB = semanticExpressionNames.findIndex((name) => name === gnmExpressionB);
        setGnmExpressionEndpointA(expressionDecoderRef.current!.evaluate(expressionDecoderInput(gnmExpressionSeedA, indexA)));
        setGnmExpressionEndpointB(expressionDecoderRef.current!.evaluate(expressionDecoderInput(gnmExpressionSeedB, indexB)));
      } catch (error) {
        setGnmExpressionStatus("error");
        callbacksRef.current.onError(`Expression decoder: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [expressionDecoderReady, gnmExpressionA, gnmExpressionB, gnmExpressionSeedA, gnmExpressionSeedB]);

  useEffect(() => {
    if (!expressionDecoderReady || !gnmExpressionAbActive) return;
    setGnmExpressionWeights(applyFrozenGnmExpressionComponents(blendGnmExpressions(gnmExpressionEndpointA, gnmExpressionEndpointB, gnmExpressionBlend), gnmFrozenExpressionComponents));
  }, [expressionDecoderReady, gnmExpressionAbActive, gnmExpressionBlend, gnmExpressionEndpointA, gnmExpressionEndpointB, gnmFrozenExpressionComponents]);

  useEffect(() => {
    if (!identityWeights || avatarKind !== "gnm") return;
    if (identityEvaluationSkipRef.current === identityWeights) {
      identityEvaluationSkipRef.current = null;
      return;
    }
    const request = ++identityGenerationRef.current;
    setGnmExpressionStatus("evaluating");
    const timer = window.setTimeout(() => {
      evaluateParameters(identityWeights, gnmExpressionWeights)
        .then((evaluation) => {
          if (request !== identityGenerationRef.current) return;
          setIdentityVertices(evaluation.positions);
          setIdentityStatus("ready");
          setGnmExpressionStatus("ready");
        })
        .catch((error) => {
          if (request !== identityGenerationRef.current) return;
          setIdentityStatus("error");
          setGnmExpressionStatus("error");
          callbacksRef.current.onError(`GNM expression evaluation: ${error instanceof Error ? error.message : String(error)}`);
        });
    }, 18);
    return () => window.clearTimeout(timer);
  }, [avatarKind, evaluateParameters, gnmExpressionWeights, identityWeights]);

  const choosePresentation = (presentation: Presentation) => {
    setIdentityGender(presentation);
    setIdentityPresentationStrength(presentation === "female" ? -1 : presentation === "male" ? 1 : 0);
  };
  const setPresentationStrength = (value: number) => {
    setIdentityPresentationStrength(value);
    setIdentityGender(Math.abs(value) < 0.01 ? "blend" : value < 0 ? "female" : "male");
  };
  const choosePopulation = (population: Population) => {
    setIdentityEthnicity(population);
    const index = { middle_eastern: 0, asian: 1, white: 2, black: 3 } as const;
    if (population === "blend") setIdentityPopulationWeights([0.25, 0.25, 0.25, 0.25]);
    else setIdentityPopulationWeights([0, 1, 2, 3].map((value) => value === index[population] ? 1 : 0) as [number, number, number, number]);
  };
  const updatePopulationWeight = (index: number, value: number) => {
    setIdentityEthnicity("blend");
    setIdentityPopulationWeights((current) => { const next = [...current] as [number, number, number, number]; next[index] = Math.min(1, Math.max(0, value)); return next; });
  };
  const comparePresentation = () => {
    const next = identityPresentationStrength <= 0 ? 1 : -1;
    setIdentityPresentationStrength(next);
    setIdentityGender(next < 0 ? "female" : "male");
  };
  const randomizeIdentity = () => {
    const seed = `GNM-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase()}`;
    setIdentitySeed(seed);
    void generateIdentity(seed);
  };
  const activateAb = (action: () => void) => { action(); setGnmExpressionAbActive(true); };
  const resampleExpressionSeed = (slot: "a" | "b") => activateAb(() => {
    const seed = `GNM-EXP-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase()}`;
    if (slot === "a") setGnmExpressionSeedA(seed); else setGnmExpressionSeedB(seed);
  });
  const setRawExpressionWeight = (index: number, value: number) => {
    setGnmExpressionAbActive(false);
    setGnmExpressionWeights((current) => { const next = current.slice(); next[index] = Math.min(2, Math.max(-2, value)); return applyFrozenGnmExpressionComponents(next, gnmFrozenExpressionComponents); });
  };
  const toggleRawExpressionFreeze = (index: number) => setGnmFrozenExpressionComponents((current) => {
    if (index in current) { const next = { ...current }; delete next[index]; return next; }
    return { ...current, [index]: gnmExpressionWeightsRef.current[index] };
  });
  const mirrorRawExpression = (direction: "left-to-right" | "right-to-left") => {
    setGnmExpressionAbActive(false);
    setGnmExpressionWeights((current) => applyFrozenGnmExpressionComponents(mirrorGnmEyeRegion(current, direction), gnmFrozenExpressionComponents));
  };
  const resetRawExpression = () => {
    setGnmFrozenExpressionComponents({});
    setGnmExpressionWeights(new Float32Array(383));
    setGnmExpressionBlend(0);
    setGnmExpressionAbActive(false);
  };

  const restoreState = useCallback((snapshot: RecordedTakeSnapshot) => {
    setIdentitySeed(snapshot.identityParameters.seed);
    setIdentityGender(snapshot.identityParameters.presentation);
    setIdentityEthnicity(snapshot.identityParameters.population);
    setIdentityPresentationStrength(snapshot.identityParameters.presentationStrength);
    setIdentityPopulationWeights(snapshot.identityParameters.populationWeights ?? [0.25, 0.25, 0.25, 0.25]);
    setIdentityVertices(snapshot.identityVertices);
    if (snapshot.identityWeights) {
      const weights = snapshot.identityWeights.slice();
      identityEvaluationSkipRef.current = weights;
      identityWeightsRef.current = weights;
      setIdentityWeights(weights);
    }
    setGnmExpressionWeights(snapshot.gnmExpressionWeights?.slice() ?? new Float32Array(383));
    setGnmFrozenExpressionComponents(snapshot.gnmFrozenExpressionComponents ?? {});
    setGnmExpressionAbActive(false);
  }, []);

  return {
    identity: {
      seed: identitySeed, presentation: identityGender, population: identityEthnicity,
      presentationStrength: identityPresentationStrength, populationWeights: identityPopulationWeights,
      vertices: identityVertices, weights: identityWeights, status: identityStatus, webBackend: webIdentityBackend,
      decoderReady: identityDecoderReady, setSeed: setIdentitySeed, choosePresentation, choosePopulation,
      setPresentationStrength, updatePopulationWeight, comparePresentation, randomize: randomizeIdentity,
      generate: generateIdentity,
    },
    expression: {
      ready: expressionDecoderReady, status: gnmExpressionStatus, weights: gnmExpressionWeights,
      frozen: gnmFrozenExpressionComponents, semanticA: gnmExpressionA, semanticB: gnmExpressionB,
      seedA: gnmExpressionSeedA, seedB: gnmExpressionSeedB, blend: gnmExpressionBlend,
      setSemanticA: (value: string) => activateAb(() => setGnmExpressionA(value)),
      setSemanticB: (value: string) => activateAb(() => setGnmExpressionB(value)),
      setSeedA: (value: string) => activateAb(() => setGnmExpressionSeedA(value)),
      setSeedB: (value: string) => activateAb(() => setGnmExpressionSeedB(value)),
      resampleA: () => resampleExpressionSeed("a"), resampleB: () => resampleExpressionSeed("b"),
      setBlend: (value: number) => activateAb(() => setGnmExpressionBlend(value)),
      setWeight: setRawExpressionWeight, toggleFreeze: toggleRawExpressionFreeze,
      mirror: mirrorRawExpression, reset: resetRawExpression,
    },
    restoreState,
  };
}
