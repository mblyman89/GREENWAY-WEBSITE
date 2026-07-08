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
 *  • a fresh same-path record from an actual form submit WINS even when the
 *    save redirected to a #hash (H13a): the vendor page's accept/save actions
 *    redirect to "?saved=1#ai-drafts", and that anchor sits near the top — so
 *    letting the hash win was exactly what jumped the owner back to the top
 *    after every save. The user's real scroll position beats a server-added
 *    hash on the SAME page;
 *  • a #hash still wins when there is NO matching same-path record — that is a
 *    genuine in-page anchor click (e.g. a "jump to section" link), where the
 *    anchor IS the intended target;
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
 *  • no record / stale → drop;
 *  • same path         → restore + drop. This holds EVEN when the landing URL
 *                        has a #hash: a fresh record means the user submitted
 *                        a form here, so their real position beats a
 *                        server-appended anchor like "#ai-drafts" (H13a);
 *  • different path + hash → drop (a real navigation to an anchor — the anchor
 *                        is the intended target, and this record is for some
 *                        other page);
 *  • different path, no hash → keep (the redirect may not have landed yet; the
 *                        record expires via TTL if the user truly left).
 */
export function decideRestore(
  record: ScrollRecord | null,
  current: { path: string; hash: string; now: number },
): RestoreDecision {
  if (!record) return { action: "drop" };
  if (current.now - record.t > SCROLL_RECORD_TTL_MS) return { action: "drop" };
  if (record.path === current.path) return { action: "restore", y: record.y };
  // Record is for a different path than where we landed.
  if (current.hash) return { action: "drop" };
  return { action: "keep" };
}

/** Build the record to store at submit time. */
export function makeScrollRecord(path: string, y: number, now: number): ScrollRecord {
  return { path, y: Math.max(0, Math.round(y)), t: now };
}
