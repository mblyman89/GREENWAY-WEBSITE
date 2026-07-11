"use client";
/**
 * src/app/admin/discovery/ccrs/CcrsZipUploader.tsx
 *
 * Task H (S3): the ZERO-TOUCH monthly-extract uploader. The owner drags the
 * ONE big zip from the WSLCB public-records delivery straight onto this card;
 * the transformer (S1 zip reader + parser, S2 aggregator) runs IN THE BROWSER
 * over the local file — the ~1 GB raw never leaves the machine (Vercel body
 * limits forbid it anyway) — and only the compact rollup JSON (~1 MB) is
 * posted to the server action.
 *
 * Flow: drop zip → read central directory → process inner table zips in
 * dependency order (Licensee → Strains → Product → Inventory → SaleHeader →
 * SalesDetail) → aggregate → POST rollups → dataset flips uploading → ready.
 * Errors are surfaced verbatim, never force-fit (NEVER GUESS).
 *
 * S14: the crunch itself lives in the DOM-free runner
 * (`ccrs-extract/run.ts`) and executes inside a WEB WORKER
 * (`transformer.worker.ts`) so the tab never freezes and the browser never
 * shows the "page unresponsive" prompt mid-crunch. If worker construction
 * fails (ancient browser, blocked workers), the SAME runner executes on the
 * main thread — identical results, just the old responsiveness.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  runCcrsExtract,
  type ExtractProgress,
  type ExtractRunOutcome,
} from "@/lib/discovery/ccrs-extract/run";
import type {
  TransformerWorkerRequest,
  TransformerWorkerResponse,
} from "@/lib/discovery/ccrs-extract/transformer.worker";
import { saveMonthlyRollupsAction } from "../actions";

type Phase = "idle" | "reading" | "aggregating" | "saving" | "done" | "error";

type Progress = {
  phase: Phase;
  fileLabel: string;
  filesDone: number;
  filesTotal: number;
  rows: number;
  message: string | null;
};

const IDLE: Progress = { phase: "idle", fileLabel: "", filesDone: 0, filesTotal: 0, rows: 0, message: null };

/**
 * S14: run the crunch in a Web Worker; fall back to the main thread when the
 * worker can't even be constructed. Worker errors are relayed verbatim and
 * REJECT (they are real crunch failures, e.g. "not the delivery zip" — the
 * main thread would have thrown the identical message; retrying there would
 * just freeze the tab for minutes before failing the same way).
 */
function runInWorker(
  file: File,
  selfLicenseNumber: string,
  trackedLicenseNumbers: string[],
  onProgress: (p: ExtractProgress) => void,
): Promise<ExtractRunOutcome> | null {
  let worker: Worker;
  try {
    // Relative URL (not the @/ alias): the documented pattern the bundler
    // statically analyzes to emit the worker chunk.
    worker = new Worker(
      new URL("../../../../lib/discovery/ccrs-extract/transformer.worker.ts", import.meta.url),
    );
  } catch {
    return null; // construction failed → caller uses the main-thread fallback
  }
  return new Promise<ExtractRunOutcome>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent<TransformerWorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === "progress") {
        onProgress(msg.progress);
      } else if (msg.type === "done") {
        worker.terminate();
        resolve({ result: msg.result, rows: msg.rows, filesTotal: msg.filesTotal });
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (ev: ErrorEvent) => {
      worker.terminate();
      reject(new Error(ev.message || "The background transformer crashed."));
    };
    const req: TransformerWorkerRequest = { type: "run", file, selfLicenseNumber, trackedLicenseNumbers };
    worker.postMessage(req);
  });
}

