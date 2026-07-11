/**
 * src/lib/discovery/ccrs-extract/transformer.worker.ts
 *
 * Web Worker shell around the pure runner (Task H, S14). Moves the ~1 GB
 * monthly-extract crunch off the main thread so the tab stays responsive and
 * the browser never shows the "page unresponsive" prompt mid-crunch.
 *
 * Thin by design: ALL crunch logic lives in `run.ts` (DOM-free, tested under
 * Node); this file only relays messages. Errors cross the boundary verbatim
 * (NEVER GUESS) — the uploader surfaces them exactly as the main-thread path
 * would have.
 *
 * Protocol (all payloads structured-clonable):
 *   in : { type: "run", file: File, selfLicenseNumber: string,
 *          trackedLicenseNumbers: string[] }
 *   out: { type: "progress", progress: ExtractProgress }
 *      | { type: "done", result: AggregationResult, rows: number,
 *          filesTotal: number }
 *      | { type: "error", message: string }
 */
import { runCcrsExtract, type ExtractProgress } from "./run";
import type { AggregationResult } from "./aggregate";

export type TransformerWorkerRequest = {
  type: "run";
  file: File;
  selfLicenseNumber: string;
  trackedLicenseNumbers: string[];
};

export type TransformerWorkerResponse =
  | { type: "progress"; progress: ExtractProgress }
  | { type: "done"; result: AggregationResult; rows: number; filesTotal: number }
  | { type: "error"; message: string };

// The project tsconfig targets the DOM lib (this is a Next.js app), so type
// the worker global surface explicitly instead of assuming `self` is a Window.
const ctx = self as unknown as {
  postMessage(message: TransformerWorkerResponse): void;
  onmessage: ((ev: MessageEvent<TransformerWorkerRequest>) => void) | null;
};

ctx.onmessage = (ev: MessageEvent<TransformerWorkerRequest>) => {
  const msg = ev.data;
  if (!msg || msg.type !== "run") return;
  void (async () => {
    try {
      const outcome = await runCcrsExtract(msg.file, {
        selfLicenseNumber: msg.selfLicenseNumber,
        trackedLicenseNumbers: msg.trackedLicenseNumbers,
        onProgress: (progress) => ctx.postMessage({ type: "progress", progress }),
      });
      ctx.postMessage({
        type: "done",
        result: outcome.result,
        rows: outcome.rows,
        filesTotal: outcome.filesTotal,
      });
    } catch (err) {
      ctx.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : "Processing failed.",
      });
    }
  })();
};
