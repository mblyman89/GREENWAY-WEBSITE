/**
 * SLICE 7 — lot enrichment gaps: ONE definition per gap.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * SLICE 6A found a real defect: the Inventory "What's missing" panel offered a
 * "Fix →" button whose filtered list did NOT match the number printed beside
 * it. On the owner's store every lot is `active`, so a link to
 * `?status=active` narrowed 3,800 lots down to 3,800 lots — the page reloaded
 * unchanged and the button looked broken.
 *
 * The root cause is structural, not cosmetic: the COUNT lived in
 * `computeInventoryStats()` as a JavaScript predicate, and the FILTER lived in
 * `listLotsPaged()` as a PostgREST predicate. Two hand-written expressions of
 * the same idea, free to drift.
 *
 * This module makes them ONE definition. Each gap declares:
 *   - `matches(row)`  — the in-memory predicate the counter uses
 *   - `sqlPredicate`  — the shape the store must apply
 *   - `href`          — the deep link, built from the knob it actually supports
 *
 * A test then proves, over generated rows, that `matches()` and the store's
 * filter select the SAME rows. If someone changes one and not the other, that
 * test fails. The SLICE 6A defect cannot silently come back.
 *
 * PURE: no I/O, no Supabase, no Date.now() beyond what is passed in.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The subset of an inventory_lots row every gap predicate reads. */
export type LotGapRow = {
  status: string | null;
  on_hand_qty: number | null;
  unit_cost_minor_units: number | null;
  lab_result_id: string | null;
  pos_product_key: string | null;
  expires_on: string | null;
};

/** The four enrichment gaps this slice can isolate on the lot list. */
export type LotGapKey =
  | "missingProductLink"
  | "emptyActive"
  | "missingExpiry"
  | "unknownCost";

/**
 * Every gap below is scoped to ACTIVE lots, because every counter in
 * `computeInventoryStats()` sits inside `if (r.status === "active")`
 * (src/lib/inventory/store.ts:346). Quarantined, recalled, destroyed and
 * sold-out lots are deliberately out of scope: chasing paperwork on a lot that
 * is out of inventory buries the rows that still matter. This mirrors the
 * SLICE 2 received-date doctrine.
 */
export function isActive(row: LotGapRow): boolean {
  return row.status === "active";
}

/**
 * `!r.pos_product_key` in the counter is JS truthiness, so it is true for NULL
 * *and* for the empty string. `pos_product_key text` carries no NOT NULL and no
 * default (migration 0023_pos_inventory_lots.sql:97), so `''` is representable
 * and a naive `is null` filter would UNDER-select and disagree with the count.
 */
export function hasNoProductLink(row: LotGapRow): boolean {
  return !row.pos_product_key;
}

/**
 * `on_hand_qty numeric not null default 0` (0023:102) — so it is never NULL in
 * practice and the real case is `<= 0`. Negative quantities (a correction that
 * over-shot) also count as empty, exactly as the counter's
 * `!on_hand_qty || on_hand_qty <= 0` does.
 */
export function isEmptyOnHand(row: LotGapRow): boolean {
  return !row.on_hand_qty || row.on_hand_qty <= 0;
}

/**
 * NEW IN SLICE 7. `expires_on date` is nullable (0023:106). The old stats loop
 * read `if (r.expires_on) { ...expired / expiringSoon... }`
 * (store.ts:350-353), so a lot with NO expiry date fell through BOTH branches
 * and was counted by nothing at all. It was invisible to the "Needs attention"
 * tile.
 *
 * NULL means UNKNOWN, never "fine" — the same doctrine SLICE 2 established for
 * received dates (store.ts:231-237).
 */
export function hasNoExpiry(row: LotGapRow): boolean {
  return !row.expires_on;
}

/**
 * NEW IN SLICE 7. `unit_cost_minor_units integer` is nullable (0023:105) and
 * the on-hand cost total skips those rows (store.ts:331-333), so every uncosted
 * lot silently contributes 0 to a figure the page labels "On-hand qty × unit
 * cost". That is the remaining half of the owner's original "wrong on-hand
 * cost" report.
 *
 * NOTE: only NULL counts as UNKNOWN. A genuine, deliberate 0 (a free sample) is
 * a known cost and is NOT a gap — conflating the two would flag legitimate rows.
 */
export function hasUnknownCost(row: LotGapRow): boolean {
  return row.unit_cost_minor_units == null;
}

/** A gap definition: one predicate, one query knob, one link. */
export type LotGapDefinition = {
  key: LotGapKey;
  /** The query-string knob that isolates this gap on /admin/inventory. */
  param: string;
  /** Plain-language label used in the "What's missing" panel. */
  label: string;
  /** Ranking weight (higher = more important), matching GapInsight. */
  weight: number;
  /** In-memory predicate — the COUNTER's definition. */
  matches: (row: LotGapRow) => boolean;
  /**
   * Human-readable description of the SQL the store must apply. Used by tests
   * to document intent; the store's real predicates are pinned by an
   * equivalence test, not by this string.
   */
  sqlPredicate: string;
};

