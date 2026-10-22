/**
 * src/lib/inventory/receiving-table-core.ts  (R50 S10a, owner follow-up #5)
 *
 * PURE logic for the Receiving table's views, filters and sorting.
 *
 * The owner asked for:
 *   1. "an option to the receiving pages table that lets me see all the
 *      Cultivera manifests in there, I can open the manifest like ones we
 *      intake. It should have a completed not complete status so I can see
 *      which ones are still in need of attention."
 *   2. "better filters and sorting so I can organize the list however I need."
 *
 * Three views share one table header:
 *   - "action"    (default, unchanged): open native deliveries only;
 *   - "all"       (unchanged): every native delivery, open ones first;
 *   - "cultivera" (new): every manifest rebuilt from the Cultivera export,
 *                 with Complete / Needs attention from the onboarding tally.
 *
 * Rebuilt manifests stay OUT of the two native views and the stage counts
 * (they are history, not deliveries: R50 S2c). They are listed only when the
 * owner picks the Cultivera view.
 *
 * Completion rule (one rule, from the onboarding tally the Product Onboarding
 * page already shows; cultiveraManifestRows):
 *   - complete        = onboarding rows exist and none is still open;
 *   - not started     = no onboarding row yet          (needs attention);
 *   - in review       = at least one open row          (needs attention);
 *   - unknown         = the tally could not be read. Never shown as complete
 *                       and never hidden by the Complete / Not complete
 *                       filters (an unread count is not evidence either way).
 *
 * Filters and sorting follow the common admin-grid pattern (status facet,
 * vendor facet, free-text search, date range, sortable columns), all carried
 * in the URL so a filtered list can be bookmarked and the Back button works.
 * Unknown or hand-edited values fall back to the default; nothing throws.
 *
 * No I/O, no React. Self-tests at the bottom (run-pure-selftests).
 */

import { normalizeStage, classifyEta } from "@/lib/inventory/manifest-pipeline-core";
import { pacificDayKey } from "@/lib/reports/timezone";
import type { CultiveraRowView } from "@/lib/inventory/cultivera-onboarding-core";
import { parseSourceFilter, type CultiveraSource } from "@/lib/inventory/cultivera-vendor-core";

export const RECEIVING_PATH = "/admin/inventory/intake";

// --- 1. Views -----------------------------------------------------------------

export type ReceivingView = "action" | "all" | "cultivera";

export function resolveReceivingView(v: unknown): ReceivingView {
  return v === "all" ? "all" : v === "cultivera" ? "cultivera" : "action";
}

// --- 2. Status facets ---------------------------------------------------------

/** Native-delivery status filter values (the stage enum + "overdue"). */
export const NATIVE_STATUS_FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "in_transit", label: "In transit" },
  { value: "overdue", label: "In transit, past ETA" },
  { value: "received", label: "Received (awaiting intake)" },
  { value: "accepted", label: "Accepted" },
  { value: "partially_accepted", label: "Partially accepted" },
  { value: "rejected", label: "Rejected" },
] as const;

/** Cultivera-view status filter values. */
export const CULTIVERA_STATUS_FILTERS = [
  { value: "not_complete", label: "Not complete (needs attention)" },
  { value: "complete", label: "Complete" },
  { value: "not_started", label: "Not started" },
  { value: "in_review", label: "In review" },
  { value: "unknown", label: "Unknown (count could not be read)" },
] as const;

export type CultiveraCompletion = "complete" | "not_complete" | "unknown";

/**
 * Complete / Not complete for one rebuilt manifest. `tallyRead` false = the
 * draft tally failed, so every row is "unknown" (cultiveraManifestRows then
 * reports "not_started" with an Unknown label; this keeps that from reading
 * as "needs attention" or "complete").
 */
export function cultiveraCompletion(state: CultiveraRowView["state"], tallyRead: boolean): CultiveraCompletion {
  if (!tallyRead) return "unknown";
  return state === "done" ? "complete" : "not_complete";
}

export const COMPLETION_LABEL: Record<CultiveraCompletion, string> = {
  complete: "Complete",
  not_complete: "Needs attention",
  unknown: "Unknown",
};

// --- 3. Sorting ---------------------------------------------------------------

export const SORT_OPTIONS = [
  { value: "default", label: "Default order" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "vendor_az", label: "Vendor A to Z" },
  { value: "vendor_za", label: "Vendor Z to A" },
  { value: "number_az", label: "Manifest # A to Z" },
  { value: "number_za", label: "Manifest # Z to A" },
  { value: "status", label: "Status (needs attention first)" },
  { value: "eta", label: "ETA (soonest first)" },
  { value: "lots_desc", label: "Most lots first" },
] as const;

