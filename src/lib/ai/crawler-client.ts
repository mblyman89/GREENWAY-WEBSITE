/**
 * src/lib/ai/crawler-client.ts
 *
 * Server-side client for the separate Python crawl4ai worker (see /crawler).
 *
 * The site (Vercel) can't run a headless browser, so research is delegated to
 * the worker over one authenticated HTTP call. The worker does the honest
 * pipeline (fetch → CSS-first → schema LLM → verify → compliance) and writes
 * DRAFTS straight into ai_suggestions with source=crawl:<url>. So from the
 * site's perspective this is fire-and-report: we ask it to research a URL and
 * it tells us what it found + how many drafts it wrote.
 *
 * Configured via env:
 *   CRAWLER_BASE_URL       e.g. https://crawler.yourhost.com (or http://localhost:8200)
 *   CRAWLER_SHARED_SECRET  must match the worker's CRAWLER_SHARED_SECRET
 *
 * Degrades gracefully: if not configured, isCrawlerConfigured() is false and
 * the UI hides the button / shows a setup hint instead of erroring.
 */
import "server-only";

export const crawlerBaseUrl = (process.env.CRAWLER_BASE_URL ?? "").trim().replace(/\/+$/, "");
const crawlerSecret = (process.env.CRAWLER_SHARED_SECRET ?? "").trim();

export function isCrawlerConfigured(): boolean {
  return Boolean(crawlerBaseUrl && crawlerSecret);
}

export type CrawlEntityType = "vendor" | "brand" | "product";

export type CrawlFieldOutcome = {
  field_key: string;
  value: string;
  confidence: number;
  via: "css" | "llm";
  accepted: boolean;
  reason: string;
  flags: string[];
};

export type CrawlResearchResult = {
  ok: boolean;
  url: string;
  entity_type: CrawlEntityType;
  entity_id: string;
  from_cache: boolean;
  fields: CrawlFieldOutcome[];
  image_candidates: string[];
  /** Every page the deep-research crawl actually read (target + same-site pages). */
  pages?: string[];
  /** C4: crawl completeness snapshot — pages read vs. budget, leftover queue,
   * failed pages, content saturation, and a one-line human `assessment`.
   * Null/absent for single-page product lookups and social research. */
  coverage?: {
    entry_url: string;
    page_budget: number;
    pages_crawled: number;
    pages_failed: string[];
    queued_leftover: number;
    frontier: Record<string, number>;
    novelty_ratios: number[];
    saturation: number | null;
    saturated: boolean;
    site_exhausted: boolean;
    assessment: string;
  } | null;
  drafts_written: number;
  drafts_skipped: number;
  supabase_configured: boolean;
  /** H9b: structured kb_products DRAFT rows staged from the verified lineup. */
  products_written?: number;
  error: string;
};

export class CrawlerNotConfiguredError extends Error {
  constructor() {
    super("Crawler not configured. Set CRAWLER_BASE_URL + CRAWLER_SHARED_SECRET.");
    this.name = "CrawlerNotConfiguredError";
  }
}

/**
 * Ask the worker to research a URL for a given entity, SYNCHRONOUSLY — this call
 * blocks until the whole crawl finishes and returns the full result. `write`
 * defaults to true (drafts written to ai_suggestions); pass false for a
 * preview/dry-run.
 *
 * ⚠️ NOT for the tunnel-fronted UI path. Since the powerhouse upgrade a full
 * crawl takes minutes, and the production deployment sits behind a Cloudflare
 * Tunnel that kills any request with no response headers after ~100 s (HTTP
 * 524). The vendor/brand "Research with the crawler" buttons therefore submit a
 * one-target harvest job via {@link startHarvest} and poll instead. Keep this
 * function only for short, local, or dry-run calls that comfortably finish
 * under the tunnel timeout.
 */
