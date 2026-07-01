"use client";

/**
 * LabelPrintControls — the on-screen (non-printed) header for the 4×6 lot label
 * page: a Print button that opens the browser print dialog, and a link back to
 * the manifest. Kept tiny; the label markup lives in the server page.
 *
 * See docs/rollo-label-printing.md — printing is done from the browser dialog to
 * the Rollo (which appears as a normal AirPrint / Wi-Fi printer).
 */
import Link from "next/link";
import { Button } from "@/components/admin/ui";

export function LabelPrintControls({
  lotId,
  manifestId,
}: {
  lotId: string;
  manifestId: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-bold text-[var(--admin-text)]">Print lot label</h1>
          <p className="text-xs text-[var(--admin-text-faint)]">
            4×6 label for the Rollo. Press Print, choose the Rollo, confirm 4×6.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => window.print()}>
          🖨 Print label
        </Button>
      </div>
      <div className="flex items-center gap-4 text-xs">
        {manifestId ? (
          <Link
            href={`/admin/inventory/intake/${manifestId}`}
            className="text-[var(--admin-text-muted)] underline hover:text-[var(--admin-accent)]"
          >
            ← Back to manifest
          </Link>
        ) : null}
        <Link
          href={`/admin/inventory?lot=${lotId}`}
          className="text-[var(--admin-text-muted)] underline hover:text-[var(--admin-accent)]"
        >
          Inventory list
        </Link>
      </div>
    </div>
  );
}
