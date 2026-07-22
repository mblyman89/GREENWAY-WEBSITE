/**
 * src/lib/admin/back-link-core.ts  (GW-029)
 *
 * PURE helpers for state-carrying "Back to ..." navigation in the back
 * office. The list pages already keep their filters/search/sort in the URL
 * (searchParams); the problem was that every in-app back link was a bare
 * route and the row links into detail pages dropped the query string, so
 * returning to a list wiped its state (FINDINGS GW-029, spec in
 * DESIGN-SYSTEM-SPEC.md section 5).
 *
 * The pattern, in three pieces:
 *   1. List pages call `withBackParam(href, sp)` on each row/detail link —
 *      the CURRENT query string rides along as `?back=<urlencoded qs>`.
 *   2. Detail pages render <BackLink fallback="/admin/orders" back={sp.back}>
 *      which calls `backHref(fallback, back)` to restore the exact list URL.
 *   3. Multi-level chains nest naturally: the `back` key itself is carried,
 *      so item -> menu -> menu-list restores every hop. No accumulation is
 *      possible because backHref REPLACES the query, never appends to it.
 *
 * SAFETY: `backHref` only ever restores a QUERY STRING onto the caller's own
 * fallback route — a crafted `back` value can never navigate to a foreign
 * path, protocol, or host.
 *
 * Transient flash params (saved/error/ok/...) are stripped so returning to a
 * list never re-shows a stale "Saved." banner or error toast.
 */

/** Next.js server-component searchParams shape (after awaiting). */
export type SearchParamsShape = Record<string, string | string[] | undefined>;

/**
 * One-shot flash/status params that must NOT be restored when navigating
 * back to a list (re-showing a stale banner would lie to the user).
 */
export const TRANSIENT_QUERY_KEYS: ReadonlySet<string> = new Set([
  "error",
  "ok",
  "msg",
  "saved",
  "cleaned",
  "published",
  "staged",
  "clocked",
  // One-shot result banners (verified flash-only across /admin pages —
  // none of these is ever a filter). Restoring them would re-show a stale
  // "Saved." / "Clocked in" / "Merged." banner after navigating back.
  "created",
  "activated",
  "archived",
  "adjusted",
  "ops",
  "approved",
  "dismissed",
  "restored",
  "resolved",
  "reconciled",
  "verified",
  "generated",
  "failed",
  "accepted",
  "deleted",
  "rejected",
  "clusters",
  "who",
  "note",
  "entity",
  "inserted",
  "updated",
  "skipped",
  "kbdone",
  "kbnew",
  "kberr",
  "service",
]);

/**
 * The page's current query string with transient flash params removed.
 * Preserves multi-value params and the nested `back` key (multi-level
 * chains). Returns "" when nothing worth carrying remains.
 */
export function currentQueryString(sp: SearchParamsShape | null | undefined): string {
  if (!sp) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (TRANSIENT_QUERY_KEYS.has(key) || value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.append(key, value);
    }
  }
  return params.toString();
}

/**
 * Append `?back=<urlencoded current qs>` to a row/detail link. No-op when
 * the page has no state worth carrying (the link stays clean).
 */
