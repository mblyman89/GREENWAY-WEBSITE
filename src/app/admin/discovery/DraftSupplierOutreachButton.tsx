"use client";

/**
 * DraftSupplierOutreachButton (Task H, S11) — one-click "draft vendor leads"
 * on the Leads page's shared-suppliers card. Calls the server action that
 * upserts DRAFT vendor leads (dedupe_key — re-clicking never duplicates) with
 * grounded outreach notes. Result feedback stays inline and honest: how many
 * NEW drafts were created vs how many suppliers were already in the pipeline.
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { draftSupplierOutreachAction } from "./actions";

export function DraftSupplierOutreachButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const run = () => {
    setMessage(null);
    startTransition(async () => {
      const res = await draftSupplierOutreachAction();
      if (res.ok) {
        const inserted = res.inserted ?? 0;
        const processed = res.processed ?? 0;
        const deduped = processed - inserted;
        setIsError(false);
        setMessage(
          `${inserted} new draft vendor lead${inserted === 1 ? "" : "s"} created` +
            (deduped > 0 ? ` (${deduped} already in your pipeline — skipped).` : "."),
        );
      } else {
        setIsError(true);
        setMessage(res.error ?? "Drafting failed.");
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="neutral" size="sm" onClick={run} disabled={pending}>
        {pending ? "Drafting…" : "Draft vendor leads from these suppliers"}
      </Button>
      {message ? (
        <span
          className={`text-xs ${isError ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-muted)]"}`}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
