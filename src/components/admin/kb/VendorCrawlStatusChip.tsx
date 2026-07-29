"use client";

/**
 * src/components/admin/kb/VendorCrawlStatusChip.tsx — SLICE 89.
 *
 * Live crawl-status chip on the vendor detail page: while a crawl that
 * targets THIS vendor is queued/running it shows live progress (pages read so
 * far), and the moment the crawler finishes it LIGHTS UP green with the draft
 * count — plus a refresh link, because the drafts were written server-side
 * after the page rendered. State lives on the crawler worker (same job list
 * the Harvest Console polls), so leaving and returning to the page shows the
 * same status. Renders NOTHING when no job has ever touched this vendor.
 *
 * Polls the staff-only /api/admin/harvest proxy every 4 s while the job is
 * moving, backs off to 30 s once it's finished, and stops entirely after the
 * finished state has been shown (one final render is enough — the chip is a
 * doorway, not a dashboard).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { CrawlJob, VendorCrawlSummary } from "@/lib/kb/vendor-crawl-status-core";
import { summarizeVendorCrawl } from "@/lib/kb/vendor-crawl-status-core";

const ACTIVE_POLL_MS = 4_000;
const IDLE_POLL_MS = 30_000;

const GLOW_STYLE: Record<VendorCrawlSummary["glow"], string> = {
  waiting: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 text-[var(--admin-gold)]",
  running: "border-[var(--admin-purple)]/50 bg-[var(--admin-purple)]/10 text-[var(--admin-purple)] animate-pulse",
  lit: "border-[var(--admin-accent)]/60 bg-[var(--admin-accent)]/15 text-[var(--admin-accent)] shadow-[0_0_12px_var(--admin-accent)]",
  failed: "border-red-400/50 bg-red-400/10 text-red-300",
};

const GLOW_ICON: Record<VendorCrawlSummary["glow"], string> = {
  waiting: "⏳",
  running: "⛏",
  lit: "✅",
  failed: "⚠",
};

export function VendorCrawlStatusChip({ vendorId }: { vendorId: string }) {
  const [summary, setSummary] = useState<VendorCrawlSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      let next = IDLE_POLL_MS;
      let finished = false;
      try {
        const res = await fetch("/api/admin/harvest", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { jobs?: CrawlJob[] };
          const s = summarizeVendorCrawl(data.jobs ?? [], vendorId);
          if (!cancelled) setSummary(s);
          if (s?.active) next = ACTIVE_POLL_MS;
          // Once the crawl has finished (lit/failed) the state is stable —
          // one more render is all we need; stop polling.
          finished = s !== null && !s.active;
        }
      } catch {
        /* keep the last known state; try again on the idle cadence */
      }
      if (!cancelled && !finished) {
        timer = setTimeout(() => void poll(), next);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [vendorId]);

  if (!summary) return null;

  return (
    <span
      className={`inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold ${GLOW_STYLE[summary.glow]}`}
      title={summary.jobLabel || undefined}
      data-glow={summary.glow}
    >
      <span>{GLOW_ICON[summary.glow]}</span>
      <span className="truncate">{summary.message}</span>
      {summary.glow === "lit" && (
        /* plain <a> on purpose: a Next soft navigation to the SAME route would
           not re-render the server page, so the fresh drafts wouldn't appear —
           a full reload guarantees they do. */
        <a href={`/admin/vendors/${vendorId}#ai-drafts`} className="underline hover:text-white">
          Refresh to see the drafts ↻
        </a>
      )}
      <Link href="/admin/knowledge-base/harvest" className="text-white/50 underline hover:text-white">
        Harvest Console →
      </Link>
    </span>
  );
}
