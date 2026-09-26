/**
 * src/lib/reports/online-orders-channels-core.ts
 *
 * THE ALL-CHANNELS HALF OF THE ONLINE ORDERS REPORT — pure, import-free.
 *
 * The owner, verbatim:
 *
 *   > "Either the math and logic is way off, or the report page is showing
 *   >  total order value for both our and Leafly orders, but the total number
 *   >  of orders is only Leafly? ... I would like for it to accurately report
 *   >  on both Leafly and our own online orders. With comparison statistics
 *   >  between the two types."
 *
 * WHAT WAS ACTUALLY WRONG (measured, see docs/online-orders-report.md)
 * -------------------------------------------------------------------
 * 1. The value was 100x too high. Leafly's spec says `Order.total` is ALREADY
 *    in minor units ("order grand total in minor units"). The old report fed
 *    it to a DECIMAL-DOLLAR parser, so a $33.70 order (3370) became 337000 —
 *    $3,370.00. Nine orders worth about $337 showed as $33,700.00.
 * 2. It only ever read `leafly_orders`. Website orders were never counted, so
 *    the tab called "Online Orders" was a Leafly tab.
 * 3. "Order value" averaged over the 9 orders that had a readable total while
 *    the count said 23, and nothing said why the other 14 had no value.
 *
 * WHAT THIS FILE DECIDES (and nothing else does)
 * ----------------------------------------------
 *   - which `orders` rows are WEBSITE orders (not register sales, not the
 *     local copy of a Leafly order);
 *   - what each order's OUTCOME was, in one vocabulary shared by both
 *     channels, so "picked up" means the same thing on both sides;
 *   - how Leafly's stored payload is read for money — INTEGER MINOR UNITS
 *     ONLY, and only from a payload that is the real Order (it has an `id`),
 *     never from a webhook envelope;
 *   - every aggregate, share, rate, median, comparison and insight sentence.
 *
 * HOUSE RULES HONOURED
 * --------------------
 * - Money is integer minor units throughout (house rule 8). No float money.
 * - MISSING IS NOT ZERO. A rate or average over nothing is `null` and renders
 *   as an em dash; "0%" and "no data" demand opposite reactions.
 * - No `new Date()`. Pacific day/hour/weekday are computed by the server
 *   (house rule 9: business-day logic uses the store's clock) and handed in,
 *   which is also what keeps this file import-free and self-testable.
 * - No PII. Customer identity arrives as an opaque, already-hashed key.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const ONLINE_CHANNELS = ["website", "leafly"] as const;
export type OnlineChannel = (typeof ONLINE_CHANNELS)[number];

export const CHANNEL_LABEL: Readonly<Record<OnlineChannel, string>> = {
  website: "Website",
  leafly: "Leafly",
};

/**
 * One outcome vocabulary for both channels.
 *
 * - `fulfilled`     the customer got the order (website "completed", an order
 *                   picked up at the register, Leafly "picked_up").
 * - `cancelled`     cancelled by the customer or the store.
 * - `no_show`       the customer never came (website "no_show", Leafly
 *                   cancel reason "not_picked_up").
 * - `lost_to_clock` Leafly auto-cancelled it because nobody acknowledged it
 *                   within fifteen minutes. Leafly-only, and never merged
 *                   into `cancelled`: one is the customer changing their
 *                   mind, the other is us losing a sale.
 * - `open`          still in progress.
 */
export const ORDER_OUTCOMES = ["fulfilled", "cancelled", "no_show", "lost_to_clock", "open"] as const;
export type OrderOutcome = (typeof ORDER_OUTCOMES)[number];

export const OUTCOME_LABEL: Readonly<Record<OrderOutcome, string>> = {
  fulfilled: "Picked up",
  cancelled: "Cancelled",
  no_show: "No-show",
  lost_to_clock: "Lost to the 15-min clock",
  open: "Still open",
};

/** Copied from pickup-core.ts (POS_SALE_STAFF_NOTE_PREFIX). CI pins equality. */
export const POS_SALE_NOTE_PREFIX = "POS sale —";

/** Copied from online-orders-report-core.ts (AUTO_CANCEL_REASON_CODE). CI pins equality. */
export const LEAFLY_AUTO_CANCEL_CODE = "order_api_unacknowledged";

/** Leafly CancelReason meaning the customer never came. From the vendored spec. */
export const LEAFLY_NO_SHOW_CODE = "not_picked_up";

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// ---------------------------------------------------------------------------
// Small, total helpers
// ---------------------------------------------------------------------------

/** A whole, finite integer, or null. The ONLY money reader Leafly totals get. */
export function intMinorOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) ? value : null;
}

function nonBlank(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export function safeRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

export function medianOf(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Whole seconds between two ISO instants; null if either is unusable or negative. */
export function secondsBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (typeof from !== "string" || typeof to !== "string") return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 1000);
}

// ---------------------------------------------------------------------------
// Classification — which `orders` rows are website orders?
// ---------------------------------------------------------------------------

/**
 * Is this `orders` row a WEBSITE order?
 *
 * `orders` holds three different things, and only one of them is a website
 * order:
 *
 *   - Register sales. The POS sync materializes every counter sale into
 *     `orders` WITHOUT setting `origin`, so they carry the column default
 *     'greenway' — the same value a website order has. They are recognised by
 *     the staff note the sync writes ("POS sale — …") or by `pos_client_uuid`,
 *     which only the sync sets (migration 0128, backfilled for older rows).
 *     Counting them would turn every walk-in into an "online order".
 *   - The local copy of a Leafly order (origin 'leafly'). Leafly orders are
 *     counted from `leafly_orders`, the complete record; counting the copy too
 *     would double every Leafly order that reached the register.
 *   - Rows with origin 'register'.
 *
 * Unknown/blank origin is treated as 'greenway', matching `toOrderOrigin`.
 */
