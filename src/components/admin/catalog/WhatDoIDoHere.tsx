/**
 * src/components/admin/catalog/WhatDoIDoHere.tsx
 *
 * W4 — the shared "What do I do here?" line for intake-pipeline surfaces,
 * visually identical to the one the owner approved on the manifest review
 * screen (GuidedAcceptRibbon). Pure presentation server component — copy and
 * the primary-action decision live in next-action-core.ts (tested).
 *
 * When the stage has a primary action, its button label is echoed as a small
 * gold chip so the reader's eye lands on the ONE button that matters.
 */

import type { NextAction } from "@/lib/catalog/next-action-core";

export function WhatDoIDoHere({ action }: { action: NextAction }) {
  return (
    <p className="rounded-[var(--admin-radius)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]">
      <span className="mr-1.5 font-bold text-[var(--admin-text-muted)]">What do I do here?</span>
      {action.text}
      {action.primaryAction && (
        <span className="ml-2 whitespace-nowrap rounded bg-[var(--admin-gold-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--admin-gold)]">
          → {action.primaryAction}
        </span>
      )}
    </p>
  );
}
