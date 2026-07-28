/**
 * src/lib/purchasing/po-list-insights-core.ts
 *
 * SLICE 82 — PURE brains for the Purchasing command center (the main
 * /admin/purchasing page). No imports beyond other pure purchasing modules.
 * Everything here is deterministic and unit-tested; the page only feeds it
 * REAL rows from po-store and renders the answers.
 *
 * Industry golden rules baked in (researched: NetSuite / Procurify / Coupa
 * procurement-dashboard guidance):
 *   - Open PO count + committed value front and center
 *   - PO cycle time (sent → received) and vendor late-delivery rate
 *   - Spend by period (this month vs last month, with a plain-English delta)
 *   - Spend concentration: top vendors by open (committed) value
 *   - Exception surfacing: received-but-unpaid POs (three-way-match gap)
 *
 * Money is CENTS (minor units) end to end.
 */

import { poCodename } from "@/lib/purchasing/po-document-core";

/** Mirrors po-store's PurchaseOrderStatus without importing server-only code. */
export type PoListStatus =
  | "draft"
  | "submitted"
  | "sent"
  | "partial"
  | "received"
  | "cancelled";

export const PO_LIST_STATUSES: readonly PoListStatus[] = [
  "draft",
  "submitted",
  "sent",
  "partial",
  "received",
  "cancelled",
];

/** Statuses that represent money committed but not yet fully received. */
export const OPEN_PO_STATUSES: readonly PoListStatus[] = [
  "draft",
  "submitted",
  "sent",
  "partial",
];

/** The slice of a purchase order the list page needs. */
export type PoListRow = {
  id: string;
  po_number: string | null;
  vendor_name: string | null;
  status: PoListStatus;
  subtotal_minor_units: number;
  line_count: number;
  origin: "manual" | "ai_suggested";
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
  expected_date: string | null;
  paid_at?: string | null;
};

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

/** Whole days between two ISO dates (>= 0). */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * PO cycle time: average days from sent to received across received POs that
 * carry both timestamps. Real data only — null when there is no history.
 */
export function avgCycleDays(rows: readonly PoListRow[]): number | null {
  const done = rows.filter((p) => p.sent_at && p.received_at);
  if (done.length === 0) return null;
  const total = done.reduce((s, p) => s + daysBetween(p.sent_at!, p.received_at!), 0);
  return Math.round(total / done.length);
}

/**
 * Vendor late-PO rate: share of received POs that arrived after their expected
 * date. Only POs carrying both dates count. Null when nothing is measurable.
 */
export function lateRatePct(rows: readonly PoListRow[]): number | null {
  const measurable = rows.filter((p) => p.received_at && p.expected_date);
  if (measurable.length === 0) return null;
  const late = measurable.filter(
    (p) => new Date(p.received_at!).getTime() > new Date(p.expected_date!).getTime(),
  ).length;
  return Math.round((late / measurable.length) * 100);
}

/** "YYYY-MM" month key of an ISO timestamp ("" for junk). */
export function monthKeyOf(iso: string | null | undefined): string {
  if (!iso || typeof iso !== "string") return "";
  const m = /^(\d{4})-(\d{2})/.exec(iso.trim());
  return m ? `${m[1]}-${m[2]}` : "";
}

