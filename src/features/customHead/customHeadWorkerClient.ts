import type { CustomHeadFitResult, CustomHeadProgress } from "./customHeadTypes";

type PendingFit = {
  resolve: (result: CustomHeadFitResult) => void;
  reject: (error: Error) => void;
  onProgress: (progress: CustomHeadProgress) => void;
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
        return;
      }
      this.pending.delete(message.id);
      if (message.type === "result") request.resolve(message.result);
      else request.reject(new Error(message.message));
    };
    this.worker.onerror = (event) => this.rejectAll(new Error(event.message || "The custom-head worker stopped unexpectedly."));
    this.worker.onmessageerror = () => this.rejectAll(new Error("The custom-head worker returned unreadable data."));
  }

  fit(
    front: ImageBitmap,
    profile: ImageBitmap,
    currentWeights: Float32Array | null,
    strength: number,
    onProgress: (progress: CustomHeadProgress) => void,
  ) {
    if (this.disposed) {
      front.close();
      profile.close();
      return Promise.reject(new Error("The custom-head worker has already been closed."));
    }
    const id = ++this.nextId;
    const transferableWeights = currentWeights?.slice() ?? null;
    return new Promise<CustomHeadFitResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      const transfer: Transferable[] = [front, profile];
      if (transferableWeights) transfer.push(transferableWeights.buffer);
      this.worker.postMessage({
        type: "fit",
        id,
        front,
        profile,
        currentWeights: transferableWeights,
        strength,
      }, transfer);
    });
  }

  private rejectAll(error: Error) {
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    this.rejectAll(new Error("The custom-head worker was closed."));
  }
}

