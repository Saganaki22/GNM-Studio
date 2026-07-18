import { assetUrl } from "./lib/assets";
import { evaluateWebIdentity, parseWebIdentityRuntime, type WebIdentityRuntime } from "./lib/webIdentityRuntime";
import { WebGpuIdentityEvaluator } from "./lib/webIdentityWebGpu";
import { addWebExpression, parseWebExpressionRuntime, type WebExpressionRuntime } from "./lib/webExpressionRuntime";
import { WebGpuExpressionEvaluator } from "./lib/webExpressionWebGpu";

type EvaluateMessage = { type: "evaluate"; id: number; weights: Float32Array };
type EvaluateExpressionMessage = { type: "evaluate-expression"; id: number; identityWeights: Float32Array; expressionWeights: Float32Array };

let runtimePromise: Promise<WebIdentityRuntime> | null = null;
let webGpuEvaluatorPromise: Promise<WebGpuIdentityEvaluator | null> | null = null;
let expressionRuntimePromise: Promise<WebExpressionRuntime> | null = null;
let webGpuExpressionPromise: Promise<WebGpuExpressionEvaluator | null> | null = null;
let evaluationQueue = Promise.resolve();

async function loadRuntime() {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    const response = await fetch(assetUrl("models/gnm_identity_basis.gni.gz"));
    if (!response.ok || !response.body) throw new Error(`Could not load the web identity runtime (${response.status}).`);
    if (typeof DecompressionStream === "undefined") throw new Error("This browser does not support local gzip decompression. Use a current Chromium, Firefox, or Safari release.");
    const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
    const buffer = await new Response(decompressed).arrayBuffer();
    return parseWebIdentityRuntime(buffer);
  })();
  return runtimePromise;
}

async function loadExpressionRuntime() {
  if (expressionRuntimePromise) return expressionRuntimePromise;
  expressionRuntimePromise = (async () => {
    const response = await fetch(assetUrl("models/gnm_expression_basis.gne.gz"));
    if (!response.ok || !response.body) throw new Error(`Could not load the web expression runtime (${response.status}).`);
    if (typeof DecompressionStream === "undefined") throw new Error("This browser does not support local gzip decompression.");
    const buffer = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    return parseWebExpressionRuntime(buffer);
  })();
  return expressionRuntimePromise;
}

async function evaluateMessage(message: EvaluateMessage) {
  try {
    const runtime = await loadRuntime();
    if (!webGpuEvaluatorPromise) {
      webGpuEvaluatorPromise = WebGpuIdentityEvaluator.create(runtime).catch(() => null);
    }
    const webGpuEvaluator = await webGpuEvaluatorPromise;
    if (webGpuEvaluator) {
      try {
        const positions = await webGpuEvaluator.evaluate(message.weights);
        self.postMessage({ type: "result", id: message.id, positions, backend: "webgpu" }, [positions.buffer]);
        return;
      } catch {
        webGpuEvaluator.dispose();
        webGpuEvaluatorPromise = Promise.resolve(null);
      }
    }
    const positions = evaluateWebIdentity(runtime, message.weights);
    self.postMessage({ type: "result", id: message.id, positions, backend: "cpu" }, [positions.buffer]);
  } catch (error) {
    runtimePromise = null;
    self.postMessage({ type: "error", id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
}

async function evaluateExpressionMessage(message: EvaluateExpressionMessage) {
  try {
    const [identityRuntime, expressionRuntime] = await Promise.all([loadRuntime(), loadExpressionRuntime()]);
    let basePositions: Float32Array;
    if (!webGpuEvaluatorPromise) webGpuEvaluatorPromise = WebGpuIdentityEvaluator.create(identityRuntime).catch(() => null);
    const identityGpu = await webGpuEvaluatorPromise;
    if (identityGpu) {
      try {
        basePositions = await identityGpu.evaluate(message.identityWeights);
      } catch {
        identityGpu.dispose();
        webGpuEvaluatorPromise = Promise.resolve(null);
        basePositions = evaluateWebIdentity(identityRuntime, message.identityWeights);
      }
    } else {
      basePositions = evaluateWebIdentity(identityRuntime, message.identityWeights);
    }

    if (!webGpuExpressionPromise) webGpuExpressionPromise = WebGpuExpressionEvaluator.create(expressionRuntime).catch(() => null);
    const expressionGpu = await webGpuExpressionPromise;
    if (expressionGpu) {
      try {
        const positions = await expressionGpu.evaluate(basePositions, message.expressionWeights);
        self.postMessage({ type: "result", id: message.id, positions, backend: "webgpu" }, [positions.buffer]);
        return;
      } catch {
        expressionGpu.dispose();
        webGpuExpressionPromise = Promise.resolve(null);
      }
    }
    const positions = addWebExpression(expressionRuntime, basePositions, message.expressionWeights);
    self.postMessage({ type: "result", id: message.id, positions, backend: "cpu" }, [positions.buffer]);
  } catch (error) {
    expressionRuntimePromise = null;
    self.postMessage({ type: "error", id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = (event: MessageEvent<EvaluateMessage | EvaluateExpressionMessage>) => {
  const message = event.data;
  if (message.type === "evaluate") evaluationQueue = evaluationQueue.then(() => evaluateMessage(message));
  else if (message.type === "evaluate-expression") evaluationQueue = evaluationQueue.then(() => evaluateExpressionMessage(message));
};

export {};