export type ReceivingSort = (typeof SORT_OPTIONS)[number]["value"];

const SORT_SET: ReadonlySet<string> = new Set(SORT_OPTIONS.map((o) => o.value));

/** ETA only means something for a native delivery; lots only for rebuilt manifests. */
export function sortOptionsFor(view: ReceivingView): readonly { value: ReceivingSort; label: string }[] {
  return SORT_OPTIONS.filter((o) => (view === "cultivera" ? o.value !== "eta" : o.value !== "lots_desc"));
}

// --- 4. Parsed filter state ---------------------------------------------------

export type ReceivingFilters = {
  view: ReceivingView;
  q: string;
  vendor: string;
  status: string;
  from: string;
  to: string;
  sort: ReceivingSort;
  page: number;
  /** R74 S11: Cultivera view only - where the manifest came from ("" = any). */
  source: CultiveraSource | "";
  /** R74 S11: Cultivera view only - "vendor" shows the by-vendor roll-up above the table. */
  group: "" | "vendor";
};

export const CULTIVERA_TABLE_PAGE_SIZE = 50;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string {
  if (Array.isArray(v)) return str(v[0]);
  return typeof v === "string" ? v : "";
}

function validDay(v: unknown): string {
  const s = str(v).trim();
  if (!DAY_RE.test(s)) return "";
  const t = Date.parse(`${s}T12:00:00Z`);
  if (Number.isNaN(t)) return "";
  // Reject roll-overs such as 2026-02-31 (Date.parse accepts and shifts them).
  return new Date(t).toISOString().slice(0, 10) === s ? s : "";
}

/** URL search params -> filter state. Bad values fall back to defaults. */
export function parseReceivingFilters(sp: Record<string, unknown>): ReceivingFilters {
  const view = resolveReceivingView(str(sp.view));
  const statusRaw = str(sp.status).trim();
  const allowed: readonly string[] = (view === "cultivera" ? CULTIVERA_STATUS_FILTERS : NATIVE_STATUS_FILTERS).map(
    (s) => s.value,
  );
  const sortRaw = str(sp.sort).trim();
  const sortOk = SORT_SET.has(sortRaw) && sortOptionsFor(view).some((o) => o.value === sortRaw);
  let from = validDay(sp.from);
  let to = validDay(sp.to);
  if (from && to && from > to) [from, to] = [to, from];
  const pageRaw = str(sp.page).trim();
  const page = /^\d{1,4}$/.test(pageRaw) && Number(pageRaw) >= 1 ? Number(pageRaw) : 1;
  return {
    view,
    q: str(sp.q).trim().slice(0, 80),
    vendor: str(sp.vendor).trim().slice(0, 120),
    status: allowed.includes(statusRaw) ? statusRaw : "",
    from,
    to,
    sort: sortOk ? (sortRaw as ReceivingSort) : "default",
    page,
    source: view === "cultivera" ? parseSourceFilter(sp.source) : "",
    group: view === "cultivera" && str(sp.group).trim() === "vendor" ? "vendor" : "",
  };
}

/** True when any filter (not the view, sort or page) narrows the list. */
export function hasActiveFilters(f: ReceivingFilters): boolean {
  return Boolean(f.q || f.vendor || f.status || f.from || f.to || f.source);
}

/**
 * The URL for a filter state. Defaults are dropped so the plain page stays
 * `/admin/inventory/intake` and the existing `?view=all` link is unchanged.
 * `patch` changes some fields; changing anything but `page` resets the page.
 */
export function receivingHref(f: ReceivingFilters, patch: Partial<ReceivingFilters> = {}): string {
  const resetsPage = Object.keys(patch).some((k) => k !== "page");
  const viewChanged = patch.view !== undefined && patch.view !== f.view;
  const n: ReceivingFilters = { ...f, ...patch, page: patch.page ?? (resetsPage ? 1 : f.page) };
  // Status and sort values differ per view: switching views clears them.
  if (viewChanged) {
    if (patch.status === undefined) n.status = "";
    if (patch.sort === undefined) n.sort = "default";
    // Source and grouping exist only on the Cultivera view.
    if (n.view !== "cultivera") {
      n.source = "";
      n.group = "";
    }
  }
  const qs = new URLSearchParams();
  if (n.view !== "action") qs.set("view", n.view);
  if (n.q) qs.set("q", n.q);
  if (n.vendor) qs.set("vendor", n.vendor);
  if (n.status) qs.set("status", n.status);
  if (n.from) qs.set("from", n.from);
  if (n.to) qs.set("to", n.to);
  if (n.sort !== "default") qs.set("sort", n.sort);
  if (n.source) qs.set("source", n.source);
  if (n.group) qs.set("group", n.group);
  if (n.page > 1) qs.set("page", String(n.page));
  const q = qs.toString();
  return q ? `${RECEIVING_PATH}?${q}` : RECEIVING_PATH;
}

