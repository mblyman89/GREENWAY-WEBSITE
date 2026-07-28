/**
 * src/lib/purchasing/leaflink-client.ts
 *
 * SLICE 84 — server-side client for the crawler worker's LeafLink endpoints.
 *
 * The site (Vercel) can't run a headless browser, so the authenticated
 * LeafLink session lives on the Python worker (see crawler/app/leaflink_auth.py
 * + leaflink_api.py). Unlike GrowFlow (Bearer token) LeafLink's internal API
 * is COOKIE-authenticated (pinned live — crawler/docs/LEAFLINK_PINNED.md).
 * This client makes one authenticated HTTP call per action:
 *
 *   POST /leaflink/brands  → discover sellers/brands (product search grouped
 *                            by brand — LeafLink has no retailer brand-search
 *                            endpoint; pinned)
 *   POST /leaflink/menu    → fetch ONE brand's LIVE menu (header + rich
 *                            product-line rows: description, quantity,
 *                            images, specs)
 *
 * The worker returns the RAW payload LeafLink gave it (plus a tolerant
 * `records` extraction). Persistence happens HERE on the Next side via the
 * LL-1 normalizers (leaflink-menu-core.ts) — so Supabase writes stay in ONE
 * place and nothing hard-codes LeafLink's response shape.
 *
 * Uses the SAME worker env as the research + Cultivera + GrowFlow clients
 * (one worker, one secret):
 *   CRAWLER_BASE_URL       e.g. https://crawler.yourhost.com (or http://localhost:8200)
 *   CRAWLER_SHARED_SECRET  must match the worker's CRAWLER_SHARED_SECRET
 *
 * Tunnel-safety: one menu fetch is a handful of polite JSON calls — worst case
 * a fresh Auth0 login (~20 s, Playwright) plus a few paced REST requests —
 * comfortably under the ~100 s tunnel limit, so these calls are synchronous.
 *
 * Degrades gracefully: if the worker isn't configured the UI shows a setup
 * hint; if the worker has no LeafLink credentials it answers 503 and we
 * surface that as a friendly `configured:false` result — never a crash.
 */
import "server-only";

import { crawlerBaseUrl, isCrawlerConfigured } from "@/lib/ai/crawler-client";

const crawlerSecret = (process.env.CRAWLER_SHARED_SECRET ?? "").trim();

/** True when the worker base + secret are set (same gate as the research UI). */
export function isLeaflinkClientConfigured(): boolean {
  return isCrawlerConfigured();
}

/**
 * Mirrors the worker's LeaflinkApiOut response model (crawler/app/main.py):
 * ok/url/status/raw/records/count/error. `raw` is the untouched payload for
 * the LL-1 normalizers; `records` is the worker's tolerant list extraction
 * (brand hits or flattened product rows).
 */
export type LeaflinkWorkerResult = {
  ok: boolean;
  url: string;
  status: number;
  raw: unknown;
  records: Record<string, unknown>[];
  count: number;
  error: string;
  /** False when the worker itself lacks LEAFLINK_EMAIL/PASSWORD (its 503). */
  configured: boolean;
};

function notConfigured(detail: string): LeaflinkWorkerResult {
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

async function leaflinkFetch(
  path: "/leaflink/brands" | "/leaflink/menu",
  body: Record<string, string>,
  timeoutMs: number,
): Promise<LeaflinkWorkerResult> {
  if (!isLeaflinkClientConfigured()) {
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
      // The worker is reachable but has no LeafLink credentials yet.
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
 * Discover LeafLink sellers/brands by name. The worker searches the shop
 * product catalog and groups the hits by brand (LeafLink's vendor unit),
 * honoring the pinned search-fallback gotcha (a non-matching term silently
 * returns the full catalog — the worker name-filters those out). `records` =
 * brand hits ({brand_id, brand_name, company_name, product_count, ...}).
 */
export async function searchLeaflinkBrands(
  query = "",
  timeoutMs = 90_000,
): Promise<LeaflinkWorkerResult> {
  return leaflinkFetch("/leaflink/brands", { query }, timeoutMs);
}

/**
 * Fetch ONE brand's live menu by brand id (integer, e.g. "11765"). The
 * caller then persists the returned `raw` {brand, products} payload via the
 * LL-1 normalizers. A first call may include a fresh Auth0 login on the
 * worker, so the default timeout is generous but under the tunnel ceiling.
 */
export async function fetchLeaflinkMenu(
  input: { brandId: string },
  timeoutMs = 90_000,
): Promise<LeaflinkWorkerResult> {
  return leaflinkFetch(
    "/leaflink/menu",
    { brand_id: input.brandId ?? "" },
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