/** The month key immediately before the given "YYYY-MM" ("" for junk). */
export function previousMonthKey(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return "";
  let year = Number(m[1]);
  let month = Number(m[2]) - 1;
  if (month < 1 || month > 12) {
    // 01 → previous December; anything out of range is junk.
    if (month === 0) {
      year -= 1;
      month = 12;
    } else return "";
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

export type PoKpis = {
  openCount: number;
  openValueMinor: number;
  awaitingCount: number;
  avgCycleDays: number | null;
  lateRatePct: number | null;
  spendThisMonthMinor: number;
  spendLastMonthMinor: number;
  /** null when last month had no spend to compare against. */
  spendDeltaPct: number | null;
};

/**
 * All headline KPIs from real PO rows. Spend by period counts every PO that
 * is not cancelled, grouped by its created month (committed spend — the
 * standard way a procurement dashboard reports "spend this period").
 */
export function computePoKpis(rows: readonly PoListRow[], nowIso: string): PoKpis {
  const open = rows.filter((p) => OPEN_PO_STATUSES.includes(p.status));
  const thisKey = monthKeyOf(nowIso);
  const lastKey = previousMonthKey(thisKey);
  let spendThis = 0;
  let spendLast = 0;
  for (const p of rows) {
    if (p.status === "cancelled") continue;
    const k = monthKeyOf(p.created_at);
    if (k && k === thisKey) spendThis += p.subtotal_minor_units;
    else if (k && k === lastKey) spendLast += p.subtotal_minor_units;
  }
  return {
    openCount: open.length,
    openValueMinor: open.reduce((s, p) => s + p.subtotal_minor_units, 0),
    awaitingCount: rows.filter((p) => p.status === "sent" || p.status === "partial").length,
    avgCycleDays: avgCycleDays(rows),
    lateRatePct: lateRatePct(rows),
    spendThisMonthMinor: spendThis,
    spendLastMonthMinor: spendLast,
    spendDeltaPct: spendLast > 0 ? Math.round(((spendThis - spendLast) / spendLast) * 100) : null,
  };
}

/** Plain-English month-over-month hint for the spend card. */
export function describeSpendDelta(kpis: Pick<PoKpis, "spendDeltaPct" | "spendLastMonthMinor">): string {
  if (kpis.spendDeltaPct == null) {
    return kpis.spendLastMonthMinor === 0
      ? "no orders last month to compare"
      : "not enough history yet";
  }
  if (kpis.spendDeltaPct === 0) return "same as last month";
  return kpis.spendDeltaPct > 0
    ? `up ${kpis.spendDeltaPct}% vs last month`
    : `down ${Math.abs(kpis.spendDeltaPct)}% vs last month`;
}

// ---------------------------------------------------------------------------
// Insights: vendor concentration + exceptions
// ---------------------------------------------------------------------------

export type VendorOpenValue = {
  vendorName: string;
  openValueMinor: number;
  openCount: number;
};

/**
 * Top vendors by open (committed, not-yet-received) value — spend
 * concentration at a glance. POs without a vendor group under
 * "(no vendor set)". Ties break alphabetically for stable rendering.
 */
export function topVendorsByOpenValue(rows: readonly PoListRow[], limit = 5): VendorOpenValue[] {
  const byVendor = new Map<string, VendorOpenValue>();
  for (const p of rows) {
    if (!OPEN_PO_STATUSES.includes(p.status)) continue;
    const name = (p.vendor_name ?? "").trim() || "(no vendor set)";
    const cur = byVendor.get(name) ?? { vendorName: name, openValueMinor: 0, openCount: 0 };
    cur.openValueMinor += p.subtotal_minor_units;
    cur.openCount += 1;
    byVendor.set(name, cur);
  }
  return [...byVendor.values()]
    .sort((a, b) => b.openValueMinor - a.openValueMinor || a.vendorName.localeCompare(b.vendorName))
    .slice(0, Math.max(0, limit));
}

/**
 * Received-but-unpaid POs — the classic three-way-match exception a
 * procurement dashboard must surface. Oldest received first (most overdue on
 * top). Relies on the W9 paid stamp (migration 0103): a received PO without
 * paid_at has money owed or a stamp gap either way worth a look.
 */
export function receivedUnpaidExceptions(rows: readonly PoListRow[]): PoListRow[] {
  return rows
    .filter((p) => p.status === "received" && !p.paid_at)
    .sort((a, b) => (a.received_at ?? a.created_at).localeCompare(b.received_at ?? b.created_at));
}

// ---------------------------------------------------------------------------
// List state: filters, search, paging (URL-driven, junk-safe)
// ---------------------------------------------------------------------------

export const PO_LIST_PAGE_SIZE = 25;

export type PoListState = {
  status: PoListStatus | "";
  vendor: string;
  q: string;
  page: number;
};

/** Normalize raw searchParams into a safe list state (junk → defaults). */
export function parsePoListState(sp: {
  status?: string;
  vendor?: string;
  q?: string;
  page?: string;
}): PoListState {
  const rawStatus = (sp.status ?? "").trim().toLowerCase();
  const status = (PO_LIST_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as PoListStatus)
    : "";
  const pageNum = Number.parseInt(sp.page ?? "1", 10);
  return {
    status,
    vendor: (sp.vendor ?? "").trim().slice(0, 120),
    q: (sp.q ?? "").trim().slice(0, 120),
    page: Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1,
  };
}

/**
 * Apply status / vendor / free-text filters. The q search matches the PO
 * number, vendor name, OR the derived codename (so the owner can type
 * "mellow" and find Operation Mellow Harvest). Case-insensitive substring.
 */
export function filterPoRows(rows: readonly PoListRow[], state: PoListState): PoListRow[] {
  const vendorNeedle = state.vendor.toLowerCase();
  const qNeedle = state.q.toLowerCase();
  return rows.filter((p) => {
    if (state.status && p.status !== state.status) return false;
    if (vendorNeedle && !(p.vendor_name ?? "").toLowerCase().includes(vendorNeedle)) return false;
    if (qNeedle) {
      const hay = [p.po_number ?? "", p.vendor_name ?? "", poCodename(p.po_number) ?? ""]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(qNeedle)) return false;
    }
    return true;
  });
}

export type PoListPage<T> = {
  pageRows: T[];
  totalCount: number;
  totalPages: number;
  safePage: number;
};

/** Clamp the requested page and slice — never an out-of-range blank page. */
export function paginatePoRows<T>(rows: readonly T[], page: number, perPage = PO_LIST_PAGE_SIZE): PoListPage<T> {
  const totalPages = Math.max(1, Math.ceil(rows.length / Math.max(1, perPage)));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (safePage - 1) * perPage;
  return {
    pageRows: rows.slice(start, start + perPage),
    totalCount: rows.length,
    totalPages,
    safePage,
  };
}

/**
 * Build a clean /admin/purchasing URL: defaults are OMITTED so the bare page
 * stays bookmarkable and the back-token stays stable.
 */
export function buildPoListHref(state: PoListState, page?: number): string {
  const params = new URLSearchParams();
  if (state.status) params.set("status", state.status);
  if (state.vendor) params.set("vendor", state.vendor);
  if (state.q) params.set("q", state.q);
  const p = page ?? state.page;
  if (p > 1) params.set("page", String(p));
  const qs = params.toString();
  return qs ? `/admin/purchasing?${qs}` : "/admin/purchasing";
}

// ---------------------------------------------------------------------------
// Trace dots — list-cheap procure-to-pay completeness per row
// ---------------------------------------------------------------------------

export type PoTraceDotState = "done" | "partial" | "missing";

export type PoTraceDot = {
  key: "po" | "received" | "paid";
  label: string;
  state: PoTraceDotState;
  detail: string;
};

/**
 * Three honest dots per row — PO created, goods received, bill paid — derived
 * ONLY from the row itself (no extra queries on a list of hundreds). The PO
 * detail page runs the full four-step paper trail with live manifest and
 * payment math; this is the at-a-glance version using the same lifecycle
 * facts (status + the W9 paid stamp).
 */
export function poTraceDots(row: PoListRow): PoTraceDot[] {
  const cancelled = row.status === "cancelled";
  const received: PoTraceDot =
    row.status === "received"
      ? { key: "received", label: "Received", state: "done", detail: "goods received in full" }
      : row.status === "partial"
        ? { key: "received", label: "Received", state: "partial", detail: "partially received" }
        : {
            key: "received",
            label: "Received",
            state: "missing",
            detail: cancelled ? "cancelled before receiving" : "not received yet",
          };
  const paid: PoTraceDot = row.paid_at
    ? { key: "paid", label: "Paid", state: "done", detail: "paid in full (stamped by Accounts Payable)" }
    : row.status === "received"
      ? { key: "paid", label: "Paid", state: "missing", detail: "received but not paid yet — settle it in Vendor payments" }
      : { key: "paid", label: "Paid", state: "missing", detail: cancelled ? "cancelled — nothing to pay" : "not due yet" };
  const po: PoTraceDot = {
    key: "po",
    label: "PO",
    state: "done",
    detail: row.po_number ? `purchase order ${row.po_number}` : "purchase order created",
  };
  return [po, received, paid];
}

// ---------------------------------------------------------------------------
// Self-tests (wired into scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

function row(overrides: Partial<PoListRow>): PoListRow {
  return {
    id: "id-1",
    po_number: "PO-202403-0007",
    vendor_name: "Fairwinds",
    status: "draft",
    subtotal_minor_units: 10_000,
    line_count: 2,
    origin: "manual",
    created_at: "2024-03-05T10:00:00Z",
    sent_at: null,
    received_at: null,
    expected_date: null,
    paid_at: null,
    ...overrides,
  };
}

export function __runPoListInsightsCoreTests(): void {
  let passed = 0;
  let failed = 0;
  function expect(name: string, cond: boolean) {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL: ${name}`);
    }
  }

  // --- month keys ---
  expect("monthKeyOf ISO", monthKeyOf("2024-03-05T10:00:00Z") === "2024-03");
  expect("monthKeyOf junk", monthKeyOf("nonsense") === "" && monthKeyOf(null) === "");
  expect("previousMonthKey mid-year", previousMonthKey("2024-03") === "2024-02");
  expect("previousMonthKey january wraps", previousMonthKey("2024-01") === "2023-12");
  expect("previousMonthKey junk", previousMonthKey("junk") === "");

  // --- KPIs ---
  const rows: PoListRow[] = [
    row({ id: "a", status: "sent", subtotal_minor_units: 50_000, created_at: "2024-03-02T00:00:00Z", sent_at: "2024-03-02T00:00:00Z" }),
    row({ id: "b", status: "partial", subtotal_minor_units: 30_000, created_at: "2024-03-10T00:00:00Z" }),
    row({ id: "c", status: "received", subtotal_minor_units: 20_000, created_at: "2024-02-15T00:00:00Z", sent_at: "2024-02-15T00:00:00Z", received_at: "2024-02-20T00:00:00Z", expected_date: "2024-02-18", paid_at: null }),
    row({ id: "d", status: "received", subtotal_minor_units: 40_000, created_at: "2024-02-01T00:00:00Z", sent_at: "2024-02-01T00:00:00Z", received_at: "2024-02-03T00:00:00Z", expected_date: "2024-02-05", paid_at: "2024-02-10T00:00:00Z" }),
    row({ id: "e", status: "cancelled", subtotal_minor_units: 99_000, created_at: "2024-03-04T00:00:00Z" }),
    row({ id: "f", status: "draft", subtotal_minor_units: 5_000, vendor_name: null, created_at: "2024-03-20T00:00:00Z" }),
  ];
  const k = computePoKpis(rows, "2024-03-25T12:00:00Z");
  expect("openCount excludes received+cancelled", k.openCount === 3);
  expect("openValue sums open only", k.openValueMinor === 85_000);
  expect("awaiting = sent|partial", k.awaitingCount === 2);
  expect("avgCycleDays = (5+2)/2 rounded", k.avgCycleDays === 4);
  expect("lateRate 1 of 2 = 50", k.lateRatePct === 50);
  expect("spend this month skips cancelled", k.spendThisMonthMinor === 85_000);
  expect("spend last month", k.spendLastMonthMinor === 60_000);
  expect("delta pct rounds", k.spendDeltaPct === 42);
  expect("delta hint up", describeSpendDelta(k) === "up 42% vs last month");
  expect(
    "delta hint no-history",
    describeSpendDelta({ spendDeltaPct: null, spendLastMonthMinor: 0 }) === "no orders last month to compare",
  );
  expect(
    "delta hint down",
    describeSpendDelta({ spendDeltaPct: -10, spendLastMonthMinor: 1 }) === "down 10% vs last month",
  );
  const empty = computePoKpis([], "2024-03-25T12:00:00Z");
  expect("empty rows → zeros and nulls", empty.openCount === 0 && empty.avgCycleDays === null && empty.spendDeltaPct === null);

  // --- top vendors ---
  const top = topVendorsByOpenValue(rows);
  expect("top vendor groups open only", top.length === 2);
  expect("top vendor #1 is Fairwinds 80000", top[0].vendorName === "Fairwinds" && top[0].openValueMinor === 80_000 && top[0].openCount === 2);
  expect("no-vendor bucket labeled", top[1].vendorName === "(no vendor set)" && top[1].openValueMinor === 5_000);
  expect("limit respected", topVendorsByOpenValue(rows, 1).length === 1);

  // --- exceptions ---
  const exceptions = receivedUnpaidExceptions(rows);
  expect("received-unpaid finds exactly c", exceptions.length === 1 && exceptions[0].id === "c");

  // --- state parsing ---
  const s1 = parsePoListState({ status: "SENT", vendor: "  fair ", q: " mellow ", page: "3" });
  expect("state normalizes", s1.status === "sent" && s1.vendor === "fair" && s1.q === "mellow" && s1.page === 3);
  const s2 = parsePoListState({ status: "junk", page: "-4" });
  expect("junk status/page → defaults", s2.status === "" && s2.page === 1);
  expect("empty sp → defaults", parsePoListState({}).status === "" && parsePoListState({}).page === 1);

  // --- filtering ---
  const base: PoListState = { status: "", vendor: "", q: "", page: 1 };
  expect("no filters passes all", filterPoRows(rows, base).length === rows.length);
  expect("status filter", filterPoRows(rows, { ...base, status: "received" }).length === 2);
  expect("vendor substring ci", filterPoRows(rows, { ...base, vendor: "FAIR" }).length === 5);
  expect("q matches po number", filterPoRows(rows, { ...base, q: "202403-0007" }).length === rows.length);
  const cn = poCodename("PO-202403-0007") ?? "";
  expect("q matches codename word", cn.length > 0 && filterPoRows(rows, { ...base, q: cn.split(" ")[1].toLowerCase() }).length === rows.length);
  expect("q no match → empty", filterPoRows(rows, { ...base, q: "zzz-no-such" }).length === 0);

  // --- paging ---
  const many = Array.from({ length: 60 }, (_, i) => row({ id: `p${i}` }));
  const pg = paginatePoRows(many, 2);
  expect("page 2 of 60/25", pg.safePage === 2 && pg.totalPages === 3 && pg.pageRows.length === 25 && pg.totalCount === 60);
  expect("page overflow clamps", paginatePoRows(many, 99).safePage === 3);
  expect("page junk clamps to 1", paginatePoRows(many, 0).safePage === 1);
  expect("empty list = one page", paginatePoRows([], 5).totalPages === 1 && paginatePoRows([], 5).pageRows.length === 0);

  // --- hrefs ---
  expect("bare href clean", buildPoListHref(base) === "/admin/purchasing");
  expect(
    "href carries filters + page",
    buildPoListHref({ status: "sent", vendor: "fair", q: "og", page: 1 }, 2) ===
      "/admin/purchasing?status=sent&vendor=fair&q=og&page=2",
  );
  expect("href omits page 1", buildPoListHref({ ...base, status: "draft" }) === "/admin/purchasing?status=draft");

  // --- trace dots ---
  const dDraft = poTraceDots(row({ status: "draft" }));
  expect("draft dots: done/missing/missing", dDraft[0].state === "done" && dDraft[1].state === "missing" && dDraft[2].state === "missing");
  expect("draft paid detail = not due yet", dDraft[2].detail === "not due yet");
  const dPartial = poTraceDots(row({ status: "partial" }));
  expect("partial receiving dot", dPartial[1].state === "partial");
  const dRecUnpaid = poTraceDots(row({ status: "received" }));
  expect("received-unpaid paid dot missing w/ AP hint", dRecUnpaid[1].state === "done" && dRecUnpaid[2].state === "missing" && dRecUnpaid[2].detail.includes("Vendor payments"));
  const dPaid = poTraceDots(row({ status: "received", paid_at: "2024-03-01T00:00:00Z" }));
  expect("paid dot done", dPaid[2].state === "done");
  const dCancelled = poTraceDots(row({ status: "cancelled" }));
  expect("cancelled dots honest", dCancelled[1].detail === "cancelled before receiving" && dCancelled[2].detail === "cancelled — nothing to pay");

  console.log(`po-list-insights-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`po-list-insights-core tests failed: ${failed}`);
}