export function isWebsiteOrderRow(row: {
  origin?: string | null;
  staffNote?: string | null;
  posClientUuid?: string | null;
}): boolean {
  const origin = (nonBlank(row.origin) ?? "greenway").toLowerCase();
  if (origin !== "greenway") return false;
  if (typeof row.staffNote === "string" && row.staffNote.startsWith(POS_SALE_NOTE_PREFIX)) return false;
  if (nonBlank(row.posClientUuid) !== null) return false;
  return true;
}

/**
 * A website order's outcome.
 *
 * `registerPickedUp` is the SLICE L-37 marker: an online order collected at the
 * counter is closed with the NON-revenue status "cancelled" (the register sale
 * is the sale of record, so revenue is never counted twice) and an
 * order_events note starting "PICKED UP AT THE REGISTER". Reading "cancelled"
 * at face value would report every counter pickup as a lost order.
 */
export function websiteOutcome(status: string | null | undefined, registerPickedUp: boolean): OrderOutcome {
  const s = (nonBlank(status) ?? "").toLowerCase();
  if (s === "completed") return "fulfilled";
  if (s === "cancelled") return registerPickedUp ? "fulfilled" : "cancelled";
  if (s === "no_show") return "no_show";
  return "open";
}

/**
 * A Leafly order's outcome.
 *
 * `localFulfilled` is true when the order's local copy was completed or picked
 * up at the register. It rescues the case where the sale happened but the
 * `picked_up` push to Leafly has not landed (Leafly still says "ready"): the
 * customer HAS the order, so for a sales report it is fulfilled. The Leafly
 * contract section below still reports Leafly's own status, because that one
 * is about what Leafly told the shopper.
 */
export function leaflyOutcome(input: {
  leaflyStatus?: string | null;
  cancelationReasonCode?: string | null;
  canceledAt?: string | null;
  localFulfilled?: boolean;
}): OrderOutcome {
  const status = (nonBlank(input.leaflyStatus) ?? "").toLowerCase();
  const reason = nonBlank(input.cancelationReasonCode) ?? "";
  if (status === "picked_up" || input.localFulfilled === true) return "fulfilled";
  if (reason === LEAFLY_AUTO_CANCEL_CODE) return "lost_to_clock";
  const isExit = status === "canceled" || status === "expired" || nonBlank(input.canceledAt) !== null;
  if (isExit) return reason === LEAFLY_NO_SHOW_CODE ? "no_show" : "cancelled";
  return "open";
}

// ---------------------------------------------------------------------------
// Reading Leafly's stored payload — money in MINOR UNITS, collected only
// ---------------------------------------------------------------------------

export type ChannelLine = {
  name: string;
  brand: string | null;
  category: string | null;
  quantity: number;
  /** Whole-line amount (all units), minor units, or null when unknown. */
  lineMinor: number | null;
};

export type LeaflyPayloadFacts = {
  /** True only when the payload is the real Order (it carries `id`). */
  collected: boolean;
  totalMinor: number | null;
  subtotalMinor: number | null;
  taxMinor: number | null;
  tipMinor: number | null;
  discountMinor: number | null;
  itemCount: number | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  email: string | null;
  phone: string | null;
  lines: ChannelLine[];
};

const EMPTY_FACTS: LeaflyPayloadFacts = {
  collected: false,
  totalMinor: null,
  subtotalMinor: null,
  taxMinor: null,
  tipMinor: null,
  discountMinor: null,
  itemCount: null,
  readyAt: null,
  pickedUpAt: null,
  email: null,
  phone: null,
  lines: [],
};

/**
 * Pull the reportable facts out of `leafly_orders.raw_order`.
 *
 * EVERY FIELD NAME IS FROM THE VENDORED SPEC (docs/leafly-specs/
 * order-api-v1.openapi.json, schemas `Order` and `CartItemOutgoing`):
 *
 *   total          "order grand total in minor units ... Tip is not included"
 *   subtotal       "order total before taxes and fees in minor units"
 *   tip            "total tip applied to the order in minor units"
 *   totalDiscounts "total of discounts applied to the order in minor units"
 *   taxes[]        TaxComponent.amountCents, "tax amount in minor units"
 *   cartItems[]    name, brandName, category, quantity,
 *                  discountedPriceCents / priceCents (whole line, minor units)
 *
 * WHY `total` AND NOT `totalWithTip`: the old report preferred totalWithTip
 * and called it "what reconciles against the register". It is the opposite —
 * the register collects `total` (bridge-core builds the local order from
 * `total`, and says "the tip is not ours"). Tip is reported on its own line.
 *
 * WHY ONLY A COLLECTED PAYLOAD: a webhook envelope (eventType/orderId, no
 * `id`) carries no money at all. Reading one is not "a $0 order", it is "we do
 * not know", so `collected` is false and every figure is null.
 *
 * WHY INTEGERS ONLY: a decimal-looking value ("33.70") is not what the spec
 * sends. Converting it would be guessing which unit it is in — the exact guess
 * that produced the 100x figure. It is refused (null) instead.
 */
