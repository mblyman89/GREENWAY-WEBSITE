"use client";

import { Button } from "@/components/admin/ui";

/** Tiny on-screen (non-printed) Print button for the SKU label page. */
export function LabelPrintControls() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div>
        <h1 className="text-sm font-bold text-[var(--admin-text)]">Print SKU label</h1>
        <p className="text-xs text-[var(--admin-text-faint)]">
          Press Print, choose your label printer, confirm the label size.
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={() => window.print()}>
        🖨 Print label
      </Button>
    </div>
  );
}
