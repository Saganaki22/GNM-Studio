type WorkerResult =
  | { type: "result"; id: number; positions: Float32Array; backend: "webgpu" | "cpu" }
  | { type: "error"; id: number; message: string };

export type WebIdentityEvaluation = {
  positions: Float32Array;
  backend: "webgpu" | "cpu";
};

export class WebIdentityEvaluator {
  private readonly worker = new Worker(new URL("../identity.worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, { resolve: (evaluation: WebIdentityEvaluation) => void; reject: (error: Error) => void }>();
  private nextId = 0;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      const result = event.data;
      const request = this.pending.get(result.id);
      if (!request) return;
      this.pending.delete(result.id);
      if (result.type === "result") request.resolve({ positions: result.positions, backend: result.backend });
      else request.reject(new Error(result.message));
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "The web identity worker stopped unexpectedly.");
      this.pending.forEach(({ reject }) => reject(error));
      this.pending.clear();
    };
  }

  evaluate(weights: Float32Array) {
    const id = ++this.nextId;
    const transferableWeights = weights.slice();
    return new Promise<WebIdentityEvaluation>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "evaluate", id, weights: transferableWeights }, [transferableWeights.buffer]);
    });
  }

  evaluateExpression(identityWeights: Float32Array, expressionWeights: Float32Array) {
    const id = ++this.nextId;
    const transferableIdentity = identityWeights.slice();
    const transferableExpression = expressionWeights.slice();
    return new Promise<WebIdentityEvaluation>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(
        { type: "evaluate-expression", id, identityWeights: transferableIdentity, expressionWeights: transferableExpression },
        [transferableIdentity.buffer, transferableExpression.buffer],
      );
    });
  }

  dispose() {
    this.worker.terminate();
    const error = new Error("The web identity evaluator was closed.");
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
  }
}
