/**
 * R71 - Printful API v1 client (SERVER-ONLY). Plain fetch, no SDK.
 *
 * Auth (Printful docs, "Authorization"): `Authorization: Bearer <token>`.
 * A private token made for ONE store needs nothing else; an account-level
 * token must also send `X-PF-Store-Id` (we send it whenever
 * PRINTFUL_STORE_ID is set).
 *
 * Fails CLOSED: with no PRINTFUL_API_TOKEN every call returns
 * { ok:false, code:"not-configured" } and nothing is sent anywhere.
 *
 * The token belongs to Greenway Merchandising LLC's Printful account (its
 * own card on file) - never the cannabis licensee's.
 */
import "server-only";

export const PRINTFUL_API = "https://api.printful.com";
const TIMEOUT_MS = 20_000;

export type PfResult<T> =
  | { ok: true; result: T; status: number; paging?: { total?: number; offset?: number; limit?: number } }
  | { ok: false; status: number; code: "not-configured" | "http" | "network" | "timeout"; error: string };

export function printfulConfigured(): boolean {
  return Boolean(process.env.PRINTFUL_API_TOKEN);
}

export async function printful<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<PfResult<T>> {
  const token = process.env.PRINTFUL_API_TOKEN;
  if (!token) return { ok: false, status: 503, code: "not-configured", error: "Printful isn't connected yet: add PRINTFUL_API_TOKEN (and PRINTFUL_STORE_ID for an account token) in Vercel for Greenway Merchandising LLC's Printful account." };
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (process.env.PRINTFUL_STORE_ID) headers["X-PF-Store-Id"] = process.env.PRINTFUL_STORE_ID;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PRINTFUL_API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, cache: "no-store" });
    const json = (await res.json().catch(() => null)) as { code?: number; result?: unknown; error?: { message?: string }; paging?: { total?: number; offset?: number; limit?: number } } | null;
    if (!res.ok || !json || (typeof json.code === "number" && json.code >= 400)) {
      const msg = json?.error?.message ?? (typeof json?.result === "string" ? json.result : res.statusText);
      return { ok: false, status: res.status, code: "http", error: `Printful ${res.status}: ${msg || "request failed"}` };
    }
    return { ok: true, status: res.status, result: json.result as T, ...(json.paging && typeof json.paging === "object" ? { paging: json.paging } : {}) };
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    return { ok: false, status: 504, code: aborted ? "timeout" : "network", error: aborted ? "Printful didn't answer within 20 seconds. Try again." : "Couldn't reach Printful (network error)." };
  } finally {
    clearTimeout(t);
  }
}