export function readLeaflyPayloadFacts(raw: unknown): LeaflyPayloadFacts {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_FACTS, lines: [] };
  const o = raw as Record<string, unknown>;
  if (nonBlank(o.id) === null) return { ...EMPTY_FACTS, lines: [] };

  let taxMinor: number | null = null;
  if (Array.isArray(o.taxes)) {
    taxMinor = 0;
    for (const t of o.taxes) {
      if (t === null || typeof t !== "object") continue;
      const amount = intMinorOrNull((t as Record<string, unknown>).amountCents);
      if (amount !== null) taxMinor += amount;
    }
  }

  const lines: ChannelLine[] = [];
  let units = 0;
  let sawItems = false;
  if (Array.isArray(o.cartItems)) {
    sawItems = true;
    for (const item of o.cartItems) {
      if (item === null || typeof item !== "object") continue;
      const ci = item as Record<string, unknown>;
      const q = typeof ci.quantity === "number" && Number.isInteger(ci.quantity) && ci.quantity > 0 ? ci.quantity : 1;
      units += q;
      lines.push({
        name: nonBlank(ci.name) ?? "Unnamed item",
        brand: nonBlank(ci.brandName),
        category: nonBlank(ci.category),
        quantity: q,
        lineMinor: intMinorOrNull(ci.discountedPriceCents) ?? intMinorOrNull(ci.priceCents),
      });
    }
  }

  return {
    collected: true,
    totalMinor: intMinorOrNull(o.total),
    subtotalMinor: intMinorOrNull(o.subtotal),
    taxMinor,
    tipMinor: intMinorOrNull(o.tip),
    discountMinor: intMinorOrNull(o.totalDiscounts),
    itemCount: sawItems ? units : null,
    readyAt: nonBlank(o.readyAt),
    pickedUpAt: nonBlank(o.pickedUpAt),
    email: nonBlank(o.emailAddress),
    phone: nonBlank(o.phoneNumber),
    lines,
  };
}

/**
 * The un-hashed identity string for "is this the same customer?".
 *
 * Phone first (last ten digits, so "+1 (360) 555-0100" and "3605550100"
 * match), then email lower-cased. Null when neither is usable. The server
 * hashes the result before it goes anywhere; this function exists so the
 * normalisation is testable.
 */
export function contactIdentity(email: string | null | undefined, phone: string | null | undefined): string | null {
  const digits = typeof phone === "string" ? phone.replace(/\D/g, "") : "";
  if (digits.length >= 10) return `p:${digits.slice(-10)}`;
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (e.includes("@")) return `e:${e}`;
  return null;
}

// ---------------------------------------------------------------------------
// The unified row and the report
// ---------------------------------------------------------------------------

export type TotalSource = "order" | "leafly_payload" | "register_copy";

export type ChannelOrderRow = {
  channel: OnlineChannel;
  id: string;
  /** UTC instant the order was placed (website) / first seen (Leafly). */
  placedAt: string | null;
  /** Pacific day key YYYY-MM-DD, hour 0-23, weekday 0=Sun. Server-computed. */
  dayKey: string | null;
  hour: number | null;
  weekday: number | null;
  outcome: OrderOutcome;
  totalMinor: number | null;
  totalSource: TotalSource | null;
  taxMinor?: number | null;
  /** Sale savings (website) / Leafly totalDiscounts. */
  discountMinor?: number | null;
  /** Website loyalty discount (0116). Leafly has none. */
  loyaltyDiscountMinor?: number | null;
  /** Leafly tip. The website has none. */
  tipMinor?: number | null;
  itemCount: number | null;
  acknowledgedAt?: string | null;
  readyAt?: string | null;
  fulfilledAt?: string | null;
  /** Opaque, hashed. Never PII. */
  customerKey?: string | null;
  lines?: readonly ChannelLine[];
};

export type ChannelStats = {
  orders: number;
  outcomes: Record<OrderOutcome, number>;
  /** Orders no longer open — the honest denominator for outcome rates. */
  finished: number;
  pickupRate: number | null;
  cancelRate: number | null;
  noShowRate: number | null;
  lostToClockRate: number | null;
  /** Orders whose total we know. */
  valueKnown: number;
  placedValueMinor: number;
  fulfilledValueMinor: number;
  averageOrderMinor: number | null;
  medianOrderMinor: number | null;
  largestOrderMinor: number | null;
  itemsKnown: number;
  units: number;
  averageItems: number | null;
  discountMinor: number;
  loyaltyDiscountMinor: number;
  tipMinor: number;
  taxMinor: number;
  ackMedianSeconds: number | null;
  readyMedianSeconds: number | null;
  fulfilMedianSeconds: number | null;
  customersKnown: number;
  uniqueCustomers: number;
  repeatCustomers: number;
  repeatRate: number | null;
  /** Share of ALL online orders / known online value. Null for the "all" bucket. */
  shareOfOrders: number | null;
  shareOfValue: number | null;
};

export type ComparisonFormat = "count" | "money" | "rate" | "duration" | "decimal";

export type ComparisonRow = {
  key: string;
  label: string;
  format: ComparisonFormat;
  website: number | null;
  leafly: number | null;
  /** Which way is "better", or null when neither direction is good or bad. */
  betterWhen: "higher" | "lower" | null;
  /** Who is ahead on this row, or null when it cannot be said. */
  leader: OnlineChannel | "tie" | null;
};

export type ProductRow = { name: string; units: number; valueMinor: number | null };

export type DailyChannelPoint = {
  date: string;
  websiteOrders: number;
  leaflyOrders: number;
  websiteValueMinor: number;
  leaflyValueMinor: number;
};

