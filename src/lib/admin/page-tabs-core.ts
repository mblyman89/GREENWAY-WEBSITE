/**
 * src/lib/admin/page-tabs-core.ts  (S27 — one query-param tab primitive)
 *
 * PURE. No React, no next/*, no I/O. Embedded self-tests run in
 * scripts/compliance/run-pure-selftests.ts; tests/compliance/page-tabs.test.ts
 * renders the component.
 *
 * Generalises receiving-tabs-core (F-107): tabs are plain `?tab=` links on ONE
 * route, the active tab is resolved on the SERVER, an explicit `?tab=` always
 * wins, and a tab can auto-open when the URL carries one of its error codes or
 * result params (so a failure banner is never hidden behind another tab). S28
 * (Issues tabs), S29 and S30 build on this with no further primitive work.
 *
 * Deliberately NOT folded in: ReportTabs (client, route-per-tab, F-108/F-122).
 * Two tab primitives, each documented, never a third.
 *
 * Research: GOV.UK Design System "Tabs" — tabs are links to sections, the
 * current tab is marked (aria-current), and content must still work without
 * JavaScript (https://design-system.service.gov.uk/components/tabs/). A zero-
 * JS server component is that pattern by construction.
 */

export type TabSpec<K extends string = string> = {
  key: K;
  label: string;
  icon?: string;
  /** Tooltip / one-line description. */
  blurb?: string;
  /** `?error=` codes that auto-open this tab (no explicit `?tab=`). */
  autoOpenOn?: ReadonlySet<string>;
  /** Result-banner params whose PRESENCE auto-opens this tab (e.g. kbdone). */
  autoOpenParams?: readonly string[];
  /** Optional count pill (e.g. S28's issue count). Hidden when null/undefined. */
  count?: number | null;
  /**
   * S28 (D-R2-2): the pill's tone. "danger" only when something BLOCKS
   * (Needs action); warnings alone keep the neutral pill.
   */
  countTone?: "neutral" | "danger";
  /**
   * R19 (bible S19.18): a QUIET "look here" cue instead of auto-opening the
   * tab. Rendered as a highlight ring plus a slow glow that runs twice (4s,
   * under WCAG 2.2.2's 5-second line, 0.5 Hz — far below 2.3.1's 3 flashes/s)
   * and then rests on a static ring; none at all under prefers-reduced-motion.
   * Screen readers get ", needs attention" in the tab's name.
   */
  attention?: boolean;
  /**
   * R19: extra params ONLY this tab's link carries (on top of `allow`), so a
   * result banner that lives on this tab (e.g. `booksError` on Accounting)
   * survives the click instead of being dropped.
   */
  keepParams?: readonly string[];
};

export type TabParams = { tab?: string; error?: string; [k: string]: string | undefined };

function present(v: string | undefined): boolean {
  return typeof v === "string" && v.length > 0;
}

/**
 * Which tab to render.
 *   1. explicit `?tab=<known key>` — the user clicked a tab; honour it;
 *   2. the first tab (display order) whose autoOpenOn holds `?error=`;
 *   3. the first tab (display order) with one of its autoOpenParams present;
 *   4. `fallback`.
 * Unknown `?tab=` / `?error=` values fall through (never guess).
 */
export function resolveTab<K extends string>(tabs: readonly TabSpec<K>[], params: TabParams, fallback: K): K {
  const explicit = tabs.find((t) => t.key === params.tab);
  if (explicit) return explicit.key;
  const err = params.error;
  if (present(err)) {
    const byError = tabs.find((t) => t.autoOpenOn?.has(err as string));
    if (byError) return byError.key;
  }
  const byParam = tabs.find((t) => (t.autoOpenParams ?? []).some((p) => present(params[p])));
  if (byParam) return byParam.key;
  return fallback;
}

/** Params a tab switch keeps by default: the worklist state (search, filter, way back). */
export const DEFAULT_KEEP_PARAMS: readonly string[] = ["q", "status", "back"];

/**
 * The href for one tab. Keeps the listed params that carry a value (so
 * switching tabs never loses the worklist), drops any `tab` in `keep`, and
 * puts `tab=` first. Result banners (error, saved, …) are NOT kept unless the
 * caller lists them — they belong to the tab that produced them.
 */
export function tabHref(
  base: string,
  key: string,
  keep: Readonly<Record<string, string | undefined>> = {},
  allow: readonly string[] = DEFAULT_KEEP_PARAMS,
): string {
  const qs = new URLSearchParams();
  qs.set("tab", key);
  for (const name of allow) {
    if (name === "tab") continue;
    const v = keep[name];
    if (present(v)) qs.set(name, v as string);
  }
  return `${base}?${qs.toString()}`;
}

/**
 * S28: the href for one tab on a page whose worklist state is too rich for an
 * allow-list (the Inventory page carries ~30 facet/flag/range params, some
 * repeated). `carry` is the page's own serialized query; every pair survives
 * in order (repeated keys included) except `tab`, which is set first, and the
 * names in `drop` (result banners, paging). Never guesses a param.
 */
