"use client";

/**
 * ManifestLotDisposition — the per-line Reject control for a staged manifest,
 * with a reason dropdown that appears when Reject is chosen. R31: there is no
 * per-line Accept button; an undecided line is accepted by Finalize, so it
 * shows a quiet "Will accept" chip. A rejected line keeps "accept instead"
 * (the undo), and a line explicitly accepted earlier keeps "reject instead".
 *
 * Grounded in docs/ccrs-rejection-and-returns.md: rejecting = refuse-at-dock.
 * We record the reason locally and NEVER destroy or file anything with CCRS.
 */

import { useState } from "react";
import { Button, Select, Input } from "@/components/admin/ui";
import {
  REJECT_REASON_CODES,
  REJECT_REASON_LABELS,
  type RejectReasonCode,
} from "@/lib/inventory/intake-disposition-core";

type Props = {
  manifestId: string;
  lotId: string;
  disposition: string | null;
  rejectReason: string | null;
  acceptAction: (
    manifestId: string,
    lotId: string,
    disposition: "accepted" | "rejected_at_dock",
    formData: FormData,
  ) => Promise<void>;
};

export function ManifestLotDisposition({
  manifestId,
  lotId,
  disposition,
  rejectReason,
  acceptAction,
}: Props) {
  const [mode, setMode] = useState<"idle" | "rejecting">("idle");
  const [reasonCode, setReasonCode] = useState<RejectReasonCode>("short_shipment");

  const acceptBound = acceptAction.bind(null, manifestId, lotId, "accepted");
  const rejectBound = acceptAction.bind(null, manifestId, lotId, "rejected_at_dock");

  // Slice 81b guard-rail: reality is refuse-at-dock, never accept-then-reject.
  // When a line is ALREADY marked accepted and the intaker switches to reject,
  // surface a warning so they don't accept product then reject/return it later.
  const wasAccepted = disposition === "accepted";

  if (disposition === "accepted" && mode !== "rejecting") {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="rounded bg-[var(--admin-accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--admin-accent)]">
          ✓ Accepted
        </span>
        <button
          type="button"
          onClick={() => setMode("rejecting")}
          className="text-xs text-[var(--admin-text-faint)] underline hover:text-[var(--admin-danger)]"
        >
          reject instead
        </button>
      </span>
    );
  }

  if (disposition === "rejected_at_dock" && mode !== "rejecting") {
    return (
      <span className="inline-flex flex-col gap-1">
        <span className="rounded bg-[var(--admin-danger)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--admin-danger)]">
          ✕ Rejected at dock
        </span>
        {rejectReason && (
          <span className="text-[10px] text-[var(--admin-text-faint)]">{rejectReason}</span>
        )}
        <form action={acceptBound} className="inline">
          <button
            type="submit"
            className="text-left text-xs text-[var(--admin-text-faint)] underline hover:text-[var(--admin-accent)]"
          >
            accept instead
          </button>
        </form>
      </span>
    );
  }

  // Rejecting: the reason picker (a reason is required, WAC 314-55-085 records).
  if (mode === "rejecting") {
    return (
      <form action={rejectBound} className="flex flex-col gap-2">
        {wasAccepted && (
          <p className="rounded border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-2 py-1.5 text-[11px] leading-snug text-[var(--admin-orange)]">
            <strong>Heads up:</strong> this line was already marked accepted. Product should be
            refused at the dock <em>before</em> you accept it &mdash; accepting first and rejecting
            later means it briefly entered inventory. Only continue if this is a genuine correction.
          </p>
        )}
        <Select
          name="reason_code"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value as RejectReasonCode)}
        >
          {REJECT_REASON_CODES.map((c) => (
            <option key={c} value={c}>
              {REJECT_REASON_LABELS[c]}
            </option>
          ))}
        </Select>
        {reasonCode === "other" && (
          <Input name="reason_text" placeholder="Explain the reason…" required />
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" variant="neutral" size="sm">
            ✕ Confirm reject
          </Button>
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="text-xs text-[var(--admin-text-faint)] underline"
          >
            cancel
          </button>
        </div>
      </form>
    );
  }

  // R31 — the walk: an untouched line needs NO click. Finalize accepts every
  // line nobody rejected (finalizeManifestDispositions: anything that is not
  // rejected_at_dock is accepted), so the old per-line "Accept" button was a
  // click that changed nothing. The owner: "I don't want to have to push any
  // buttons while I walk the page unless I have to." Only Reject remains.
  return (
    <div className="flex items-center gap-2" data-line-state="will-accept">
      <span
        className="rounded bg-[var(--admin-surface-2)] px-2 py-0.5 text-xs font-semibold text-[var(--admin-text-muted)]"
        title="Nothing to press: Finalize accepts this line unless you reject it."
      >
        Will accept
      </span>
      <button
        type="button"
        onClick={() => setMode("rejecting")}
        className="rounded border border-[var(--admin-border)] px-2 py-1 text-xs text-[var(--admin-text-muted)] hover:border-[var(--admin-danger)] hover:text-[var(--admin-danger)]"
      >
        ✕ Reject
      </button>
    </div>
  );
}