export const LOT_GAP_DEFINITIONS: readonly LotGapDefinition[] = [
  {
    key: "missingProductLink",
    param: "missingProductLink",
    label: "active not linked to a catalog product",
    weight: 1,
    matches: (r) => isActive(r) && hasNoProductLink(r),
    sqlPredicate: "status = 'active' AND (pos_product_key IS NULL OR pos_product_key = '')",
  },
  {
    key: "emptyActive",
    param: "emptyActive",
    label: "active but out of stock (0 on hand)",
    weight: 1,
    matches: (r) => isActive(r) && isEmptyOnHand(r),
    sqlPredicate: "status = 'active' AND on_hand_qty <= 0",
  },
  {
    key: "missingExpiry",
    param: "missingExpiry",
    label: "active with no expiry date on file",
    weight: 2,
    matches: (r) => isActive(r) && hasNoExpiry(r),
    sqlPredicate: "status = 'active' AND expires_on IS NULL",
  },
  {
    key: "unknownCost",
    param: "unknownCost",
    label: "active with no unit cost on file (understates on-hand value)",
    weight: 2,
    matches: (r) => isActive(r) && hasUnknownCost(r),
    sqlPredicate: "status = 'active' AND unit_cost_minor_units IS NULL",
  },
] as const;

export function lotGapDefinition(key: LotGapKey): LotGapDefinition {
  const found = LOT_GAP_DEFINITIONS.find((d) => d.key === key);
  // Exhaustive by construction; throwing beats returning a wrong definition.
  if (!found) throw new Error(`unknown lot gap: ${key}`);
  return found;
}

/**
 * The deep link for a gap. Always carries `status=active` (so the list is
 * scoped exactly like the counter) PLUS the knob that does the real narrowing.
 *
 * The SLICE 6A defect was a link of `?status=active` and nothing else. Every
 * href produced here therefore carries a second parameter by construction, and
 * a test asserts it is never bare `status=active` alone.
 */
export function lotGapHref(key: LotGapKey): string {
  const def = lotGapDefinition(key);
  return `/admin/inventory?status=active&${def.param}=1`;
}

/**
 * Count every gap over a set of rows, using the SAME predicates the filters
 * use. `computeInventoryStats()` calls this so there is exactly one definition
 * of each gap in the codebase.
 */
export function countLotGaps(rows: readonly LotGapRow[]): Record<LotGapKey, number> {
  const out: Record<LotGapKey, number> = {
    missingProductLink: 0,
    emptyActive: 0,
    missingExpiry: 0,
    unknownCost: 0,
  };
  for (const row of rows) {
    for (const def of LOT_GAP_DEFINITIONS) {
      if (def.matches(row)) out[def.key] += 1;
    }
  }
  return out;
}

/**
 * On-hand cost, in MINOR UNITS (repo-wide money rule), together with an HONEST
 * account of what could not be included.
 *
 * The old loop silently skipped rows whose cost was unknown, so the page
 * printed a confident total that was understated by an unknown amount. This
 * returns the same total PLUS `skippedUnknownCost`, so the screen can say so.
 */
export function computeOnHandCost(rows: readonly LotGapRow[]): {
  totalMinor: number;
  skippedUnknownCost: number;
  complete: boolean;
} {
  let totalMinor = 0;
  let skippedUnknownCost = 0;
  for (const row of rows) {
    if (row.on_hand_qty != null && row.unit_cost_minor_units != null) {
      totalMinor += Math.round(row.on_hand_qty * row.unit_cost_minor_units);
      continue;
    }
    // Only stock we actually HOLD can understate the value of stock on hand.
    // A lot with no cost AND no quantity contributes 0 either way, so counting
    // it would inflate the warning and train the owner to ignore it.
    if ((row.on_hand_qty ?? 0) > 0) skippedUnknownCost += 1;
  }
  return {
    totalMinor,
    skippedUnknownCost,
    complete: skippedUnknownCost === 0,
  };
}

/**
 * The sentence shown under the On-hand cost tile when some lots had no cost.
 * Returns null when the total is complete, so the UI shows nothing rather than
 * a reassuring "all good" the owner would learn to skim past.
 */
export function describeCostIncompleteness(skippedUnknownCost: number): string | null {
  if (skippedUnknownCost <= 0) return null;
  const lots = skippedUnknownCost === 1 ? "lot" : "lots";
  return `Understated — ${skippedUnknownCost} in-stock ${lots} have no unit cost on file.`;
}

/**
 * Parse a gap knob from the query string. Only the literal "1" turns a filter
 * ON; anything else silently means "filter off". This matches every other knob
 * on the inventory page (page.tsx:84-100) — garbage params never throw.
 */