/** The three view links (labels carry counts when known). */
export function receivingViewLinks(
  f: ReceivingFilters,
  counts: { processed: number; cultivera: number | null },
): { view: ReceivingView; href: string; label: string; active: boolean; title: string }[] {
  const base: ReceivingFilters = { ...f, q: "", vendor: "", status: "", from: "", to: "", sort: "default", page: 1, source: "", group: "" };
  return [
    {
      view: "action",
      href: receivingHref(base, { view: "action" }),
      label: "Needs attention",
      active: f.view === "action",
      title: "Deliveries that still need something from you. Accepted, partially accepted and rejected ones are hidden.",
    },
    {
      view: "all",
      href: receivingHref(base, { view: "all" }),
      label: `All${counts.processed > 0 ? ` (+${counts.processed} processed)` : ""}`,
      active: f.view === "all",
      title: "Every delivery: open ones first, then accepted, partially accepted and rejected.",
    },
    {
      view: "cultivera",
      href: receivingHref(base, { view: "cultivera" }),
      label: `Cultivera manifests${counts.cultivera !== null && counts.cultivera > 0 ? ` (${counts.cultivera.toLocaleString("en-US")})` : ""}`,
      active: f.view === "cultivera",
      title:
        "Every manifest rebuilt from the Cultivera export, with Complete / Needs attention for its onboarding. Open one exactly like a delivery.",
    },
  ];
}

// --- 5. Native rows: filter + sort -------------------------------------------

export type NativeRow = {
  id: string;
  manifest_number: string | null;
  vendor_label: string | null;
  status: string | null;
  eta_date: string | null;
  created_at: string | null;
  /** Whatever invoiceNumberForRow resolved (searchable). */
  invoice?: string | null;
};

function lc(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function dayOfInstant(iso: string | null | undefined): string {
  const s = (iso ?? "").trim();
  if (!s || Number.isNaN(Date.parse(s))) return "";
  return pacificDayKey(s);
}

function inRange(day: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function nativeStatusMatches(row: NativeRow, status: string, now?: Date): boolean {
  if (!status) return true;
  const stage = normalizeStage(row.status);
  if (status === "overdue") return stage === "in_transit" && classifyEta(row.eta_date, now) === "overdue";
  return stage === status;
}

/** Lower = needs attention sooner. */
const NATIVE_STATUS_RANK: Record<string, number> = {
  received: 0,
  in_transit: 1,
  pending: 2,
  partially_accepted: 3,
  accepted: 4,
  rejected: 5,
  dismissed: 6,
};

function cmpText(a: string, b: string): number {
  // Blank always sorts last, whatever the direction.
  if (!a && b) return 1;
  if (a && !b) return -1;
  return a.localeCompare(b, "en-US", { numeric: true, sensitivity: "base" });
}

/** Descending text order that still keeps blanks last. */
function cmpTextDesc(a: string, b: string): number {
  if (!a && b) return 1;
  if (a && !b) return -1;
  return cmpText(b, a);
}

/** Stable sort helper (keeps the incoming order on ties). */
function stableSort<T>(rows: readonly T[], cmp: (a: T, b: T) => number): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => cmp(x.r, y.r) || x.i - y.i)
    .map((x) => x.r);
}

