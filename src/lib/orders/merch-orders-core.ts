/**
 * src/lib/orders/merch-orders-core.ts
 *
 * R73 S1 - GREENWAY MERCH ORDERS ON THE BACK-OFFICE ORDERS PAGE.
 *
 * The owner, verbatim:
 *   > "I would really like to have merch orders to be managed from Greenway
 *   >  Marijuana back office, with its table or whatever to be the last table
 *   >  on that page ... the table should be identical to the other two on
 *   >  there. I open the detail page and then manage it from there, just like
 *   >  how it's done with our online orders and Leafly online orders."
 *
 * WHERE THE ORDERS COME FROM: Printful. greenwaymerch.com (R72 S6) turns every
 * paid Stripe session into a Printful order whose `external_id` is our gm- ref,
 * with the recipient, items, the retail costs the customer paid and - later -
 * the shipments. So Printful already IS the merch order record; this page
 * reads it with the same LLC token Merch Studio uses (PRINTFUL_API_TOKEN).
 * No new table, no new secret, no second copy that could drift.
 *
 * WHAT A PRINTFUL STATUS MEANS ON OUR TABS (the tabs are shared with the
 * other two panels, so Printful's words are mapped onto ours; the pill keeps
 * Printful's own words so nothing is hidden):
 *   draft                     -> New          (paid; a person must Confirm it)
 *   failed / onhold           -> New          (needs a person: fix and resubmit)
 *   inreview / pending        -> Acknowledged (submitted; Printful reviewing / queued)
 *   inprocess                 -> Preparing    (being printed)
 *   partial                   -> Ready        (part shipped, rest coming)
 *   fulfilled                 -> Completed    (everything shipped)
 *   canceled                  -> Cancelled
 *   anything else             -> New          (unknown is shown to a person, never hidden)
 * Verified against Printful's v1 OpenAPI (developers.printful.com/docs/openapi.json,
 * Order.status, Order.shipments, Costs, RetailCosts, Address).
 *
 * No I/O. No React. No clock (callers pass `now` where needed).
 */
import type { OrderStatus } from "./types";
import {
  ALL_ORDER_STATUSES,
  countByStatus,
  statusInTab,
  type OrdersPanelQuery,
  type StatusCounts,
} from "./order-panels-core";
import { ORDER_SORTS, type SortColumn } from "@/lib/admin/list-filter-core";
import { DEFAULT_PAGE_SIZE, listWindow, type ListWindow } from "@/lib/admin/list-window-core";

// ============================================================================
// STATUS
// ============================================================================

export const PRINTFUL_STATUS_MAP: Record<string, OrderStatus> = {
  draft: "new",
  failed: "new",
  onhold: "new",
  inreview: "acknowledged",
  pending: "acknowledged",
  inprocess: "preparing",
  partial: "ready",
  fulfilled: "completed",
  canceled: "cancelled",
};

/** Printful's own words, shown on the pill (never an invented label). */
export const PRINTFUL_STATUS_LABELS: Record<string, string> = {
  draft: "Draft - confirm",
  failed: "Failed",
  onhold: "On hold",
  inreview: "In review",
  pending: "Submitted",
  inprocess: "In production",
  partial: "Partly shipped",
  fulfilled: "Shipped",
  canceled: "Cancelled",
};

/** Printful statuses where a person has to act. */
export const MERCH_NEEDS_PERSON = new Set(["draft", "failed", "onhold"]);
/** Printful: "POST /orders/{id}/confirm - Approves for fulfillment an order that was saved as a draft." */
export const MERCH_CONFIRMABLE = new Set(["draft"]);
/** Printful: "DELETE /orders/{id} - Cancels pending order or draft." */
export const MERCH_CANCELLABLE = new Set(["draft", "pending", "failed"]);

export function merchPanelStatus(printfulStatus: string): OrderStatus {
  return PRINTFUL_STATUS_MAP[printfulStatus] ?? "new";
}

export function merchStatusLabel(printfulStatus: string): string {
  return PRINTFUL_STATUS_LABELS[printfulStatus] ?? `Unrecognised: ${printfulStatus || "none"}`;
}

// ============================================================================
// PARSING A PRINTFUL ORDER (defensive: the API is outside our control)
// ============================================================================

