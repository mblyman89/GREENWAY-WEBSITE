/**
 * src/lib/media/return-state-core.ts — Slice H12d, PURE core.
 *
 * Owner: "if I filter the media content page to show only drafts, then click
 * one, add the info save and publish, when I go back, it shows all the images
 * again instead of the filtered list."
 *
 * The media library's filter state lives in its URL (?q=&status=&usage=).
 * These helpers carry that state INTO the detail page (grid links), THROUGH
 * every save/status/delete round-trip (hidden form fields → action redirects),
 * and BACK out again (the "Back to library" link), so the owner always returns
 * to the exact filtered view they left.
 *
 * Pure + defensively validated (redirect targets are same-app admin paths
 * only) so the rules are pinned in tests/compliance.
 */

/** The library's filter params — the ONLY state worth carrying around. */
export type MediaListParams = { q?: string; status?: string; usage?: string };

const LIST_KEYS = ["q", "status", "usage"] as const;

/** Keep only non-empty filter params from a searchParams-shaped object. */
export function pickListParams(
  sp: Record<string, string | string[] | undefined> | null | undefined,
): MediaListParams {
  const out: MediaListParams = {};
  for (const key of LIST_KEYS) {
    const raw = sp?.[key];
    const v = (Array.isArray(raw) ? raw[0] : raw ?? "").trim();
    if (v) out[key] = v;
  }
  return out;
}

/** Deterministic query string ("q=…&status=…"), "" when no filters active. */
export function listQueryString(params: MediaListParams): string {
  const usp = new URLSearchParams();
  for (const key of LIST_KEYS) {
    const v = (params[key] ?? "").trim();
    if (v) usp.set(key, v);
  }
  return usp.toString();
}

/**
 * Build an href that carries the filter state plus any extra params
 * (e.g. saved=1). Extra params win on key collisions.
 */
export function withListParams(
  path: string,
  params: MediaListParams,
  extra?: Record<string, string>,
): string {
  const usp = new URLSearchParams(listQueryString(params));
  for (const [k, v] of Object.entries(extra ?? {})) usp.set(k, v);
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Append/override params on an href that may already carry a query string
 * (e.g. "/admin/media/abc?status=draft" + {saved:"1"}).
 */
export function appendQuery(href: string, extra: Record<string, string>): string {
  const [path, existing = ""] = href.split("?", 2);
  const usp = new URLSearchParams(existing);
  for (const [k, v] of Object.entries(extra)) usp.set(k, v);
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Server actions receive the return path from a hidden field — validate it so
 * a tampered form can never turn the redirect into an open redirect. Only
 * same-app admin paths pass; anything else falls back to the given default.
 */
export function safeAdminPath(raw: string | null | undefined, fallback: string): string {
  const s = String(raw ?? "").trim();
  // Must be an absolute in-app path, not protocol-relative (//evil.com) and
  // not a full URL. Query strings are fine.
  if (s.startsWith("/admin/") || s === "/admin") return s;
  return fallback;
}