export type OnlineChannelsReport = {
  channels: Record<OnlineChannel, ChannelStats>;
  all: ChannelStats;
  comparison: ComparisonRow[];
  daily: DailyChannelPoint[];
  byHour: { hour: number; website: number; leafly: number }[];
  byWeekday: { weekday: number; label: string; website: number; leafly: number }[];
  topProducts: Record<OnlineChannel, ProductRow[]>;
  /** Customers seen on BOTH channels in the window. */
  crossChannelCustomers: number;
  /** Where Leafly totals came from (payload / register copy / unknown). */
  leaflyValueSources: { payload: number; registerCopy: number; unknown: number };
  insights: string[];
};

function emptyOutcomes(): Record<OrderOutcome, number> {
  return { fulfilled: 0, cancelled: 0, no_show: 0, lost_to_clock: 0, open: 0 };
}

function statsFor(rows: readonly ChannelOrderRow[]): ChannelStats {
  const outcomes = emptyOutcomes();
  const totals: number[] = [];
  let placedValueMinor = 0;
  let fulfilledValueMinor = 0;
  let itemsKnown = 0;
  let units = 0;
  let discountMinor = 0;
  let loyaltyDiscountMinor = 0;
  let tipMinor = 0;
  let taxMinor = 0;
  const ack: number[] = [];
  const ready: number[] = [];
  const fulfil: number[] = [];
  const perCustomer = new Map<string, number>();

  for (const r of rows) {
    const outcome = (ORDER_OUTCOMES as readonly string[]).includes(r.outcome) ? r.outcome : "open";
    outcomes[outcome] += 1;

    const total = intMinorOrNull(r.totalMinor);
    if (total !== null) {
      totals.push(total);
      placedValueMinor += total;
      if (outcome === "fulfilled") fulfilledValueMinor += total;
    }
    const items = intMinorOrNull(r.itemCount);
    if (items !== null && items >= 0) {
      itemsKnown += 1;
      units += items;
    }
    discountMinor += intMinorOrNull(r.discountMinor) ?? 0;
    loyaltyDiscountMinor += intMinorOrNull(r.loyaltyDiscountMinor) ?? 0;
    tipMinor += intMinorOrNull(r.tipMinor) ?? 0;
    taxMinor += intMinorOrNull(r.taxMinor) ?? 0;

    const a = secondsBetween(r.placedAt, r.acknowledgedAt);
    if (a !== null) ack.push(a);
    const rd = secondsBetween(r.placedAt, r.readyAt);
    if (rd !== null) ready.push(rd);
    if (outcome === "fulfilled") {
      const f = secondsBetween(r.placedAt, r.fulfilledAt);
      if (f !== null) fulfil.push(f);
    }

    const key = nonBlank(r.customerKey);
    if (key !== null) perCustomer.set(key, (perCustomer.get(key) ?? 0) + 1);
  }

  const finished = rows.length - outcomes.open;
  let customersKnown = 0;
  let repeatCustomers = 0;
  for (const n of perCustomer.values()) {
    customersKnown += n;
    if (n > 1) repeatCustomers += 1;
  }
  const med = medianOf(totals);

  return {
    orders: rows.length,
    outcomes,
    finished,
    pickupRate: safeRate(outcomes.fulfilled, finished),
    cancelRate: safeRate(outcomes.cancelled, finished),
    noShowRate: safeRate(outcomes.no_show, finished),
    lostToClockRate: safeRate(outcomes.lost_to_clock, finished),
    valueKnown: totals.length,
    placedValueMinor,
    fulfilledValueMinor,
    averageOrderMinor: totals.length > 0 ? Math.round(placedValueMinor / totals.length) : null,
    medianOrderMinor: med === null ? null : Math.round(med),
    largestOrderMinor: totals.length > 0 ? Math.max(...totals) : null,
    itemsKnown,
    units,
    averageItems: itemsKnown > 0 ? units / itemsKnown : null,
    discountMinor,
    loyaltyDiscountMinor,
    tipMinor,
    taxMinor,
    ackMedianSeconds: medianOf(ack),
    readyMedianSeconds: medianOf(ready),
    fulfilMedianSeconds: medianOf(fulfil),
    customersKnown,
    uniqueCustomers: perCustomer.size,
    repeatCustomers,
    repeatRate: safeRate(repeatCustomers, perCustomer.size),
    shareOfOrders: null,
    shareOfValue: null,
  };
}

/** Who leads a comparison row. Null when either side is unknown. */
export function comparisonLeader(
  website: number | null,
  leafly: number | null,
  betterWhen: "higher" | "lower" | null,
): OnlineChannel | "tie" | null {
  if (website === null || leafly === null || !Number.isFinite(website) || !Number.isFinite(leafly)) return null;
  if (website === leafly) return "tie";
  if (betterWhen === null) return website > leafly ? "website" : "leafly";
  const websiteBigger = website > leafly;
  return betterWhen === "higher" ? (websiteBigger ? "website" : "leafly") : websiteBigger ? "leafly" : "website";
}