const clip = (s: unknown, n: number) =>
  (typeof s === "string" ? s : typeof s === "number" ? String(s) : "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, n);

/** "12.34" | 12.34 -> 1234; unparseable -> null (never a made-up 0). */
export function centsFromDollars(v: unknown): number | null {
  const s = typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : typeof v === "string" ? v.trim() : "";
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export const isMerchOrderRef = (s: unknown): s is string =>
  typeof s === "string" && /^gm-[a-z0-9]{6,12}-[a-z0-9]{1,8}$/.test(s);

export type MerchItem = {
  name: string;
  quantity: number;
  /** what the customer paid per unit (retail_price) */
  retailCents: number | null;
  /** what Printful charges per unit (price) */
  costCents: number | null;
  sku: string;
  variantId: number | null;
  thumbnail: string;
};

export type MerchShipment = {
  carrier: string;
  service: string;
  trackingNumber: string;
  trackingUrl: string;
  shipDate: string;
};

export type MerchMoney = {
  subtotal: number | null;
  discount: number | null;
  shipping: number | null;
  tax: number | null;
  total: number | null;
};

export type MerchOrder = {
  id: number;
  ref: string;
  ours: boolean;
  printfulStatus: string;
  status: OrderStatus;
  needsPerson: boolean;
  confirmable: boolean;
  cancellable: boolean;
  /** ISO; "" when Printful sent no time. */
  placedAt: string;
  updatedAt: string;
  name: string;
  firstName: string;
  email: string;
  phone: string;
  address: { line1: string; line2: string; city: string; state: string; zip: string; country: string };
  shippingMethod: string;
  items: MerchItem[];
  itemCount: number;
  /** What the customer paid (retail_costs, sent by greenwaymerch.com). */
  paid: MerchMoney;
  /** What Printful charges the LLC (costs). */
  cost: MerchMoney;
  /** paid.total - cost.total; null if either is unknown. */
  marginCents: number | null;
  shipments: MerchShipment[];
  searchTerms: string[];
};

const iso = (sec: unknown) =>
  typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? new Date(sec * 1000).toISOString() : "";

function money(m: unknown): MerchMoney {
  const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
  return {
    subtotal: centsFromDollars(o.subtotal),
    discount: centsFromDollars(o.discount),
    shipping: centsFromDollars(o.shipping),
    tax: centsFromDollars(o.tax),
    total: centsFromDollars(o.total),
  };
}

export function parsePrintfulOrder(raw: unknown): MerchOrder | null {
  const o = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!o || typeof o.id !== "number" || !Number.isFinite(o.id)) return null;
  const printfulStatus = clip(o.status, 20).toLowerCase();
  const r = (o.recipient && typeof o.recipient === "object" ? o.recipient : {}) as Record<string, unknown>;
  const name = clip(r.name, 100);
  const ref = clip(o.external_id, 32);
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  const items: MerchItem[] = itemsRaw.slice(0, 100).map((it) => {
    const i = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const product = (i.product && typeof i.product === "object" ? i.product : {}) as Record<string, unknown>;
    const files = Array.isArray(i.files) ? (i.files as Record<string, unknown>[]) : [];
    const preview = files.map((f) => clip(f?.preview_url, 500) || clip(f?.thumbnail_url, 500)).find(Boolean) ?? "";
    const qty = typeof i.quantity === "number" && Number.isFinite(i.quantity) ? Math.max(0, Math.floor(i.quantity)) : 0;
    return {
      name: clip(i.name, 160) || clip(product.name, 160) || "Item",
      quantity: qty,
      retailCents: centsFromDollars(i.retail_price),
      costCents: centsFromDollars(i.price),
      sku: clip(i.sku, 60),
      variantId: typeof i.variant_id === "number" ? i.variant_id : null,
      thumbnail: /^https:\/\//.test(preview) ? preview : /^https:\/\//.test(clip(product.image, 500)) ? clip(product.image, 500) : "",
    };
  });
  const shipments: MerchShipment[] = (Array.isArray(o.shipments) ? o.shipments : []).slice(0, 20).map((s) => {
    const x = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const url = clip(x.tracking_url, 500);
    return {
      carrier: clip(x.carrier, 60),
      service: clip(x.service, 80),
      trackingNumber: clip(x.tracking_number, 80),
      trackingUrl: /^https?:\/\//.test(url) ? url : "",
      shipDate: clip(x.ship_date, 30),
    };
  });
  const paid = money(o.retail_costs);
  const cost = money(o.costs);
  const email = clip(r.email, 254);
  const phone = clip(r.phone, 30);
  return {
    id: o.id,
    ref,
    ours: isMerchOrderRef(ref),
    printfulStatus,
    status: merchPanelStatus(printfulStatus),
    needsPerson: MERCH_NEEDS_PERSON.has(printfulStatus) || !(printfulStatus in PRINTFUL_STATUS_MAP),
    confirmable: MERCH_CONFIRMABLE.has(printfulStatus),
    cancellable: MERCH_CANCELLABLE.has(printfulStatus),
    placedAt: iso(o.created),
    updatedAt: iso(o.updated),
    name,
    firstName: name.split(/\s+/)[0] ?? "",
    email,
    phone,
    address: {
      line1: clip(r.address1, 200),
      line2: clip(r.address2, 200),
      city: clip(r.city, 100),
      state: clip(r.state_code, 10),
      zip: clip(r.zip, 20),
      country: clip(r.country_code, 2),
    },
    shippingMethod: clip(o.shipping_service_name, 80) || clip(o.shipping, 40),
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    paid,
    cost,
    marginCents: paid.total != null && cost.total != null ? paid.total - cost.total : null,
    shipments,
    searchTerms: [ref, String(o.id), name, email, phone, clip(r.city, 100), clip(r.zip, 20)]
      .filter(Boolean)
      .map((s) => s.toLowerCase()),
  };
}

/** The detail page's URL handle: our gm- ref, else Printful's numeric id. */
export function merchOrderHandle(o: Pick<MerchOrder, "ref" | "ours" | "id">): string {
  return o.ours ? o.ref : String(o.id);
}

/** Validate a detail-page param into the Printful path id (`@ref` or numeric). */
export function printfulIdFromHandle(handle: string): string | null {
  const h = (handle ?? "").trim();
  if (isMerchOrderRef(h)) return `@${h}`;
  if (/^\d{1,12}$/.test(h)) return h;
  return null;
}

// ============================================================================
// THE VIEW (same semantics as the other two panels)
// ============================================================================

const SORTABLE: Record<string, (o: MerchOrder) => string | number | null> = {
  placed_at: (o) => {
    const t = Date.parse(o.placedAt);
    return Number.isFinite(t) ? t : null;
  },
  total_minor_units: (o) => o.paid.total,
  customer_first_name: (o) => (o.firstName ? o.firstName : null),
};

export function merchSortColumnSupported(column: string): boolean {
  return Object.prototype.hasOwnProperty.call(SORTABLE, column);
}

function compare(a: MerchOrder, b: MerchOrder, columns: readonly SortColumn[]): number {
  for (const col of columns) {
    const read = SORTABLE[col.column];
    if (!read) continue;
    const av = read(a);
    const bv = read(b);
    if (av === null && bv === null) continue;
    if (av === null) return 1;
    if (bv === null) return -1;
    const c =
      typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv, "en", { sensitivity: "base" })
        : av < bv
          ? -1
          : av > bv
            ? 1
            : 0;
    if (c !== 0) return col.ascending ? c : -c;
  }
  return b.id - a.id;
}