export function parseGapFlag(raw: string | undefined | null): true | undefined {
  return raw === "1" ? true : undefined;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Self-tests (wired into scripts/compliance/run-pure-selftests.ts)           */
/* ────────────────────────────────────────────────────────────────────────── */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`lot-gap-core: ${msg}`);
}

function row(over: Partial<LotGapRow> = {}): LotGapRow {
  return {
    status: "active",
    on_hand_qty: 10,
    unit_cost_minor_units: 500,
    lab_result_id: "lab-1",
    pos_product_key: "KEY-1",
    expires_on: "2027-01-01",
    ...over,
  };
}

export function __runLotGapCoreTests(): string {
  // A fully-populated active lot has no gaps at all.
  const clean = countLotGaps([row()]);
  assert(clean.missingProductLink === 0, "clean row flagged as missing product link");
  assert(clean.emptyActive === 0, "clean row flagged as empty");
  assert(clean.missingExpiry === 0, "clean row flagged as missing expiry");
  assert(clean.unknownCost === 0, "clean row flagged as unknown cost");

  // NULL product key AND empty-string product key both count (JS truthiness).
  assert(countLotGaps([row({ pos_product_key: null })]).missingProductLink === 1, "null key missed");
  assert(countLotGaps([row({ pos_product_key: "" })]).missingProductLink === 1, "empty-string key missed");

  // on_hand_qty: 0 and negative both count as empty; a positive does not.
  assert(countLotGaps([row({ on_hand_qty: 0 })]).emptyActive === 1, "zero qty missed");
  assert(countLotGaps([row({ on_hand_qty: -5 })]).emptyActive === 1, "negative qty missed");
  assert(countLotGaps([row({ on_hand_qty: 1 })]).emptyActive === 0, "positive qty flagged");

  // Missing expiry is counted — the hole this slice opened up.
  assert(countLotGaps([row({ expires_on: null })]).missingExpiry === 1, "null expiry missed");

  // Unknown cost is NULL only. A deliberate 0 is a KNOWN cost, not a gap.
  assert(countLotGaps([row({ unit_cost_minor_units: null })]).unknownCost === 1, "null cost missed");
  assert(countLotGaps([row({ unit_cost_minor_units: 0 })]).unknownCost === 0, "zero cost wrongly flagged");

  // Non-active lots are out of scope for every gap.
  for (const status of ["quarantine", "recalled", "destroyed", "sold_out"]) {
    const counts = countLotGaps([
      row({ status, pos_product_key: null, on_hand_qty: 0, expires_on: null, unit_cost_minor_units: null }),
    ]);
    assert(counts.missingProductLink === 0, `${status} counted as missing link`);
    assert(counts.emptyActive === 0, `${status} counted as empty`);
    assert(counts.missingExpiry === 0, `${status} counted as missing expiry`);
    assert(counts.unknownCost === 0, `${status} counted as unknown cost`);
  }

  // Every href narrows by something MORE than status alone (the 6A defect).
  for (const def of LOT_GAP_DEFINITIONS) {
    const href = lotGapHref(def.key);
    assert(href !== "/admin/inventory?status=active", `${def.key} href narrows nothing`);
    assert(href.includes(`${def.param}=1`), `${def.key} href missing its knob`);
  }

  // On-hand cost: the total is unchanged, but the omission is now reported.
  const cost = computeOnHandCost([
    row({ on_hand_qty: 2, unit_cost_minor_units: 150 }),
    row({ on_hand_qty: 3, unit_cost_minor_units: null }),
  ]);
  assert(cost.totalMinor === 300, `expected 300 minor units, got ${cost.totalMinor}`);
  assert(cost.skippedUnknownCost === 1, "in-stock uncosted lot not reported");
  assert(cost.complete === false, "incomplete total claimed complete");

  // An uncosted lot with NO stock cannot understate stock value, so it is not
  // counted — otherwise the warning inflates and gets ignored.
  const noStock = computeOnHandCost([row({ on_hand_qty: 0, unit_cost_minor_units: null })]);
  assert(noStock.skippedUnknownCost === 0, "empty uncosted lot inflated the warning");
  assert(noStock.complete === true, "empty uncosted lot marked total incomplete");

  // Disclosure is directional: silent when complete, explicit when not.
  assert(describeCostIncompleteness(0) === null, "disclosed when nothing was skipped");
  const msg = describeCostIncompleteness(2);
  assert(msg !== null && msg.includes("2"), "disclosure omitted the count");
  assert(describeCostIncompleteness(1)!.includes(" lot "), "singular wording wrong");

  // Knob grammar: only "1" is ON; garbage is OFF, never an exception.
  assert(parseGapFlag("1") === true, "literal 1 did not enable");
  for (const junk of ["0", "yes", "true", "", undefined, null, "1 ", "01"]) {
    assert(parseGapFlag(junk) === undefined, `junk ${JSON.stringify(junk)} enabled a filter`);
  }

  return "lot-gap-core: all assertions passed";
}