function createdMs(r: NativeRow): number {
  const t = Date.parse(r.created_at ?? "");
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * Filter + sort native rows that already went through applyIntakeView
 * (the view decided which rows; this narrows and orders them). `now` decides
 * the overdue facet (injected for tests; defaults to the current instant).
 */
export function applyNativeFilters<T extends NativeRow>(rows: readonly T[], f: ReceivingFilters, now?: Date): T[] {
  const q = lc(f.q);
  const vendor = lc(f.vendor);
  const kept = rows.filter((r) => {
    if (vendor && lc(r.vendor_label) !== vendor) return false;
    if (!nativeStatusMatches(r, f.status, now)) return false;
    if (!inRange(dayOfInstant(r.created_at), f.from, f.to)) return false;
    if (q) {
      const hay = [r.manifest_number, r.vendor_label, r.invoice].map(lc).join(" \u0000 ");
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  switch (f.sort) {
    case "newest":
      return stableSort(kept, (a, b) => createdMs(b) - createdMs(a));
    case "oldest":
      return stableSort(kept, (a, b) => {
        const am = createdMs(a);
        const bm = createdMs(b);
        // Undated rows last in both directions.
        if (am === bm) return 0;
        if (am === Number.NEGATIVE_INFINITY) return 1;
        if (bm === Number.NEGATIVE_INFINITY) return -1;
        return am - bm;
      });
    case "vendor_az":
      return stableSort(kept, (a, b) => cmpText(lc(a.vendor_label), lc(b.vendor_label)));
    case "vendor_za":
      return stableSort(kept, (a, b) => cmpTextDesc(lc(a.vendor_label), lc(b.vendor_label)));
    case "number_az":
      return stableSort(kept, (a, b) => cmpText(lc(a.manifest_number), lc(b.manifest_number)));
    case "number_za":
      return stableSort(kept, (a, b) => cmpTextDesc(lc(a.manifest_number), lc(b.manifest_number)));
    case "status":
      return stableSort(
        kept,
        (a, b) => (NATIVE_STATUS_RANK[normalizeStage(a.status)] ?? 9) - (NATIVE_STATUS_RANK[normalizeStage(b.status)] ?? 9),
      );
    case "eta":
      return stableSort(kept, (a, b) => cmpText((a.eta_date ?? "").trim(), (b.eta_date ?? "").trim()));
    default:
      return kept;
  }
}

// --- 6. Cultivera rows: filter + sort + page ---------------------------------

export type CultiveraTableRow = CultiveraRowView & {
  /** YYYY-MM-DD the rebuilt manifest represents (Pacific accepted day, else transfer day). */
  dayKey: string;
  completion: CultiveraCompletion;
  /** R74 S11: where it came from (raw_payload.group_kind); "unknown" when not recorded. */
  source: CultiveraSource;
};

/** The YYYY-MM-DD a rebuilt manifest represents (same precedence as its display day). */
export function cultiveraDayKey(m: { accepted_at: string | null; transfer_date: string | null }): string {
  const fromInstant = dayOfInstant(m.accepted_at);
  if (fromInstant) return fromInstant;
  const d = (m.transfer_date ?? "").trim();
  return DAY_RE.test(d) ? d : "";
}

const CULTIVERA_STATE_RANK: Record<CultiveraTableRow["state"], number> = { in_review: 0, not_started: 1, done: 3 };

export function applyCultiveraFilters(rows: readonly CultiveraTableRow[], f: ReceivingFilters): CultiveraTableRow[] {
  const q = lc(f.q);
  const vendor = lc(f.vendor);
  const kept = rows.filter((r) => {
    if (vendor && lc(r.vendor) !== vendor) return false;
    if (f.status) {
      if (f.status === "complete" && r.completion !== "complete") return false;
      if (f.status === "not_complete" && r.completion !== "not_complete") return false;
      if (f.status === "unknown" && r.completion !== "unknown") return false;
      if ((f.status === "not_started" || f.status === "in_review") && (r.completion === "unknown" || r.state !== f.status))
        return false;
    }
    if (f.source && r.source !== f.source) return false;
    if (!inRange(r.dayKey, f.from, f.to)) return false;
    if (q && !`${lc(r.number)} \u0000 ${lc(r.vendor)}`.includes(q)) return false;
    return true;
  });
  const byDay = (a: CultiveraTableRow, b: CultiveraTableRow, dir: 1 | -1) => {
    if (a.dayKey === b.dayKey) return 0;
    if (!a.dayKey) return 1;
    if (!b.dayKey) return -1;
    return a.dayKey < b.dayKey ? -dir : dir;
  };
  switch (f.sort) {
    case "newest":
      return stableSort(kept, (a, b) => byDay(a, b, -1));
    case "oldest":
      return stableSort(kept, (a, b) => byDay(a, b, 1));
    case "vendor_az":
      return stableSort(kept, (a, b) => cmpText(lc(a.vendor), lc(b.vendor)));
    case "vendor_za":
      return stableSort(kept, (a, b) => cmpTextDesc(lc(a.vendor), lc(b.vendor)));
    case "number_az":
      return stableSort(kept, (a, b) => cmpText(lc(a.number), lc(b.number)));
    case "number_za":
      return stableSort(kept, (a, b) => cmpTextDesc(lc(a.number), lc(b.number)));
    case "status":
      // Needs attention first (in review, then not started), unknown next, complete last.
      return stableSort(kept, (a, b) => statusRank(a) - statusRank(b));
    case "lots_desc":
      return stableSort(kept, (a, b) => (b.lots ?? -1) - (a.lots ?? -1));
    default:
      return kept;
  }
}

function statusRank(r: CultiveraTableRow): number {
  if (r.completion === "unknown") return 2;
  return CULTIVERA_STATE_RANK[r.state];
}

export function cultiveraTableRows(
  views: readonly CultiveraRowView[],
  dayKeys: ReadonlyMap<string, string>,
  tallyRead: boolean,
  sources: ReadonlyMap<string, CultiveraSource> = new Map(),
): CultiveraTableRow[] {
  return views.map((v) => ({
    ...v,
    dayKey: dayKeys.get(v.id) ?? "",
    completion: cultiveraCompletion(v.state, tallyRead),
    source: sources.get(v.id) ?? "unknown",
  }));
}

export type SourceCounts = Record<CultiveraSource, number>;

/** How many manifests came from each source (the chips above the table). */
export function countSources(rows: readonly { source: CultiveraSource }[]): SourceCounts {
  const c: SourceCounts = { transfer: 0, email: 0, unmatched: 0, received: 0, unknown: 0 };
  for (const r of rows) c[r.source] += 1;
  return c;
}

export type CultiveraSummary = { total: number; complete: number; notComplete: number; unknown: number };

export function summarizeCultivera(rows: readonly CultiveraTableRow[]): CultiveraSummary {
  const s: CultiveraSummary = { total: rows.length, complete: 0, notComplete: 0, unknown: 0 };
  for (const r of rows) {
    if (r.completion === "complete") s.complete += 1;
    else if (r.completion === "not_complete") s.notComplete += 1;
    else s.unknown += 1;
  }
  return s;
}

export function pageSlice<T>(rows: readonly T[], page: number, size: number): { rows: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pageCount);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pageCount };
}

/** Distinct vendor labels for the vendor facet, A to Z, blanks dropped. */
export function vendorOptions(labels: readonly (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const l of labels) {
    const t = (l ?? "").trim();
    if (!t || t === "Unknown vendor") continue;
    if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "en-US", { sensitivity: "base" }));
}

const SOURCE_WORD: Record<CultiveraSource, string> = {
  transfer: "Cultivera transfer",
  email: "Emailed manifest",
  unmatched: "Unmatched stock",
  received: "Received-date group",
  unknown: "Not recorded",
};

/** One sentence describing what the list is showing (shown above the table). */
export function filterSummary(f: ReceivingFilters, shown: number, total: number): string {
  const parts: string[] = [];
  if (f.status) {
    const all = [...NATIVE_STATUS_FILTERS, ...CULTIVERA_STATUS_FILTERS] as readonly { value: string; label: string }[];
    const lbl = all.find((s) => s.value === f.status)?.label ?? f.status;
    parts.push(`status "${lbl}"`);
  }
  if (f.vendor) parts.push(`vendor "${f.vendor}"`);
  if (f.source) parts.push(`source "${SOURCE_WORD[f.source]}"`);
  if (f.q) parts.push(`matching "${f.q}"`);
  if (f.from && f.to) parts.push(`dated ${f.from} to ${f.to}`);
  else if (f.from) parts.push(`dated on or after ${f.from}`);
  else if (f.to) parts.push(`dated on or before ${f.to}`);
  const noun = f.view === "cultivera" ? "Cultivera manifest" : "manifest";
  const head = `Showing ${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${noun}${total === 1 ? "" : "s"}`;
  return parts.length ? `${head}, ${parts.join(", ")}.` : `${head}.`;
}

// --- 7. Self-tests ------------------------------------------------------------

export function __runReceivingTableCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL receiving-table-core: " + m);
    }
  };
  const P = (sp: Record<string, unknown>) => parseReceivingFilters(sp);

  // Views
  ok(resolveReceivingView(undefined) === "action", "default view is action");
  ok(resolveReceivingView("all") === "all", "all view");
  ok(resolveReceivingView("cultivera") === "cultivera", "cultivera view");
  ok(resolveReceivingView("CULTIVERA") === "action", "views are exact");

  // Parsing
  const d = P({});
  ok(d.view === "action" && d.sort === "default" && d.page === 1 && !hasActiveFilters(d), "empty params = defaults");
  ok(P({ status: "accepted" }).status === "accepted", "native status kept");
  ok(P({ status: "complete" }).status === "", "cultivera status refused on a native view");
  ok(P({ view: "cultivera", status: "complete" }).status === "complete", "cultivera status kept on cultivera view");
  ok(P({ view: "cultivera", status: "accepted" }).status === "", "native status refused on cultivera view");
  ok(P({ sort: "eta" }).sort === "eta", "eta sort on native");
  ok(P({ view: "cultivera", sort: "eta" }).sort === "default", "eta sort refused on cultivera");
  ok(P({ sort: "lots_desc" }).sort === "default", "lots sort refused on native");
  ok(P({ sort: "bogus" }).sort === "default", "unknown sort = default");
  ok(P({ from: "2026-02-31" }).from === "", "rolled-over date refused");
  ok(P({ from: "2026-13-01" }).from === "", "bad month refused");
  ok(P({ from: "10/01/2026" }).from === "", "US date refused");
  const sw = P({ from: "2026-10-09", to: "2026-10-01" });
  ok(sw.from === "2026-10-01" && sw.to === "2026-10-09", "reversed range is swapped");
  ok(P({ page: "3" }).page === 3 && P({ page: "0" }).page === 1 && P({ page: "-2" }).page === 1, "page parse");
  ok(P({ q: ["  abc ", "x"] }).q === "abc", "array param takes the first value, trimmed");
  ok(P({ q: "x".repeat(200) }).q.length === 80, "search clipped");
  ok(hasActiveFilters(P({ vendor: "V" })) && hasActiveFilters(P({ to: "2026-01-01" })), "active filters detected");
  ok(!hasActiveFilters(P({ sort: "newest", page: "2" })), "sort and page are not filters");

  // Hrefs
  ok(receivingHref(d) === RECEIVING_PATH, "default href is the bare path");
  ok(receivingHref(d, { view: "all" }) === `${RECEIVING_PATH}?view=all`, "all link unchanged");
  ok(receivingHref(d, { view: "cultivera" }) === `${RECEIVING_PATH}?view=cultivera`, "cultivera link");
  const f2 = P({ view: "cultivera", status: "complete", sort: "status", page: "3", vendor: "A&B" });
  ok(receivingHref(f2, { page: 4 }).includes("page=4"), "page patch keeps page");
  ok(!receivingHref(f2, { vendor: "Z" }).includes("page="), "filter change resets page");
  ok(receivingHref(f2).includes("vendor=A%26B"), "values are URL-encoded");
  const switched = receivingHref(f2, { view: "all" });
  ok(!switched.includes("status=") && !switched.includes("sort="), "switching view clears status and sort");
  ok(switched.includes("vendor=A%26B"), "switching view keeps vendor");
  const links = receivingViewLinks(f2, { processed: 4, cultivera: 1234 });
  ok(links.length === 3 && links[2].active && !links[0].active, "view links + active");
  ok(links[0].href === RECEIVING_PATH && links[1].href === `${RECEIVING_PATH}?view=all`, "view links drop filters");
  ok(links[1].label === "All (+4 processed)" && links[2].label === "Cultivera manifests (1,234)", "view link labels");
  ok(receivingViewLinks(d, { processed: 0, cultivera: null })[2].label === "Cultivera manifests", "unknown count = no number");

  // Native filters
  const rows: NativeRow[] = [
    { id: "1", manifest_number: "M-10", vendor_label: "Bravo", status: "in_transit", eta_date: "2026-10-01", created_at: "2026-10-02T18:00:00Z", invoice: "INV-77" },
    { id: "2", manifest_number: "M-9", vendor_label: "alpha", status: "received", eta_date: null, created_at: "2026-10-05T18:00:00Z" },
    { id: "3", manifest_number: "M-100", vendor_label: "Alpha", status: "accepted", eta_date: "2026-10-20", created_at: "2026-10-01T06:30:00Z" },
    { id: "4", manifest_number: null, vendor_label: null, status: "in_transit", eta_date: "2026-10-30", created_at: null },
  ];
  const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id).join(",");
  const today = new Date("2026-10-13T19:00:00Z");
  ok(ids(applyNativeFilters(rows, d, today)) === "1,2,3,4", "default keeps order and rows");
  ok(ids(applyNativeFilters(rows, P({ vendor: "ALPHA" }), today)) === "2,3", "vendor facet is case-insensitive exact");
  ok(ids(applyNativeFilters(rows, P({ vendor: "Alp" }), today)) === "", "vendor facet is not a substring match");
  ok(ids(applyNativeFilters(rows, P({ status: "overdue" }), today)) === "1", "overdue = in transit past ETA");
  ok(ids(applyNativeFilters(rows, P({ status: "in_transit" }), today)) === "1,4", "stage facet");
  const acceptedLate: NativeRow = { id: "9", manifest_number: "M-9", vendor_label: "x", status: "accepted", eta_date: "2026-09-01", created_at: null };
  ok(ids(applyNativeFilters([acceptedLate], P({ status: "overdue" }), today)) === "", "an accepted delivery past its ETA is not overdue");
  ok(ids(applyNativeFilters(rows, P({ q: "inv-77" }), today)) === "1", "search reaches the invoice #");
  ok(ids(applyNativeFilters(rows, P({ q: "m-1" }), today)) === "1,3", "search is a substring on the number");
  // 2026-10-01T06:30Z is Sep 30 in Pacific.
  ok(ids(applyNativeFilters(rows, P({ from: "2026-10-01", to: "2026-10-02" }), today)) === "1", "date range uses the Pacific day; undated rows drop");
  ok(ids(applyNativeFilters(rows, P({ to: "2026-09-30" }), today)) === "3", "to-only bound");
  ok(ids(applyNativeFilters(rows, P({ sort: "newest" }), today)) === "2,1,3,4", "newest; undated last");
  ok(ids(applyNativeFilters(rows, P({ sort: "oldest" }), today)) === "3,1,2,4", "oldest; undated last");
  ok(ids(applyNativeFilters(rows, P({ sort: "vendor_az" }), today)) === "2,3,1,4", "vendor A-Z stable, blank last");
  ok(ids(applyNativeFilters(rows, P({ sort: "vendor_za" }), today)) === "1,2,3,4", "vendor Z-A, blank last");
  ok(ids(applyNativeFilters(rows, P({ sort: "number_az" }), today)) === "2,1,3,4", "manifest # natural order (M-9 < M-10 < M-100)");
  ok(ids(applyNativeFilters(rows, P({ sort: "number_za" }), today)) === "3,1,2,4", "manifest # descending, blank last");
  ok(ids(applyNativeFilters(rows, P({ sort: "status" }), today)) === "2,1,4,3", "status: received, in transit, accepted");
  ok(ids(applyNativeFilters(rows, P({ sort: "eta" }), today)) === "1,3,4,2", "eta soonest first, none last");

  // Cultivera completion
  ok(cultiveraCompletion("done", true) === "complete", "done = complete");
  ok(cultiveraCompletion("in_review", true) === "not_complete", "in review = needs attention");
  ok(cultiveraCompletion("not_started", true) === "not_complete", "not started = needs attention");
  ok(cultiveraCompletion("done", false) === "unknown" && cultiveraCompletion("not_started", false) === "unknown", "unread tally = unknown");
  ok(cultiveraDayKey({ accepted_at: "2024-08-31T03:00:00Z", transfer_date: "2024-08-31" }) === "2024-08-30", "day key from the Pacific accepted day");
  ok(cultiveraDayKey({ accepted_at: null, transfer_date: "2024-07-03" }) === "2024-07-03", "day key falls back to transfer day");
  ok(cultiveraDayKey({ accepted_at: "nope", transfer_date: "x" }) === "", "no usable date = blank");

  const base = { stateLabel: "", inReview: 0, approved: 0, day: null } as const;
  const cv: CultiveraRowView[] = [
    { ...base, id: "a", number: "CV-2", vendor: "Zed", lots: 3, state: "done" },
    { ...base, id: "b", number: "CV-10", vendor: "Ace", lots: 9, state: "in_review" },
    { ...base, id: "c", number: "CV-1", vendor: "ace", lots: null, state: "not_started" },
  ];
  const days = new Map([
    ["a", "2024-07-01"],
    ["b", "2024-09-01"],
  ]);
  const t = cultiveraTableRows(cv, days, true);
  const PC = (sp: Record<string, unknown>) => P({ view: "cultivera", ...sp });
  ok(ids(applyCultiveraFilters(t, PC({}))) === "a,b,c", "cultivera default order kept");
  ok(ids(applyCultiveraFilters(t, PC({ status: "complete" }))) === "a", "complete facet");
  ok(ids(applyCultiveraFilters(t, PC({ status: "not_complete" }))) === "b,c", "not complete facet");
  ok(ids(applyCultiveraFilters(t, PC({ status: "in_review" }))) === "b", "in review facet");
  ok(ids(applyCultiveraFilters(t, PC({ status: "not_started" }))) === "c", "not started facet");
  ok(ids(applyCultiveraFilters(t, PC({ vendor: "ACE" }))) === "b,c", "cultivera vendor facet");
  ok(ids(applyCultiveraFilters(t, PC({ q: "cv-1" }))) === "b,c", "cultivera search");
  ok(ids(applyCultiveraFilters(t, PC({ from: "2024-08-01" }))) === "b", "cultivera date range drops undated");
  ok(ids(applyCultiveraFilters(t, PC({ sort: "newest" }))) === "b,a,c", "cultivera newest, undated last");
  ok(ids(applyCultiveraFilters(t, PC({ sort: "oldest" }))) === "a,b,c", "cultivera oldest, undated last");
  ok(ids(applyCultiveraFilters(t, PC({ sort: "number_az" }))) === "c,a,b", "cultivera number natural order");
  ok(ids(applyCultiveraFilters(t, PC({ sort: "number_za" }))) === "b,a,c", "cultivera number descending");
  ok(ids(applyCultiveraFilters(t, PC({ sort: "vendor_az" }))) === "b,c,a", "cultivera vendor A-Z stable");
  ok(ids(applyCultiveraFilters(t, PC({ sort: "vendor_za" }))) === "a,b,c", "cultivera vendor Z-A");
  ok(ids(applyCultiveraFilters(t, PC({ sort: "status" }))) === "b,c,a", "needs attention first, complete last");
  ok(ids(applyCultiveraFilters(t, PC({ sort: "lots_desc" }))) === "b,a,c", "most lots first, unknown last");
  const unread = cultiveraTableRows(cv, days, false);
  ok(ids(applyCultiveraFilters(unread, PC({ status: "complete" }))) === "", "unread: nothing is complete");
  ok(ids(applyCultiveraFilters(unread, PC({ status: "not_complete" }))) === "", "unread: nothing is called needs attention");
  ok(ids(applyCultiveraFilters(unread, PC({ status: "not_started" }))) === "", "unread: not-started facet never claims");
  ok(ids(applyCultiveraFilters(unread, PC({ status: "unknown" }))) === "a,b,c", "unread: unknown facet shows all");
  const mixed = [...t, { ...unread[0], id: "u" }];
  ok(ids(applyCultiveraFilters(mixed, PC({ sort: "status" }))) === "b,c,u,a", "unknown sorts between needs attention and complete");
  const sum = summarizeCultivera(mixed);
  ok(sum.total === 4 && sum.complete === 1 && sum.notComplete === 2 && sum.unknown === 1, "summary counts");

  // Paging + vendors + summary text
  const ps = pageSlice([1, 2, 3, 4, 5], 9, 2);
  ok(ps.page === 3 && ps.pageCount === 3 && ps.rows.join() === "5", "page is clamped to the last page");
  ok(pageSlice([], 1, 50).pageCount === 1, "empty list has one page");
  ok(vendorOptions(["b", " A ", "a", null, "", "Unknown vendor"]).join("|") === "A|b", "vendor options distinct, sorted, blanks dropped");
  ok(filterSummary(d, 3, 3) === "Showing 3 of 3 manifests.", "plain summary");
  ok(
    filterSummary(PC({ status: "complete", vendor: "Ace", from: "2024-01-01" }), 1, 1200) ===
      'Showing 1 of 1,200 Cultivera manifests, status "Complete", vendor "Ace", dated on or after 2024-01-01.',
    "filtered summary",
  );
  ok(filterSummary(P({ to: "2026-01-01" }), 0, 1).endsWith("manifest, dated on or before 2026-01-01."), "singular + to-only");
  ok(sortOptionsFor("cultivera").every((o) => o.value !== "eta") && sortOptionsFor("all").every((o) => o.value !== "lots_desc"), "per-view sorts");

  // R74 S11: source filter + vendor grouping (Cultivera view only)
  ok(P({ view: "cultivera", source: "email" }).source === "email" && P({ source: "email" }).source === "", "source only on the Cultivera view");
  ok(P({ view: "cultivera", source: "bogus" }).source === "", "bad source = any");
  ok(P({ view: "cultivera", group: "vendor" }).group === "vendor" && P({ group: "vendor" }).group === "" && P({ view: "cultivera", group: "x" }).group === "", "group only vendor, only Cultivera");
  ok(hasActiveFilters(P({ view: "cultivera", source: "unmatched" })) && !hasActiveFilters(P({ view: "cultivera", group: "vendor" })), "source narrows, grouping does not");
  {
    const cv = P({ view: "cultivera", source: "email", group: "vendor" });
    ok(receivingHref(cv) === `${RECEIVING_PATH}?view=cultivera&source=email&group=vendor`, "href keeps source + group");
    ok(receivingHref(cv, { view: "all" }) === `${RECEIVING_PATH}?view=all`, "leaving the Cultivera view drops source + group");
    const srcRows = cultiveraTableRows(
      [
        { id: "a", number: "1", vendor: "V", day: null, lots: 1, state: "done", stateLabel: "", inReview: 0, approved: 1 },
        { id: "b", number: "2", vendor: "V", day: null, lots: 1, state: "done", stateLabel: "", inReview: 0, approved: 1 },
      ],
      new Map(),
      true,
      new Map([["a", "email" as const]]),
    );
    ok(srcRows[0].source === "email" && srcRows[1].source === "unknown", "source from the map; missing = unknown, never guessed");
    ok(applyCultiveraFilters(srcRows, cv).map((r) => r.id).join() === "a", "source filter applies");
    const c = countSources(srcRows);
    ok(c.email === 1 && c.unknown === 1 && c.transfer === 0, "source counts");
    ok(filterSummary(cv, 1, 2).includes('source "Emailed manifest"'), "summary names the source");
  }
  return { passed, failed };
}
