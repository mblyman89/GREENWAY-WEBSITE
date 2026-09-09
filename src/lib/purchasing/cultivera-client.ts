/**
 * src/lib/purchasing/cultivera-client.ts
 *
 * CV-3 — server-side client for the crawler worker's Cultivera endpoints.
 *
 * ============================================================================
 * ONE-TIME IMPORT ONLY — THIS IS NOT HOW PRODUCTS ENTER GREENWAY.
 * ----------------------------------------------------------------------------
 * The Cultivera menu import is a ONE-TIME EVENT and will NEVER be used again
 * after the changeover. Cultivera is crap vendor data we drag into our own
 * system once; it is NOT an architecture and we do NOT build around it.
 *
 * PRODUCTS ENTER GREENWAY THROUGH RECEIVING INTAKE — a vendor manifest or
 * invoice arriving with physical inventory (src/lib/inventory/intake-store.ts).
 * That is the real, permanent, business-critical pipeline.
 *
 * Do NOT treat this module as the product pipeline, and do NOT fix a pipeline
 * bug here first. Fix RECEIVING INTAKE first, always. See
 * docs/RECEIVING-IS-THE-REAL-PIPELINE.md and standing rule 11 in AGENTS.md.
 * ============================================================================
 *
 * The site (Vercel) can't run a headless browser, so the authenticated
 * Cultivera Market session lives on the Python worker (see
 * crawler/app/cultivera_auth.py + cultivera_api.py). This client makes one
 * authenticated HTTP call per action:
 *
 *   POST /cultivera/markets  → search/list the marketplace's vendors
 *   POST /cultivera/menu     → fetch ONE vendor's LIVE menu (listings)
 *   POST /cultivera/product  → fetch ONE product line's per-variant DETAIL
 *
 * The worker returns the RAW payload Cultivera gave it (plus a tolerant
 * `records` extraction). Persistence happens HERE on the Next side via
 * cultivera-store.saveSnapshot(), which runs the shipped tolerant normalizers
 * (normalizeSnapshot/normalizeMenuItem) — so Supabase writes stay in ONE place
 * and nothing hard-codes Cultivera's response shape. NEVER GUESS: exact field
 * names get pinned from a live authenticated probe once credentials exist; the
 * normalizers tolerate the variants until then.
 *
 * Uses the SAME worker env as the research client (one worker, one secret):
 *   CRAWLER_BASE_URL       e.g. https://crawler.yourhost.com (or http://localhost:8200)
 *   CRAWLER_SHARED_SECRET  must match the worker's CRAWLER_SHARED_SECRET
 *
 * Tunnel-safety: unlike a full-site crawl (minutes → 524 behind the Cloudflare
 * tunnel), one menu fetch is a handful of polite JSON calls — worst case a
 * fresh login (~15 s) plus a few paced requests — comfortably under the ~100 s
 * tunnel limit, so these calls are synchronous (no job/poll machinery needed).
 * Timeouts stay well below the tunnel ceiling regardless.
 *
 * Degrades gracefully: if the worker isn't configured the UI shows a setup
 * hint; if the worker has no Cultivera credentials it answers 503 and we
 * surface that as a friendly `configured:false` result — never a crash.
 */
import "server-only";

import { crawlerBaseUrl, isCrawlerConfigured } from "@/lib/ai/crawler-client";

const crawlerSecret = (process.env.CRAWLER_SHARED_SECRET ?? "").trim();

/** True when the worker base + secret are set (same gate as the research UI). */
export function isCultiveraClientConfigured(): boolean {
  return isCrawlerConfigured();
}

/**
 * Mirrors the worker's CultiveraApiOut response model (crawler/app/main.py):
 * ok/url/status/raw/records/count/error. `raw` is the untouched marketplace
 * payload for normalizeSnapshot(); `records` is the worker's tolerant list
 * extraction for quick previews.
 */
export type CultiveraWorkerResult = {
  ok: boolean;
  url: string;
  status: number;
  raw: unknown;
  records: Record<string, unknown>[];
  count: number;
  error: string;
  /** False when the worker itself lacks CULTIVERA_EMAIL/PASSWORD (its 503). */
  configured: boolean;
};

function notConfigured(detail: string): CultiveraWorkerResult {
  return {
    ok: false,
    url: "",
    status: 0,
    raw: null,
    records: [],
    count: 0,
    error: detail,
    configured: false,
  };
}

async function cultiveraFetch(
  path: "/cultivera/markets" | "/cultivera/menu" | "/cultivera/product",
  body: Record<string, string>,
  timeoutMs: number,
): Promise<CultiveraWorkerResult> {
  if (!isCultiveraClientConfigured()) {
    return notConfigured("Crawler not configured. Set CRAWLER_BASE_URL + CRAWLER_SHARED_SECRET.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${crawlerBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Crawler-Secret": crawlerSecret,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    if (res.status === 503) {
      // The worker is reachable but has no Cultivera credentials yet.
      return notConfigured(await safeDetail(res));
    }
    if (!res.ok) {
      return {
        ok: false,
        url: "",
        status: res.status,
        raw: null,
        records: [],
        count: 0,
        error: `Crawler responded ${res.status}: ${await safeDetail(res)}`,
        configured: true,
      };
    }

    const data = (await res.json()) as {
      ok?: boolean;
      url?: string;
      status?: number;
      raw?: unknown;
      records?: Record<string, unknown>[];
      count?: number;
      error?: string;
    };
    return {
      ok: Boolean(data.ok),
      url: data.url ?? "",
      status: data.status ?? 0,
      raw: data.raw ?? null,
      records: Array.isArray(data.records) ? data.records : [],
      count: data.count ?? (Array.isArray(data.records) ? data.records.length : 0),
      error: data.error ?? "",
      configured: true,
    };
  } catch (e) {
    return {
      ok: false,
      url: "",
      status: 0,
      raw: null,
      records: [],
      count: 0,
      error: e instanceof Error ? e.message : "Crawler unreachable.",
      configured: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Search/list the marketplace vendors the buyer account can see.
 * `query` filters by vendor name (worker-side, tolerant substring match).
 */
export async function searchCultiveraMarkets(
  query = "",
  timeoutMs = 60_000,
): Promise<CultiveraWorkerResult> {
  return cultiveraFetch("/cultivera/markets", { query }, timeoutMs);
}

/**
 * Fetch ONE vendor's live menu by market id or slug. The caller then persists
 * the returned `raw` payload via cultivera-store.saveSnapshot().
 * A first call may include a fresh login on the worker, so the default timeout
 * is generous but still under the tunnel ceiling.
 */
export async function fetchCultiveraMenu(
  input: { marketId?: string; slug?: string },
  timeoutMs = 90_000,
): Promise<CultiveraWorkerResult> {
  return cultiveraFetch(
    "/cultivera/menu",
    { market_id: input.marketId ?? "", slug: input.slug ?? "" },
    timeoutMs,
  );
}

/**
 * Fetch ONE product line's full per-variant DETAIL (pinned endpoint:
 * GET /listings/{productId}/market/{marketId} on the worker side). The caller
 * persists the returned `raw` payload onto the item row via
 * cultivera-store.saveItemDetail(); variants normalize on read.
 */
export async function fetchCultiveraProductDetail(
  input: { marketId: string; productId: string },
  timeoutMs = 90_000,
): Promise<CultiveraWorkerResult> {
  return cultiveraFetch(
    "/cultivera/product",
    { market_id: input.marketId, product_id: input.productId },
    timeoutMs,
  );
}

async function safeDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: string };
    return data.detail ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
