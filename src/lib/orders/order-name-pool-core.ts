/**
 * src/lib/orders/order-name-pool-core.ts
 *
 * SLICE 113 — Order-name POOL (pure helpers, NO server imports).
 *
 * Michael maintains a small recycling list of custom, personality-filled order
 * names ("Nugs4Thugs", "High Life", …) that the system assigns to online orders
 * and reuses. This module holds every pure decision the pool needs so the store,
 * the admin UI, and the tests all share ONE source of truth:
 *
 *   - name normalization + a case/space-insensitive dedupe key
 *   - the RECYCLE ORDER (which name comes next) — Least-Recently-Used:
 *       enabled names, oldest last_assigned_at first (never-used = "oldest"),
 *       tie-break by sort_order then id, so a short list cycles fairly and the
 *       "next few will be…" preview is deterministic.
 *   - resolveDisplay(display_name, order_number): the single rule for the ONE
 *     identity a human sees — the friendly name when present, else the unique
 *     GWY-XXXXXX backstop. Used by emails, the receipt, the confirmation page,
 *     and every admin surface so they can never disagree.
 *
 * Imported by BOTH client (admin manager) and server (store), so it must never
 * import server-only code.
 */

/** Max characters for a pool name (keeps receipts + emails tidy). */
export const ORDER_NAME_MAX_LEN = 40;

/** A pool row as the store persists / reads it (mirrors order_name_pool). */
export type OrderNamePoolRow = {
  id: string;
  name: string;
  enabled: boolean;
  sort_order: number;
  /** ISO timestamp of the last time this name was handed to an order, or null. */
  last_assigned_at: string | null;
  /** How many orders have ever used this name (LRU tie-insight + admin stat). */
  assigned_count: number;
};

/**
 * Normalize a proposed name: trim ends and collapse internal whitespace runs to
 * a single space. Does NOT change case (Michael's capitalization is preserved).
 */
