"use client";
/**
 * src/app/admin/products/bulk-ai/AcceptAllDescriptions.tsx  (D244 round 6, slice R-18)
 *
 * Owner (verbatim): "I need a way to select many/ all and approve many/ all
 * drafts awaiting my review on the bulk ai draft page in enrichment."
 *
 * One button above the older "Drafts awaiting your review" description cards:
 * accepts every one of them in small chunks, each through the compliance
 * re-scan (a blocked one stays as a card for you). Nothing is published.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { approveDraftsChunkAction } from "./approve-actions";
import { BULK_APPROVE_IDS_CHUNK, addTotals, approveSummary, chunkList, emptyTotals, type ApproveTotals } from "@/lib/enrichment/bulk-approve-core";

export function AcceptAllDescriptions(props: { ids: string[] }) {
  const { ids } = props;
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const go = async () => {
    if (!window.confirm(`Accept all ${ids.length} description draft${ids.length === 1 ? "" : "s"}? Each goes through the compliance re-scan; a blocked one stays for you. Nothing is published.`)) return;
    setRunning(true);
    let t = emptyTotals();
    let done = 0;
    try {
      for (const c of chunkList(ids, BULK_APPROVE_IDS_CHUNK)) {
        setStatus(`Accepting\u2026 ${done} of ${ids.length}`);
        const r: Partial<ApproveTotals> = await approveDraftsChunkAction(c).catch(() => ({ blocked: c.length }));
        t = addTotals(t, r);
        done += c.length;
      }
      setStatus(approveSummary(t));
      router.refresh();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid="accept-all-descriptions"
        onClick={() => void go()}
        disabled={running || ids.length === 0}
        className="rounded-lg bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-40"
      >
        {"\u2705"} Accept all {ids.length} description draft{ids.length === 1 ? "" : "s"}
      </button>
      {status ? (
        <span className="text-xs text-white/70" role="status">
          {status}
        </span>
      ) : null}
    </div>
  );
}
