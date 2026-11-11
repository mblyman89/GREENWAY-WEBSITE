/**
 * D232 M-1 (G-76, F-11-1) - where the shop reads the back office, and what a
 * feed answer means. PURE: no fetch, no env, no React.
 *
 * The bug this fixes: the shop asked https://greenwaymarijuana.com/api/... (no
 * www). The main site answers that with a 308 to https://www.greenwaymarijuana.com.
 * fetch() follows a cross-origin redirect but DROPS the Authorization header
 * (Fetch standard, "HTTP-redirect fetch" step 13), so the catalog route saw no
 * token, answered 404, and the shop silently kept an empty last-good copy.
 * No Studio product could ever appear.
 *
 * The fix has three layers:
 *  1. MAIN_SITE_ORIGIN is the www address (the one that answers directly).
 *  2. feedUrl() rewrites a bare greenwaymarijuana.com host to www, so an env
 *     value typed without www still works.
 *  3. The fetch uses redirect: "manual" and describeFeedAnswer() turns a 3xx
 *     into a plain message, so a redirect is REPORTED (to the logs and to the
 *     health endpoint), never followed without the token.
 */

/** The main site's address that answers without a redirect. */
export const MAIN_SITE_ORIGIN = "https://www.greenwaymarijuana.com";
const BARE_HOST = "greenwaymarijuana.com";

/**
 * The env value if set (trimmed), else `${MAIN_SITE_ORIGIN}${path}`. A bare
 * greenwaymarijuana.com host is moved to www. Anything that is not https://
 * is returned as-is so the caller's own https check refuses it.
 */
export function feedUrl(envValue: string | undefined, path: string): string {
  const raw = (envValue ?? "").trim() || `${MAIN_SITE_ORIGIN}${path}`;
  let u: URL;
  try { u = new URL(raw); } catch { return raw; }
  if (u.protocol !== "https:") return raw;
  if (u.hostname.toLowerCase() === BARE_HOST) u.hostname = `www.${BARE_HOST}`;
  return u.toString();
}

export type FeedAnswer =
  | { ok: true }
  | { ok: false; kind: "redirect" | "refused" | "server" | "other"; problem: string };

/** Plain-English meaning of the back office's HTTP answer to the shop. */
export function describeFeedAnswer(status: number, location: string | null): FeedAnswer {
  if (status >= 200 && status < 300) return { ok: true };
  if (status >= 300 && status < 400) {
    const to = (location ?? "").trim() || "another address";
    return { ok: false, kind: "redirect", problem: `The feed address redirects to ${to}. A redirect drops the password, so set MERCH_CATALOG_URL to the address it redirects to (SOP-11 §4.4.1).` };
  }
  if (status === 404 || status === 401 || status === 403) {
    return { ok: false, kind: "refused", problem: `The back office refused the feed (${status}). MERCH_CATALOG_TOKEN must be the same value in both Vercel projects, at least 32 characters (SOP-11 §4.3).` };
  }
  if (status >= 500) return { ok: false, kind: "server", problem: `The back office had an error (${status}). The shop keeps showing the last good copy.` };
  return { ok: false, kind: "other", problem: `The back office answered ${status}.` };
}

/** What the shop last saw from the catalog feed (read by /api/health in M-2). */
export interface FeedStatus {
  at: string;
  ok: boolean;
  status: number;
  products: number;
  problem: string;
}

export function __runFeedCoreTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL merch-site feed-core: ${m}`); } };
  ok(feedUrl(undefined, "/api/merch-catalog") === "https://www.greenwaymarijuana.com/api/merch-catalog", "default is www");
  ok(feedUrl("  ", "/api/merch-content") === "https://www.greenwaymarijuana.com/api/merch-content", "blank env -> default");
  ok(feedUrl("https://greenwaymarijuana.com/api/merch-catalog", "/x") === "https://www.greenwaymarijuana.com/api/merch-catalog", "bare host moved to www");
  ok(feedUrl("https://GreenwayMarijuana.com/api/merch-catalog", "/x") === "https://www.greenwaymarijuana.com/api/merch-catalog", "host match is case-insensitive");
  ok(feedUrl("https://preview-abc.vercel.app/api/merch-catalog", "/x") === "https://preview-abc.vercel.app/api/merch-catalog", "other hosts untouched");
  ok(feedUrl("http://greenwaymarijuana.com/api/merch-catalog", "/x") === "http://greenwaymarijuana.com/api/merch-catalog", "non-https returned as-is (caller refuses it)");
  ok(feedUrl("not a url", "/x") === "not a url", "garbage returned as-is");
  ok(describeFeedAnswer(200, null).ok, "200 ok");
  const r = describeFeedAnswer(308, "https://www.greenwaymarijuana.com/api/merch-catalog");
  ok(!r.ok && r.kind === "redirect" && r.problem.includes("www.greenwaymarijuana.com") && r.problem.includes("MERCH_CATALOG_URL"), "308 named, with the fix");
  ok(!describeFeedAnswer(301, null).ok && (describeFeedAnswer(301, null) as { problem: string }).problem.includes("another address"), "redirect without Location");
  const n = describeFeedAnswer(404, null);
  ok(!n.ok && n.kind === "refused" && n.problem.includes("MERCH_CATALOG_TOKEN"), "404 = token refused");
  ok(!describeFeedAnswer(503, null).ok && (describeFeedAnswer(503, null) as { kind: string }).kind === "server", "5xx = server");
  ok((describeFeedAnswer(418, null) as { kind: string }).kind === "other", "anything else");
  return { passed, failed };
}
