import { assetUrl } from "./lib/assets";
import { evaluateWebIdentity, parseWebIdentityRuntime, type WebIdentityRuntime } from "./lib/webIdentityRuntime";

type EvaluateMessage = { type: "evaluate"; id: number; weights: Float32Array };

let runtimePromise: Promise<WebIdentityRuntime> | null = null;

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

self.onmessage = async (event: MessageEvent<EvaluateMessage>) => {
  const message = event.data;
  if (message.type !== "evaluate") return;
  try {
    const runtime = await loadRuntime();
    const positions = evaluateWebIdentity(runtime, message.weights);
    self.postMessage({ type: "result", id: message.id, positions }, [positions.buffer]);
  } catch (error) {
    runtimePromise = null;
    self.postMessage({ type: "error", id: message.id, message: error instanceof Error ? error.message : String(error) });
  }
};

export {};