export function tabHrefCarry(
  base: string,
  key: string,
  carry: string,
  drop: readonly string[] = [],
): string {
  const src = new URLSearchParams(carry);
  const qs = new URLSearchParams();
  qs.set("tab", key);
  const dropped = new Set(["tab", ...drop]);
  for (const [name, value] of src) {
    if (dropped.has(name) || value === "") continue;
    qs.append(name, value);
  }
  return `${base}?${qs.toString()}`;
}

/** The count pill text: null when hidden; "99+" past 99 (keeps the tab row calm). */
export function tabCountLabel(count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** Accessible name for a tab with a count ("Issues, 3 items"). */
export function tabAriaLabel(label: string, count: number | null | undefined): string {
  const c = tabCountLabel(count);
  return c ? `${label}, ${c} item${c === "1" ? "" : "s"}` : label;
}

/**
 * R19: the tab's accessible name, or null when the visible label already says
 * everything (no pill, no attention) — so plain tabs render no aria-label and
 * the Receiving strip stays byte-identical.
 *   ("Accounting", 2, true)  → "Accounting, 2 items, needs attention"
 *   ("Accounting", 0, true)  → "Accounting, needs attention"
 *   ("Issues", 3, false)     → "Issues, 3 items"
 */
export function tabAccessibleName(
  label: string,
  count: number | null | undefined,
  attention: boolean | undefined,
): string | null {
  const pill = tabCountLabel(count);
  if (!pill && attention !== true) return null;
  const base = tabAriaLabel(label, count);
  return attention === true ? `${base}, needs attention` : base;
}

/** R19: the allow-list for ONE tab's link: the strip's list plus the tab's own keepParams (deduped, order kept). */
export function tabAllowFor(allow: readonly string[], tab: { keepParams?: readonly string[] }): readonly string[] {
  const extra = tab.keepParams ?? [];
  if (extra.length === 0) return allow;
  const out = [...allow];
  for (const p of extra) if (!out.includes(p)) out.push(p);
  return out;
}

/**
 * Attach live counts to a static tab list (e.g. the Suggestions pill). Keys
 * not in `counts` keep whatever count they had; the input is never mutated.
 */
export function withTabCounts<K extends string>(
  tabs: readonly TabSpec<K>[],
  counts: Partial<Record<K, number | null | undefined>>,
): TabSpec<K>[] {
  return tabs.map((t) => (Object.prototype.hasOwnProperty.call(counts, t.key) ? { ...t, count: counts[t.key] } : { ...t }));
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern)
// ---------------------------------------------------------------------------

export function __runPageTabsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, what: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL page-tabs-core:", what);
    }
  };
  type K = "main" | "manual" | "issues";
  const tabs: TabSpec<K>[] = [
    { key: "main", label: "Main" },
    { key: "manual", label: "Manual", autoOpenOn: new Set(["parse", "shared"]), autoOpenParams: ["kbdone"] },
    { key: "issues", label: "Issues", autoOpenOn: new Set(["shared", "held"]), autoOpenParams: ["kbdone", "flag"] },
  ];

  // resolveTab
  ok(resolveTab(tabs, {}, "main") === "main", "no params → fallback");
  ok(resolveTab(tabs, { tab: "issues" }, "main") === "issues", "explicit tab");
  ok(resolveTab(tabs, { tab: "main", error: "parse" }, "issues") === "main", "explicit tab wins over error");
  ok(resolveTab(tabs, { tab: "main", kbdone: "3" }, "issues") === "main", "explicit tab wins over param");
  ok(resolveTab(tabs, { error: "parse" }, "main") === "manual", "error auto-opens its tab");
  ok(resolveTab(tabs, { error: "held" }, "main") === "issues", "error auto-opens a later tab");
  ok(resolveTab(tabs, { error: "shared" }, "main") === "manual", "two tabs claim a code → first in display order");
  ok(resolveTab(tabs, { kbdone: "1" }, "main") === "manual", "param auto-opens (first claimant)");
  ok(resolveTab(tabs, { flag: "x" }, "main") === "issues", "param auto-opens a later tab");
  ok(resolveTab(tabs, { flag: "" }, "main") === "main", "empty param is not present");
  ok(resolveTab(tabs, { error: "held", kbdone: "1" }, "main") === "issues", "error outranks a result param");
  ok(resolveTab(tabs, { error: "" }, "issues") === "issues", "empty error → fallback");
  ok(resolveTab(tabs, { tab: "bogus" }, "main") === "main", "unknown tab → fallback");
  ok(resolveTab(tabs, { tab: "bogus", error: "parse" }, "main") === "manual", "unknown tab does not block auto-open");
  ok(resolveTab(tabs, { error: "nope" }, "main") === "main", "unknown error → fallback");
  ok(resolveTab(tabs, { tab: "Issues" }, "main") === "main", "tab keys are exact (case-sensitive)");
  ok(resolveTab([], { tab: "x" }, "main") === "main", "no tabs → fallback");

  // tabHref
  ok(tabHref("/admin/x", "issues") === "/admin/x?tab=issues", "bare href");
  ok(
    tabHref("/admin/x", "issues", { q: "blue dream", status: "approved", back: "/admin/y?z=1", tab: "main", error: "e" }) ===
      "/admin/x?tab=issues&q=blue+dream&status=approved&back=%2Fadmin%2Fy%3Fz%3D1",
    "keeps q/status/back (encoded), drops tab and banners",
  );
  ok(tabHref("/admin/x", "a", { q: "", status: undefined }) === "/admin/x?tab=a", "blank keep values dropped");
  ok(tabHref("/admin/x", "a", { vendor: "v1", q: "k" }, ["vendor"]) === "/admin/x?tab=a&vendor=v1", "custom allow-list replaces the default");
  ok(tabHref("/admin/x", "a", { tab: "b" }, ["tab"]) === "/admin/x?tab=a", "tab can never be kept");
  ok(tabHref("/admin/x", "a b") === "/admin/x?tab=a+b", "key encoded");
  ok(DEFAULT_KEEP_PARAMS.join(",") === "q,status,back", "default keep list");

  // count pill
  ok(tabCountLabel(undefined) === null && tabCountLabel(null) === null, "no count → hidden");
  ok(tabCountLabel(0) === null && tabCountLabel(-2) === null, "zero/negative hidden");
  ok(tabCountLabel(Number.NaN) === null && tabCountLabel(Infinity) === null, "non-finite hidden");
  ok(tabCountLabel(1) === "1" && tabCountLabel(99) === "99", "1..99 shown as-is");
  ok(tabCountLabel(100) === "99+", "100 → 99+");
  ok(tabCountLabel(2.7) === "2", "fractions floored");
  ok(tabAriaLabel("Issues", 3) === "Issues, 3 items", "aria plural");
  ok(tabAriaLabel("Issues", 1) === "Issues, 1 item", "aria singular");
  ok(tabAriaLabel("Issues", 0) === "Issues", "aria no count");
  ok(tabAriaLabel("Issues", 500) === "Issues, 99+ items", "aria capped");

  // withTabCounts
  const counted = withTabCounts(tabs, { issues: 4 });
  ok(counted[2].count === 4, "count attached to its key");
  ok(counted[0].count === undefined && counted[1].count === undefined, "other tabs untouched");
  ok(tabs[2].count === undefined, "input not mutated");
  ok(counted[0] !== tabs[0], "returns fresh objects");
  ok(counted.map((t) => t.key).join(",") === "main,manual,issues", "order kept");
  const pre: TabSpec<K>[] = [{ key: "main", label: "Main", count: 7 }];
  ok(withTabCounts(pre, {})[0].count === 7, "absent key keeps its existing count");
  ok(withTabCounts(pre, { main: null })[0].count === null, "explicit null clears the pill");

  // tabHrefCarry (S28)
  ok(tabHrefCarry("/admin/x", "issues", "") === "/admin/x?tab=issues", "carry: empty query");
  ok(
    tabHrefCarry("/admin/x", "lots", "tab=issues&fVendor=A&fVendor=B%2C+C&q=blue") ===
      "/admin/x?tab=lots&fVendor=A&fVendor=B%2C+C&q=blue",
    "carry: repeated keys kept in order, old tab replaced",
  );
  ok(
    tabHrefCarry("/admin/x", "lots", "page=3&restored=ok&q=k", ["page", "restored"]) === "/admin/x?tab=lots&q=k",
    "carry: dropped names removed",
  );
  ok(tabHrefCarry("/admin/x", "a", "q=&status=active") === "/admin/x?tab=a&status=active", "carry: blank values dropped");
  ok(tabHrefCarry("/admin/x", "a", "?q=z") === "/admin/x?tab=a&q=z", "carry: a leading ? is tolerated");

  // R19: tabAccessibleName / tabAllowFor
  ok(tabAccessibleName("Accounting", undefined, undefined) === null, "a11y: plain tab \u2192 no aria-label");
  ok(tabAccessibleName("Accounting", 0, false) === null, "a11y: zero count, no attention \u2192 null");
  ok(tabAccessibleName("Issues", 3, false) === "Issues, 3 items", "a11y: count only matches tabAriaLabel");
  ok(tabAccessibleName("Accounting", 1, true) === "Accounting, 1 item, needs attention", "a11y: count + attention");
  ok(tabAccessibleName("Accounting", null, true) === "Accounting, needs attention", "a11y: attention only");
  ok(tabAccessibleName("Accounting", 500, true) === "Accounting, 99+ items, needs attention", "a11y: capped + attention");
  const allowBase = ["q"] as const;
  ok(tabAllowFor(allowBase, {}) === allowBase, "allowFor: no keepParams \u2192 same list");
  ok(tabAllowFor([], { keepParams: ["booksError", "books"] }).join(",") === "booksError,books", "allowFor: adds keepParams");
  ok(tabAllowFor(["q", "books"], { keepParams: ["books", "booksError"] }).join(",") === "q,books,booksError", "allowFor: dedup, order kept");
  ok(
    tabHref("/m", "accounting", { booksError: "no category", tab: "delivery" }, tabAllowFor([], { keepParams: ["booksError"] })) ===
      "/m?tab=accounting&booksError=no+category",
    "allowFor: the banner param survives the click",
  );

  return { passed, failed };
}
