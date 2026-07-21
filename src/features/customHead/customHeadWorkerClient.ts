import type { CustomHeadFitResult, CustomHeadProgress } from "./customHeadTypes";

type PendingFit = {
  resolve: (result: CustomHeadFitResult) => void;
  reject: (error: Error) => void;
  onProgress: (progress: CustomHeadProgress) => void;
  timeout: number;
};

type WorkerMessage =
  | { type: "progress"; id: number; progress: CustomHeadProgress }
  | { type: "result"; id: number; result: CustomHeadFitResult }
  | { type: "error"; id: number; message: string };

export class CustomHeadWorkerClient {
  private readonly worker = new Worker(new URL("./customHead.worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, PendingFit>();
  private nextId = 0;
  private disposed = false;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      const request = this.pending.get(message.id);
      if (!request) return;
      if (message.type === "progress") {
        request.onProgress(message.progress);
        this.armTimeout(message.id);
        return;
      }
      this.pending.delete(message.id);
      window.clearTimeout(request.timeout);
      if (message.type === "result") request.resolve(message.result);
      else request.reject(new Error(message.message));
    };
    this.worker.onerror = (event) => this.fail(new Error(event.message || "The custom-head worker stopped unexpectedly."));
    this.worker.onmessageerror = () => this.fail(new Error("The custom-head worker returned unreadable data."));
  }

  fit(
    front: ImageBitmap,
    profile: ImageBitmap | null,
    currentWeights: Float32Array | null,
    strength: number,
    onProgress: (progress: CustomHeadProgress) => void,
  ) {
    if (this.disposed) {
      front.close();
      profile?.close();
      return Promise.reject(new Error("The custom-head worker has already been closed."));
    }
    const id = ++this.nextId;
    const transferableWeights = currentWeights?.slice() ?? null;
    return new Promise<CustomHeadFitResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress, timeout: 0 });
      this.armTimeout(id);
      try {
        const transfer: Transferable[] = [front];
        if (profile) transfer.push(profile);
        if (transferableWeights) transfer.push(transferableWeights.buffer);
        this.worker.postMessage({
          type: "fit",
          id,
          front,
          profile,
          currentWeights: transferableWeights,
          strength,
        }, transfer);
      } catch (error) {
        try { front.close(); } catch { /* already transferred */ }
        try { profile?.close(); } catch { /* already transferred */ }
        const request = this.pending.get(id);
        if (request) window.clearTimeout(request.timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private armTimeout(id: number) {
    const request = this.pending.get(id);
    if (!request) return;
    window.clearTimeout(request.timeout);
    request.timeout = window.setTimeout(() => {
      this.fail(new Error("Custom-head analysis stopped responding. The worker was restarted; press Fit to retry."));
    }, 180_000);
  }

  private fail(error: Error) {
    if (!this.disposed) {
      this.disposed = true;
      this.worker.terminate();
    }
    this.rejectAll(error);
  }

  private rejectAll(error: Error) {
    this.pending.forEach(({ reject, timeout }) => {
      window.clearTimeout(timeout);
      reject(error);
    });
    this.pending.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.fail(new Error("The custom-head worker was closed."));
  }
}
