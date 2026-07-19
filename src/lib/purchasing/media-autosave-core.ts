/**
 * src/lib/purchasing/media-autosave-core.ts
 *
 * MB-1 — PURE helpers for the BACKGROUND auto-save runner used by both the
 * Cultivera and GrowFlow menu "Save all to library" buttons. No I/O, no React;
 * self-tested in the pure runner and mirrored in vitest.
 *
 * WHY: the bulk-save server action is CHUNKED (BULK_MEDIA_LIMIT downloads per
 * call so one request can't blow the serverless timeout). The owner doesn't
 * want to click it over and over for a 280-item menu — they want ONE click that
 * keeps going in the background until every asset is saved, while they keep
 * working. The client island drives that loop; this module holds the pure
 * decision + display logic so the loop can NEVER spin forever (it stops the
 * moment a batch makes no progress) and the progress copy stays testable.
 */

/** One batch's outcome, as the client sees it from the server action. */
export type AutosaveBatch = {
  ok: boolean;
  /** Unsaved assets left AFTER this batch (server-counted). */
  remaining: number;
};

export type AutosaveDecision = {
  /** Whether the client should fire another batch. */
  continue: boolean;
  /** Why it stopped (for the inline status), or "" while continuing. */
  reason: "" | "done" | "stalled" | "error";
};

/**
 * Decide whether the auto-loop should run another batch.
 *
 *   • Stop with "error"   — the batch reported ok:false (a real failure).
 *   • Stop with "done"    — nothing remains (remaining <= 0).
 *   • Stop with "stalled" — remaining did NOT decrease vs. the previous batch
 *                           (e.g. every item left is a dead URL) — prevents an
 *                           infinite loop.
 *   • Otherwise continue.
 *
 * `prevRemaining` is the remaining count from BEFORE this batch (Infinity on
 * the first batch so any finite result counts as progress).
 */
export function decideAutosaveNext(batch: AutosaveBatch, prevRemaining: number): AutosaveDecision {
  if (!batch.ok) return { continue: false, reason: "error" };
  if (batch.remaining <= 0) return { continue: false, reason: "done" };
  if (batch.remaining >= prevRemaining) return { continue: false, reason: "stalled" };
  return { continue: true, reason: "" };
}

/** Percent complete (0–100, integer) given total-at-start and remaining now. */
export function autosaveProgressPct(total: number, remaining: number): number {
  if (total <= 0) return 100;
  const clampedRemaining = Math.max(0, Math.min(remaining, total));
  const done = total - clampedRemaining;
  return Math.round((done / total) * 100);
}

/**
 * Live status line for the button while/after the background run.
 *   running: "Saving in the background… 120 of 237 done (49%)"
 *   done:    "All 237 saved to the library."
 *   stalled: "Saved 233 of 237 — 4 couldn't be fetched (skipped)."
 *   error:   "Stopped on an error — 40 of 237 saved. Try again."
 */
export function autosaveStatusLabel(args: {
  phase: "running" | "done" | "stalled" | "error";
  total: number;
  remaining: number;
}): string {
  const { phase, total, remaining } = args;
  const done = Math.max(0, total - Math.max(0, remaining));
  const pct = autosaveProgressPct(total, remaining);
  switch (phase) {
    case "running":
      return `Saving in the background… ${done} of ${total} done (${pct}%)`;
    case "done":
      return `All ${total} saved to the library.`;
    case "stalled":
      return `Saved ${done} of ${total} — ${remaining} couldn't be fetched (skipped).`;
    case "error":
      return `Stopped on an error — ${done} of ${total} saved. Try again.`;
  }
}

/* ------------------------------------------------------------------
 * Self-tests (pure runner)
 * ------------------------------------------------------------------ */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`media-autosave-core self-test failed: ${msg}`);
}

export function __runMediaAutosaveCoreTests(): void {
  let n = 0;
  const ok = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // decideAutosaveNext
  ok(
    decideAutosaveNext({ ok: true, remaining: 100 }, Number.POSITIVE_INFINITY).continue === true,
    "first batch with progress continues",
  );
  ok(
    decideAutosaveNext({ ok: true, remaining: 80 }, 100).continue === true,
    "progress continues",
  );
  const doneD = decideAutosaveNext({ ok: true, remaining: 0 }, 20);
  ok(doneD.continue === false && doneD.reason === "done", "remaining 0 -> done");
  const stalled = decideAutosaveNext({ ok: true, remaining: 4 }, 4);
  ok(stalled.continue === false && stalled.reason === "stalled", "no progress -> stalled");
  const stalledUp = decideAutosaveNext({ ok: true, remaining: 6 }, 4);
  ok(stalledUp.continue === false && stalledUp.reason === "stalled", "went up -> stalled");
  const err = decideAutosaveNext({ ok: false, remaining: 50 }, 100);
  ok(err.continue === false && err.reason === "error", "not-ok -> error");

  // autosaveProgressPct
  ok(autosaveProgressPct(200, 100) === 50, "half done = 50%");
  ok(autosaveProgressPct(237, 0) === 100, "none remaining = 100%");
  ok(autosaveProgressPct(0, 0) === 100, "empty total = 100%");
  ok(autosaveProgressPct(100, 25) === 75, "75% done");
  ok(autosaveProgressPct(100, 150) === 0, "remaining clamped to total");
  ok(autosaveProgressPct(100, -5) === 100, "negative remaining clamped to 0");

  // autosaveStatusLabel
  ok(
    autosaveStatusLabel({ phase: "running", total: 237, remaining: 117 }) ===
      "Saving in the background… 120 of 237 done (51%)",
    "running label",
  );
  ok(
    autosaveStatusLabel({ phase: "done", total: 237, remaining: 0 }) === "All 237 saved to the library.",
    "done label",
  );
  ok(
    autosaveStatusLabel({ phase: "stalled", total: 237, remaining: 4 }) ===
      "Saved 233 of 237 — 4 couldn't be fetched (skipped).",
    "stalled label",
  );
  ok(
    autosaveStatusLabel({ phase: "error", total: 237, remaining: 197 }) ===
      "Stopped on an error — 40 of 237 saved. Try again.",
    "error label",
  );

  console.log(`media-autosave-core: ${n} self-tests passed`);
}
