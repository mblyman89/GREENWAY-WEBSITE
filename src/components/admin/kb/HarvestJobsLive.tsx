"use client";

/**
 * src/components/admin/kb/HarvestJobsLive.tsx — Slice H4.
 *
 * Live progress for harvest jobs. Polls the staff-only /api/admin/harvest
 * proxy every 5 s while a job is queued/running (backs off to 30 s when
 * idle). Renders each job with a progress bar, per-state counts, and
 * Cancel / Resume buttons that post to the caller's server actions.
 *
 * Purely additive: if polling fails, the last known state stays on screen
 * with an "updating paused" note.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { chipGlowFor, targetVendorId, type ChipGlow } from "@/lib/kb/vendor-crawl-status-core";

/**
 * A completed target is "jumpable" when it maps to a real vendor page — i.e. an
 * entity_type of "vendor" with a UUID id (lead targets carry a "lead:" prefix
 * and have no vendor page yet).
 */
function jumpableVendorId(t: { entity_type?: string; entity_id?: string }): string | null {
  return targetVendorId(t);
}

/** SLICE 89: how a back-to-vendor button GLOWS through the crawl lifecycle.
 *  waiting = dim gold outline; running = pulsing purple; lit = bright green
 *  glow (the "button lights up when the crawler is done" moment); failed =
 *  red but still clickable. State lives on the worker's job list, so it is
 *  remembered across page leaves for free. */
const VENDOR_BTN_STYLE: Record<ChipGlow, string> = {
  waiting:
    "border-[var(--admin-gold)]/30 text-[var(--admin-gold)]/60 hover:bg-[var(--admin-gold)]/10",
  running:
    "border-[var(--admin-purple)]/50 text-[var(--admin-purple)] animate-pulse hover:bg-[var(--admin-purple)]/10",
  lit:
    "border-[var(--admin-accent)]/70 bg-[var(--admin-accent)]/15 text-[var(--admin-accent)] shadow-[0_0_10px_var(--admin-accent)] hover:bg-[var(--admin-accent)]/25",
  failed: "border-red-400/50 text-red-300 hover:bg-red-400/10",
};

const VENDOR_BTN_ICON: Record<ChipGlow, string> = {
  waiting: "⏳",
  running: "⛏",
  lit: "✅",
  failed: "⚠",
};

const VENDOR_BTN_TITLE: Record<ChipGlow, string> = {
  waiting: "Queued — the crawler hasn't reached this site yet",
  running: "The crawler is reading this site right now",
  lit: "Done — the drafts are waiting on the vendor page",
  failed: "This site failed — open the vendor page to retry or fix the URL",
};

type TargetState = {
  url: string;
  /** C-task: which entity this target maps back to ("vendor" | "brand"), and
      its id — used to render a "Jump to vendor" link on completed targets.
      Lead targets carry an id prefixed "lead:" (no vendor page yet). */
  entity_type?: string;
  entity_id?: string;
  display_name: string;
  status: "pending" | "running" | "done" | "failed";
  pages: number;
  /** C4: discovered pages left unread when the budget ran out (0 = site exhausted). */
  pages_leftover?: number;
  /** C4: one-line completeness verdict ("COMPLETE — …" / "BUDGET REACHED — …"). */
  coverage_assessment?: string;
  /** R1 (resumable crawls): this run CONTINUED a previous budget-cut crawl. */
  resumed?: boolean;
  /** R1: how many crawl runs this site has had (fresh = 1). */
  crawl_runs?: number;
  /** R1: pages read across ALL runs for this site (fresh = this run's pages). */
  total_pages_all_runs?: number;
  drafts_written: number;
  error: string;
};

type Job = {
  id: string;
  label: string;
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
  cancel_requested: boolean;
  created_at: number;
  targets: TargetState[];
  counts: { pending: number; running: number; done: number; failed: number };
  total_targets: number;
  total_drafts_written: number;
  total_products_written?: number;
};

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;

const STATUS_STYLE: Record<Job["status"], string> = {
  queued: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 text-[var(--admin-gold)]",
  running: "border-[var(--admin-purple)]/40 bg-[var(--admin-purple)]/10 text-[var(--admin-purple)]",
  completed: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]",
  cancelled: "border-white/20 bg-white/5 text-white/60",
  failed: "border-red-400/40 bg-red-400/10 text-red-300",
};

