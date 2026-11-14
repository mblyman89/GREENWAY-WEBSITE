/**
 * D244 E-1b — "keep my place" on the product detail page (F-40, F-41).
 *
 * PURE. Every detail-page action posts the list's query string as `back`,
 * and every redirect keeps it, so "← All products" always returns to the
 * same filtered list (and page). Prev / Next / Save & next walk the list
 * order the worklist saved for that SAME `back` (sessionStorage), so the
 * detail page never re-runs the list query.
 */

/** sessionStorage key for the worklist order. */
export const WORKLIST_ORDER_STORAGE_KEY = "gw.worklist.order";
/** The editor and publish forms on the detail page (Save & next joins them by `form=`). */
export const DETAIL_EDITOR_FORM_ID = "enrich-editor-form";
export const DETAIL_PUBLISH_FORM_ID = "enrich-publish-form";
const BACK_MAX = 4000;
const KEY_MAX = 300;

/**
 * The list query string to carry, or "". Only a query string survives:
 * anything that could change the path/origin is dropped (same rule as
 * backHref). "/admin/products?q=x" is accepted as "q=x".
 */
export function cleanBack(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let v = raw.trim();
  if (v.startsWith("/admin/products?")) v = v.slice("/admin/products?".length);
  v = v.replace(/^\?/, "");
  if (!v || v.length > BACK_MAX) return "";
  if (v.startsWith("/") || v.startsWith("\\") || v.includes("://")) return "";
  return v;
}

/** A product key from a form field, or "" (bounded, no control chars). */
export function cleanKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const v = raw.trim();
  if (!v || v.length > KEY_MAX || /[\u0000-\u001f]/.test(v)) return "";
  return v;
}

/**
 * The detail URL for `key`: the flash params first, then `back` (the list
 * query string, encoded), then the hash. `flash` may start with "?"
 * ("?saved=1", "?error=..."); with no flash and no back there is no "?".
 */
export function detailUrl(key: string, back: string, flash = "", hash = ""): string {
  const parts: string[] = [];
  const f = flash.replace(/^\?/, "");
  if (f) parts.push(f);
  const b = cleanBack(back);
  if (b) parts.push(`back=${encodeURIComponent(b)}`);
  const h = hash && !hash.startsWith("#") ? `#${hash}` : hash;
  return `/admin/products/${encodeURIComponent(key)}${parts.length ? `?${parts.join("&")}` : ""}${h}`;
}

export type StoredOrder = { back: string; keys: string[] };

export function serializeOrder(back: string, keys: readonly string[]): string {
  return JSON.stringify({ back: cleanBack(back), keys: keys.slice(0, 2000) });
}

/** The saved order, only when it was saved for this same `back`; else null. */
export function parseStoredOrder(raw: string | null | undefined, back: string): string[] | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<StoredOrder>;
    if (!o || typeof o.back !== "string" || !Array.isArray(o.keys)) return null;
    if (o.back !== cleanBack(back)) return null;
    return o.keys.filter((k): k is string => typeof k === "string" && k.length > 0);
  } catch {
    return null;
  }
}

export type Neighbours = { prev: string | null; next: string | null; index: number; total: number };

/** Where `key` sits in the list; index -1 = not in it (no prev/next). */
export function neighbours(order: readonly string[] | null, key: string): Neighbours {
  if (!order || order.length === 0) return { prev: null, next: null, index: -1, total: 0 };
  const i = order.indexOf(key);
  if (i < 0) return { prev: null, next: null, index: -1, total: order.length };
  return { prev: i > 0 ? order[i - 1]! : null, next: i < order.length - 1 ? order[i + 1]! : null, index: i, total: order.length };
}

