/**
 * src/lib/ai/gemini-http.ts  (D244 R-3)
 *
 * The two plain Gemini API calls - one HTTP call, and "list our batches" -
 * moved out of gemini-batch-server.ts so a second batch user (the overnight
 * enrichment batch, enrich-batch-server.ts) can share them without loading
 * the whole lookup engine. gemini-batch-server.ts re-exports both, so every
 * existing import keeps working unchanged.
 */
import "server-only";
import { geminiApiKey } from "@/lib/ai/provider";
import { explainGemini, parseBatchList, type GoogleBatchRow } from "@/lib/ai/gemini-batch-explain-core";

export const GEMINI_API_ORIGIN = "https://generativelanguage.googleapis.com";

/** One call to the Gemini API. Never throws: a network failure is status 0. */
export async function gemini(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  try {
    const res = await fetch(`${GEMINI_API_ORIGIN}/${path}`, { ...init, headers: { "x-goog-api-key": geminiApiKey(), "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, json: null, text };
  }
}

/** Every batch on the Google account (newest first, up to `maxPages` x 100). */
export async function listGoogleBatches(maxPages = 10): Promise<{ ok: boolean; status: number; rows: GoogleBatchRow[]; raw: string; error: string | null }> {
  const rows: GoogleBatchRow[] = [];
  let token: string | null = null;
  let raw = "";
  for (let p = 0; p < maxPages; p += 1) {
    const res = await gemini(`v1beta/batches?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
    if (p === 0) raw = res.text;
    if (!res.ok) {
      const x = explainGemini(res.status, res.json ?? res.text);
      return { ok: false, status: res.status, rows, raw: res.text, error: `${x.title}. ${x.fix}` };
    }
    const page = parseBatchList(res.json);
    rows.push(...page.rows);
    token = page.nextPageToken;
    if (!token) break;
  }
  return { ok: true, status: 200, rows, raw, error: null };
}