export async function researchUrl(input: {
  url: string;
  entityType: CrawlEntityType;
  entityId: string;
  displayName?: string;
  write?: boolean;
  timeoutMs?: number;
}): Promise<CrawlResearchResult> {
  if (!isCrawlerConfigured()) throw new CrawlerNotConfiguredError();

  const controller = new AbortController();
  // Deep research reads several pages politely (robots + per-domain delay),
  // so give the worker room to finish before we abort.
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 240_000);
  try {
    const res = await fetch(`${crawlerBaseUrl}/research`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Crawler-Secret": crawlerSecret,
      },
      body: JSON.stringify({
        url: input.url,
        entity_type: input.entityType,
        entity_id: input.entityId,
        display_name: input.displayName ?? "",
        write: input.write ?? true,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await safeDetail(res);
      throw new Error(`Crawler responded ${res.status}: ${detail}`);
    }
    return (await res.json()) as CrawlResearchResult;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Ask the worker to research a vendor/brand's PUBLIC Instagram business profile
 * via the sanctioned Meta Graph Business Discovery API (DF-9). Same drafts-only
 * lifecycle as researchUrl. Throws if the worker base/secret isn't configured;
 * the worker itself returns ok:false (or 503) when META_GRAPH_TOKEN is unset.
 */
export async function researchSocial(input: {
  handle: string;
  entityType: CrawlEntityType;
  entityId: string;
  displayName?: string;
  write?: boolean;
  timeoutMs?: number;
}): Promise<CrawlResearchResult> {
  if (!isCrawlerConfigured()) throw new CrawlerNotConfiguredError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${crawlerBaseUrl}/research-social`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Crawler-Secret": crawlerSecret,
      },
      body: JSON.stringify({
        handle: input.handle,
        entity_type: input.entityType,
        entity_id: input.entityId,
        display_name: input.displayName ?? "",
        write: input.write ?? true,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await safeDetail(res);
      throw new Error(`Crawler responded ${res.status}: ${detail}`);
    }
    return (await res.json()) as CrawlResearchResult;
  } finally {
    clearTimeout(timeout);
  }
}

export type CrawlerHealth = {
  ok: boolean;
  detail: string;
  aiEnabled?: boolean;
  socialConfigured?: boolean;
  proxyEnabled?: boolean;
  /** Worker facts already exposed by GET /health (Slice H8 reference panel). */
  version?: string;
  supabaseConfigured?: boolean;
  respectRobots?: boolean;
  allowDomains?: string[];
};

/** Lightweight health probe so the admin UI can show worker status + capabilities. */
export async function crawlerHealth(timeoutMs = 5_000): Promise<CrawlerHealth> {
  if (!isCrawlerConfigured()) return { ok: false, detail: "not configured" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${crawlerBaseUrl}/health`, {
      headers: { "X-Crawler-Secret": crawlerSecret },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = (await res.json()) as {
      ok?: boolean;
      version?: string;
      ai_enabled?: boolean;
      supabase_configured?: boolean;
      social_configured?: boolean;
      respect_robots?: boolean;
      proxy_enabled?: boolean;
      allow_domains?: string[];
    };
    return {
      ok: Boolean(data.ok),
      detail: "reachable",
      version: data.version,
      aiEnabled: data.ai_enabled,
      supabaseConfigured: data.supabase_configured,
      socialConfigured: data.social_configured,
      respectRobots: data.respect_robots,
      proxyEnabled: data.proxy_enabled,
      allowDomains: data.allow_domains,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------
 * Batch harvest (Slices H1/H4) — multi-target jobs on the worker.
 * The worker crawls one job at a time, persists state after every
 * target (crash-safe), and writes the same drafts-only output as
 * /research. We submit, then poll.
 * ------------------------------------------------------------------ */

export type HarvestTargetInput = {
  url: string;
  entityType: CrawlEntityType;
  /** Supabase id the drafts belong to (vendor/brand id — or a lead id for
   * prospect harvests, whose drafts stay "dark" until the lead is promoted). */
  entityId: string;
  displayName?: string;
};

export type HarvestTargetState = {
  url: string;
  entity_type: string;
  entity_id: string;
  display_name: string;
  status: "pending" | "running" | "done" | "failed";
  pages: number;
  /** C4: discovered same-site pages left unread when the budget ran out (0 = site exhausted). */
  pages_leftover?: number;
  /** C4: one-line completeness verdict ("COMPLETE — …" / "BUDGET REACHED — …"). */
  coverage_assessment?: string;
  drafts_written: number;
  drafts_skipped: number;
  /** H9b: structured kb_products DRAFT rows staged from the verified lineup. */
  products_written?: number;
  error: string;
};

export type HarvestJob = {
  id: string;
  label: string;
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
  write: boolean;
  max_pages_per_site: number | null;
  delay_between_targets: number;
  created_at: number;
  started_at: number;
  finished_at: number;
  cancel_requested: boolean;
  targets: HarvestTargetState[];
  counts: { pending: number; running: number; done: number; failed: number };
  total_targets: number;
  total_drafts_written: number;
  /** H9b: sum of structured kb_products DRAFT rows staged across targets. */
  total_products_written?: number;
};

async function harvestFetch(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<Response> {
  if (!isCrawlerConfigured()) throw new CrawlerNotConfiguredError();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${crawlerBaseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Crawler-Secret": crawlerSecret,
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Submit a batch harvest job (returns immediately; poll for progress). */
export async function startHarvest(input: {
  targets: HarvestTargetInput[];
  maxPagesPerSite?: number;
  delayBetweenTargets?: number;
  label?: string;
  write?: boolean;
}): Promise<HarvestJob> {
  const res = await harvestFetch("/harvest", {
    method: "POST",
    body: JSON.stringify({
      targets: input.targets.map((t) => ({
        url: t.url,
        entity_type: t.entityType,
        entity_id: t.entityId,
        display_name: t.displayName ?? "",
      })),
      write: input.write ?? true,
      max_pages_per_site: input.maxPagesPerSite ?? null,
      delay_between_targets: input.delayBetweenTargets ?? 0,
      label: input.label ?? "",
    }),
  });
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await safeDetail(res)}`);
  const data = (await res.json()) as { ok: boolean; job: HarvestJob };
  return data.job;
}

/** List recent harvest jobs (newest first). */
export async function listHarvestJobs(): Promise<HarvestJob[]> {
  const res = await harvestFetch("/harvest");
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await safeDetail(res)}`);
  const data = (await res.json()) as { ok: boolean; jobs: HarvestJob[] };
  return data.jobs ?? [];
}

/** Fetch one harvest job's live state. */
export async function getHarvestJob(jobId: string): Promise<HarvestJob | null> {
  const res = await harvestFetch(`/harvest/${encodeURIComponent(jobId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await safeDetail(res)}`);
  const data = (await res.json()) as { ok: boolean; job: HarvestJob };
  return data.job;
}

/** Ask a running job to stop after the current site. */
export async function cancelHarvestJob(jobId: string): Promise<HarvestJob | null> {
  const res = await harvestFetch(`/harvest/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await safeDetail(res)}`);
  const data = (await res.json()) as { ok: boolean; job: HarvestJob };
  return data.job;
}

/** Resume an interrupted job (e.g. after a worker restart). */
export async function resumeHarvestJob(jobId: string): Promise<HarvestJob | null> {
  const res = await harvestFetch(`/harvest/${encodeURIComponent(jobId)}/resume`, { method: "POST" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await safeDetail(res)}`);
  const data = (await res.json()) as { ok: boolean; job: HarvestJob };
  return data.job;
}

async function safeDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: string };
    return data.detail ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