/** "published:next" -> { status: "published", andNext: true } */
export function parseStatusIntent(raw: unknown): { status: "published" | "draft" | "archived"; andNext: boolean } {
  const s = typeof raw === "string" ? raw : "";
  const [base, then] = s.split(":");
  const status = base === "published" ? "published" : base === "archived" ? "archived" : "draft";
  return { status, andNext: then === "next" };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runDetailNavCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.log("FAIL detail-nav-core:", m);
    }
  };

  ok(cleanBack("q=gas&stock=all") === "q=gas&stock=all", "qs kept");
  ok(cleanBack("?q=gas") === "q=gas", "leading ? dropped");
  ok(cleanBack("/admin/products?q=gas") === "q=gas", "list path form accepted");
  ok(cleanBack("/evil?x=1") === "", "other path refused");
  ok(cleanBack("https://evil.example/?a=1") === "", "origin refused");
  ok(cleanBack("a=1&u=https://x") === "", "scheme anywhere refused");
  ok(cleanBack("x".repeat(4001)) === "", "too long refused");
  ok(cleanBack(null) === "" && cleanBack(["q=1"]) === "", "non-string refused");
  ok(cleanKey(" LOT-A ") === "LOT-A", "key trimmed");
  ok(cleanKey("a\nb") === "" && cleanKey("") === "" && cleanKey("k".repeat(301)) === "", "bad keys refused");

  ok(detailUrl("K 1", "", "?saved=1") === "/admin/products/K%201?saved=1", "no back = old URL");
  ok(detailUrl("K", "", "?ai=1", "#ai") === "/admin/products/K?ai=1#ai", "hash kept");
  ok(detailUrl("K", "", "", "#ai") === "/admin/products/K#ai", "no flash no back no ?");
  ok(detailUrl("K", "q=gas&page=2", "?saved=1") === "/admin/products/K?saved=1&back=q%3Dgas%26page%3D2", "back carried, encoded");
  ok(detailUrl("K", "q=x", "error=" + encodeURIComponent("Bad & worse"), "matches") === "/admin/products/K?error=Bad%20%26%20worse&back=q%3Dx#matches", "error + back + bare hash");
  ok(detailUrl("K", "https://evil", "?saved=1") === "/admin/products/K?saved=1", "bad back dropped");
  ok(new URL("http://h" + detailUrl("K", "q=a&b=c", "?saved=1")).searchParams.get("back") === "q=a&b=c", "back round-trips");

  const stored = serializeOrder("q=gas", ["A", "B", "C"]);
  ok(JSON.stringify(parseStoredOrder(stored, "q=gas")) === '["A","B","C"]', "order for same back");
  ok(parseStoredOrder(stored, "q=other") === null, "other list ignored");
  ok(parseStoredOrder(stored, "?q=gas")?.length === 3, "back normalised");
  ok(parseStoredOrder("{nope", "q=gas") === null && parseStoredOrder(null, "") === null, "junk ignored");
  ok(parseStoredOrder(JSON.stringify({ back: "", keys: ["A", 3, ""] }), "")?.join() === "A", "non-string keys dropped");
  ok(JSON.parse(serializeOrder("", Array.from({ length: 2500 }, (_, i) => `k${i}`))).keys.length === 2000, "order capped at 2000");

  const n = neighbours(["A", "B", "C"], "B");
  ok(n.prev === "A" && n.next === "C" && n.index === 1 && n.total === 3, "middle");
  ok(neighbours(["A", "B"], "A").prev === null && neighbours(["A", "B"], "A").next === "B", "first");
  ok(neighbours(["A", "B"], "B").next === null, "last");
  ok(neighbours(["A"], "Z").index === -1 && neighbours(["A"], "Z").next === null, "not in list");
  ok(neighbours(null, "A").total === 0, "no list");

  ok(JSON.stringify(parseStatusIntent("published:next")) === '{"status":"published","andNext":true}', "publish & next");
  ok(JSON.stringify(parseStatusIntent("published")) === '{"status":"published","andNext":false}', "publish");
  ok(parseStatusIntent("archived").status === "archived" && parseStatusIntent("junk").status === "draft", "fallback draft");
  ok(parseStatusIntent("draft:next").andNext && !parseStatusIntent("draft:later").andNext, "only :next");

  return { passed, failed };
}
