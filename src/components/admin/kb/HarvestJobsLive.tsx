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

/**
 * A completed target is "jumpable" when it maps to a real vendor page — i.e. an
 * entity_type of "vendor" with a UUID id (lead targets carry a "lead:" prefix
 * and have no vendor page yet).
 */
function jumpableVendorId(t: { entity_type?: string; entity_id?: string }): string | null {
  if (t.entity_type !== "vendor") return null;
  const id = (t.entity_id ?? "").trim();
  if (!id || id.startsWith("lead:")) return null;
  return id;
}

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
  queued: "border-[#ffd700]/40 bg-[#ffd700]/10 text-[#ffd700]",
  running: "border-[#5ec1ff]/40 bg-[#5ec1ff]/10 text-[#5ec1ff]",
  completed: "border-[#7ed957]/40 bg-[#7ed957]/10 text-[#7ed957]",
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
        <p className="text-[10px] text-[#ffd700]">Live updates paused (worker unreachable) — showing the last known state.</p>
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
                className={`h-full rounded-full transition-all ${job.counts.failed > 0 ? "bg-[#ffd700]" : "bg-[#7ed957]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/60">
              <span>
                {finished}/{job.total_targets} sites · {job.counts.done} ok
                {job.counts.failed > 0 ? ` · ${job.counts.failed} failed` : ""} ·{" "}
                <strong className="text-[#7ed957]">{job.total_drafts_written} drafts</strong> written
                {(job.total_products_written ?? 0) > 0 ? (
                  <>
                    {" · "}
                    <strong className="text-[#5ec1ff]">{job.total_products_written} products</strong> staged
                  </>
                ) : null}
              </span>
              {running && (
                <span className="truncate text-[#5ec1ff]" title={running.url}>
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
                <ul className="mt-1 space-y-0.5 text-[10px] text-[#ffd700]/80">
                  {job.targets
                    .filter((t) => t.status === "done" && (t.pages_leftover ?? 0) > 0)
                    .slice(0, 20)
                    .map((t) => (
                      <li key={t.url} className="truncate" title={t.coverage_assessment || t.url}>
                        {t.display_name || t.url} — {t.pages} read, {t.pages_leftover} left queued
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

            {/* Jump to vendor — quick return to the vendor page(s) just
                crawled, so the owner doesn't have to hunt for them again.
                Shown for completed vendor targets (leads have no vendor page). */}
            {(() => {
              const jumpable = job.targets.filter(
                (t) => t.status === "done" && jumpableVendorId(t),
              );
              if (jumpable.length === 0) return null;
              return (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-white/40">
                    Jump to vendor{jumpable.length > 1 ? "s" : ""}:
                  </span>
                  {jumpable.slice(0, 12).map((t) => {
                    const id = jumpableVendorId(t)!;
                    return (
                      <Link
                        key={id}
                        href={`/admin/vendors/${id}`}
                        className="max-w-[220px] truncate rounded-full border border-[#7ed957]/40 px-3 py-1 text-[10px] font-semibold text-[#7ed957] transition hover:bg-[#7ed957]/10"
                        title={`Open ${t.display_name || t.url}`}
                      >
                        → {t.display_name || t.url}
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
                  <button
                    type="submit"
                    className="rounded-full border border-white/20 px-3 py-1 text-[10px] font-semibold text-white/70 transition hover:border-red-400 hover:text-red-300"
                  >
                    ⏹ Stop after current site
                  </button>
                </form>
              )}
              {(job.status === "failed" || job.status === "cancelled") &&
                job.counts.pending + job.counts.running > 0 && (
                  <form action={resumeAction}>
                    <input type="hidden" name="jobId" value={job.id} />
                    <button
                      type="submit"
                      className="rounded-full border border-[#5ec1ff]/40 px-3 py-1 text-[10px] font-semibold text-[#5ec1ff] transition hover:brightness-125"
                    >
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