/**
 * Which slice of jobs to show:
 *   • "active"  → only queued/running jobs (the live Harvest Console).
 *   • "history" → only finished jobs (completed/cancelled/failed) — the
 *                 separate "Past crawls" tab so the main console stays clean.
 *   • "all"     → everything (previous behaviour; kept for flexibility).
 */
export type HarvestJobsFilter = "active" | "history" | "all";

function isActiveJob(j: Job): boolean {
  return j.status === "queued" || j.status === "running";
}

export function HarvestJobsLive({
  cancelAction,
  resumeAction,
  filter = "all",
}: {
  cancelAction: (formData: FormData) => void | Promise<void>;
  resumeAction: (formData: FormData) => void | Promise<void>;
  filter?: HarvestJobsFilter;
}) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      let next = IDLE_POLL_MS;
      try {
        const res = await fetch("/api/admin/harvest", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { jobs?: Job[] };
          const list = data.jobs ?? [];
          if (!cancelled) {
            setJobs(list);
            setStale(false);
          }
          if (list.some((j) => j.status === "queued" || j.status === "running")) {
            next = ACTIVE_POLL_MS;
          }
        } else if (!cancelled) {
          setStale(true);
        }
      } catch {
        if (!cancelled) setStale(true);
      }
      if (!cancelled) {
        timer = setTimeout(() => void poll(), next);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (jobs === null) {
    return <p className="text-xs text-white/40">Loading jobs…</p>;
  }

  // Show only the slice this instance is responsible for. History is
  // newest-first so the most recent crawl is at the top.
  const visible =
    filter === "active"
      ? jobs.filter(isActiveJob)
      : filter === "history"
        ? [...jobs].filter((j) => !isActiveJob(j)).sort((a, b) => b.created_at - a.created_at)
        : jobs;

  if (visible.length === 0) {
    const emptyMsg =
      filter === "active"
        ? "No harvest running right now — pick targets below and start one."
        : filter === "history"
          ? "No past crawls yet — finished jobs will appear here."
          : "No harvest jobs yet — pick targets below and start one.";
    return <p className="text-xs text-white/40">{emptyMsg}</p>;
  }

  return (
    <div className="space-y-3">
      {stale && (
        <p className="text-[10px] text-[var(--admin-gold)]">Live updates paused (worker unreachable) — showing the last known state.</p>
      )}
      {visible.map((job) => {
        const finished = job.counts.done + job.counts.failed;
        const pct = job.total_targets === 0 ? 0 : Math.round((finished / job.total_targets) * 100);
        const active = job.status === "queued" || job.status === "running";
        const running = job.targets.find((t) => t.status === "running");
        return (
          <div key={job.id} className="rounded-lg border border-white/10 bg-black/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[job.status]}`}>
                  {job.cancel_requested && active ? "stopping…" : job.status}
                </span>
                <span className="text-xs font-semibold text-white">{job.label || `Job ${job.id.slice(0, 8)}`}</span>
              </div>
              <span className="text-[10px] text-white/40">
                {new Date(job.created_at * 1000).toLocaleString()}
              </span>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${job.counts.failed > 0 ? "bg-[var(--admin-gold)]" : "bg-[var(--admin-accent)]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/60">
              <span>
                {finished}/{job.total_targets} sites · {job.counts.done} ok
                {job.counts.failed > 0 ? ` · ${job.counts.failed} failed` : ""} ·{" "}
                <strong className="text-[var(--admin-accent)]">{job.total_drafts_written} drafts</strong> written
                {(job.total_products_written ?? 0) > 0 ? (
                  <>
                    {" · "}
                    <strong className="text-[var(--admin-purple)]">{job.total_products_written} products</strong> staged
                  </>
                ) : null}
              </span>
              {running && (
                <span className="truncate text-[var(--admin-purple)]" title={running.url}>
                  ⛏ {running.display_name || running.url}
                </span>
              )}
            </div>

            {/* C4/C5: sites whose crawl hit the page budget with links still
                queued — the honest "you did NOT see everything" signal, with
                the fix (raise the per-site page budget and re-run). */}
            {job.targets.some((t) => t.status === "done" && (t.pages_leftover ?? 0) > 0) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[10px] text-white/40 hover:text-white/70">
                  Incomplete sites (budget reached with pages still queued)
                </summary>
                <ul className="mt-1 space-y-0.5 text-[10px] text-[var(--admin-gold)]/80">
                  {job.targets
                    .filter((t) => t.status === "done" && (t.pages_leftover ?? 0) > 0)
                    .slice(0, 20)
                    .map((t) => (
                      <li key={t.url} className="truncate" title={t.coverage_assessment || t.url}>
                        {t.display_name || t.url} — {t.pages} read, {t.pages_leftover} left queued
                        {(t.crawl_runs ?? 1) > 1 && (
                          <span className="text-white/40">
                            {" "}· run #{t.crawl_runs} ({t.total_pages_all_runs} total read)
                          </span>
                        )}
                        {jumpableVendorId(t) && (
                          <>
                            {" "}
                            <Link
                              href={`/admin/vendors/${jumpableVendorId(t)}`}
                              className="text-[var(--admin-gold)] underline hover:text-white"
                              title="The vendor page has a gold '⏩ Continue crawl' button that picks up exactly where this run stopped — already-read pages are never re-fetched."
                            >
                              Continue on vendor page →
                            </Link>
                          </>
                        )}
                      </li>
                    ))}
                </ul>
              </details>
            )}

            {job.counts.failed > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[10px] text-white/40 hover:text-white/70">
                  Failed sites
                </summary>
                <ul className="mt-1 space-y-0.5 text-[10px] text-red-300/80">
                  {job.targets
                    .filter((t) => t.status === "failed")
                    .slice(0, 20)
                    .map((t) => (
                      <li key={t.url} className="truncate" title={`${t.url}: ${t.error}`}>
                        {t.display_name || t.url} — {t.error || "error"}
                      </li>
                    ))}
                </ul>
              </details>
            )}

            {/* SLICE 89: back-to-vendor buttons for EVERY vendor target —
                dim while queued, pulsing while the crawler reads the site,
                and LIT UP green the moment it finishes (remembered across
                page leaves because the state lives on the worker). Leads
                have no vendor page and are skipped. */}
            {(() => {
              const jumpable = job.targets.filter((t) => jumpableVendorId(t));
              if (jumpable.length === 0) return null;
              return (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-white/40">
                    Back to vendor{jumpable.length > 1 ? "s" : ""}:
                  </span>
                  {jumpable.slice(0, 12).map((t) => {
                    const id = jumpableVendorId(t)!;
                    const glow = chipGlowFor(t);
                    return (
                      <Link
                        key={id}
                        href={`/admin/vendors/${id}${glow === "lit" ? "#ai-drafts" : ""}`}
                        className={`max-w-[220px] truncate rounded-full border px-3 py-1 text-[10px] font-semibold transition ${VENDOR_BTN_STYLE[glow]}`}
                        title={`${VENDOR_BTN_TITLE[glow]} — ${t.display_name || t.url}`}
                        data-glow={glow}
                      >
                        {VENDOR_BTN_ICON[glow]} {t.display_name || t.url}
                        {glow === "lit" && (t.drafts_written ?? 0) > 0
                          ? ` · ${t.drafts_written} drafts`
                          : ""}
                      </Link>
                    );
                  })}
                  {jumpable.length > 12 && (
                    <span className="text-[10px] text-white/35">+{jumpable.length - 12} more</span>
                  )}
                </div>
              );
            })()}

            <div className="mt-3 flex gap-2">
              {active && !job.cancel_requested && (
                <form action={cancelAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <button type="submit" className={CHIP_NEUTRAL}>
                    ⏹ Stop after current site
                  </button>
                </form>
              )}
              {(job.status === "failed" || job.status === "cancelled") &&
                job.counts.pending + job.counts.running > 0 && (
                  <form action={resumeAction}>
                    <input type="hidden" name="jobId" value={job.id} />
                    <button type="submit" className={CHIP_ACTION}>
                      ▶ Resume unfinished sites
                    </button>
                  </form>
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
