/**
 * src/lib/orders/order-source-core.ts  (D226)
 *
 * WHICH `orders` ROWS ARE ONLINE ORDERS, AND WHICH ARE REGISTER SALES.
 *
 * Owner (verbatim, D226): "In the back office online orders page, it shows
 * thousands of orders in history. Are all orders getting added to this table
 * or is there a bug? I'm sure we have not had that many online orders."
 *
 * What production showed (2026-11-10, read only): 1,388 `orders` rows since
 * Nov 1, of which 1,376 were register walk-in sales, 11 website orders and 1
 * local copy of a Leafly order. Every register sale is written into `orders`
 * ON PURPOSE (it is the sale of record: reprints, returns, CCRS, the books),
 * but the POS sync never set `origin`, so each one carried the column default
 * 'greenway' and the Orders board listed it as a "Website" order.
 *
 * THE ONE RULE (same test the Online Orders report and customer insights
 * already use, so every screen agrees):
 *
 *   a row is a REGISTER SALE when ANY of these holds
 *     - origin = 'register'          (set by the POS sync from D226 on, and by
 *                                     migration 0359 for older rows)
 *     - pos_client_uuid is set       (only the POS sync writes it, 0128)
 *     - staff_note starts "POS sale —" (the sync's note, older rows)
 *
 * Nothing here deletes, hides from the books, or relabels a sale: it only
 * decides which list a row belongs on.
 *
 * PURE: no I/O, no React. Safe to import from a client component.
 */

/** The note the POS sync writes on every register sale (em dash). */
export const REGISTER_SALE_NOTE_PREFIX = "POS sale \u2014";

/** The origin value a register sale carries from D226 on. */
export const REGISTER_ORIGIN = "register" as const;

export type OrderSourceRow = {
  origin?: string | null;
  staff_note?: string | null;
  pos_client_uuid?: string | null;
};

/** Is this `orders` row a sale rung up at the register? */
export function isRegisterSaleRow(row: OrderSourceRow | null | undefined): boolean {
  if (!row) return false;
  const origin = typeof row.origin === "string" ? row.origin.trim().toLowerCase() : "";
  if (origin === REGISTER_ORIGIN) return true;
  if (typeof row.pos_client_uuid === "string" && row.pos_client_uuid.trim() !== "") return true;
  if (typeof row.staff_note === "string" && row.staff_note.startsWith(REGISTER_SALE_NOTE_PREFIX)) return true;
  return false;
}

// ============================================================================
// THE BOARD'S "SOURCE" FILTER
// ============================================================================

/**
 * What the Greenway orders panel lists.
 *   online   - website orders only (the default: what the panel is for)
 *   register - register sales only (to look one up; never the default)
 *   all      - both
 */
export const ORDER_SOURCES = ["online", "register", "all"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
export const DEFAULT_ORDER_SOURCE: OrderSource = "online";

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  online: "Online orders",
  register: "Register sales",
  all: "Online + register",
};

/** Garbage, blank or missing means the default (online). Never throws. */
export function parseOrderSource(raw: string | string[] | null | undefined): OrderSource {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase() ?? "";
  return (ORDER_SOURCES as readonly string[]).includes(v) ? (v as OrderSource) : DEFAULT_ORDER_SOURCE;
}

/**
 * The PostgREST filter for a source, applied by the store.
 *
 *   online   -> origin <> 'register' AND pos_client_uuid IS NULL
 *   register -> or(origin = 'register', pos_client_uuid IS NOT NULL)
 *   all      -> nothing
 *
 * Why the database filter does not also match the "POS sale —" note: every
 * register sale on record carries pos_client_uuid (migration 0128 backfilled
 * it from the note for older rows; checked in production 2026-11-10: 0 rows
 * with the note and no uuid), and from D226 on the sync also writes
 * origin = 'register' on every sale, even on its retry without the uuid
 * column. A NOT LIKE on a nullable note would need its own or-group (NULL is
 * not "not like"), so the note stays a belt-and-braces check in
 * isRegisterSaleRow and in the 0358 SQL, where it costs nothing.
 *
 * Returned as plain data (not a query builder) so it is testable here and the
 * store cannot hand-type a second copy.
 */