export function normalizeOrderName(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/** Case- and space-insensitive key used for duplicate detection. */
export function orderNameDedupeKey(name: string): string {
  return normalizeOrderName(name).toLowerCase();
}

/**
 * True when `candidate` (after normalization) already exists in `existing`
 * (case/space-insensitive). `ignoreId` lets an edit keep its own name.
 */
export function isDuplicateOrderName(
  existing: Pick<OrderNamePoolRow, "id" | "name">[],
  candidate: string,
  ignoreId?: string,
): boolean {
  const key = orderNameDedupeKey(candidate);
  if (!key) return false;
  return existing.some(
    (r) => r.id !== ignoreId && orderNameDedupeKey(r.name) === key,
  );
}

/** Validation result for a proposed / edited name. */
export type OrderNameValidation = {
  ok: boolean;
  /** The normalized value the caller should persist when ok. */
  value: string;
  /** Human reason when not ok. */
  error?: string;
};

/**
 * Validate a proposed name for length + emptiness + duplication. (Compliance
 * tone is a SEPARATE, non-blocking nudge — see order-name-compliance-core.)
 */
export function validateOrderName(
  existing: Pick<OrderNamePoolRow, "id" | "name">[],
  raw: string,
  ignoreId?: string,
): OrderNameValidation {
  const value = normalizeOrderName(raw);
  if (!value) return { ok: false, value, error: "Enter a name." };
  if (value.length > ORDER_NAME_MAX_LEN) {
    return {
      ok: false,
      value,
      error: `Keep it under ${ORDER_NAME_MAX_LEN} characters.`,
    };
  }
  if (isDuplicateOrderName(existing, value, ignoreId)) {
    return { ok: false, value, error: "That name is already in the pool." };
  }
  return { ok: true, value };
}

/** Epoch ms for LRU ordering; a null/blank last_assigned_at sorts oldest (0). */
function lastAssignedMs(row: OrderNamePoolRow): number {
  if (!row.last_assigned_at) return 0;
  const t = new Date(row.last_assigned_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * The RECYCLE ORDER for enabled names: least-recently-used first (never-used
 * names lead), then lowest sort_order, then id — a total, stable order so both
 * the picker and the preview agree exactly. Disabled names are dropped.
 */
export function recycleOrder(pool: OrderNamePoolRow[]): OrderNamePoolRow[] {
  return pool
    .filter((r) => r.enabled)
    .slice()
    .sort((a, b) => {
      const dt = lastAssignedMs(a) - lastAssignedMs(b);
      if (dt !== 0) return dt;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * Which enabled name the NEXT order should get (the LRU head), or null when the
 * pool has no enabled names (caller falls back to the GWY generator).
 */
export function pickNextOrderName(pool: OrderNamePoolRow[]): OrderNamePoolRow | null {
  const ordered = recycleOrder(pool);
  return ordered[0] ?? null;
}

/**
 * A deterministic preview of the next `count` names the pool will assign,
 * simulating the LRU rotation (each pick moves to the back of the line). With
 * fewer enabled names than `count`, the list simply cycles. Empty pool → [].
 */
export function previewNextOrderNames(
  pool: OrderNamePoolRow[],
  count: number,
): string[] {
  const ordered = recycleOrder(pool).map((r) => r.name);
  if (ordered.length === 0 || count <= 0) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(ordered[i % ordered.length]);
  return out;
}

/**
 * The ONE rule for the customer-facing identity: the friendly display name when
 * it is a non-blank string, otherwise the unique GWY-XXXXXX order number. Used
 * by emails, receipts, the confirmation page, and every admin surface.
 */
export function resolveOrderDisplay(
  displayName: string | null | undefined,
  orderNumber: string,
): string {
  const n = typeof displayName === "string" ? displayName.trim() : "";
  return n !== "" ? n : orderNumber;
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

function row(
  id: string,
  name: string,
  opts: Partial<Omit<OrderNamePoolRow, "id" | "name">> = {},
): OrderNamePoolRow {
  return {
    id,
    name,
    enabled: opts.enabled ?? true,
    sort_order: opts.sort_order ?? 0,
    last_assigned_at: opts.last_assigned_at ?? null,
    assigned_count: opts.assigned_count ?? 0,
  };
}

export function __runOrderNamePoolCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`[order-name-pool] FAIL: ${msg}`);
    }
  };

  // normalize + dedupe key
  ok(normalizeOrderName("  High   Life  ") === "High Life", "normalize collapses + trims");
  ok(normalizeOrderName("High Life") === "High Life", "normalize leaves clean names");
  ok(orderNameDedupeKey("  HIGH   life ") === "high life", "dedupe key is lower + collapsed");

  // duplicate detection
  const existing = [row("a", "High Life"), row("b", "Nugs4Thugs")];
  ok(isDuplicateOrderName(existing, "high life") === true, "dupe: case-insensitive match");
  ok(isDuplicateOrderName(existing, " HIGH   LIFE ") === true, "dupe: space-insensitive match");
  ok(isDuplicateOrderName(existing, "Green Dream") === false, "dupe: new name is unique");
  ok(isDuplicateOrderName(existing, "High Life", "a") === false, "dupe: edit keeps own name");
  ok(isDuplicateOrderName(existing, "") === false, "dupe: empty is never a duplicate");

  // validation
  ok(validateOrderName(existing, "  ").ok === false, "validate: blank rejected");
  ok(validateOrderName(existing, "high life").ok === false, "validate: dupe rejected");
  ok(validateOrderName(existing, "Green Dream").ok === true, "validate: new name ok");
  ok(
    validateOrderName(existing, "Green Dream").value === "Green Dream",
    "validate: returns normalized value",
  );
  ok(
    validateOrderName([], "x".repeat(ORDER_NAME_MAX_LEN + 1)).ok === false,
    "validate: too long rejected",
  );
  ok(
    validateOrderName(existing, "High Life", "a").ok === true,
    "validate: editing own row keeps name",
  );

  // recycle order — LRU: never-used first, then oldest, tie by sort_order
  const pool = [
    row("1", "A", { last_assigned_at: "2024-01-03T00:00:00Z", sort_order: 0 }),
    row("2", "B", { last_assigned_at: null, sort_order: 5 }),
    row("3", "C", { last_assigned_at: "2024-01-01T00:00:00Z", sort_order: 2 }),
    row("4", "D", { enabled: false }), // disabled → excluded
    row("5", "E", { last_assigned_at: null, sort_order: 1 }),
  ];
  const order = recycleOrder(pool).map((r) => r.name);
  ok(order.join(",") === "E,B,C,A", "recycle: never-used (by sort) then oldest-first, no disabled");
  ok(recycleOrder(pool).every((r) => r.enabled), "recycle: excludes disabled names");

  // pickNext = head of recycle order
  ok(pickNextOrderName(pool)?.name === "E", "pickNext: LRU head");
  ok(pickNextOrderName([row("x", "X", { enabled: false })]) === null, "pickNext: all disabled → null");
  ok(pickNextOrderName([]) === null, "pickNext: empty → null");

  // preview cycles deterministically
  ok(previewNextOrderNames(pool, 6).join(",") === "E,B,C,A,E,B", "preview: cycles the LRU order");
  ok(previewNextOrderNames(pool, 0).length === 0, "preview: count 0 → empty");
  ok(previewNextOrderNames([], 3).length === 0, "preview: empty pool → empty");
  ok(
    previewNextOrderNames([row("z", "Solo")], 3).join(",") === "Solo,Solo,Solo",
    "preview: single name repeats",
  );

  // resolveDisplay — friendly name wins, blank falls back to GWY
  ok(resolveOrderDisplay("High Life", "GWY-ABC234") === "High Life", "display: friendly name used");
  ok(resolveOrderDisplay(null, "GWY-ABC234") === "GWY-ABC234", "display: null → GWY");
  ok(resolveOrderDisplay("   ", "GWY-ABC234") === "GWY-ABC234", "display: blank → GWY");
  ok(resolveOrderDisplay(undefined, "GWY-ABC234") === "GWY-ABC234", "display: undefined → GWY");

  return { passed, failed };
}
