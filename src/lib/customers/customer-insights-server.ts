/**
 * src/lib/customers/customer-insights-server.ts
 *
 * SLICE 3 — the server side of customer intelligence. Reads the database and
 * feeds the two PURE cores:
 *
 *   customer-insights-core  one customer's full profile (favorites, rhythm,
 *                           next visit, staples, recommendations, …)
 *   customer-segments-core  the whole customer base (RFM segments, rank,
 *                           stock watch)
 *
 * CONNECTION RULES (all verified in code, see docs/customer-intelligence.md):
 *   - A purchase is an order linked to the customer (orders.customer_id) whose
 *     status is "completed" — the same revenue basis as every report
 *     (src/lib/reports/revenue-basis.ts). A voided sale ends "cancelled"; an
 *     online order collected at the register ends "cancelled" and the REGISTER
 *     order is the sale of record, so nothing is counted twice.
 *   - Register sale lines carry brand = null; brand / vendor / strain / THC
 *     come from the published menu (order_lines.product_id =
 *     menu_items.source_item_id).
 *   - Which online order a register sale was the pickup of comes from the
 *     audit row "order.picked_up_at_register" (after_json.registerOrderId).
 *
 * Every paged read reports whether it finished. A read that stops early is
 * named in `partial` and shown on screen — a short list never poses as the
 * whole truth.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { getConfig, listTiers } from "@/lib/loyalty/loyalty-store";
import { tierForPoints } from "@/lib/loyalty/engine";
import { isCustomLineProductId } from "@/lib/pos/custom-sale-core";
import { REGISTER_PICKED_UP_NOTE_PREFIX } from "@/lib/pos/pickup-progress-core";
import { normalizeEmail, normalizePhoneDigits } from "@/lib/orders/customer-link-core";
import { escapeIlikeOrTerm } from "@/lib/supabase/postgrest-escape";
import type { Customer } from "@/lib/customers/types";
import {
  buildCustomerInsights,
  productKeyOf,
  purchaseChannelOf,
  type CatalogItem,
  type CustomerInsights,
  type LineInput,
  type LoyaltyInput,
  type OnlineOrderInput,
  type PurchaseInput,
  type ReturnInput,
} from "@/lib/customers/customer-insights-core";
import { pacificDayKey } from "@/lib/reports/timezone";
import {
  buildStockWatch,
  dueAndOverdue,
  identificationRate,
  median,
  normalizeStockStatus,
  percentileLabel,
  preferenceLift,
  stapleSignalsFromProductDays,
  type LabelSpend,
  type PreferenceLiftRow,
  type ProductDay,
  type StockStatus,
  type StockWatchRow,
  scorePopulation,
  segmentInfo,
  spendPercentile,
  storeTypicalGapDays,
  summarizePopulation,
  type CustomerRollup,
  type PopulationSummary,
  type ScoredCustomer,
  type SegmentInfo,
} from "@/lib/customers/customer-segments-core";

const PAGE = 1000;
const ID_CHUNK = 150;
/** Memory ceilings (reported as partial when hit — never silent). */
const MAX_CUSTOMER_ORDERS = 20_000;
const MAX_POPULATION_ROWS = 100_000;
const MAX_CATALOG_ROWS = 20_000;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

// ---------------------------------------------------------------------------
// Small read helpers
// ---------------------------------------------------------------------------

/** Paged read of one query; pushes `label` into `partial` when incomplete. */
async function readAll<Row>(
  label: string,
  partial: string[],
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  maxRows: number,
): Promise<Row[]> {
  const res = await pagedAllChecked<Row>(
    async (from, to) => {
      const r = await page(from, to);
      return { rows: ((r.data ?? []) as Row[]) ?? [], ok: !r.error };
    },
    { pageSize: PAGE, maxRows },
  );
  if (!res.verdict.complete) partial.push(label);
  return res.rows;
}

/** Chunked `.in()` read, each chunk fully paged. */
async function readIn<Row>(
  ids: readonly string[],
  label: string,
  partial: string[],
  page: (chunk: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  maxRows: number = MAX_POPULATION_ROWS,
): Promise<Row[]> {
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x.length > 0))];
  const out: Row[] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const chunk = unique.slice(i, i + ID_CHUNK);
    const res = await pagedAllChecked<Row>(
      async (from, to) => {
        const r = await page(chunk, from, to);
        return { rows: ((r.data ?? []) as Row[]) ?? [], ok: !r.error };
      },
      { pageSize: PAGE, maxRows },
    );
    out.push(...res.rows);
    if (!res.verdict.complete) {
      partial.push(label);
      break;
    }
  }
  return out;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// ---------------------------------------------------------------------------
// Row shapes (columns verified against the migrated schema)
// ---------------------------------------------------------------------------

type OrderRow = {
  id: string;
  order_number: string | null;
  status: string;
  origin: string | null;
  staff_note: string | null;
  pos_client_uuid: string | null;
  placed_at: string;
  completed_at: string | null;
  total_minor_units: number | null;
  savings_minor_units: number | null;
  loyalty_discount_minor_units: number | null;
  customer_id: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
};

const ORDER_COLS =
  "id, order_number, status, origin, staff_note, pos_client_uuid, placed_at, completed_at, total_minor_units, savings_minor_units, loyalty_discount_minor_units, customer_id";

type LineRow = {
  order_id: string;
  product_id: string | null;
  product_name: string | null;
  brand: string | null;
  category: string | null;
  quantity: number | null;
  price_minor_units: number | null;
  regular_price_minor_units: number | null;
};