export function withBackParam(href: string, sp: SearchParamsShape | null | undefined): string {
  const qs = currentQueryString(sp);
  if (!qs) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}back=${encodeURIComponent(qs)}`;
}

/**
 * Resolve the restore URL for a BackLink. `back` is the raw searchParam
 * value as Next.js delivers it (already URL-decoded once). Only a query
 * string is ever restored — anything that smells like a path, protocol, or
 * host falls back to the bare route.
 */
export function backHref(fallback: string, back: string | string[] | undefined): string {
  const raw = typeof back === "string" ? back.trim() : "";
  if (!raw) return fallback;
  const qs = raw.replace(/^\?/, "");
  // Reject anything that could change the destination path/origin.
  if (!qs || qs.startsWith("/") || qs.startsWith("\\") || qs.includes("://")) return fallback;
  // Must parse as a query string with at least one key.
  const parsed = new URLSearchParams(qs);
  let hasAny = false;
  for (const [k] of parsed) {
    if (k) {
      hasAny = true;
      break;
    }
  }
  if (!hasAny) return fallback;
  // Re-serialize through URLSearchParams so stray characters are normalized.
  return `${fallback}?${parsed.toString()}`;
}

// ---------------------------------------------------------------------------
// Self-tests (wired into scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runBackLinkTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // currentQueryString
  ok(currentQueryString({ status: "new", q: "sarah" }) === "status=new&q=sarah", "carries filters");
  ok(currentQueryString({ status: "new", error: "x", saved: "1" }) === "status=new", "strips transients");
  ok(currentQueryString({}) === "", "empty sp is empty");
  ok(currentQueryString(null) === "", "null sp is empty");
  ok(currentQueryString({ error: "x" }) === "", "only-transient sp is empty");
  ok(currentQueryString({ tag: ["a", "b"] }) === "tag=a&tag=b", "multi-value preserved");
  ok(currentQueryString({ q: undefined }) === "", "undefined value skipped");
  ok(
    currentQueryString({ back: "status=new" }) === "back=status%3Dnew",
    "nested back key carried (multi-level chains)",
  );
  ok(currentQueryString({ q: "50% off" }) === "q=50%25+off", "special chars encoded");
  ok(
    currentQueryString({ status: "new", created: "SKU-1", resolved: "1", who: "Sarah" }) === "status=new",
    "one-shot result banners stripped (created/resolved/who)",
  );
  ok(
    currentQueryString({ tab: "drafts", generated: "3", clusters: "2", kbdone: "1" }) === "tab=drafts",
    "AI/KB flash counters stripped, real tab filter kept",
  );

  // withBackParam
  ok(
    withBackParam("/admin/orders/123", { status: "new", q: "sarah" }) ===
      "/admin/orders/123?back=status%3Dnew%26q%3Dsarah",
    "row link gains ?back=",
  );
  ok(withBackParam("/admin/orders/123", {}) === "/admin/orders/123", "no state -> clean link");
  ok(
    withBackParam("/admin/orders/123?tab=notes", { q: "x" }) ===
      "/admin/orders/123?tab=notes&back=q%3Dx",
    "existing query uses & separator",
  );
  ok(
    withBackParam("/admin/orders/123", { error: "boom" }) === "/admin/orders/123",
    "transient-only state -> clean link",
  );

  // backHref — restore
  ok(backHref("/admin/orders", "status=new&q=sarah") === "/admin/orders?status=new&q=sarah", "restores qs");
  ok(backHref("/admin/orders", undefined) === "/admin/orders", "missing back -> fallback");
  ok(backHref("/admin/orders", "") === "/admin/orders", "empty back -> fallback");
  ok(backHref("/admin/orders", ["a=1", "b=2"] as unknown as string[]) === "/admin/orders", "array back -> fallback");
  ok(backHref("/admin/orders", "?status=new") === "/admin/orders?status=new", "leading ? tolerated");

  // backHref — safety
  ok(backHref("/admin/orders", "/etc/passwd") === "/admin/orders", "path back rejected");
  ok(backHref("/admin/orders", "//evil.com") === "/admin/orders", "protocol-relative rejected");
  ok(backHref("/admin/orders", "https://evil.com") === "/admin/orders", "absolute URL rejected");
  ok(backHref("/admin/orders", "\\\\evil") === "/admin/orders", "backslash rejected");
  ok(backHref("/admin/orders", "a=https%3A%2F%2Fok") === "/admin/orders?a=https%3A%2F%2Fok", "encoded URL as VALUE is fine");

  // round-trip: list -> detail -> back restores identical qs
  const sp = { status: "new", q: "sarah", saved: "1" };
  const link = withBackParam("/admin/orders/123", sp);
  const backVal = decodeURIComponent(link.split("back=")[1]); // what Next hands the detail page
  ok(backHref("/admin/orders", backVal) === "/admin/orders?status=new&q=sarah", "round-trip restores (minus transients)");

  // two-level round-trip: menus list -> menu detail -> item -> back -> back
  const menuSp = { back: "q=abc" }; // menu detail arrived carrying the list's state
  const itemLink = withBackParam("/admin/purchasing/menus/5/item/9", menuSp);
  const itemBackVal = decodeURIComponent(itemLink.split("back=")[1]);
  const restoredMenu = backHref("/admin/purchasing/menus/5", itemBackVal);
  ok(restoredMenu === "/admin/purchasing/menus/5?back=q%3Dabc", "level 1: item restores menu WITH its back");
  const menuBack = new URLSearchParams(restoredMenu.split("?")[1]).get("back") ?? "";
  ok(backHref("/admin/purchasing/menus", menuBack) === "/admin/purchasing/menus?q=abc", "level 2: menu restores list");

  console.log(`back-link-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} back-link-core tests failed`);
}