export type MerchPanelView = {
  rows: MerchOrder[];
  total: number;
  window: ListWindow;
  counts: StatusCounts;
  hiddenNeedsPerson: number;
};

export function buildMerchPanelView(
  orders: readonly MerchOrder[],
  q: OrdersPanelQuery,
  pageSize: number = DEFAULT_PAGE_SIZE,
): MerchPanelView {
  const terms = q.search.toLowerCase().split(/\s+/).filter(Boolean);
  const fromMs = q.placedFrom ? Date.parse(`${q.placedFrom}T00:00:00.000Z`) : null;
  const toMs = q.placedTo ? Date.parse(q.placedTo) : null;
  const matched = orders.filter((o) => {
    if (!statusInTab(o.status, q.status)) return false;
    if (terms.length && !terms.every((t) => o.searchTerms.some((s) => s.includes(t)))) return false;
    if (fromMs !== null || toMs !== null) {
      const t = Date.parse(o.placedAt);
      if (!Number.isFinite(t)) return false;
      if (fromMs !== null && t < fromMs) return false;
      if (toMs !== null && t > toMs) return false;
    }
    if (q.totalMin != null || q.totalMax != null) {
      if (o.paid.total === null) return false;
      if (q.totalMin != null && o.paid.total < q.totalMin) return false;
      if (q.totalMax != null && o.paid.total > q.totalMax) return false;
    }
    return true;
  });
  const visible = new Set(matched);
  const hiddenNeedsPerson = orders.filter((o) => o.needsPerson && !visible.has(o)).length;
  const sorted = [...matched].sort((a, b) => compare(a, b, q.sortColumns));
  const window = listWindow(sorted.length, q.page, pageSize);
  return {
    rows: sorted.slice(window.from, window.to + 1),
    total: sorted.length,
    window,
    counts: countByStatus(orders),
    hiddenNeedsPerson,
  };
}