export function CcrsZipUploader({
  selfLicenseNumber,
  trackedLicenseNumbers,
}: {
  selfLicenseNumber: string;
  trackedLicenseNumbers: string[];
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress>(IDLE);
  const [dragOver, setDragOver] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(
    async (file: File) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        setProgress({ ...IDLE, phase: "reading", fileLabel: file.name, message: "Reading zip directory…" });

        // S14: identical crunch (ccrs-extract/run.ts), preferably off-thread.
        const onExtractProgress = (p: ExtractProgress) => {
          setProgress({
            phase: p.phase,
            fileLabel: file.name,
            filesDone: p.filesDone,
            filesTotal: p.filesTotal,
            rows: p.rows,
            message: p.currentFile ? `Processing ${p.currentFile}…` : null,
          });
        };
        const workerRun = runInWorker(file, selfLicenseNumber, trackedLicenseNumbers, onExtractProgress);
        const outcome = await (workerRun ??
          // Worker couldn't be constructed → same runner on the main thread
          // (the pre-S14 behavior: correct results, tab busy while crunching).
          runCcrsExtract(file, { selfLicenseNumber, trackedLicenseNumbers, onProgress: onExtractProgress }));

        const { result, rows, filesTotal } = outcome;
        setProgress((p) => ({ ...p, phase: "saving", message: "Saving rollups…" }));
        const saved = await saveMonthlyRollupsAction({
          fileName: file.name,
          result: JSON.parse(JSON.stringify(result)),
        });
        if (!saved.ok) throw new Error(saved.error ?? "Saving the rollups failed.");

        setProgress({
          phase: "done",
          fileLabel: file.name,
          filesDone: filesTotal,
          filesTotal,
          rows,
          message: `Saved ${saved.benchmarks?.toLocaleString()} benchmark rows, ${saved.competitors} competitor profiles and ${saved.signals} market signals for ${result.periodStart ?? "?"} → ${result.periodEnd ?? "?"}.`,
        });
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Processing failed.";
        setProgress((p) => ({ ...p, phase: "error", message }));
      } finally {
        busyRef.current = false;
      }
    },
    [router, selfLicenseNumber, trackedLicenseNumbers],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void run(file);
    },
    [run],
  );

  const busy = progress.phase === "reading" || progress.phase === "aggregating" || progress.phase === "saving";
  const pct =
    progress.filesTotal > 0 ? Math.round((progress.filesDone / progress.filesTotal) * 100) : 0;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop the monthly CCRS zip here or click to choose it"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!busy && (e.key === "Enter" || e.key === " ")) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--admin-radius-lg)] border-2 border-dashed p-6 text-center transition-colors ${
          dragOver
            ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]"
            : "border-[var(--admin-border)] bg-[var(--admin-surface-2)] hover:border-[var(--admin-accent)]/60"
        } ${busy ? "pointer-events-none opacity-90" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void run(file);
            e.target.value = "";
          }}
        />
        {progress.phase === "idle" ? (
          <>
            <div className="text-sm font-semibold text-[var(--admin-text)]">
              Drag &amp; drop the monthly CCRS zip here
            </div>
            <div className="text-xs text-[var(--admin-text-muted)]">
              The one big zip from the WSLCB delivery — nested zips and all. It&apos;s processed right
              here in your browser (the raw file never uploads); only the small market rollups are
              saved. Takes a few minutes for a full month.
            </div>
          </>
        ) : null}
        {busy ? (
          <div className="w-full max-w-md space-y-2">
            <div className="text-sm font-semibold text-[var(--admin-text)]">
              {progress.phase === "reading"
                ? "Reading zip…"
                : progress.phase === "saving"
                  ? "Saving rollups…"
                  : `Crunching ${progress.fileLabel}`}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--admin-surface)]">
              <div
                className="h-full rounded-full bg-[var(--admin-accent)] transition-all"
                style={{ width: `${progress.phase === "saving" ? 100 : pct}%` }}
              />
            </div>
            <div className="text-xs text-[var(--admin-text-muted)]">
              {progress.filesTotal > 0
                ? `${progress.filesDone}/${progress.filesTotal} table files · ${progress.rows.toLocaleString()} rows scanned`
                : null}
              {progress.message ? ` · ${progress.message}` : null}
            </div>
            <div className="text-[11px] text-[var(--admin-text-muted)]">
              Keep this tab open — closing it stops the crunch (nothing partial is saved).
            </div>
          </div>
        ) : null}
        {progress.phase === "done" ? (
          <div className="space-y-1">
            <div className="text-sm font-semibold text-[var(--admin-accent)]">Done ✓</div>
            <div className="text-xs text-[var(--admin-text)]">{progress.message}</div>
            <div className="text-[11px] text-[var(--admin-text-muted)]">
              Drop next month&apos;s zip here whenever it arrives.
            </div>
          </div>
        ) : null}
        {progress.phase === "error" ? (
          <div className="space-y-1">
            <div className="text-sm font-semibold text-[var(--admin-danger)]">Something went wrong</div>
            <div className="text-xs text-[var(--admin-text)]">{progress.message}</div>
            <div className="text-[11px] text-[var(--admin-text-muted)]">
              Nothing was saved. Fix the file (it should be the original monthly delivery zip) and
              drop it again.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

