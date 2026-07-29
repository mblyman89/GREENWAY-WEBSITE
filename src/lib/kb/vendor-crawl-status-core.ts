/**
 * src/lib/kb/vendor-crawl-status-core.ts
 *
 * SLICE 89 (seamless hub ↔ vendor flow): PURE logic for the live crawl-status
 * chip on the vendor page and the light-up "back to vendor" buttons in the
 * Harvest Console. No fetch, no React — fully unit-testable.
 *
 * The single source of truth is the crawler worker's job list (relayed by the
 * staff-only /api/admin/harvest proxy). Because the job state lives on the
 * WORKER, the chip/buttons "remember" across page leaves for free — any page
 * that polls sees the same state.
 */

/** The slice of a harvest target these helpers need. */
export type CrawlTarget = {
  url?: string;
  entity_type?: string;
  entity_id?: string;
  display_name?: string;
  status?: "pending" | "running" | "done" | "failed" | string;
  pages?: number;
  drafts_written?: number;
  error?: string;
};

/** The slice of a harvest job these helpers need. */
export type CrawlJob = {
  id: string;
  label?: string;
  status?: "queued" | "running" | "completed" | "cancelled" | "failed" | string;
  created_at?: number;
  targets?: CrawlTarget[];
  total_drafts_written?: number;
};

/** How a back-to-vendor button should render for one target. */
export type ChipGlow = "waiting" | "running" | "lit" | "failed";

/**
 * A target maps to a real vendor page only when it's a vendor with a plain id
 * (discovery leads carry a "lead:" prefix and have no vendor page yet).
 */
export function targetVendorId(t: CrawlTarget): string | null {
  if (t.entity_type !== "vendor") return null;
  const id = (t.entity_id ?? "").trim();
  if (!id || id.startsWith("lead:")) return null;
  return id;
}

/** Does this job include the given vendor as a target? */
export function jobTouchesVendor(job: CrawlJob, vendorId: string): boolean {
  return (job.targets ?? []).some((t) => targetVendorId(t) === vendorId);
}

/**
 * The job the vendor-page chip should describe: the NEWEST job (by
 * created_at) that targets this vendor. Queued/running jobs win over
 * finished ones of the same age so a just-started re-crawl replaces last
 * week's completed banner.
 */
export function latestJobForVendor(jobs: CrawlJob[], vendorId: string): CrawlJob | null {
  const mine = jobs.filter((j) => jobTouchesVendor(j, vendorId));
  if (mine.length === 0) return null;
  const isActive = (j: CrawlJob) => j.status === "queued" || j.status === "running";
  return [...mine].sort((a, b) => {
    const activeDiff = Number(isActive(b)) - Number(isActive(a));
    if (activeDiff !== 0) return activeDiff;
    return (b.created_at ?? 0) - (a.created_at ?? 0);
  })[0];
}

/** This vendor's own target row inside a job (first match). */
export function vendorTarget(job: CrawlJob, vendorId: string): CrawlTarget | null {
  return (job.targets ?? []).find((t) => targetVendorId(t) === vendorId) ?? null;
}

/**
 * How the back-to-vendor button glows for one target:
 *   waiting → queued, not fetched yet (dim)
 *   running → the crawler is on this site right now (pulsing)
 *   lit     → DONE — this is the "button lights up" moment
 *   failed  → the site errored (still clickable; the vendor page explains)
 */
export function chipGlowFor(t: CrawlTarget): ChipGlow {
  switch (t.status) {
    case "done":
      return "lit";
    case "running":
      return "running";
    case "failed":
      return "failed";
    default:
      return "waiting";
  }
}

/** Vendor-page chip summary — everything the UI needs, precomputed. */
export type VendorCrawlSummary = {
  jobId: string;
  jobLabel: string;
  /** waiting | running | lit | failed — same glow scale as the hub buttons. */
  glow: ChipGlow;
  /** Plain-English one-liner for the chip. */
  message: string;
  /** Pages read for THIS vendor's target so far. */
  pages: number;
  /** Drafts written for THIS vendor's target. */
  drafts: number;
  /** True ⇒ the poller should keep polling fast (job still moving). */
  active: boolean;
};

/**
 * Build the vendor-page chip state from the worker's job list. Returns null
 * when no job (past or present) targets this vendor — the chip renders
 * nothing and the page stays exactly as it was before this slice.
 */
export function summarizeVendorCrawl(jobs: CrawlJob[], vendorId: string): VendorCrawlSummary | null {
  const job = latestJobForVendor(jobs, vendorId);
  if (!job) return null;
  const t = vendorTarget(job, vendorId);
  if (!t) return null;
  const glow = chipGlowFor(t);
  const pages = t.pages ?? 0;
  const drafts = t.drafts_written ?? 0;
  const jobActive = job.status === "queued" || job.status === "running";
  let message: string;
  switch (glow) {
    case "lit":
      message =
        drafts > 0
          ? `Crawl finished — ${drafts} draft${drafts === 1 ? "" : "s"} ready below (${pages} page${pages === 1 ? "" : "s"} read)`
          : `Crawl finished — ${pages} page${pages === 1 ? "" : "s"} read, no new drafts`;
      break;
    case "running":
      message = `Crawler is reading this vendor's site now — ${pages} page${pages === 1 ? "" : "s"} so far`;
      break;
    case "failed":
      message = `Crawl failed: ${(t.error ?? "").trim() || "site unreachable"}`;
      break;
    default:
      message = "Crawl queued — waiting for the worker";
  }
  return {
    jobId: job.id,
    jobLabel: job.label ?? "",
    glow,
    message,
    pages,
    drafts,
    active: jobActive && glow !== "lit" && glow !== "failed",
  };
}
