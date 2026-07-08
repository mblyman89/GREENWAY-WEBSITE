/**
 * src/lib/admin/scroll-keeper-core.ts — Slice H12e, PURE core.
 *
 * Owner: "when I click save on something, it always sends me to the top of
 * the page. I don't like this."
 *
 * Why it happens: every admin save is a server action that ends in
 * redirect(...) — Next.js treats that as a fresh navigation and scrolls to
 * the top. The fix is a tiny client component (ScrollKeeper) in the admin
 * layout that records the scroll position when a form submits and restores it
 * once the redirect lands back on the SAME page. These pure helpers hold the
 * decision rules so they can be pinned in tests/compliance:
 *
 *  • restore ONLY on the same pathname (a delete that redirects to the list
 *    page is a real navigation — top is correct);
 *  • an explicit #hash in the landing URL WINS (redirects like "#ai-drafts"
 *    are intentional scroll targets);
 *  • stale records (previous session, abandoned submit) never fire.
 */

export type ScrollRecord = {
  /** pathname where the form was submitted. */
  path: string;
  /** window.scrollY at submit time. */
  y: number;
  /** Date.now() at submit time. */
  t: number;
};

/** Records older than this never restore (abandoned submits, old sessions). */
export const SCROLL_RECORD_TTL_MS = 60_000;

/** sessionStorage key — session-scoped by design (never survives the tab). */
export const SCROLL_KEEPER_KEY = "admin-scroll-keeper";

/** Parse a stored record defensively; null for junk. */
export function parseScrollRecord(raw: string | null | undefined): ScrollRecord | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const path = typeof o.path === "string" ? o.path : "";
    const y = typeof o.y === "number" && Number.isFinite(o.y) && o.y >= 0 ? o.y : -1;
    const t = typeof o.t === "number" && Number.isFinite(o.t) ? o.t : 0;
    if (!path || y < 0 || t <= 0) return null;
    return { path, y, t };
  } catch {
    return null;
  }
}

export type RestoreDecision =
  | { action: "restore"; y: number }
  | { action: "drop" }   // record consumed/invalid — clear it
  | { action: "keep" };  // navigation still in flight — leave the record

/**
 * Decide what to do with a stored record when a page settles.
 *  • hash present  → drop (the anchor is the intended scroll target);
 *  • stale         → drop;
 *  • other path    → keep (the redirect may not have landed yet; the record
 *                    expires via TTL if the user truly navigated away);
 *  • same path     → restore + drop.
 */
export function decideRestore(
  record: ScrollRecord | null,
  current: { path: string; hash: string; now: number },
): RestoreDecision {
  if (!record) return { action: "drop" };
  if (current.now - record.t > SCROLL_RECORD_TTL_MS) return { action: "drop" };
  if (current.hash) return { action: "drop" };
  if (record.path !== current.path) return { action: "keep" };
  return { action: "restore", y: record.y };
}

/** Build the record to store at submit time. */
export function makeScrollRecord(path: string, y: number, now: number): ScrollRecord {
  return { path, y: Math.max(0, Math.round(y)), t: now };
}