function topProducts(rows: readonly ChannelOrderRow[], limit: number): ProductRow[] {
  const map = new Map<string, { name: string; units: number; value: number; valueKnown: boolean }>();
  for (const r of rows) {
    for (const l of r.lines ?? []) {
      const name = nonBlank(l.name) ?? "Unnamed item";
      const key = name.toLowerCase();
      const q = Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 1;
      const cur = map.get(key) ?? { name, units: 0, value: 0, valueKnown: true };
      cur.units += q;
      const v = intMinorOrNull(l.lineMinor);
      if (v === null) cur.valueKnown = false;
      else cur.value += v;
      map.set(key, cur);
    }
  }
  return [...map.values()]
    .sort((a, b) => b.units - a.units || b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((p) => ({ name: p.name, units: p.units, valueMinor: p.valueKnown ? p.value : null }));
}

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function money(minor: number | null): string {
  if (minor === null || !Number.isFinite(minor)) return "—";
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

function minutes(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Plain-English findings, only where BOTH sides have data. A comparison
 * against nothing is not a finding, so an empty channel produces silence.
 */
export function buildInsights(report: Omit<OnlineChannelsReport, "insights">): string[] {
  const w = report.channels.website;
  const l = report.channels.leafly;
  const out: string[] = [];
  if (report.all.orders === 0) return out;

  if (w.orders === 0 || l.orders === 0) {
    const only = w.orders === 0 ? "Leafly" : "the website";
    const none = w.orders === 0 ? "the website" : "Leafly";
    out.push(`Every online order in this window came through ${only}; ${none} had none, so there is nothing to compare yet.`);
    return out;
  }

  const lShareO = l.shareOfOrders;
  const lShareV = l.shareOfValue;
  if (lShareO !== null && lShareV !== null) {
    out.push(
      `Leafly brought ${pct(lShareO)} of online orders and ${pct(lShareV)} of known online order value; the website brought ${pct(
        w.shareOfOrders,
      )} and ${pct(w.shareOfValue)}.`,
    );
  }
  if (w.averageOrderMinor !== null && l.averageOrderMinor !== null && w.averageOrderMinor !== l.averageOrderMinor) {
    const bigger = w.averageOrderMinor > l.averageOrderMinor ? "Website" : "Leafly";
    const diff = Math.abs(w.averageOrderMinor - l.averageOrderMinor);
    out.push(
      `${bigger} orders are bigger on average: ${money(w.averageOrderMinor)} on the website vs ${money(
        l.averageOrderMinor,
      )} on Leafly (a ${money(diff)} gap).`,
    );
  }
  if (w.pickupRate !== null && l.pickupRate !== null && w.pickupRate !== l.pickupRate) {
    out.push(
      `Of finished orders, ${pct(w.pickupRate)} of website orders and ${pct(l.pickupRate)} of Leafly orders were picked up.`,
    );
  }
  if (w.readyMedianSeconds !== null && l.readyMedianSeconds !== null && w.readyMedianSeconds !== l.readyMedianSeconds) {
    const faster = w.readyMedianSeconds < l.readyMedianSeconds ? "Website" : "Leafly";
    out.push(
      `${faster} orders are ready sooner: a typical ${minutes(w.readyMedianSeconds)} for the website vs ${minutes(
        l.readyMedianSeconds,
      )} for Leafly.`,
    );
  }
  if (report.crossChannelCustomers > 0) {
    const n = report.crossChannelCustomers;
    out.push(`${n} customer${n === 1 ? "" : "s"} ordered through BOTH the website and Leafly in this window.`);
  }
  return out;
}

/**
 * Build the whole comparison.
 *
 * @param dayKeys every Pacific day in the window, oldest first, so the daily
 *                trend shows zero days as zero instead of skipping them (a
 *                line that jumps over a dead Tuesday hides the dead Tuesday).
 */
export function buildOnlineChannelsReport(input: {
  orders: readonly ChannelOrderRow[];
  dayKeys?: readonly string[];
  topProductLimit?: number;
}): OnlineChannelsReport {
  const orders = Array.isArray(input.orders) ? input.orders : [];
  const byChannel: Record<OnlineChannel, ChannelOrderRow[]> = { website: [], leafly: [] };
  for (const r of orders) {
    const ch = r ? (r.channel as string) : "";
    if (ch === "website" || ch === "leafly") byChannel[ch].push(r);
  }

  const website = statsFor(byChannel.website);
  const leafly = statsFor(byChannel.leafly);
  const all = statsFor([...byChannel.website, ...byChannel.leafly]);

  website.shareOfOrders = safeRate(website.orders, all.orders);
  leafly.shareOfOrders = safeRate(leafly.orders, all.orders);
  website.shareOfValue = safeRate(website.placedValueMinor, all.placedValueMinor);
  leafly.shareOfValue = safeRate(leafly.placedValueMinor, all.placedValueMinor);

  const row = (
    key: string,
    label: string,
    format: ComparisonFormat,
    pick: (s: ChannelStats) => number | null,
    betterWhen: "higher" | "lower" | null,
  ): ComparisonRow => {
    const wv = website.orders > 0 ? pick(website) : null;
    const lv = leafly.orders > 0 ? pick(leafly) : null;
    return { key, label, format, website: wv, leafly: lv, betterWhen, leader: comparisonLeader(wv, lv, betterWhen) };
  };

  const comparison: ComparisonRow[] = [
    row("orders", "Orders placed", "count", (s) => s.orders, "higher"),
    row("share_orders", "Share of online orders", "rate", (s) => s.shareOfOrders, "higher"),
    row("value", "Order value (known totals)", "money", (s) => s.placedValueMinor, "higher"),
    row("share_value", "Share of online value", "rate", (s) => s.shareOfValue, "higher"),
    row("fulfilled_value", "Value picked up", "money", (s) => s.fulfilledValueMinor, "higher"),
    row("aov", "Average order", "money", (s) => s.averageOrderMinor, "higher"),
    row("median", "Median order", "money", (s) => s.medianOrderMinor, "higher"),
    row("items", "Items per order", "decimal", (s) => s.averageItems, "higher"),
    row("pickup", "Picked up (of finished)", "rate", (s) => s.pickupRate, "higher"),
    row("cancel", "Cancelled (of finished)", "rate", (s) => s.cancelRate, "lower"),
    row("no_show", "No-shows (of finished)", "rate", (s) => s.noShowRate, "lower"),
    row("ack", "Time to confirm (median)", "duration", (s) => s.ackMedianSeconds, "lower"),
    row("ready", "Time to ready (median)", "duration", (s) => s.readyMedianSeconds, "lower"),
    row("fulfil", "Time to pickup (median)", "duration", (s) => s.fulfilMedianSeconds, "lower"),
    row("customers", "Unique customers", "count", (s) => s.uniqueCustomers, "higher"),
    row("repeat", "Repeat customers (in window)", "rate", (s) => s.repeatRate, "higher"),
    row("discounts", "Discounts given", "money", (s) => s.discountMinor, null),
  ];

  // Daily trend, gap-filled.
  const dayMap = new Map<string, DailyChannelPoint>();
  const keys = Array.isArray(input.dayKeys) ? input.dayKeys : [];
  for (const d of keys) dayMap.set(d, { date: d, websiteOrders: 0, leaflyOrders: 0, websiteValueMinor: 0, leaflyValueMinor: 0 });
  for (const r of [...byChannel.website, ...byChannel.leafly]) {
    const d = nonBlank(r.dayKey);
    if (d === null) continue;
    const p = dayMap.get(d) ?? { date: d, websiteOrders: 0, leaflyOrders: 0, websiteValueMinor: 0, leaflyValueMinor: 0 };
    const v = intMinorOrNull(r.totalMinor) ?? 0;
    if (r.channel === "website") {
      p.websiteOrders += 1;
      p.websiteValueMinor += v;
    } else {
      p.leaflyOrders += 1;
      p.leaflyValueMinor += v;
    }
    dayMap.set(d, p);
  }
  const daily = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, website: 0, leafly: 0 }));
  const byWeekday = WEEKDAY_LABELS.map((label, weekday) => ({ weekday, label, website: 0, leafly: 0 }));
  for (const r of [...byChannel.website, ...byChannel.leafly]) {
    if (typeof r.hour === "number" && Number.isInteger(r.hour) && r.hour >= 0 && r.hour < 24) byHour[r.hour][r.channel] += 1;
    if (typeof r.weekday === "number" && Number.isInteger(r.weekday) && r.weekday >= 0 && r.weekday < 7) {
      byWeekday[r.weekday][r.channel] += 1;
    }
  }

  const wKeys = new Set(byChannel.website.map((r) => nonBlank(r.customerKey)).filter((k): k is string => k !== null));
  let crossChannelCustomers = 0;
  const seen = new Set<string>();
  for (const r of byChannel.leafly) {
    const k = nonBlank(r.customerKey);
    if (k !== null && wKeys.has(k) && !seen.has(k)) {
      seen.add(k);
      crossChannelCustomers += 1;
    }
  }

  const leaflyValueSources = { payload: 0, registerCopy: 0, unknown: 0 };
  for (const r of byChannel.leafly) {
    if (intMinorOrNull(r.totalMinor) === null) leaflyValueSources.unknown += 1;
    else if (r.totalSource === "register_copy") leaflyValueSources.registerCopy += 1;
    else leaflyValueSources.payload += 1;
  }

  const limit = typeof input.topProductLimit === "number" && input.topProductLimit > 0 ? input.topProductLimit : 8;
  const base = {
    channels: { website, leafly },
    all,
    comparison,
    daily,
    byHour,
    byWeekday,
    topProducts: { website: topProducts(byChannel.website, limit), leafly: topProducts(byChannel.leafly, limit) },
    crossChannelCustomers,
    leaflyValueSources,
  };
  return { ...base, insights: buildInsights(base) };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runOnlineChannelsReportTests(): { passed: number; failed: number; messages: string[] } {
  let passed = 0;
  let failed = 0;
  const messages: string[] = [];
  const eq = (label: string, actual: unknown, want: unknown) => {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(want);
    if (a === b) passed += 1;
    else {
      failed += 1;
      messages.push(`FAIL: ${label} (got ${a}, want ${b})`);
    }
  };
  const ok = (label: string, cond: boolean) => eq(label, cond, true);

  // -- money reader: integers only ------------------------------------------
  eq("integer passes", intMinorOrNull(3370), 3370);
  eq("zero passes", intMinorOrNull(0), 0);
  eq("decimal refused", intMinorOrNull(33.7), null);
  eq("string refused", intMinorOrNull("3370"), null);
  eq("NaN refused", intMinorOrNull(NaN), null);
  eq("null refused", intMinorOrNull(null), null);

  // -- the 100x regression, pinned -------------------------------------------
  const facts = readLeaflyPayloadFacts({ id: "o1", total: 3370, totalWithTip: 3870, tip: 500, subtotal: 3000 });
  eq("total read as minor units, NOT x100", facts.totalMinor, 3370);
  eq("tip reported separately", facts.tipMinor, 500);
  ok("collected", facts.collected);
  eq("envelope is not collected", readLeaflyPayloadFacts({ eventType: "order_cancel", orderId: "o1" }).collected, false);
  eq("envelope has no total", readLeaflyPayloadFacts({ eventType: "order_submit", orderId: "o1", total: 999 }).totalMinor, null);
  eq("decimal-looking total refused", readLeaflyPayloadFacts({ id: "o", total: "33.70" }).totalMinor, null);
  eq("null payload", readLeaflyPayloadFacts(null).collected, false);
  eq("array payload", readLeaflyPayloadFacts([]).collected, false);
  const cart = readLeaflyPayloadFacts({
    id: "o",
    total: 5000,
    taxes: [{ amountCents: 300 }, { amountCents: 203 }, null],
    cartItems: [
      { name: "Blue Dream 3.5g", brandName: "Acme", quantity: 2, discountedPriceCents: 3000, priceCents: 3400 },
      { name: "Gummies", quantity: 1, priceCents: 1500 },
      { name: "Mystery", quantity: 0 },
    ],
  });
  eq("taxes summed", cart.taxMinor, 503);
  eq("units summed (bad qty => 1)", cart.itemCount, 4);
  eq("discounted line price preferred", cart.lines[0].lineMinor, 3000);
  eq("falls back to priceCents", cart.lines[1].lineMinor, 1500);
  eq("unknown line price is null", cart.lines[2].lineMinor, null);
  eq("no taxes key => null tax", readLeaflyPayloadFacts({ id: "o" }).taxMinor, null);
  eq("empty taxes => 0", readLeaflyPayloadFacts({ id: "o", taxes: [] }).taxMinor, 0);
  eq("no cartItems => unknown items", readLeaflyPayloadFacts({ id: "o" }).itemCount, null);

  // -- website classification -------------------------------------------------
  ok("plain website order", isWebsiteOrderRow({ origin: "greenway", staffNote: null, posClientUuid: null }));
  ok("blank origin = website", isWebsiteOrderRow({ origin: null }));
  ok("register sale by note is excluded", !isWebsiteOrderRow({ origin: "greenway", staffNote: "POS sale — iPad — rung by Sam." }));
  ok("register sale by uuid is excluded", !isWebsiteOrderRow({ origin: "greenway", posClientUuid: "u-1" }));
  ok("leafly copy excluded", !isWebsiteOrderRow({ origin: "leafly" }));
  ok("register origin excluded", !isWebsiteOrderRow({ origin: "register" }));
  ok("ordinary staff note kept", isWebsiteOrderRow({ origin: "greenway", staffNote: "Customer called" }));
  ok("hyphen is not the POS em dash", isWebsiteOrderRow({ staffNote: "POS sale - hyphen" }));

  // -- outcomes ---------------------------------------------------------------
  eq("completed", websiteOutcome("completed", false), "fulfilled");
  eq("register pickup is fulfilled", websiteOutcome("cancelled", true), "fulfilled");
  eq("plain cancel", websiteOutcome("cancelled", false), "cancelled");
  eq("no show", websiteOutcome("no_show", false), "no_show");
  eq("ready is open", websiteOutcome("ready", false), "open");
  eq("null is open", websiteOutcome(null, false), "open");
  eq("leafly picked up", leaflyOutcome({ leaflyStatus: "picked_up" }), "fulfilled");
  eq("leafly local pickup rescues", leaflyOutcome({ leaflyStatus: "ready", localFulfilled: true }), "fulfilled");
  eq("leafly auto cancel", leaflyOutcome({ leaflyStatus: "canceled", cancelationReasonCode: LEAFLY_AUTO_CANCEL_CODE }), "lost_to_clock");
  eq("leafly no-show", leaflyOutcome({ leaflyStatus: "canceled", cancelationReasonCode: "not_picked_up" }), "no_show");
  eq("leafly customer cancel", leaflyOutcome({ leaflyStatus: "canceled", cancelationReasonCode: "customer" }), "cancelled");
  eq("leafly expired", leaflyOutcome({ leaflyStatus: "expired" }), "cancelled");
  eq("leafly canceledAt only", leaflyOutcome({ canceledAt: "2026-01-01T00:00:00Z" }), "cancelled");
  eq("leafly confirmed open", leaflyOutcome({ leaflyStatus: "confirmed" }), "open");

  // -- identity ---------------------------------------------------------------
  eq("phone normalised", contactIdentity(null, "+1 (360) 555-0100"), "p:3605550100");
  eq("phone beats email", contactIdentity("A@B.com", "3605550100"), "p:3605550100");
  eq("email lowercased", contactIdentity(" A@B.com ", "555"), "e:a@b.com");
  eq("nothing usable", contactIdentity("nope", null), null);

  // -- leader -----------------------------------------------------------------
  eq("higher wins", comparisonLeader(5, 3, "higher"), "website");
  eq("lower wins", comparisonLeader(5, 3, "lower"), "leafly");
  eq("tie", comparisonLeader(2, 2, "higher"), "tie");
  eq("unknown side", comparisonLeader(null, 2, "higher"), null);
  eq("neutral picks bigger", comparisonLeader(1, 9, null), "leafly");

  // -- a realistic window -----------------------------------------------------
  const r = buildOnlineChannelsReport({
    dayKeys: ["2026-09-01", "2026-09-02", "2026-09-03"],
    orders: [
      {
        channel: "website", id: "w1", placedAt: "2026-09-01T17:00:00Z", dayKey: "2026-09-01", hour: 10, weekday: 2,
        outcome: "fulfilled", totalMinor: 5000, totalSource: "order", itemCount: 2, discountMinor: 200, loyaltyDiscountMinor: 100,
        acknowledgedAt: "2026-09-01T17:05:00Z", readyAt: "2026-09-01T17:20:00Z", fulfilledAt: "2026-09-01T18:00:00Z",
        customerKey: "k1", lines: [{ name: "Blue Dream", brand: null, category: null, quantity: 2, lineMinor: 5000 }],
      },
      {
        channel: "website", id: "w2", placedAt: "2026-09-03T18:00:00Z", dayKey: "2026-09-03", hour: 11, weekday: 4,
        outcome: "cancelled", totalMinor: 3000, totalSource: "order", itemCount: 1, customerKey: "k1",
      },
      {
        channel: "leafly", id: "l1", placedAt: "2026-09-01T19:00:00Z", dayKey: "2026-09-01", hour: 12, weekday: 2,
        outcome: "fulfilled", totalMinor: 3370, totalSource: "leafly_payload", itemCount: 1, tipMinor: 500,
        acknowledgedAt: "2026-09-01T19:01:00Z", readyAt: "2026-09-01T19:11:00Z", customerKey: "k1",
        lines: [{ name: "blue dream", brand: null, category: null, quantity: 1, lineMinor: 3370 }],
      },
      {
        channel: "leafly", id: "l2", placedAt: "2026-09-02T19:00:00Z", dayKey: "2026-09-02", hour: 12, weekday: 3,
        outcome: "lost_to_clock", totalMinor: null, totalSource: null, itemCount: null, customerKey: "k2",
      },
      {
        channel: "leafly", id: "l3", placedAt: "2026-09-02T20:00:00Z", dayKey: "2026-09-02", hour: 13, weekday: 3,
        outcome: "open", totalMinor: 1000, totalSource: "register_copy", itemCount: 1,
      },
    ],
  });
  eq("website orders", r.channels.website.orders, 2);
  eq("leafly orders", r.channels.leafly.orders, 3);
  eq("all orders", r.all.orders, 5);
  eq("website value", r.channels.website.placedValueMinor, 8000);
  eq("leafly value over known only", r.channels.leafly.placedValueMinor, 4370);
  eq("leafly valueKnown", r.channels.leafly.valueKnown, 2);
  eq("leafly aov over known", r.channels.leafly.averageOrderMinor, 2185);
  eq("website fulfilled value", r.channels.website.fulfilledValueMinor, 5000);
  eq("all value", r.all.placedValueMinor, 12370);
  eq("website finished", r.channels.website.finished, 2);
  eq("leafly finished excludes open", r.channels.leafly.finished, 2);
  eq("leafly pickup rate", r.channels.leafly.pickupRate, 0.5);
  eq("leafly lost rate", r.channels.leafly.lostToClockRate, 0.5);
  eq("website cancel rate", r.channels.website.cancelRate, 0.5);
  eq("share of orders", r.channels.leafly.shareOfOrders, 0.6);
  eq("share of value", r.channels.website.shareOfValue, 8000 / 12370);
  eq("all has no share", r.all.shareOfOrders, null);
  eq("ack median website", r.channels.website.ackMedianSeconds, 300);
  eq("ready median leafly", r.channels.leafly.readyMedianSeconds, 660);
  eq("fulfil only over fulfilled", r.channels.website.fulfilMedianSeconds, 3600);
  eq("tip", r.channels.leafly.tipMinor, 500);
  eq("loyalty", r.channels.website.loyaltyDiscountMinor, 100);
  eq("repeat customer website", r.channels.website.repeatCustomers, 1);
  eq("repeat rate website", r.channels.website.repeatRate, 1);
  eq("cross channel", r.crossChannelCustomers, 1);
  eq("daily gap-filled", r.daily.map((d) => d.date), ["2026-09-01", "2026-09-02", "2026-09-03"]);
  eq("daily leafly day 2", r.daily[1].leaflyOrders, 2);
  eq("daily leafly value day 2 counts known only", r.daily[1].leaflyValueMinor, 1000);
  eq("hour 12 leafly", r.byHour[12].leafly, 2);
  eq("weekday tue website", r.byWeekday[2].website, 1);
  eq("top product merges case", r.topProducts.website[0], { name: "Blue Dream", units: 2, valueMinor: 5000 });
  eq("value sources", r.leaflyValueSources, { payload: 1, registerCopy: 1, unknown: 1 });
  const aov = r.comparison.find((c) => c.key === "aov");
  eq("aov row", aov ? [aov.website, aov.leafly, aov.leader] : null, [4000, 2185, "website"]);
  const cancel = r.comparison.find((c) => c.key === "cancel");
  eq("cancel lower is better", cancel?.leader, "leafly");
  ok("insights speak", r.insights.length >= 3);
  ok("insight names share", r.insights.some((s) => s.includes("60%")));

  // -- empties ---------------------------------------------------------------
  const empty = buildOnlineChannelsReport({ orders: [] });
  eq("empty aov null", empty.all.averageOrderMinor, null);
  eq("empty pickup null", empty.all.pickupRate, null);
  eq("empty insights", empty.insights, []);
  eq("empty comparison nulls", empty.comparison[0].website, null);
  const oneSided = buildOnlineChannelsReport({
    orders: [{ channel: "leafly", id: "x", placedAt: null, dayKey: null, hour: null, weekday: null, outcome: "open", totalMinor: 100, totalSource: "leafly_payload", itemCount: null }],
  });
  eq("one-sided comparison has no leader", oneSided.comparison.find((c) => c.key === "aov")?.leader, null);
  ok("one-sided insight says so", oneSided.insights[0]?.includes("nothing to compare") === true);
  eq(
    "non-array tolerated",
    buildOnlineChannelsReport({ orders: undefined as unknown as ChannelOrderRow[] }).all.orders,
    0,
  );

  return { passed, failed, messages };
}
