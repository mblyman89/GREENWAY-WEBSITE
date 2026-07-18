/**
 * src/lib/purchasing/growflow-client.ts
 *
 * GF-3 — server-side client for the crawler worker's GrowFlow endpoints.
 *
 * The site (Vercel) can't run a headless browser, so the authenticated
 * GrowFlow marketplace session lives on the Python worker (see
 * crawler/app/growflow_auth.py + growflow_api.py). This client makes one
 * authenticated HTTP call per action:
 *
 *   POST /growflow/stores  → search/list the marketplace storefronts
 *   POST /growflow/menu    → fetch ONE storefront's LIVE menu (getStoreListing)
 *
 * The worker returns the RAW GraphQL `data` node GrowFlow gave it (plus a
 * tolerant `records` extraction). Persistence happens HERE on the Next side
 * via the GF-1 normalizers (growflow-menu-core.ts) — so Supabase writes stay
 * in ONE place and nothing hard-codes GrowFlow's response shape. NEVER GUESS:
 * field names were pinned from a live authenticated probe (getStoreFrontsV2 /
 * getStoreListingV2); the normalizers tolerate variants regardless.
 *
 * Uses the SAME worker env as the research + Cultivera clients (one worker,
 * one secret):
 *   CRAWLER_BASE_URL       e.g. https://crawler.yourhost.com (or http://localhost:8200)
 *   CRAWLER_SHARED_SECRET  must match the worker's CRAWLER_SHARED_SECRET
 *
 * Tunnel-safety: one menu fetch is a handful of polite JSON calls — worst case
 * a fresh Auth0 login (~20 s, Playwright) plus a few paced GraphQL requests —
 * comfortably under the ~100 s tunnel limit, so these calls are synchronous
 * (no job/poll machinery needed).
 *
 * Degrades gracefully: if the worker isn't configured the UI shows a setup
 * hint; if the worker has no GrowFlow credentials it answers 503 and we
 * surface that as a friendly `configured:false` result — never a crash.
 */
import "server-only";

import { crawlerBaseUrl, isCrawlerConfigured } from "@/lib/ai/crawler-client";

const crawlerSecret = (process.env.CRAWLER_SHARED_SECRET ?? "").trim();

/** True when the worker base + secret are set (same gate as the research UI). */
export function isGrowflowClientConfigured(): boolean {
  return isCrawlerConfigured();
}

/**
 * Mirrors the worker's GrowflowApiOut response model (crawler/app/main.py):
 * ok/url/status/raw/records/count/error. `raw` is the untouched GraphQL data
 * node for the GF-1 normalizers; `records` is the worker's tolerant list
 * extraction for quick previews.
 */
export type GrowflowWorkerResult = {
  ok: boolean;
  url: string;
  status: number;
  raw: unknown;
  records: Record<string, unknown>[];
  count: number;
  error: string;
  /** False when the worker itself lacks GROWFLOW_EMAIL/PASSWORD (its 503). */
  configured: boolean;
};

function notConfigured(detail: string): GrowflowWorkerResult {
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

async function growflowFetch(
  path: "/growflow/stores" | "/growflow/menu",
  body: Record<string, string>,
  timeoutMs: number,
): Promise<GrowflowWorkerResult> {
  if (!isGrowflowClientConfigured()) {
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
      // The worker is reachable but has no GrowFlow credentials yet.
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
 * Search/list the GrowFlow storefronts the buyer account can see.
 * `query` filters by store name/license/city (worker-side substring match,
 * mirroring the SPA's own client-side search).
 */
export async function searchGrowflowStores(
  query = "",
  timeoutMs = 60_000,
): Promise<GrowflowWorkerResult> {
  return growflowFetch("/growflow/stores", { query }, timeoutMs);
}

/**
 * Fetch ONE storefront's live menu by storefront id (integer, e.g. "1211").
 * The caller then persists the returned `raw` getStoreListing node via the
 * GF-1 normalizers. A first call may include a fresh Auth0 login on the
 * worker, so the default timeout is generous but under the tunnel ceiling.
 */
export async function fetchGrowflowMenu(
  input: { storeFrontId: string },
  timeoutMs = 90_000,
): Promise<GrowflowWorkerResult> {
  return growflowFetch(
    "/growflow/menu",
    { store_front_id: input.storeFrontId ?? "" },
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
