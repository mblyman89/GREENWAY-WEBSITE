/**
 * src/lib/inventory/batch-import-core.ts — Slice H11b (batch Transfer-Link
 * importer, PURE core).
 *
 * The owner has 12+ months of Cultivera order emails, each carrying ONE
 * "WCIA Transfer Data Link" (https://files.cultivera.com/.../Cultivera_ORD-
 * <n>_413541.json). This core turns a pasted wall of text (hundreds of links,
 * one per line) into a clean, de-duplicated URL list and defines the shared
 * result vocabulary for the batch import run.
 *
 * PURE — no I/O, fully unit-testable. The server side (actions.ts) fetches
 * and stages; the client panel chunks calls so hundreds of URLs never hit a
 * single serverless-function timeout.
 */

/** Hard cap per pasted batch — guards the UI and the server loop alike. */
export const MAX_BATCH_URLS = 500;

/**
 * How many URLs one server-action call processes. Each URL costs a remote
 * fetch (15s worst-case timeout in transfer-fetch.ts) plus staging inserts,
 * so keep chunks small enough that a chunk always finishes well inside a
 * serverless window even when links are slow or dead.
 */
export const BATCH_CHUNK_SIZE = 5;

/**
 * Collapse the Cultivera doubled-prefix bug (https://host/https://real/...).
 * Same regex as intake-parser.cleanUrl — duplicated here because this module
 * must stay importable by client components (intake-parser is pure too, but
 * keeping this core self-contained avoids pulling the whole parser into the
 * client bundle).
 */
export function collapseDoubledUrl(raw: string): string {
  const s = raw.trim();
  const doubled = s.match(/^(https?:\/\/[^/]+\/)(https?:\/\/.+)$/i);
  return doubled ? doubled[2] : s;
}

export type ParsedUrlList = {
  /** Clean, de-duplicated, in-order URLs ready to import. */
  urls: string[];
  /** Lines that were skipped because they aren't http(s) URLs. */
  invalid: string[];
  /** Count of duplicate lines removed (after doubled-prefix collapse). */
  duplicates: number;
  /** True when the paste exceeded MAX_BATCH_URLS and was truncated. */
  truncated: boolean;
};

/**
 * Parse a pasted blob into a URL list: one URL per line (commas/whitespace
 * separators tolerated), doubled prefixes collapsed, exact duplicates removed
 * (first occurrence wins), non-URL lines reported, capped at MAX_BATCH_URLS.
 */
export function parseUrlList(text: string): ParsedUrlList {
  const out: ParsedUrlList = { urls: [], invalid: [], duplicates: 0, truncated: false };
  const seen = new Set<string>();
  // Split on newlines, commas and whitespace — pasted email lists vary.
  const tokens = String(text ?? "")
    .split(/[\n\r,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const collapsed = collapseDoubledUrl(token);
    let parsed: URL;
    try {
      parsed = new URL(collapsed);
    } catch {
      out.invalid.push(token);
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      out.invalid.push(token);
      continue;
    }
    const key = parsed.toString();
    if (seen.has(key)) {
      out.duplicates += 1;
      continue;
    }
    if (out.urls.length >= MAX_BATCH_URLS) {
      out.truncated = true;
      continue;
    }
    seen.add(key);
    out.urls.push(key);
  }
  return out;
}

/** Split a URL list into sequential chunks for one-call-at-a-time submission. */
export function chunkUrls(urls: string[], size: number = BATCH_CHUNK_SIZE): string[][] {
  const n = Math.max(1, Math.floor(size));
  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += n) chunks.push(urls.slice(i, i + n));
  return chunks;
}

/** Per-URL outcome vocabulary shared by server action and client panel. */
export type BatchUrlStatus =
  | "staged" // fetched, parsed, staged as a pending draft manifest
  | "duplicate" // already imported (matched source_url or manifest_number)
  | "fetch_failed" // link unreachable / expired / not JSON
  | "parse_failed" // JSON fetched but not a recognizable manifest
  | "no_lines" // manifest parsed but had zero line items
  | "save_failed"; // staging insert failed

export type BatchUrlResult = {
  url: string;
  status: BatchUrlStatus;
  /** Human detail — error text, or the staged manifest number. */
  detail: string | null;
  /** Set when staged (links the UI straight to the review page). */
  manifestId: string | null;
};

export type BatchSummary = {
  total: number;
  staged: number;
  duplicates: number;
  failed: number;
};

/** Roll per-URL results into headline counters. */
export function summarizeBatch(results: BatchUrlResult[]): BatchSummary {
  const s: BatchSummary = { total: results.length, staged: 0, duplicates: 0, failed: 0 };
  for (const r of results) {
    if (r.status === "staged") s.staged += 1;
    else if (r.status === "duplicate") s.duplicates += 1;
    else s.failed += 1;
  }
  return s;
}

/** Short human label per status for the results table. */
export function statusLabel(status: BatchUrlStatus): string {
  switch (status) {
    case "staged":
      return "Staged for review";
    case "duplicate":
      return "Already imported";
    case "fetch_failed":
      return "Link failed";
    case "parse_failed":
      return "Not a manifest";
    case "no_lines":
      return "No line items";
    case "save_failed":
      return "Save failed";
  }
}