export type OrderSourceFilter = {
  /** `.neq(col, value)` pairs. */
  neq: [string, string][];
  /** `.is(col, null)` columns. */
  isNull: string[];
  /** A PostgREST `or` group (without the parentheses), or null. */
  orFilter: string | null;
};

export function orderSourceFilter(source: OrderSource): OrderSourceFilter {
  if (source === "online") {
    return { neq: [["origin", REGISTER_ORIGIN]], isNull: ["pos_client_uuid"], orFilter: null };
  }
  if (source === "register") {
    return { neq: [], isNull: [], orFilter: `origin.eq.${REGISTER_ORIGIN},pos_client_uuid.not.is.null` };
  }
  return { neq: [], isNull: [], orFilter: null };
}

/**
 * The RPC argument for the 0358 snapshot: which source the counts cover.
 * `null` = every row (the old behaviour, for any caller that passes nothing).
 */
export function snapshotSourceArg(source: OrderSource | null | undefined): OrderSource | null {
  return source === "online" || source === "register" ? source : null;
}

// ============================================================================
// SELF-TESTS (scripts/compliance/run-pure-selftests.ts + vitest)
// ============================================================================

export function __runOrderSourceCoreTests(): void {
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`order-source-core: ${m}`);
  };
  const note = "POS sale \u2014 Register 1 \u2014 rung by Larry Dee. Event 7783c849.";
  ok(isRegisterSaleRow({ origin: "register" }), "origin register");
  ok(isRegisterSaleRow({ origin: " Register " }), "origin register, any case");
  ok(isRegisterSaleRow({ origin: "greenway", pos_client_uuid: "u-1" }), "pos uuid");
  ok(isRegisterSaleRow({ origin: "greenway", staff_note: note }), "POS note");
  ok(isRegisterSaleRow({ origin: null, staff_note: note }), "POS note, no origin");
  ok(!isRegisterSaleRow({ origin: "greenway" }), "website order");
  ok(!isRegisterSaleRow({ origin: "greenway", staff_note: "Customer asked for a bag" }), "ordinary note");
  ok(!isRegisterSaleRow({ origin: "greenway", staff_note: "POS sale - hyphen" }), "ASCII hyphen is not the sync's note");
  ok(!isRegisterSaleRow({ origin: "greenway", pos_client_uuid: "  " }), "blank uuid");
  ok(!isRegisterSaleRow({ origin: "leafly" }), "leafly copy");
  ok(!isRegisterSaleRow(null) && !isRegisterSaleRow(undefined), "null row");

  ok(parseOrderSource(undefined) === "online", "default online");
  ok(parseOrderSource("register") === "register", "register");
  ok(parseOrderSource(["all", "online"]) === "all", "array takes first");
  ok(parseOrderSource(" ALL ") === "all", "trim + case");
  ok(parseOrderSource("DROP TABLE") === "online", "garbage -> online");
  ok(ORDER_SOURCES.every((s) => ORDER_SOURCE_LABELS[s].length > 0), "every source labelled");

  const on = orderSourceFilter("online");
  ok(on.neq.length === 1 && on.neq[0][0] === "origin" && on.neq[0][1] === "register", "online: origin <> register");
  ok(on.isNull.length === 1 && on.isNull[0] === "pos_client_uuid", "online: no pos uuid");
  ok(on.orFilter === null, "online: no or-group (ANDs only)");
  const reg = orderSourceFilter("register");
  ok(reg.neq.length === 0 && reg.isNull.length === 0, "register: no AND filters");
  ok(
    reg.orFilter === "origin.eq.register,pos_client_uuid.not.is.null",
    "register: origin or uuid",
  );
  const all = orderSourceFilter("all");
  ok(all.neq.length === 0 && all.isNull.length === 0 && all.orFilter === null, "all: nothing");

  ok(snapshotSourceArg("online") === "online", "snapshot online");
  ok(snapshotSourceArg("register") === "register", "snapshot register");
  ok(snapshotSourceArg("all") === null && snapshotSourceArg(undefined) === null, "snapshot all/none -> null");
}