export function merchHiddenWarning(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === 1
    ? "1 merch order needs someone (draft to confirm, failed or on hold) but is hidden by the current view. Choose \u201cActive\u201d and clear the search to see it."
    : `${n} merch orders need someone (drafts to confirm, failed or on hold) but are hidden by the current view. Choose \u201cActive\u201d and clear the search to see them.`;
}

/** How many Printful list pages the board reads (100 per page, Printful's max). */
export const MERCH_BOARD_PAGES = 5;
export const MERCH_PAGE_LIMIT = 100;

export function merchLoadCapNotice(loaded: number, totalAtPrintful: number | null): string | null {
  if (totalAtPrintful == null || !Number.isFinite(totalAtPrintful) || loaded >= totalAtPrintful) return null;
  return `Showing the ${loaded} most recent merch orders of ${totalAtPrintful} at Printful. Older ones are in your Printful dashboard.`;
}

// ============================================================================
// SELF-TESTS
// ============================================================================

export function __runMerchOrdersPanelTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[merch-orders-core] FAIL: ${label}`);
    }
  };

  // status mapping covers every Printful status, onto real tab statuses
  const pfStatuses = ["draft", "failed", "inreview", "pending", "canceled", "onhold", "inprocess", "partial", "fulfilled"];
  ok("every documented Printful status is mapped", pfStatuses.every((s) => s in PRINTFUL_STATUS_MAP && s in PRINTFUL_STATUS_LABELS));
  ok("mapped onto our statuses", Object.values(PRINTFUL_STATUS_MAP).every((s) => (ALL_ORDER_STATUSES as readonly string[]).includes(s)));
  ok("draft is New", merchPanelStatus("draft") === "new");
  ok("fulfilled is Completed", merchPanelStatus("fulfilled") === "completed");
  ok("canceled is Cancelled", merchPanelStatus("canceled") === "cancelled");
  ok("unknown is New, never hidden", merchPanelStatus("martian") === "new");
  ok("unknown label is honest", merchStatusLabel("martian").includes("martian"));
  ok("only drafts are confirmable", [...MERCH_CONFIRMABLE].join() === "draft");

  // money
  ok("dollars -> cents", centsFromDollars("12.34") === 1234 && centsFromDollars(5) === 500 && centsFromDollars("7.5") === 750);
  ok("garbage money is null, not 0", centsFromDollars("abc") === null && centsFromDollars(undefined) === null && centsFromDollars("") === null);

  // parse
  const raw = (over: Record<string, unknown> = {}) => ({
    id: 101,
    external_id: "gm-abc123-xy",
    status: "draft",
    created: 1767600000,
    updated: 1767600100,
    shipping_service_name: "Flat Rate",
    recipient: { name: "Jane Q Public", address1: "1 Main St", city: "Spokane", state_code: "WA", zip: "99201", country_code: "US", email: "jane@example.com", phone: "5095550100" },
    items: [
      { name: "Logo Tee - Black / M", quantity: 2, retail_price: "25.00", price: "11.50", variant_id: 4017, files: [{ preview_url: "https://files.cdn.printful.com/x.png" }] },
      { name: "Cap", quantity: 1, retail_price: "20.00", price: "9.00", product: { image: "javascript:alert(1)" } },
    ],
    costs: { subtotal: "32.00", shipping: "4.99", tax: "0.00", total: "36.99" },
    retail_costs: { subtotal: "70.00", shipping: "6.00", tax: "6.10", total: "82.10" },
    shipments: [{ carrier: "USPS", service: "Ground", tracking_number: "9400", tracking_url: "https://tools.usps.com/x", ship_date: "2026-01-06" }],
    ...over,
  });
  const p = parsePrintfulOrder(raw())!;
  ok("parses", p !== null && p.id === 101 && p.ref === "gm-abc123-xy" && p.ours);
  ok("draft needs a person and is confirmable", p.needsPerson && p.confirmable && p.cancellable);
  ok("placed time from unix seconds", p.placedAt === new Date(1767600000 * 1000).toISOString());
  ok("item count sums quantities", p.itemCount === 3);
  ok("paid vs cost vs margin", p.paid.total === 8210 && p.cost.total === 3699 && p.marginCents === 4511);
  ok("tax collected is read", p.paid.tax === 610);
  ok("https thumbnails only", p.items[0].thumbnail.startsWith("https://") && p.items[1].thumbnail === "");
  ok("shipment tracking read", p.shipments[0].trackingNumber === "9400" && p.shipments[0].trackingUrl.startsWith("https://"));
  ok("first name for sorting", p.firstName === "Jane");
  ok("no id -> null", parsePrintfulOrder({ status: "draft" }) === null && parsePrintfulOrder(null) === null);
  const noCost = parsePrintfulOrder(raw({ costs: {} }))!;
  ok("unknown cost -> unknown margin", noCost.marginCents === null);
  const foreign = parsePrintfulOrder(raw({ id: 7, external_id: "etsy-55" }))!;
  ok("non-gm order still listed, by numeric id", !foreign.ours && merchOrderHandle(foreign) === "7");
  ok("gm order handle is the ref", merchOrderHandle(p) === "gm-abc123-xy");
  ok("handle -> @ref", printfulIdFromHandle("gm-abc123-xy") === "@gm-abc123-xy");
  ok("handle -> numeric", printfulIdFromHandle("12345") === "12345");
  ok("bad handle rejected", printfulIdFromHandle("../orders") === null && printfulIdFromHandle("@x") === null && printfulIdFromHandle("") === null);
  ok("control chars stripped", parsePrintfulOrder(raw({ recipient: { name: "A\u0000B" } }))!.name === "A B");

  // view: reuse the shared grammar
  const mk = (id: number, status: string, created: number, total: string, name: string) =>
    parsePrintfulOrder(raw({ id, external_id: `gm-ord${id}00-a`, status, created, retail_costs: { total }, recipient: { name } }))!;
  const orders = [
    mk(1, "draft", 1767600000, "50.00", "zed"),
    mk(2, "inprocess", 1767500000, "90.00", "Amy"),
    mk(3, "fulfilled", 1767400000, "30.00", "Bob"),
    mk(4, "canceled", 1767300000, "10.00", "Cy"),
    mk(5, "failed", 1767200000, "20.00", "Dee"),
  ];
  const q = (over: Partial<OrdersPanelQuery> = {}): OrdersPanelQuery => ({
    status: "active",
    search: "",
    sortKey: "newest",
    sortColumns: ORDER_SORTS[0].columns,
    minRaw: "",
    maxRaw: "",
    page: 1,
    ...over,
  });
  const ids = (v: MerchPanelView) => v.rows.map((r) => r.id).join(",");
  ok("Active: drafts, failed, in production; newest first", ids(buildMerchPanelView(orders, q())) === "1,2,5");
  ok("counts over everything", (() => { const c = buildMerchPanelView(orders, q()).counts; return c.new === 2 && c.preparing === 1 && c.completed === 1 && c.cancelled === 1; })());
  ok("Completed tab", ids(buildMerchPanelView(orders, q({ status: "completed" }))) === "3");
  ok("Completed hides two needing a person", buildMerchPanelView(orders, q({ status: "completed" })).hiddenNeedsPerson === 2);
  ok("search by name", ids(buildMerchPanelView(orders, q({ status: "all", search: "AMY" }))) === "2");
  ok("search by ref", ids(buildMerchPanelView(orders, q({ status: "all", search: "gm-ord300" }))) === "3");
  ok("total high first", ids(buildMerchPanelView(orders, q({ status: "all", sortColumns: ORDER_SORTS.find((s) => s.key === "total_high")!.columns }))).startsWith("2,1"));
  ok("name A-Z case-insensitive", ids(buildMerchPanelView(orders, q({ status: "all", sortColumns: ORDER_SORTS.find((s) => s.key === "name")!.columns }))).startsWith("2,3,4,5"));
  ok("total min", ids(buildMerchPanelView(orders, q({ status: "all", totalMin: 4000 }))) === "1,2");
  ok("paging", (() => { const v = buildMerchPanelView(orders, q({ status: "all", page: 2 }), 2); return v.rows.length === 2 && v.window.page === 2 && v.total === 5; })());
  ok("every ORDER_SORTS column is sortable here", ORDER_SORTS.every((o) => o.columns.every((c) => merchSortColumnSupported(c.column))));
  ok("hidden warning wording", (merchHiddenWarning(1) ?? "").startsWith("1 merch order") && merchHiddenWarning(0) === null);
  ok("cap notice only when clipped", merchLoadCapNotice(500, 800)!.includes("500") && merchLoadCapNotice(3, 3) === null && merchLoadCapNotice(3, null) === null);

  return { passed, failed };
}
