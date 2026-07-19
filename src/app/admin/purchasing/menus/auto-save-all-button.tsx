"use client";

/**
 * MB-1 — shared BACKGROUND "Save all to library" button for the Cultivera and
 * GrowFlow menu browsers.
 *
 * The bulk-save server action is chunked (a fixed number of downloads per call
 * so a request can't time out). This island fires that action in a LOOP: after
 * each batch it reads the server-reported `remaining` and, while there's more
 * AND the batch made progress, fires the next batch automatically — so ONE
 * click saves an entire 280-item menu without the owner clicking again. It runs
 * in the background: the owner can scroll, filter, and tick items for a PO while
 * it works; the loop only pauses page refreshes until it finishes so the "in
 * library" badges update once at the end (avoids fighting the owner's scroll).
 *
 * The loop can never spin forever — decideAutosaveNext() stops it the moment a
 * batch makes no progress (e.g. the only items left have dead image URLs) or
 * reports an error.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import {
  decideAutosaveNext,
  autosaveProgressPct,
  autosaveStatusLabel,
} from "@/lib/purchasing/media-autosave-core";

type BulkAction = (formData: FormData) => Promise<{
  ok: boolean;
  message: string;
  remaining?: number;
  done?: boolean;
}>;

export function AutoSaveAllButton({
  snapshotId,
  remaining: initialRemaining,
  action,
}: {
  snapshotId: string;
  /** Unsaved assets the server counted at render time (the run total). */
  remaining: number;
  action: BulkAction;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [total] = useState(initialRemaining);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // A ref so an in-flight loop can be told to stop if the component unmounts.
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const run = useCallback(async () => {
    cancelledRef.current = false;
    setRunning(true);
    setFailed(false);

    let prevRemaining = Number.POSITIVE_INFINITY;
    // Guard against runaway loops even beyond the stall check.
    const maxBatches = 1000;

    for (let i = 0; i < maxBatches; i += 1) {
      if (cancelledRef.current) break;

      const fd = new FormData();
      fd.set("snapshot_id", snapshotId);
      let res: Awaited<ReturnType<BulkAction>>;
      try {
        res = await action(fd);
      } catch {
        setFailed(true);
        setStatus("Stopped on a network error — try again.");
        setRunning(false);
        router.refresh();
        return;
      }

      const rem = typeof res.remaining === "number" ? res.remaining : 0;
      setRemaining(rem);
      const decision = decideAutosaveNext({ ok: res.ok, remaining: rem }, prevRemaining);

      if (decision.continue) {
        setStatus(autosaveStatusLabel({ phase: "running", total, remaining: rem }));
        prevRemaining = rem;
        continue;
      }

      // Terminal states.
      if (decision.reason === "done") {
        setStatus(autosaveStatusLabel({ phase: "done", total, remaining: 0 }));
      } else if (decision.reason === "stalled") {
        setStatus(autosaveStatusLabel({ phase: "stalled", total, remaining: rem }));
      } else {
        setFailed(true);
        setStatus(
          res.message || autosaveStatusLabel({ phase: "error", total, remaining: rem }),
        );
      }
      break;
    }

    setRunning(false);
    // One refresh at the end so the per-item "in library" badges update without
    // yanking the page around mid-run.
    router.refresh();
  }, [action, snapshotId, total, router]);

  const pct = autosaveProgressPct(total, remaining);
  const allDone = total === 0;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        type="button"
        variant="save"
        size="sm"
        disabled={running || allDone}
        onClick={run}
      >
        {running
          ? `Saving… ${pct}%`
          : allDone
            ? "All media saved"
            : `Save all to library (${total})`}
      </Button>
      {running && (
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--admin-gold,#b8860b)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {status && (
        <span
          className={`max-w-xs text-right text-[0.65rem] leading-snug ${
            failed ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-muted)]"
          }`}
        >
          {status}
        </span>
      )}
    </div>
  );
}
