type WorkerResult =
  | { type: "result"; id: number; positions: Float32Array }
  | { type: "error"; id: number; message: string };

export class WebIdentityEvaluator {
  private readonly worker = new Worker(new URL("../identity.worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, { resolve: (positions: Float32Array) => void; reject: (error: Error) => void }>();
  private nextId = 0;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      const result = event.data;
      const request = this.pending.get(result.id);
      if (!request) return;
      this.pending.delete(result.id);
      if (result.type === "result") request.resolve(result.positions);
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
    return new Promise<Float32Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "evaluate", id, weights: transferableWeights }, [transferableWeights.buffer]);
    });
  }

  dispose() {
    this.worker.terminate();
    const error = new Error("The web identity evaluator was closed.");
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
  }
}
