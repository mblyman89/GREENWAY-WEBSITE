/**
 * src/lib/purchasing/budalerts-fetch.ts
 *
 * D241 — the respectful Budalerts fetcher. Owner permission (recorded in
 * docs/verbatim): brand photos, descriptions and prices for the brands we
 * carry, INTERNAL USE ONLY — never advertised, never sold.
 *
 * How it stays polite (every rule is in budalerts-core.ts and self-tested):
 *   - Only URLs that pass `isAllowedBudalertsUrl` are ever requested — the
 *     exact host, https, and only the brand / category / product / brand
 *     sitemap paths robots.txt allows. Nothing under /api, /browse, /alerts …
 *   - ONE request at a time, at least 3 s apart. The gap is kept in the
 *     database (`budalerts_fetch_state.last_request_at`), so two server
 *     instances or two open tabs still share one clock, plus a lease so only
 *     one run fetches at a time.
 *   - An honest User-Agent naming Greenway and a contact address.
 *   - 20 s timeout, 2 MB cap per page; a 429 / 503 / 403 stops the run at
 *     once (we back off instead of retrying).
 *   - A brand is refetched at most once every 7 days unless a person asks.
 *   - At most `BUDALERTS_RUN_BUDGET` requests per run.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import {
  BUDALERTS_BRAND_SITEMAP_URL,
  BUDALERTS_MAX_BYTES,
  BUDALERTS_MIN_GAP_MS,
  BUDALERTS_RUN_BUDGET,
  BUDALERTS_TIMEOUT_MS,
  BUDALERTS_USER_AGENT,
  brandPageUrl,
  distinctImages,
  isAllowedBudalertsUrl,
  isValidBrandSlug,
  mergeItems,
  parseBrandPage,
  parseWaBrandSitemap,
  pickDueSlugs,
  planCategoryPages,
  politeWaitMs,
  shouldStopRun,
  snapshotStatus,
  type BudalertsBrandPage,
  type BudalertsItem,
} from "@/lib/purchasing/budalerts-core";
import {
  acquireLease,
  loadBudalertsOverview,
  linkRowsFrom,
  readFetchState,
  releaseLease,
  saveKnownSlugs,
  saveSnapshot,
  stampRequest,
  toSnapshotRow,
  BudalertsStoreError,
} from "@/lib/purchasing/budalerts-store";

/** Category pages per brand (on top of the main page). Six categories exist today. */
export const BUDALERTS_CATEGORY_PAGES_PER_BRAND = 8;
/** How long one run may hold the lease. A server action lives at most 300 s. */
const LEASE_MS = 280_000;

export type PoliteResponse =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number | null; stop: boolean; error: string };

class Run {
  readonly owner = `run-${randomUUID()}`;
  requests = 0;
  stopped = false;
  stopReason: string | null = null;
  private lastAtMs: number | null = null;

  constructor(private readonly budget: number) {}

  get budgetLeft(): number {
    return Math.max(0, this.budget - this.requests);
  }

