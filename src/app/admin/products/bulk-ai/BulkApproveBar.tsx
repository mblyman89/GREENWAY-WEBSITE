"use client";
/**
 * src/app/admin/products/bulk-ai/BulkApproveBar.tsx  (D244 round 4, slice R-12)
 *
 * Owner (verbatim): "to be able to select one or all drafts waiting for me to
 * approve. I want this page to auto approve the ones that are over 80%."
 *
 * The bar above the review grid. Each product and each draft on the grid has
 * a tick box (data-approve-key / data-approve-id). "Select all" ticks every
 * product. "Approve selected" accepts the ticked products (their 80%+ drafts)
 * and the ticked single drafts. "Approve every draft at 80%+" does every
 * product that has one, in one press. The browser sends small chunks one
 * after the next and shows a running total; the page refreshes at the end.
 *
 * D244 R-18 (owner: "I need a way to select many/ all and approve many/ all
 * drafts awaiting my review"): "Approve every draft (any confidence)" reads
 * every product with a pending draft (not only the ones on screen) and accepts
 * them all, still through the compliance re-scan; a potency best guess is
 * never auto-accepted. A Stop button ends it between chunks.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { approveDraftsChunkAction, approveProductsChunkAction } from "./approve-actions";
import { approveEveryDraftChunkAction, listEveryPendingDraftKeyAction } from "./approve-all-actions";
import {
  BULK_APPROVE_CHUNK,
  BULK_APPROVE_IDS_CHUNK,
  addTotals,
  approveProgress,
  approveSummary,
  autoApproveConfirm,
  chunkList,
  draftsNotCovered,
  emptyTotals,
  type ApproveTotals,
} from "@/lib/enrichment/bulk-approve-core";

const KEY_SEL = "input[data-approve-key]";
const ID_SEL = "input[data-approve-id]";

export function BulkApproveBar(props: { autoKeys: string[]; threshold: number; products: number }) {
  const { autoKeys, threshold, products } = props;
  const router = useRouter();
  const cancelled = useRef(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [picked, setPicked] = useState({ keys: 0, ids: 0 });

  useEffect(() => {
    const count = () => setPicked({ keys: document.querySelectorAll(`${KEY_SEL}:checked`).length, ids: document.querySelectorAll(`${ID_SEL}:checked`).length });
    document.addEventListener("change", count);
    count();
    return () => {
      cancelled.current = true;
      document.removeEventListener("change", count);
    };
  }, []);

  const setAll = (on: boolean) => {
    document.querySelectorAll<HTMLInputElement>(KEY_SEL).forEach((b) => {
      b.checked = on;
    });
    if (!on)
      document.querySelectorAll<HTMLInputElement>(ID_SEL).forEach((b) => {
        b.checked = false;
      });
    document.dispatchEvent(new Event("change"));
  };

  const run = async (keys: string[], drafts: string[], every = false) => {
    cancelled.current = false;
    setRunning(true);
    setSummary(null);
    let t = emptyTotals();
    try {
      const keyChunks = chunkList(keys, BULK_APPROVE_CHUNK);
      let done = 0;
      for (const c of keyChunks) {
        if (cancelled.current) break;
        setProgress(approveProgress(done, keys.length));
        const send = every ? approveEveryDraftChunkAction : approveProductsChunkAction;
        t = addTotals(t, await send(c).catch(() => ({ failed: c.length, products: c.length })));
        done += c.length;
      }
      for (const c of chunkList(drafts, BULK_APPROVE_IDS_CHUNK)) {
        if (cancelled.current) break;
        setProgress(`Approving ${drafts.length} single draft${drafts.length === 1 ? "" : "s"}\u2026`);
        const r: Partial<ApproveTotals> = await approveDraftsChunkAction(c).catch(() => ({ blocked: c.length }));
        t = addTotals(t, r);
      }
      setSummary(approveSummary(t));
      setAll(false);
      router.refresh();
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const approveSelected = () => {
    const keys = [...document.querySelectorAll<HTMLInputElement>(`${KEY_SEL}:checked`)].map((b) => b.dataset.approveKey ?? "").filter(Boolean);
    const ids = [...document.querySelectorAll<HTMLInputElement>(`${ID_SEL}:checked`)].map((b) => ({ id: b.dataset.approveId ?? "", key: b.dataset.approveOf ?? "" })).filter((d) => d.id);
    void run(keys, draftsNotCovered(ids, keys));
  };

  const approveEverything = () => {
    if (!window.confirm(autoApproveConfirm(autoKeys.length, threshold))) return;
    void run(autoKeys, []);
  };

  const approveEveryDraft = async () => {
    setRunning(true);
    setSummary(null);
    setProgress("Finding every product with a draft waiting\u2026");
    let keys: string[] = [];
    try {
      keys = await listEveryPendingDraftKeyAction();
    } catch {
      keys = [];
    }
    setRunning(false);
    setProgress(null);
    if (keys.length === 0) {
      setSummary("No drafts are waiting.");
      return;
    }
    const msg = `Accept EVERY waiting draft, at any confidence, on ${keys.length} product${keys.length === 1 ? "" : "s"}? Each one still goes through the compliance re-scan (a flagged one stays for you), and a potency best guess is never auto-accepted. Nothing is published. You can press Stop.`;
    if (!window.confirm(msg)) return;
    await run(keys, [], true);
  };

  return (
    <div className="sticky top-0 z-10 mb-3 space-y-2 rounded-xl border border-[var(--admin-accent)]/30 bg-black/90 p-3 backdrop-blur" data-testid="bulk-approve-bar">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-white/80">
          <input type="checkbox" data-testid="bulk-approve-select-all" disabled={running || products === 0} checked={products > 0 && picked.keys === products} onChange={(e) => setAll(e.target.checked)} className="h-4 w-4" />
          Select all {products} product{products === 1 ? "" : "s"}
        </label>
        <button
          type="button"
          data-testid="bulk-approve-selected"
          onClick={approveSelected}
          disabled={running || picked.keys + picked.ids === 0}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-40"
        >
          Approve selected ({picked.keys} product{picked.keys === 1 ? "" : "s"}
          {picked.ids ? `, ${picked.ids} draft${picked.ids === 1 ? "" : "s"}` : ""})
        </button>
        <button
          type="button"
          data-testid="bulk-approve-all-80"
          onClick={approveEverything}
          disabled={running || autoKeys.length === 0}
          className="rounded-lg bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-40"
        >
          {"\u26a1"} Approve every draft at {threshold}%+ ({autoKeys.length} product{autoKeys.length === 1 ? "" : "s"})
        </button>
        <button
          type="button"
          data-testid="bulk-approve-every"
          onClick={() => void approveEveryDraft()}
          disabled={running}
          className="rounded-lg border border-[var(--admin-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--admin-accent)] hover:bg-[var(--admin-accent)]/10 disabled:opacity-40"
        >
          {"\u2705"} Approve every draft (any confidence, all pages)
        </button>
        {running ? (
          <button type="button" data-testid="bulk-approve-stop" disabled={!running} onClick={() => (cancelled.current = true)} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">
            Stop
          </button>
        ) : null}
        {progress ? <span className="text-xs text-white/70" role="status">{progress}</span> : null}
      </div>
      {summary ? (
        <p className="text-xs text-[var(--admin-accent)]" role="status" data-testid="bulk-approve-summary">
          {summary}
        </p>
      ) : null}
      <p className="text-[0.65rem] text-white/45">
        A ticked product accepts its drafts at {threshold}% or better (best guesses too, flagged for a closer look). A ticked single draft is accepted as it is. Every draft goes through the compliance re-scan; a blocked one stays for you. &ldquo;Approve every draft&rdquo; takes every waiting product (not only this screen) at any confidence, except potency best guesses. Approving never publishes: a product goes live when it gets a photo.
      </p>
    </div>
  );
}
