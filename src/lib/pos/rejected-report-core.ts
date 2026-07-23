/**
 * src/lib/pos/rejected-report-core.ts  (GW-027)
 *
 * PURE policy for the register's REJECTED-ROWS report. "Rejected" means the
 * server refused an event BEFORE it entered the ledger (malformed envelope,
 * foreign device) — the row exists ONLY in that device's local queue, so the
 * back office cannot list the rows themselves. What it CAN know is that they
 * exist: every sync flush now carries a tiny summary ({ count, note }) that
 * the server stamps onto the device row, and the admin pages surface it as
 * "this register has N rejected rows on-device — walk over and review them."
 *
 * This module is used on BOTH sides of the wire:
 *   - the register builds the report from its rejected list;
 *   - the sync route sanitizes whatever arrives before persisting it.
 * One shared policy means the two ends cannot drift.
 *
 * No imports, no server-only — safe for client, server, and tests.
 */

/** Hard cap so a hostile/buggy device can never bloat the device row. */
export const REJECTED_NOTE_MAX_CHARS = 300;

export type RejectedReport = {
  /** How many rejected rows are being held on the device right now. */
  count: number;
  /** Short human summary of the FIRST (oldest) rejected row, or null. */
  note: string | null;
};

/** Minimal shape of an on-device rejected row this module needs. */
export type RejectedRowLike = {
  eventType?: string;
  queuedAt?: string;
  rejectedReason?: string;
};

/**
 * Build the report the register sends with each flush. The note names the
 * oldest row's event type + reason so a manager knows what they will find
 * before walking to the device.
 */
export function buildRejectedReport(rows: RejectedRowLike[]): RejectedReport {
  if (!Array.isArray(rows) || rows.length === 0) return { count: 0, note: null };
  const first = rows[0];
  const type = typeof first.eventType === "string" && first.eventType ? first.eventType : "event";
  const reason =
    typeof first.rejectedReason === "string" && first.rejectedReason.trim()
      ? first.rejectedReason.trim()
      : "no reason recorded";
  const note = clampNote(`oldest: ${type} — ${reason}`);
  return { count: rows.length, note };
}

/**
 * Sanitize a report received over the wire. Returns null when the value is
 * not a usable report (missing, wrong shape) — the caller then leaves the
 * stored report untouched rather than guessing.
 */
export function sanitizeRejectedReport(raw: unknown): RejectedReport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const count = (raw as { count?: unknown }).count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  const bounded = Math.min(Math.floor(count), 9999);
  const noteRaw = (raw as { note?: unknown }).note;
  const note =
    typeof noteRaw === "string" && noteRaw.trim() ? clampNote(noteRaw.trim()) : null;
  // A zero-count report always clears the note — no phantom leftovers.
  return bounded === 0 ? { count: 0, note: null } : { count: bounded, note };
}

function clampNote(note: string): string {
  return note.length > REJECTED_NOTE_MAX_CHARS ? `${note.slice(0, REJECTED_NOTE_MAX_CHARS - 1)}…` : note;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runRejectedReportTests(): void {
  const eq = (got: unknown, want: unknown, label: string) => {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) throw new Error(`rejected-report-core: ${label}: got ${g}, want ${w}`);
  };

  // build: empty and non-array inputs report zero
  eq(buildRejectedReport([]), { count: 0, note: null }, "empty list");
  eq(buildRejectedReport(undefined as unknown as RejectedRowLike[]), { count: 0, note: null }, "non-array");

  // build: names the OLDEST row's type + reason
  eq(
    buildRejectedReport([
      { eventType: "sale.completed", rejectedReason: "Sequence out of range.", queuedAt: "2026-01-01T00:00:00Z" },
      { eventType: "punch.in", rejectedReason: "later row" },
    ]),
    { count: 2, note: "oldest: sale.completed — Sequence out of range." },
    "two rows",
  );

  // build: missing type/reason degrade gracefully
  eq(buildRejectedReport([{}]), { count: 1, note: "oldest: event — no reason recorded" }, "bare row");

  // build: long reasons are clamped with an ellipsis
  const long = buildRejectedReport([{ eventType: "sale.completed", rejectedReason: "x".repeat(500) }]);
  if (long.note === null || long.note.length !== REJECTED_NOTE_MAX_CHARS || !long.note.endsWith("…")) {
    throw new Error("rejected-report-core: long note not clamped");
  }

  // sanitize: happy path passes through
  eq(sanitizeRejectedReport({ count: 3, note: "oldest: sale — bad" }), { count: 3, note: "oldest: sale — bad" }, "sanitize ok");
  // sanitize: zero clears the note
  eq(sanitizeRejectedReport({ count: 0, note: "stale" }), { count: 0, note: null }, "zero clears note");
  // sanitize: garbage shapes are refused (caller keeps stored value)
  eq(sanitizeRejectedReport(null), null, "null refused");
  eq(sanitizeRejectedReport("3"), null, "string refused");
  eq(sanitizeRejectedReport({ count: -1 }), null, "negative refused");
  eq(sanitizeRejectedReport({ count: Number.NaN }), null, "NaN refused");
  eq(sanitizeRejectedReport({ count: "3" }), null, "string count refused");
  // sanitize: fractional + absurd counts are bounded
  eq(sanitizeRejectedReport({ count: 2.9 }), { count: 2, note: null }, "fractional floored");
  eq(sanitizeRejectedReport({ count: 1e9, note: "n" }), { count: 9999, note: "n" }, "count capped");
  // sanitize: blank note becomes null
  eq(sanitizeRejectedReport({ count: 1, note: "   " }), { count: 1, note: null }, "blank note null");
}
