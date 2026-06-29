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
  drafts_written: number;
  drafts_skipped: number;
  supabase_configured: boolean;
  error: string;
};

export class CrawlerNotConfiguredError extends Error {
  constructor() {
    super("Crawler not configured. Set CRAWLER_BASE_URL + CRAWLER_SHARED_SECRET.");
    this.name = "CrawlerNotConfiguredError";
  }
}

/**
 * Ask the worker to research a URL for a given entity. `write` defaults to true
 * (drafts written to ai_suggestions); pass false for a preview/dry-run.
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
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000);
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

/** Lightweight health probe so the admin UI can show worker status. */
export async function crawlerHealth(timeoutMs = 5_000): Promise<{ ok: boolean; detail: string }> {
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
    const data = (await res.json()) as { ok?: boolean };
    return { ok: Boolean(data.ok), detail: "reachable" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

async function safeDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: string };
    return data.detail ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
