"use client";

/**
 * ManifestLotDisposition — per-line Accept / Reject controls for a staged
 * manifest, with a reason dropdown that appears when Reject is chosen.
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

  // Pending: show Accept + Reject; Reject expands the reason picker.
  if (mode === "rejecting") {
    return (
      <form action={rejectBound} className="flex flex-col gap-2">
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
          <Button type="submit" variant="subtle" size="sm">
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

  return (
    <div className="flex items-center gap-2">
      <form action={acceptBound} className="inline">
        <Button type="submit" variant="save" size="sm">
          ✓ Accept
        </Button>
      </form>
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