  /** One polite GET. Never throws for network trouble — returns {ok:false}. */
  async get(url: string): Promise<PoliteResponse> {
    if (!isAllowedBudalertsUrl(url)) return { ok: false, status: null, stop: false, error: "That address is not one we are allowed to read." };
    if (this.stopped) return { ok: false, status: null, stop: true, error: this.stopReason ?? "Run stopped." };
    if (this.requests >= this.budget) return { ok: false, status: null, stop: true, error: "Request budget for this run is used up." };

    // Shared clock: the later of our own last request and the database's.
    const state = await readFetchState();
    const dbLast = state?.last_request_at ? Date.parse(state.last_request_at) : null;
    const last = Math.max(this.lastAtMs ?? 0, dbLast ?? 0) || null;
    const wait = politeWaitMs(last, Date.now(), BUDALERTS_MIN_GAP_MS);
    if (wait > 0) await sleep(wait);

    const startedAt = Date.now();
    this.lastAtMs = startedAt;
    this.requests += 1;
    await stampRequest(new Date(startedAt).toISOString());

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BUDALERTS_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: ctrl.signal,
        headers: {
          "User-Agent": BUDALERTS_USER_AGENT,
          Accept: "text/html,application/xml;q=0.9,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.8",
        },
      });
      if (shouldStopRun(res.status)) {
        this.stopped = true;
        this.stopReason = `Budalerts answered ${res.status} — stopping politely and trying again later.`;
        return { ok: false, status: res.status, stop: true, error: this.stopReason };
      }
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, status: res.status, stop: false, error: `The page moved (HTTP ${res.status}); not following it.` };
      }
      if (!res.ok) return { ok: false, status: res.status, stop: false, error: `Budalerts answered HTTP ${res.status}.` };
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > BUDALERTS_MAX_BYTES) return { ok: false, status: res.status, stop: false, error: "The page is larger than the 2 MB cap." };
      const body = await readCapped(res, BUDALERTS_MAX_BYTES);
      if (body === null) return { ok: false, status: res.status, stop: false, error: "The page is larger than the 2 MB cap." };
      return { ok: true, status: res.status, body };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return { ok: false, status: null, stop: false, error: aborted ? "Budalerts took longer than 20 s to answer." : "Could not reach Budalerts (network error)." };
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