type MenuRow = {
  id: string;
  source_item_id: string | null;
  name: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  strain_type: string | null;
  thc: string | null;
  price_minor_units: number | null;
  inventory_status: string | null;
  hidden: boolean | null;
};

export type CatalogIndex = {
  items: CatalogItem[];
  byKey: Map<string, CatalogItem & { thc: string | null }>;
  categoryMedianPriceMinor: Record<string, number>;
  versionFound: boolean;
};

// ---------------------------------------------------------------------------
// Catalog (published menu)
// ---------------------------------------------------------------------------

export async function loadCatalog(admin: Admin, partial: string[]): Promise<CatalogIndex> {
  const empty: CatalogIndex = { items: [], byKey: new Map(), categoryMedianPriceMinor: {}, versionFound: false };
  const version = await getPublishedVersion();
  if (!version) return empty;
  const rows = await readAll<MenuRow>(
    "the published menu",
    partial,
    (from, to) =>
      admin
        .from("menu_items")
        .select("id, source_item_id, name, brand_name, vendor_name, category, strain_type, thc, price_minor_units, inventory_status, hidden")
        .eq("menu_version_id", version.id)
        .order("id", { ascending: true })
        .range(from, to),
    MAX_CATALOG_ROWS,
  );
  // Items priced only on their variants: use the lowest positive variant price.
  const zeroPriced = rows.filter((r) => num(r.price_minor_units) <= 0).map((r) => r.id);
  const variantMin = new Map<string, number>();
  if (zeroPriced.length > 0) {
    const vrows = await readIn<{ id: string; menu_item_id: string; price_minor_units: number | null }>(
      zeroPriced,
      "menu variant prices",
      partial,
      (chunk, from, to) =>
        admin
          .from("menu_variants")
          .select("id, menu_item_id, price_minor_units")
          .in("menu_item_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
    );
    for (const v of vrows) {
      const p = num(v.price_minor_units);
      if (p <= 0) continue;
      const prev = variantMin.get(v.menu_item_id);
      if (prev === undefined || p < prev) variantMin.set(v.menu_item_id, p);
    }
  }
  const items: CatalogItem[] = [];
  const byKey = new Map<string, CatalogItem & { thc: string | null }>();
  const pricesByCat = new Map<string, number[]>();
  for (const r of rows) {
    const key = str(r.source_item_id);
    if (!key) continue;
    const price = num(r.price_minor_units) > 0 ? num(r.price_minor_units) : (variantMin.get(r.id) ?? 0);
    const status = (str(r.inventory_status) ?? "in-stock").toLowerCase();
    const stockStatus: CatalogItem["stockStatus"] =
      status === "unavailable" ? "unavailable" : status === "low-stock" ? "low-stock" : "in-stock";
    const item: CatalogItem & { thc: string | null } = {
      productKey: key,
      name: str(r.name) ?? key,
      brand: str(r.brand_name),
      vendor: str(r.vendor_name),
      category: str(r.category),
      strainType: str(r.strain_type),
      priceMinor: price,
      // A hidden item cannot be sold from the menu: treat it as unavailable
      // for recommendations and stock warnings.
      stockStatus: r.hidden ? "unavailable" : stockStatus,
      thc: str(r.thc),
    };
    byKey.set(key, item);
    items.push(item);
    if (item.category && price > 0) {
      const list = pricesByCat.get(item.category) ?? [];
      list.push(price);
      pricesByCat.set(item.category, list);
    }
  }
  const categoryMedianPriceMinor: Record<string, number> = {};
  for (const [cat, list] of pricesByCat) {
    const m = median(list);
    if (m !== null) categoryMedianPriceMinor[cat] = m;
  }
  return { items, byKey, categoryMedianPriceMinor, versionFound: true };
}

// ---------------------------------------------------------------------------
// Population rollups (for segments + rank)
// ---------------------------------------------------------------------------

export type PopulationRead = {
  rollups: CustomerRollup[];
  /** "live" = customers columns maintained by migration 0232; "computed" = rebuilt from orders here. */
  source: "live" | "computed";
};

/**
 * Every customer's visits / net spend / first + last visit. Uses the 0232
 * columns when they exist; otherwise rebuilds the same numbers from orders
 * (so the screens are right even before the owner runs the migration).
 */
export async function loadPopulation(admin: Admin, partial: string[]): Promise<PopulationRead> {
  type LiveRow = {
    id: string;
    visit_count: number | null;
    lifetime_spend_minor_units: number | null;
    first_visit_at: string | null;
    last_visit_at: string | null;
  };
  const probe = await admin.from("customers").select("id, first_visit_at").limit(1);
  if (!probe.error) {
    const rows = await readAll<LiveRow>(
      "customer totals",
      partial,
      (from, to) =>
        admin
          .from("customers")
          .select("id, visit_count, lifetime_spend_minor_units, first_visit_at, last_visit_at")
          .order("id", { ascending: true })
          .range(from, to),
      MAX_POPULATION_ROWS,
    );
    return {
      source: "live",
      rollups: rows.map((r) => ({
        customerId: r.id,
        visits: num(r.visit_count),
        netSpendMinor: num(r.lifetime_spend_minor_units),
        firstVisitAt: r.first_visit_at,
        lastVisitAt: r.last_visit_at,
      })),
    };
  }
  return { source: "computed", rollups: await computePopulationFromOrders(admin, partial) };
}

/** The 0232 definition, computed in code: completed linked orders minus refunds. */
export async function computePopulationFromOrders(admin: Admin, partial: string[]): Promise<CustomerRollup[]> {
  const customers = await readAll<{ id: string }>(
    "customers",
    partial,
    (from, to) => admin.from("customers").select("id").order("id", { ascending: true }).range(from, to),
    MAX_POPULATION_ROWS,
  );
  const orders = await readAll<{ id: string; customer_id: string; total_minor_units: number | null; placed_at: string; completed_at: string | null }>(
    "linked sales",
    partial,
    (from, to) =>
      admin
        .from("orders")
        .select("id, customer_id, total_minor_units, placed_at, completed_at")
        .eq("status", "completed")
        .not("customer_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    MAX_POPULATION_ROWS,
  );
  const refunds = await readIn<{ id: string; order_id: string; refund_minor_units: number | null }>(
    orders.map((o) => o.id),
    "refunds",
    partial,
    (chunk, from, to) =>
      admin
        .from("customer_returns")
        .select("id, order_id, refund_minor_units")
        .in("order_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
  );
  return rollupsFromRows(
    customers.map((c) => c.id),
    orders,
    refunds,
  );
}

/** Pure fold used by the fallback path (exported for tests). */
export function rollupsFromRows(
  customerIds: readonly string[],
  orders: readonly { id: string; customer_id: string; total_minor_units: number | null; placed_at: string; completed_at: string | null }[],
  refunds: readonly { order_id: string; refund_minor_units: number | null }[],
): CustomerRollup[] {
  const refundByOrder = new Map<string, number>();
  for (const r of refunds) refundByOrder.set(r.order_id, (refundByOrder.get(r.order_id) ?? 0) + Math.max(0, num(r.refund_minor_units)));
  const acc = new Map<string, CustomerRollup>();
  for (const id of customerIds) acc.set(id, { customerId: id, visits: 0, netSpendMinor: 0, firstVisitAt: null, lastVisitAt: null });
  for (const o of orders) {
    const c = acc.get(o.customer_id) ?? { customerId: o.customer_id, visits: 0, netSpendMinor: 0, firstVisitAt: null, lastVisitAt: null };
    const at = o.completed_at ?? o.placed_at;
    c.visits += 1;
    c.netSpendMinor += num(o.total_minor_units) - (refundByOrder.get(o.id) ?? 0);
    if (!c.firstVisitAt || Date.parse(at) < Date.parse(c.firstVisitAt)) c.firstVisitAt = at;
    if (!c.lastVisitAt || Date.parse(at) > Date.parse(c.lastVisitAt)) c.lastVisitAt = at;
    acc.set(o.customer_id, c);
  }
  return [...acc.values()].map((c) => ({ ...c, netSpendMinor: Math.max(0, c.netSpendMinor) }));
}

// ---------------------------------------------------------------------------
// Lines → LineInput (catalog enrichment)
// ---------------------------------------------------------------------------

export function toLineInput(l: LineRow, catalog: CatalogIndex): LineInput {
  const key = productKeyOf(l.product_id, l.product_name);
  const cat = catalog.byKey.get(key);
  return {
    productKey: key,
    productName: str(l.product_name) ?? cat?.name ?? "Unknown item",
    brand: str(l.brand) ?? cat?.brand ?? null,
    vendor: cat?.vendor ?? null,
    category: str(l.category) ?? cat?.category ?? null,
    strainType: cat?.strainType ?? null,
    thcText: cat?.thc ?? null,
    quantity: Math.max(0, Math.round(num(l.quantity))),
    unitPriceMinor: Math.max(0, num(l.price_minor_units)),
    regularPriceMinor: l.regular_price_minor_units === null || l.regular_price_minor_units === undefined ? null : num(l.regular_price_minor_units),
    isCustom: isCustomLineProductId(l.product_id),
  };
}

// ---------------------------------------------------------------------------
// One customer's profile
// ---------------------------------------------------------------------------

export type RecentPurchase = {
  orderId: string;
  orderNumber: string | null;
  at: string;
  channelLabel: string;
  totalMinor: number;
  items: number;
  refundMinor: number;
};

export type UnlinkedMatch = {
  /** The online order that matched by contact info. */
  onlineOrderId: string;
  onlineOrderNumber: string | null;
  channel: "website" | "leafly";
  placedAt: string;
  status: string;
  totalMinor: number;
  basis: "phone_and_email" | "phone" | "email";
  nameOnOrder: string;
  /**
   * The order to link: the online order itself, or — when it was collected at
   * the register — the register sale that replaced it. null when the sale of
   * record is already linked to someone (never overwritten).
   */
  linkOrderId: string | null;
  linkNote: string;
};

export type CustomerProfile = {
  insights: CustomerInsights;
  segment: SegmentInfo | null;
  spendRankLabel: string | null;
  population: PopulationSummary;
  populationSource: "live" | "computed";
  recentPurchases: RecentPurchase[];
  unlinkedMatches: UnlinkedMatch[];
  partial: string[];
  catalogFound: boolean;
};

export async function loadCustomerProfile(customer: Customer, nowIso: string = new Date().toISOString()): Promise<CustomerProfile | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const partial: string[] = [];

  // 1. Every order linked to the customer (any status) — purchases AND the
  //    online-order history (placed / cancelled / no-show / open).
  const orders = await readAll<OrderRow>(
    "this customer's orders",
    partial,
    (from, to) =>
      admin.from("orders").select(ORDER_COLS).eq("customer_id", customer.id).order("id", { ascending: true }).range(from, to),
    MAX_CUSTOMER_ORDERS,
  );
  const completed = orders.filter((o) => o.status === "completed");
  const completedIds = completed.map((o) => o.id);

  // 2. Lines + catalog + returns.
  const [catalog, lines, returnsRows] = await Promise.all([
    loadCatalog(admin, partial),
    readIn<LineRow & { id: string }>(completedIds, "purchase lines", partial, (chunk, from, to) =>
      admin
        .from("order_lines")
        .select("id, order_id, product_id, product_name, brand, category, quantity, price_minor_units, regular_price_minor_units")
        .in("order_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    readIn<{ id: string; order_id: string | null; product_name: string | null; quantity: number | null; refund_minor_units: number | null; reason: string | null; created_at: string }>(
      completedIds,
      "returns",
      partial,
      (chunk, from, to) =>
        admin
          .from("customer_returns")
          .select("id, order_id, product_name, quantity, refund_minor_units, reason, created_at")
          .in("order_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
    ),
  ]);

  // 3. Register sales that were pickups of online orders (audit trail).
  const registerIds = completed.filter((o) => purchaseChannelOf({ origin: o.origin, staffNote: o.staff_note, posClientUuid: o.pos_client_uuid }) === "register").map((o) => o.id);
  const pickedFrom = await loadPickedUpFrom(admin, partial, registerIds);

  // 4. Online orders linked to the customer + which were collected at the register.
  const onlineRows = orders.filter((o) => purchaseChannelOf({ origin: o.origin, staffNote: o.staff_note, posClientUuid: o.pos_client_uuid }) !== "register");
  const pickedUpIds = await loadRegisterPickupMarkers(
    admin,
    partial,
    onlineRows.filter((o) => o.status === "cancelled").map((o) => o.id),
  );

  const linesByOrder = new Map<string, LineInput[]>();
  for (const l of lines) {
    const list = linesByOrder.get(l.order_id) ?? [];
    list.push(toLineInput(l, catalog));
    linesByOrder.set(l.order_id, list);
  }
  const refundByOrder = new Map<string, number>();
  for (const r of returnsRows) if (r.order_id) refundByOrder.set(r.order_id, (refundByOrder.get(r.order_id) ?? 0) + Math.max(0, num(r.refund_minor_units)));

  const purchases: PurchaseInput[] = completed.map((o) => {
    const channel = purchaseChannelOf({ origin: o.origin, staffNote: o.staff_note, posClientUuid: o.pos_client_uuid });
    return {
      orderId: o.id,
      orderNumber: o.order_number,
      channel,
      pickedUpFrom: channel === "register" ? (pickedFrom.get(o.id) ?? null) : null,
      completedAt: o.completed_at,
      placedAt: o.placed_at,
      totalMinor: Math.max(0, num(o.total_minor_units)),
      savingsMinor: Math.max(0, num(o.savings_minor_units)),
      loyaltyDiscountMinor: Math.max(0, num(o.loyalty_discount_minor_units)),
      lines: linesByOrder.get(o.id) ?? [],
    };
  });
  const returns: ReturnInput[] = returnsRows.map((r) => ({
    orderId: r.order_id,
    productName: r.product_name,
    quantity: num(r.quantity),
    refundMinor: Math.max(0, num(r.refund_minor_units)),
    reason: r.reason,
    createdAt: r.created_at,
  }));
  const onlineOrders: OnlineOrderInput[] = onlineRows.map((o) => ({
    orderId: o.id,
    orderNumber: o.order_number,
    channel: (o.origin ?? "").toLowerCase() === "leafly" ? "leafly" : "website",
    status: o.status,
    pickedUpAtRegister: pickedUpIds.has(o.id),
    placedAt: o.placed_at,
    totalMinor: Math.max(0, num(o.total_minor_units)),
  }));

  // 5. Loyalty.
  const loyalty = await loadLoyalty(admin, customer.id, partial);

  // 6. Population (segments + rank + the shop's rhythm).
  const pop = await loadPopulation(admin, partial);
  const scored = scorePopulation(pop.rollups, nowIso);
  const population = summarizePopulation(scored);
  const me: ScoredCustomer | undefined = scored.find((s) => s.customerId === customer.id);
  const mine: CustomerRollup | undefined = pop.rollups.find((r) => r.customerId === customer.id);
  const segment = me && me.segment !== "none" ? segmentInfo(me.segment) : null;
  const spendRankLabel = mine && mine.visits > 0 ? percentileLabel(spendPercentile(mine, pop.rollups)) : null;

  // 7. Unlinked online orders that match by phone / email.
  const unlinkedMatches = await findUnlinkedMatches(admin, partial, customer);

  const insights = buildCustomerInsights({
    purchases,
    returns,
    onlineOrders,
    loyalty,
    catalog: catalog.items,
    unlinkedMatchingOrders: unlinkedMatches.filter((m) => m.linkOrderId !== null).length,
    context: {
      nowIso,
      storeTypicalGapDays: storeTypicalGapDays(pop.rollups),
      categoryMedianPriceMinor: catalog.categoryMedianPriceMinor,
      birthdate: customer.birthdate,
      marketingConsent: Boolean(customer.marketing_consent),
      doNotContact: Boolean(customer.do_not_contact),
      importedSpendMinor: Math.max(0, num(customer.imported_spend_minor_units)),
      importedLastPurchaseAt: str(customer.last_purchase_at),
      spendRankLabel,
      segmentLabel: segment?.label ?? null,
    },
  });

  const recentPurchases: RecentPurchase[] = [...purchases]
    .sort((a, b) => Date.parse(b.completedAt ?? b.placedAt) - Date.parse(a.completedAt ?? a.placedAt))
    .slice(0, 12)
    .map((p) => ({
      orderId: p.orderId,
      orderNumber: p.orderNumber,
      at: p.completedAt ?? p.placedAt,
      channelLabel:
        p.channel === "register"
          ? p.pickedUpFrom === "leafly"
            ? "Leafly order, picked up in store"
            : p.pickedUpFrom === "website"
              ? "Website order, picked up in store"
              : "In store"
          : p.channel === "leafly"
            ? "Leafly order"
            : "Website order",
      totalMinor: p.totalMinor,
      items: p.lines.reduce((s, l) => s + l.quantity, 0),
      refundMinor: refundByOrder.get(p.orderId) ?? 0,
    }));

  return {
    insights,
    segment,
    spendRankLabel,
    population,
    populationSource: pop.source,
    recentPurchases,
    unlinkedMatches,
    partial: [...new Set(partial)],
    catalogFound: catalog.versionFound,
  };
}

/** registerOrderId → which online channel it was the pickup of. */
async function loadPickedUpFrom(admin: Admin, partial: string[], registerOrderIds: readonly string[]): Promise<Map<string, "website" | "leafly">> {
  const out = new Map<string, "website" | "leafly">();
  if (registerOrderIds.length === 0) return out;
  const want = new Set(registerOrderIds);
  // The audit row is keyed by the SOURCE order; registerOrderId lives in
  // after_json. Filter server-side on the JSON field, chunked.
  const rows = await readIn<{ id: number; after_json: Record<string, unknown> | null }>(
    registerOrderIds,
    "register pickup history",
    partial,
    (chunk, from, to) =>
      admin
        .from("audit_logs")
        .select("id, after_json")
        .eq("action", "order.picked_up_at_register")
        .in("after_json->>registerOrderId", chunk)
        .order("id", { ascending: true })
        .range(from, to),
  );
  for (const r of rows) {
    const a = r.after_json ?? {};
    const reg = str(a.registerOrderId);
    if (!reg || !want.has(reg)) continue;
    out.set(reg, (str(a.origin) ?? "").toLowerCase() === "leafly" ? "leafly" : "website");
  }
  return out;
}

/** Online orders closed because they were collected at the register. */
async function loadRegisterPickupMarkers(admin: Admin, partial: string[], cancelledIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (cancelledIds.length === 0) return out;
  const rows = await readIn<{ id: string; order_id: string }>(cancelledIds, "register pickup markers", partial, (chunk, from, to) =>
    admin
      .from("order_events")
      .select("id, order_id")
      .in("order_id", chunk)
      .eq("to_status", "cancelled")
      .like("note", `${REGISTER_PICKED_UP_NOTE_PREFIX}%`)
      .order("id", { ascending: true })
      .range(from, to),
  );
  for (const r of rows) out.add(r.order_id);
  return out;
}

async function loadLoyalty(admin: Admin, customerId: string, partial: string[]): Promise<LoyaltyInput | null> {
  const { data: account, error } = await admin
    .from("loyalty_accounts")
    .select("id, balance_points, lifetime_points, tier_id")
    .eq("customer_id", customerId)
    .maybeSingle<{ id: string; balance_points: number; lifetime_points: number; tier_id: string | null }>();
  if (error) partial.push("loyalty account");
  if (error || !account) return null;
  // Fully paged (never a silent cap): an incomplete read is named in `partial`.
  const [cfg, tiers, ledgerRows, redemptionRows] = await Promise.all([
    getConfig(),
    listTiers(),
    readAll<{ id: string; kind: string; points: number }>(
      "loyalty points history",
      partial,
      (from, to) => admin.from("loyalty_ledger").select("id, kind, points").eq("account_id", account.id).order("id", { ascending: true }).range(from, to),
      MAX_POPULATION_ROWS,
    ),
    readAll<{ id: string; status: string; value_minor: number }>(
      "loyalty rewards",
      partial,
      (from, to) =>
        admin.from("loyalty_redemptions").select("id, status, value_minor").eq("account_id", account.id).order("id", { ascending: true }).range(from, to),
      MAX_POPULATION_ROWS,
    ),
  ]);
  let earned = 0;
  let redeemed = 0;
  for (const r of ledgerRows) {
    const p = num(r.points);
    if (p > 0) earned += p;
    else if (r.kind === "redeem") redeemed += -p;
  }
  let codes = 0;
  let value = 0;
  for (const r of redemptionRows) {
    if (r.status !== "redeemed") continue;
    codes += 1;
    value += Math.max(0, num(r.value_minor));
  }
  const tier = tierForPoints(num(account.lifetime_points), tiers);
  return {
    balancePoints: num(account.balance_points),
    lifetimePoints: num(account.lifetime_points),
    tierName: tier?.name ?? null,
    pointValueMinor: cfg.pointValueMinor,
    minRedeemPoints: cfg.minRedeemPoints,
    pointsEarned: earned,
    pointsRedeemed: redeemed,
    codesRedeemed: codes,
    redeemedValueMinor: value,
  };
}

// ---------------------------------------------------------------------------
// Unlinked matches (the "connect their history" tool)
// ---------------------------------------------------------------------------

export async function findUnlinkedMatches(
  admin: Admin,
  partial: string[],
  customer: Pick<Customer, "id" | "phone" | "email"> & { phone_normalized?: string | null },
): Promise<UnlinkedMatch[]> {
  const phone = normalizePhoneDigits(customer.phone_normalized ?? customer.phone);
  const email = normalizeEmail(customer.email);
  if (!phone && !email) return [];
  // Phone is compared on digits; an order's phone is free text, so fetch the
  // candidates by email (exact, case-insensitive) and by the last 7 digits,
  // then confirm with the SAME normalizer the order page uses.
  const ors: string[] = [];
  const emailTerm = email ? escapeIlikeOrTerm(email) : "";
  if (emailTerm) ors.push(`customer_email.ilike.${emailTerm}`);
  // Last 4 digits are contiguous in every phone format ("(360) 555-1234",
  // "360.555.1234", "+13605551234"); the exact digits check below confirms.
  if (phone && phone.length >= 7) ors.push(`customer_phone.ilike.%${phone.slice(-4)}%`);
  if (ors.length === 0) return [];
  const rows = await readAll<OrderRow>(
    "matching online orders",
    partial,
    (from, to) =>
      admin
        .from("orders")
        .select(`${ORDER_COLS}, customer_first_name, customer_last_name, customer_phone, customer_email`)
        .is("customer_id", null)
        .in("origin", ["greenway", "leafly"])
        .or(ors.join(","))
        .order("id", { ascending: true })
        .range(from, to),
    5_000,
  );
  const matches = rows
    .filter((o) => purchaseChannelOf({ origin: o.origin, staffNote: o.staff_note, posClientUuid: o.pos_client_uuid }) !== "register")
    .map((o) => {
      const oPhone = normalizePhoneDigits(o.customer_phone ?? null);
      const oEmail = normalizeEmail(o.customer_email ?? null);
      const phoneHit = phone !== null && oPhone !== null && phone === oPhone;
      const emailHit = email !== null && oEmail !== null && email === oEmail;
      if (!phoneHit && !emailHit) return null;
      return { o, basis: (phoneHit && emailHit ? "phone_and_email" : phoneHit ? "phone" : "email") as UnlinkedMatch["basis"] };
    })
    .filter((x): x is { o: OrderRow; basis: UnlinkedMatch["basis"] } => x !== null);
  if (matches.length === 0) return [];

  // For cancelled ones, find the register sale that replaced them (if any).
  const cancelledIds = matches.filter((m) => m.o.status === "cancelled").map((m) => m.o.id);
  const replacedBy = new Map<string, string>();
  if (cancelledIds.length > 0) {
    const audits = await readIn<{ id: number; entity_id: string; after_json: Record<string, unknown> | null }>(
      cancelledIds,
      "register pickups of matching orders",
      partial,
      (chunk, from, to) =>
        admin
          .from("audit_logs")
          .select("id, entity_id, after_json")
          .eq("action", "order.picked_up_at_register")
          .in("entity_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
    );
    for (const a of audits) {
      const reg = str((a.after_json ?? {}).registerOrderId);
      if (reg) replacedBy.set(a.entity_id, reg);
    }
  }
  const regIds = [...new Set(replacedBy.values())];
  const regOwner = new Map<string, { customer_id: string | null; status: string }>();
  if (regIds.length > 0) {
    const regs = await readIn<{ id: string; customer_id: string | null; status: string }>(regIds, "register sales for matching orders", partial, (chunk, from, to) =>
      admin.from("orders").select("id, customer_id, status").in("id", chunk).order("id", { ascending: true }).range(from, to),
    );
    for (const r of regs) regOwner.set(r.id, { customer_id: r.customer_id, status: r.status });
  }

  return matches
    .map(({ o, basis }): UnlinkedMatch => {
      const channel: "website" | "leafly" = (o.origin ?? "").toLowerCase() === "leafly" ? "leafly" : "website";
      const base = {
        onlineOrderId: o.id,
        onlineOrderNumber: o.order_number,
        channel,
        placedAt: o.placed_at,
        status: o.status,
        totalMinor: Math.max(0, num(o.total_minor_units)),
        basis,
        nameOnOrder: `${o.customer_first_name ?? ""} ${o.customer_last_name ?? ""}`.trim() || "—",
      };
      const reg = replacedBy.get(o.id);
      if (reg) {
        const owner = regOwner.get(reg);
        if (owner && owner.customer_id && owner.customer_id !== customer.id) {
          return { ...base, linkOrderId: null, linkNote: "Picked up in store, but that sale is already linked to a different customer. Check it on the order page." };
        }
        if (owner && owner.customer_id === customer.id) {
          return { ...base, linkOrderId: null, linkNote: "Picked up in store; that sale is already on this profile." };
        }
        return { ...base, linkOrderId: reg, linkNote: "Picked up in store: links the register sale (the sale of record)." };
      }
      if (o.status === "cancelled") return { ...base, linkOrderId: o.id, linkNote: "Cancelled order: links for history only (no sale)." };
      if (o.status === "no_show") return { ...base, linkOrderId: o.id, linkNote: "Never picked up: links for history only (no sale)." };
      if (o.status === "completed") return { ...base, linkOrderId: o.id, linkNote: "Completed: adds this sale to their visits and spend." };
      return { ...base, linkOrderId: o.id, linkNote: "Still open: they'll earn points when it completes." };
    })
    .sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt));
}

/**
 * Staff-confirmed bulk link from the customer page. Links ONLY orders that
 * (a) are still unlinked at write time and (b) are in this customer's current
 * match list — the ids from the form are re-verified, never trusted.
 * Loyalty points are NOT back-dated (accrual happens at completion).
 */
export async function linkMatchedOrders(
  customer: Customer,
  requestedOrderIds: readonly string[],
  actor: { actorId: string | null; actorLabel: string | null },
): Promise<{ ok: true; linked: string[] } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const admin = createSupabaseAdminClient();
  const partial: string[] = [];
  const matches = await findUnlinkedMatches(admin, partial, customer);
  if (partial.length > 0) return { ok: false, error: `Could not finish reading ${partial.join(", ")}. Nothing was linked; try again.` };
  const allowed = new Set(matches.map((m) => m.linkOrderId).filter((x): x is string => x !== null));
  const want = [...new Set(requestedOrderIds)].filter((id) => allowed.has(id));
  if (want.length === 0) return { ok: false, error: "None of the selected orders can be linked any more (already linked or no longer matching)." };
  const linked: string[] = [];
  const name = `${customer.first_name}${customer.last_name ? ` ${customer.last_name}` : ""}`;
  for (const id of want) {
    // Conditional: only if still unlinked (never steals another customer's sale).
    const { data, error } = await admin.from("orders").update({ customer_id: customer.id }).eq("id", id).is("customer_id", null).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || (data as unknown[]).length === 0) continue;
    linked.push(id);
    await admin.from("order_events").insert({
      order_id: id,
      event_type: "customer_linked",
      note: `Linked to customer ${name} (from the customer profile, matched by contact info)`,
      actor_id: actor.actorId,
      actor_label: actor.actorLabel,
    });
  }
  return { ok: true, linked };
}

// ---------------------------------------------------------------------------
// The whole customer base (intelligence dashboard)
// ---------------------------------------------------------------------------

export type NamedCustomer = {
  customerId: string;
  name: string;
  contact: string | null;
  marketingConsent: boolean;
  doNotContact: boolean;
};

export type IntelligenceDashboard = {
  nowIso: string;
  population: PopulationSummary;
  populationSource: "live" | "computed";
  /** Sales in the last IDENT_WINDOW_DAYS: how many were tied to a customer. */
  identification: { linked: number; all: number; rate: number | null; windowDays: number };
  topCustomers: (NamedCustomer & { visits: number; netSpendMinor: number; lastVisitAt: string | null; segment: SegmentInfo })[];
  dueSoon: (NamedCustomer & DueRow)[];
  overdue: (NamedCustomer & DueRow)[];
  stockWatch: StockWatchRow[];
  bestBrands: PreferenceLiftRow[];
  bestCategories: PreferenceLiftRow[];
  bestGroupSize: number;
  segmentMembers: Record<string, (NamedCustomer & { visits: number; netSpendMinor: number; lastVisitAt: string | null })[]>;
  partial: string[];
  catalogFound: boolean;
  /** Days of purchase history the product-level views looked at. */
  historyDays: number;
};

type DueRow = { visits: number; netSpendMinor: number; lastVisitAt: string; gapDays: number; dueInDays: number; segment: SegmentInfo };

export const IDENT_WINDOW_DAYS = 90;
export const PRODUCT_HISTORY_DAYS = 365;
const SEGMENT_MEMBER_LIMIT = 50;

export async function loadIntelligenceDashboard(nowIso: string = new Date().toISOString()): Promise<IntelligenceDashboard | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const partial: string[] = [];

  const [pop, catalog] = await Promise.all([loadPopulation(admin, partial), loadCatalog(admin, partial)]);
  const scored = scorePopulation(pop.rollups, nowIso);
  const population = summarizePopulation(scored);
  const segByCustomer = new Map(scored.map((s) => [s.customerId, s.segment]));

  // Identification rate: exact counts, last 90 days of completed sales.
  const since = new Date(Date.parse(nowIso) - IDENT_WINDOW_DAYS * 86_400_000).toISOString();
  const [allRes, linkedRes] = await Promise.all([
    admin.from("orders").select("id", { count: "exact", head: true }).eq("status", "completed").gte("placed_at", since),
    admin.from("orders").select("id", { count: "exact", head: true }).eq("status", "completed").gte("placed_at", since).not("customer_id", "is", null),
  ]);
  if (allRes.error || linkedRes.error) partial.push("the identification counts");
  const all = allRes.count ?? 0;
  const linked = linkedRes.count ?? 0;

  // Product-level history for linked customers (last 12 months).
  const historySince = new Date(Date.parse(nowIso) - PRODUCT_HISTORY_DAYS * 86_400_000).toISOString();
  const linkedOrders = await readAll<{ id: string; customer_id: string; placed_at: string; completed_at: string | null }>(
    "linked sales (12 months)",
    partial,
    (from, to) =>
      admin
        .from("orders")
        .select("id, customer_id, placed_at, completed_at")
        .eq("status", "completed")
        .not("customer_id", "is", null)
        .gte("placed_at", historySince)
        .order("id", { ascending: true })
        .range(from, to),
    MAX_POPULATION_ROWS,
  );
  const orderMeta = new Map(linkedOrders.map((o) => [o.id, o]));
  const lineRows = await readIn<LineRow & { id: string }>(
    linkedOrders.map((o) => o.id),
    "linked sale lines (12 months)",
    partial,
    (chunk, from, to) =>
      admin
        .from("order_lines")
        .select("id, order_id, product_id, product_name, brand, category, quantity, price_minor_units, regular_price_minor_units")
        .in("order_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    MAX_POPULATION_ROWS * 4,
  );
  const productDays: ProductDay[] = [];
  const brandSpend: LabelSpend[] = [];
  const categorySpend: LabelSpend[] = [];
  for (const l of lineRows) {
    const o = orderMeta.get(l.order_id);
    if (!o) continue;
    const li = toLineInput(l, catalog);
    if (li.isCustom || li.quantity <= 0) continue;
    const spend = li.unitPriceMinor * li.quantity;
    productDays.push({ customerId: o.customer_id, productKey: li.productKey, productName: li.productName, dayKey: pacificDayKey(o.completed_at ?? o.placed_at) });
    if (li.brand) brandSpend.push({ customerId: o.customer_id, label: li.brand, spendMinor: spend });
    if (li.category) categorySpend.push({ customerId: o.customer_id, label: li.category, spendMinor: spend });
  }
  const todayKey = pacificDayKey(nowIso);
  const signals = stapleSignalsFromProductDays(productDays, todayKey, segByCustomer);
  const stockByProduct = new Map<string, StockStatus>();
  for (const s of signals) {
    const c = catalog.byKey.get(s.productKey);
    stockByProduct.set(s.productKey, normalizeStockStatus(c?.stockStatus ?? null, Boolean(c)));
  }
  const stockWatch = catalog.versionFound ? buildStockWatch(signals, stockByProduct) : [];

  // "Best customers" = champions + loyal + can't-lose (falls back to the top
  // 20% by spend when no one qualifies yet).
  let best = new Set(scored.filter((s) => s.segment === "champions" || s.segment === "loyal" || s.segment === "cant_lose").map((s) => s.customerId));
  if (best.size === 0) {
    const buyers = scored.filter((s) => s.visits > 0).sort((a, b) => b.netSpendMinor - a.netSpendMinor);
    best = new Set(buyers.slice(0, Math.max(1, Math.ceil(buyers.length * 0.2))).map((s) => s.customerId));
  }
  const bestBrands = preferenceLift(brandSpend, best);
  const bestCategories = preferenceLift(categorySpend, best);

  // Lists that need names.
  const buyers = scored.filter((s) => s.visits > 0);
  const top = [...buyers].sort((a, b) => b.netSpendMinor - a.netSpendMinor || b.visits - a.visits).slice(0, 15);
  const { dueSoon, overdue } = dueAndOverdue(scored, nowIso, 7);
  const dueTop = dueSoon.slice(0, 25);
  const overTop = overdue.slice(0, 25);
  const segmentMembersRaw = new Map<string, ScoredCustomer[]>();
  for (const s of [...buyers].sort((a, b) => b.netSpendMinor - a.netSpendMinor)) {
    const list = segmentMembersRaw.get(s.segment) ?? [];
    if (list.length < SEGMENT_MEMBER_LIMIT) list.push(s);
    segmentMembersRaw.set(s.segment, list);
  }
  const needIds = new Set<string>([...top.map((t) => t.customerId), ...dueTop.map((d) => d.customerId), ...overTop.map((d) => d.customerId)]);
  for (const list of segmentMembersRaw.values()) for (const s of list) needIds.add(s.customerId);
  const names = await loadNames(admin, partial, [...needIds]);
  const nameOf = (id: string): NamedCustomer => names.get(id) ?? { customerId: id, name: "Unknown customer", contact: null, marketingConsent: false, doNotContact: false };

  const segmentMembers: IntelligenceDashboard["segmentMembers"] = {};
  for (const [key, list] of segmentMembersRaw) {
    segmentMembers[key] = list.map((s) => ({ ...nameOf(s.customerId), visits: s.visits, netSpendMinor: s.netSpendMinor, lastVisitAt: s.lastVisitAt }));
  }

  return {
    nowIso,
    population,
    populationSource: pop.source,
    identification: { linked, all, rate: identificationRate(linked, all), windowDays: IDENT_WINDOW_DAYS },
    topCustomers: top.map((s) => ({ ...nameOf(s.customerId), visits: s.visits, netSpendMinor: s.netSpendMinor, lastVisitAt: s.lastVisitAt, segment: segmentInfo(s.segment) })),
    dueSoon: dueTop.map((d) => ({ ...nameOf(d.customerId), ...d, segment: segmentInfo(d.segment) })),
    overdue: overTop.map((d) => ({ ...nameOf(d.customerId), ...d, segment: segmentInfo(d.segment) })),
    stockWatch,
    bestBrands,
    bestCategories,
    bestGroupSize: best.size,
    segmentMembers,
    partial: [...new Set(partial)],
    catalogFound: catalog.versionFound,
    historyDays: PRODUCT_HISTORY_DAYS,
  };
}

async function loadNames(admin: Admin, partial: string[], ids: readonly string[]): Promise<Map<string, NamedCustomer>> {
  const out = new Map<string, NamedCustomer>();
  const rows = await readIn<{ id: string; first_name: string; last_name: string | null; phone: string | null; email: string | null; marketing_consent: boolean; do_not_contact: boolean }>(
    ids,
    "customer names",
    partial,
    (chunk, from, to) =>
      admin
        .from("customers")
        .select("id, first_name, last_name, phone, email, marketing_consent, do_not_contact")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
  );
  for (const r of rows) {
    out.set(r.id, {
      customerId: r.id,
      name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unnamed",
      contact: r.phone || r.email || null,
      marketingConsent: Boolean(r.marketing_consent),
      doNotContact: Boolean(r.do_not_contact),
    });
  }
  return out;
}

/** Segment per customer for the list page (one population read). */
export async function loadSegmentMap(nowIso: string = new Date().toISOString()): Promise<{
  segments: Map<string, SegmentInfo>;
  /** Each customer's visits / net spend / last visit — live columns after 0232, computed from orders before. */
  rollups: Map<string, CustomerRollup>;
  source: "live" | "computed";
  partial: string[];
} | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const partial: string[] = [];
  const pop = await loadPopulation(admin, partial);
  const scored = scorePopulation(pop.rollups, nowIso);
  const segments = new Map<string, SegmentInfo>();
  for (const s of scored) if (s.segment !== "none") segments.set(s.customerId, segmentInfo(s.segment));
  const rollups = new Map<string, CustomerRollup>();
  for (const r of pop.rollups) rollups.set(r.customerId, r);
  return { segments, rollups, source: pop.source, partial };
}