async function withLease<T>(fn: (run: Run) => Promise<T>, budget: number, noteOf: (r: T | null, run: Run) => string): Promise<T> {
  const run = new Run(budget);
  const now = Date.now();
  const got = await acquireLease(run.owner, new Date(now).toISOString(), new Date(now + LEASE_MS).toISOString());
  if (!got) throw new BudalertsStoreError("Another Budalerts fetch is running right now. Try again in a few minutes.");
  let result: T | null = null;
  try {
    result = await fn(run);
    return result;
  } finally {
    await releaseLease(run.owner, noteOf(result, run), new Date().toISOString()).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------
 * One brand
 * ------------------------------------------------------------------ */

export type FetchBrandResult = {
  slug: string;
  snapshotId: string | null;
  status: "fetched" | "partial" | "empty" | "error";
  itemCount: number;
  imageCount: number;
  pagesFetched: number;
  stopped: boolean;
  message: string;
};

async function fetchBrandInRun(run: Run, slug: string, userId: string | null): Promise<FetchBrandResult> {
  const mainUrl = brandPageUrl(slug);
  if (!mainUrl) {
    return { slug, snapshotId: null, status: "error", itemCount: 0, imageCount: 0, pagesFetched: 0, stopped: false, message: "Not a valid Budalerts brand slug." };
  }
  const errors: string[] = [];
  let pages = 0;
  const main = await run.get(mainUrl);
  let page: BudalertsBrandPage | null = null;
  const lists: BudalertsItem[][] = [];
  if (main.ok) {
    pages += 1;
    page = parseBrandPage(main.body, "all");
    lists.push(page.items);
    const plan = planCategoryPages(slug, page, Math.min(BUDALERTS_CATEGORY_PAGES_PER_BRAND, run.budgetLeft));
    for (const step of plan) {
      const r = await run.get(step.url);
      if (!r.ok) {
        errors.push(`${step.category}: ${r.error}`);
        if (r.stop) break;
        continue;
      }
      pages += 1;
      lists.push(parseBrandPage(r.body, step.category).items);
    }
  } else {
    errors.push(main.error);
  }

  const items = mergeItems(lists);
  const imageCount = distinctImages(items).length;
  const status = snapshotStatus(items.length, errors.length, run.stopped);
  const warnings = [...(page?.warnings ?? []), ...errors];
  const errorMessage = errors.length ? errors.join(" · ") : null;
  const snapshotId = await saveSnapshot({
    slug,
    page,
    items,
    status,
    errorMessage,
    pagesFetched: pages,
    imageCount,
    warnings,
    fetchedBy: userId,
  });
  const message =
    status === "fetched" || status === "partial"
      ? `${page?.brandName ?? slug}: ${items.length} listings, ${imageCount} distinct photos from ${pages} page${pages === 1 ? "" : "s"}${status === "partial" ? " (some pages failed)" : ""}.`
      : status === "empty"
        ? `${slug}: Budalerts lists no products for this brand in Washington right now.`
        : `${slug}: ${errorMessage ?? "the pull failed"}`;
  return { slug, snapshotId, status, itemCount: items.length, imageCount, pagesFetched: pages, stopped: run.stopped, message };
}

/** Fetch ONE brand now (a person clicked "Fetch"). Ignores the 7-day cache. */
export async function fetchBudalertsBrand(slug: string, userId: string | null): Promise<FetchBrandResult> {
  if (!isValidBrandSlug(slug)) throw new BudalertsStoreError("Not a valid Budalerts brand slug.");
  return withLease(
    (run) => fetchBrandInRun(run, slug, userId),
    1 + BUDALERTS_CATEGORY_PAGES_PER_BRAND,
    (r) => (r ? r.message : `${slug}: run ended early.`),
  );
}

/* ------------------------------------------------------------------
 * Batch — next due linked brands (the "Fetch all linked brands" loop)
 * ------------------------------------------------------------------ */

export type FetchDueResult = {
  results: FetchBrandResult[];
  /** Linked brands still due after this run (the button keeps looping while > 0). */
  remaining: number;
  stopped: boolean;
  message: string;
};

/**
 * Fetch up to `maxBrands` linked brands that are due (never fetched first,
 * then oldest; nothing fetched in the last 7 days). The client button calls
 * this again while `remaining > 0` and nothing told us to stop.
 */
export async function fetchDueBudalertsBrands(userId: string | null, maxBrands = 3): Promise<FetchDueResult> {
  const ov = await loadBudalertsOverview();
  if (!ov.available) throw new BudalertsStoreError(ov.warnings[0] ?? "Budalerts is not available.");
  const links = linkRowsFrom(ov.links);
  const snaps = ov.snapshots.map(toSnapshotRow);
  const due = pickDueSlugs(links, snaps, Date.now(), 10_000);
  if (due.length === 0) return { results: [], remaining: 0, stopped: false, message: "Every linked brand was fetched in the last 7 days." };
  const take = due.slice(0, Math.max(1, maxBrands));
  return withLease(
    async (run) => {
      const results: FetchBrandResult[] = [];
      for (const slug of take) {
        if (run.stopped || run.budgetLeft < 1) break;
        results.push(await fetchBrandInRun(run, slug, userId));
      }
      const remaining = due.length - results.length;
      const got = results.reduce((n, r) => n + r.itemCount, 0);
      const message = run.stopped
        ? `Stopped: ${run.stopReason}`
        : `Fetched ${results.length} brand${results.length === 1 ? "" : "s"} (${got} listings). ${remaining} still due.`;
      return { results, remaining, stopped: run.stopped, message };
    },
    BUDALERTS_RUN_BUDGET,
    (r, run) => (r ? r.message : run.stopReason ?? "Batch ended early."),
  );
}

/* ------------------------------------------------------------------
 * Sitemap — the list of Washington brand slugs (for link suggestions)
 * ------------------------------------------------------------------ */

export async function refreshBudalertsKnownSlugs(): Promise<{ count: number; message: string }> {
  return withLease(
    async (run) => {
      const r = await run.get(BUDALERTS_BRAND_SITEMAP_URL);
      if (!r.ok) throw new BudalertsStoreError(`Could not read the Budalerts brand list: ${r.error}`);
      const brands = parseWaBrandSitemap(r.body);
      await saveKnownSlugs(brands.map((b) => b.slug), new Date().toISOString());
      return { count: brands.length, message: `Budalerts lists ${brands.length} brands in Washington.` };
    },
    1,
    (r) => (r ? r.message : "Brand list refresh failed."),
  );
}
