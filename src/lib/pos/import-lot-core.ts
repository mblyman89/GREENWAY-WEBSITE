/**
 * src/lib/pos/import-lot-core.ts  (Optimus Prime SLICE 46)
 *
 * PURE planner that turns the per-row lot sources exposed by the POS
 * transform (src/lib/pos/transform.ts `lotSources`) into compliance-grade
 * inventory_lots rows for the ONE-TIME Cultivera migration import.
 *
 * Owner decision (Q1): "we need a compliant system so these imported products
 * need to be in the system as if we received them through intake." Products
 * that arrive through the Menu Imports page therefore get REAL inventory lots
 * — the same table intake writes — so the sale path decrements FIFO, the
 * weekly CCRS Sale.csv resolves a real InventoryExternalIdentifier, COGS math
 * has a unit cost, and expiry/enrichment worklists have a home.
 *
 * Verified facts about the real Cultivera INVENTORIES export this planner is
 * built against (3,917 rows inspected):
 *   • Barcode is ALWAYS populated (e.g. "GF42802505795142") and is the
 *     identifier Cultivera (a CCRS integrator) filed with CCRS — 3,870 unique
 *     values; 47 barcodes appear twice (same product, two received dates).
 *   • Cost is always populated ("$5.00" format) → unit_cost_minor_units.
 *   • Received date is MM/DD/YYYY, blank on 247 rows.
 *   • Expiration date is blank on ALL rows (kept supported; surfaced as an
 *     enrichment worklist item, never invented).
 *   • [COA Y/N] is "Y" on 3,520 rows / "N" on 397 — flagged for enrichment.
 *   • Is Sample is always "False"; Is Cannabis always "True".
 *
 * Identity & idempotency: one planned lot per BARCODE. Duplicate-barcode rows
 * are merged (units summed, earliest received date kept) because CCRS treats
 * one identifier as ONE inventory record. The caller dedupes against existing
 * inventory_lots by ccrs_inventory_external_id, so publishing twice — or
 * retrying a partially-failed publish — never doubles inventory.
 *
 * FIFO: planned lots carry createdAtIso derived from the Received date so the
 * sale path's `order by created_at` consumes genuinely-oldest stock first,
 * and inventory aging reports reflect the true shelf time.
 *
 * NO I/O — unit-testable via __runImportLotCoreTests() (registered in
 * scripts/compliance/run-pure-selftests.ts) and mirrored in vitest.
 */
import { deriveInventoryExternalId } from "@/lib/compliance/ccrs-identifiers";

export type ImportLotSource = {
  /** menu_items.source_item_id of the card this row rolled into (`pos-…`). */
  posProductKey: string;
  /** Card display name (messages only). */
  itemName: string;
  /** Cultivera Barcode — the CCRS-filed inventory identifier. */
  barcode: string;
  /** Raw Product cell. */
  productName: string;
  /** Raw Cultivera category ("Flower", "Gummies", …). */
  category: string;
  /** CCRS inventory type ("Usable Marijuana", "Solid Edible", …). */
  inventoryType: string;
  strainName: string;
  /** Card strain type ("indica" | "sativa" | "hybrid" | hyphenated hybrids | "cbd" | "unknown"). */
  strainType: string;
  brand: string;
  vendor: string;
  /** Units Available For Sale for THIS row (integer, ≥ 0). */
  units: number;
  /** Raw Cost cell ("$5.00"). */
  costRaw: string;
  /** Raw Received date cell ("06/17/2026" or ""). */
  receivedDateRaw: string;
  /** Raw Expiration date cell (blank in current exports; supported). */
  expirationDateRaw: string;
  /** Raw [COA Y/N] cell ("Y" / "N" / ""). */
  coaRaw: string;
  isMedical: boolean;
  isSample: boolean;
  /** Parsed package quantity for the variant this row collapsed into. */
  unitWeight: number | null;
  /** Parsed package unit (g | mg | oz | ml | floz | ea). */
  unitWeightUom: string | null;
};

export type PlannedImportLot = {
  /** inventory_lots.lot_code — the Cultivera barcode (null only if blank). */
  lotCode: string | null;
  /** Canonical CCRS InventoryExternalIdentifier (sanitized barcode). */
  ccrsExternalId: string;
  /** inventory_lots.pos_product_key = menu_items.source_item_id (card key). */
  posProductKey: string;
  productName: string;
  strainName: string | null;
  /** inventory_lots.strain_type — card strain type, null when unknown (Rule 1.4). */
  strainType: string | null;
  category: string | null;
  inventoryType: string | null;
  unitWeight: number | null;
  unitWeightUom: string | null;
  isSample: boolean;
  isMedical: boolean;
  /** received_qty AND initial on_hand_qty. */
  receivedQty: number;
  /** Lot unit — Cultivera "Units Available" are unit counts. */
  unit: "each";
  unitCostMinorUnits: number | null;
  /** ISO date (YYYY-MM-DD) or null — blank in all current exports. */
  expiresOn: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  receivedOn: string | null;
  /**
   * Explicit created_at for the insert (noon UTC on the received date) so the
   * sale path's created_at-ordered FIFO consumes oldest stock first.
   *
   * Null means the POS export had no Received date. SLICE 1: the caller must
   * NOT omit the column in that case — it resolves the value through
   * resolveLotCreatedAt(), which substitutes the publish run's "now". Omitting
   * the key makes postgrest-js write an explicit NULL (it unions the keys of
   * every row in the batch into `columns=`), which violates the NOT NULL
   * constraint on inventory_lots.created_at.
   */
  createdAtIso: string | null;
  /** Whether the POS export says a COA is on file. */
  coaPresent: boolean;
  /** Raw vendor label for resolution against the vendors table. */
  vendorLabel: string | null;
  /** Raw brand label for resolution against the brands table. */
  brandLabel: string | null;
  /** Human note persisted on the lot (provenance + enrichment hints). */
  notes: string;
};

export type ImportLotDiagnostic = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  context?: Record<string, unknown>;
};

export type ImportLotPlan = {
  lots: PlannedImportLot[];
  diagnostics: ImportLotDiagnostic[];
  summary: {
    sourceRows: number;
    lotsPlanned: number;
    unitsTotal: number;
    mergedBarcodes: number;
    skippedZeroUnit: number;
    missingBarcode: number;
    coaMissing: number;
    receivedDateMissing: number;
    expirationMissing: number;
    costMissing: number;
    mixedSizeCards: number;
  };
};

/** "$5.00" / "5" / "1,234.50" → integer cents; null when unparseable. */
export function costToMinorUnits(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** "06/17/2026" or "2026-06-17" → "2026-06-17"; null when blank/invalid. */
export function parseUsDate(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (us) {
    m = Number(us[1]);
    d = Number(us[2]);
    y = Number(us[3]);
  } else if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "Y"/"yes"/"true" → true; anything else (incl. blank) → false. */
export function coaFlagToBool(raw: string | null | undefined): boolean {
  return /^(y|yes|true|1)$/i.test((raw ?? "").trim());
}

// ---------------------------------------------------------------------------
// SLICE 1 — created_at safety at the insert boundary
//
// THE BUG THIS FIXES (proven, not guessed):
// `@supabase/postgrest-js` builds the PostgREST `columns=` list from the UNION
// of the keys of EVERY row in an array insert, and does NOT send
// `Prefer: missing=default` unless the caller passes `defaultToNull: false`:
//
//   node_modules/@supabase/postgrest-js/dist/index.mjs:4189-4201
//     insert(values, { count, defaultToNull = true } = {}) {
//       if (!defaultToNull) headers.append("Prefer", `missing=default`)
//       if (Array.isArray(values)) {
//         const columns = values.reduce((acc, x) => acc.concat(Object.keys(x)), [])
//         url.searchParams.set("columns", [...new Set(columns)].join(","))
//
// Consequence: if ONE row in a batch carries `created_at` and another OMITS it,
// `created_at` still lands in `columns=`, and the omitting rows are written as
// an explicit NULL — never the column default. Against
// `supabase/migrations/0023_pos_inventory_lots.sql:112`
// (`created_at timestamptz not null default now()`) that is a hard failure:
//   'null value in column "created_at" of relation "inventory_lots"
//    violates not-null constraint'
//
// The Cultivera export has 203 rows with a blank "Received date", so real
// batches are MIXED (dated + undated) and the publish aborts mid-run — before
// `publish_menu_version` ever executes, which is why the customer-facing menu
// stayed empty.
//
// THE FIX: never omit the column. Every row carries a real timestamp, so the
// key-set is uniform and no NULL can be synthesized. Undated lots get the
// publish run's "now", which is younger than every real received date and
// therefore preserves the planner's documented FIFO intent (dated oldest-first,
// undated last — see the sort at the end of planImportLots).
// ---------------------------------------------------------------------------

/**
 * The `created_at` an inventory_lots row must carry.
 *
 * @param plannedIso  PlannedImportLot.createdAtIso — noon UTC on the POS
 *                    "Received date", or null when the export had no date.
 * @param fallbackIso One instant for the whole publish run (the caller passes
 *                    `storeNow().toISOString()`), used for undated lots.
 *
 * Always returns a non-empty ISO string: `created_at` is NOT NULL, so there is
 * no legal "omit it" branch at the insert boundary.
 */
export function resolveLotCreatedAt(plannedIso: string | null, fallbackIso: string): string {
  const planned = (plannedIso ?? "").trim();
  if (planned) return planned;
  const fallback = (fallbackIso ?? "").trim();
  if (!fallback) {
    throw new Error(
      "resolveLotCreatedAt: fallbackIso is required — inventory_lots.created_at is NOT NULL and postgrest-js writes an explicit NULL for omitted keys.",
    );
  }
  return fallback;
}

/** Stable, order-independent fingerprint of a row's column set. */
export function insertKeySignature(row: Record<string, unknown>): string {
  return Object.keys(row).sort().join(",");
}

/**
 * Find the first row whose column set differs from row 0's.
 *
 * This is the guardrail for the postgrest-js union-of-keys behaviour above: any
 * divergence means some row is about to be written as an explicit NULL in a
 * column it never intended to set. Returns null when the batch is uniform.
 */
export function findNonUniformInsertRow(
  rows: readonly Record<string, unknown>[],
): { index: number; missing: string[]; extra: string[] } | null {
  if (rows.length < 2) return null;
  const baseline = new Set(Object.keys(rows[0]));
  for (let i = 1; i < rows.length; i++) {
    const keys = new Set(Object.keys(rows[i]));
    const missing = [...baseline].filter((k) => !keys.has(k)).sort();
    const extra = [...keys].filter((k) => !baseline.has(k)).sort();
    if (missing.length || extra.length) return { index: i, missing, extra };
  }
  return null;
}

/**
 * Throw a PRECISE error (Rule 3: surface precise warnings, never invent values)
 * if an array insert would send a ragged column set. Fails BEFORE the network
 * call, so the operator sees the real cause instead of a Postgres NOT NULL
 * violation on a column nobody meant to touch.
 */
export function assertUniformInsertKeys(rows: readonly Record<string, unknown>[], label: string): void {
  const bad = findNonUniformInsertRow(rows);
  if (!bad) return;
  const parts: string[] = [];
  if (bad.missing.length) parts.push(`missing [${bad.missing.join(", ")}]`);
  if (bad.extra.length) parts.push(`unexpected [${bad.extra.join(", ")}]`);
  throw new Error(
    `${label}: row ${bad.index} has a different column set than row 0 (${parts.join("; ")}). ` +
      "postgrest-js unions the keys of every row into `columns=`, so the differing rows would be written as explicit NULLs. Build every row with an identical key set.",
  );
}

function lotNote(opts: { receivedOn: string | null; coaPresent: boolean; merged: number }): string {
  const parts: string[] = ["Cultivera migration (one-time POS import)."];
  parts.push(opts.receivedOn ? `Received ${opts.receivedOn}.` : "Received date missing in POS export.");
  parts.push(
    opts.coaPresent
      ? "COA on file per POS export (attach the document during enrichment)."
      : "COA flag N in POS export — obtain and attach the COA during enrichment.",
  );
  if (opts.merged > 1) parts.push(`Merged ${opts.merged} POS rows sharing this barcode.`);
  parts.push("Expiration date not provided by POS export — set during enrichment.");
  return parts.join(" ");
}

/**
 * Plan compliance lots for a menu import. PURE — the caller (import-service)
 * resolves vendor/brand ids, dedupes against existing lots, and inserts.
 */
export function planImportLots(sources: readonly ImportLotSource[]): ImportLotPlan {
  const diagnostics: ImportLotDiagnostic[] = [];
  const byBarcode = new Map<string, ImportLotSource[]>();
  let skippedZeroUnit = 0;
  let missingBarcode = 0;
  let syntheticSeq = 0;

  for (const src of sources) {
    const units = Math.max(0, Math.floor(Number(src.units) || 0));
    if (units <= 0) {
      skippedZeroUnit += 1;
      diagnostics.push({
        severity: "info",
        code: "import_lot_zero_units",
        message: "Inventory row has zero sellable units; no lot planned.",
        context: { barcode: src.barcode, product: src.productName },
      });
      continue;
    }
    let key = (src.barcode ?? "").trim();
    if (!key) {
      // Verified: never happens in the real export (0 blank barcodes over
      // 3,917 rows) — but a lot must still have a stable identity, so we mint
      // a deterministic per-card synthetic key and flag it loudly.
      missingBarcode += 1;
      syntheticSeq += 1;
      key = `${src.posProductKey}-NOBARCODE-${syntheticSeq}`;
      diagnostics.push({
        severity: "warning",
        code: "import_lot_missing_barcode",
        message:
          "Inventory row has no barcode; lot created with a synthetic identifier. Verify its CCRS identifier before selling.",
        context: { product: src.productName, syntheticKey: key },
      });
    }
    const list = byBarcode.get(key) ?? [];
    list.push({ ...src, units });
    byBarcode.set(key, list);
  }

  const lots: PlannedImportLot[] = [];
  let mergedBarcodes = 0;
  let coaMissing = 0;
  let receivedDateMissing = 0;
  let expirationMissing = 0;
  let costMissing = 0;
  let unitsTotal = 0;

  for (const [barcode, rows] of byBarcode) {
    if (rows.length > 1) {
      mergedBarcodes += 1;
      const names = new Set(rows.map((r) => r.productName));
      if (names.size > 1) {
        diagnostics.push({
          severity: "warning",
          code: "import_lot_barcode_conflict",
          message:
            "One barcode maps to DIFFERENT product names in the POS export; rows merged into one lot under the first name — verify before selling.",
          context: { barcode, products: [...names] },
        });
      } else {
        diagnostics.push({
          severity: "info",
          code: "import_lot_barcode_merged",
          message:
            "Multiple POS rows share this barcode (same CCRS inventory record received on different dates); merged into one lot with summed units and the earliest received date.",
          context: { barcode, rows: rows.length, product: rows[0].productName },
        });
      }
    }

    const first = rows[0];
    const receivedQty = rows.reduce((s, r) => s + r.units, 0);
    unitsTotal += receivedQty;

    const receivedDates = rows.map((r) => parseUsDate(r.receivedDateRaw)).filter((d): d is string => !!d).sort();
    const receivedOn = receivedDates[0] ?? null;
    if (!receivedOn) {
      receivedDateMissing += 1;
      diagnostics.push({
        severity: "info",
        code: "import_lot_received_date_missing",
        message: "No received date in POS export; lot ages from the import moment instead of its true receipt date.",
        context: { barcode, product: first.productName },
      });
    }

    const expiresOn = parseUsDate(first.expirationDateRaw);
    if (!expiresOn) expirationMissing += 1;

    const unitCost = costToMinorUnits(first.costRaw);
    if (unitCost === null) {
      costMissing += 1;
      diagnostics.push({
        severity: "warning",
        code: "import_lot_cost_unparseable",
        message: "Cost cell could not be parsed; lot has no unit cost (COGS/margin reports will skip it) — fix during enrichment.",
        context: { barcode, product: first.productName, costRaw: first.costRaw },
      });
    }

    const coaPresent = coaFlagToBool(first.coaRaw);
    if (!coaPresent) {
      coaMissing += 1;
      diagnostics.push({
        severity: "info",
        code: "import_lot_coa_missing",
        message: "POS export marks this product's COA flag as N — obtain and attach the COA during enrichment.",
        context: { barcode, product: first.productName },
      });
    }

    const ccrsExternalId = deriveInventoryExternalId({ lot_code: barcode }) ?? barcode;

    lots.push({
      lotCode: (first.barcode ?? "").trim() ? barcode : null,
      ccrsExternalId,
      posProductKey: first.posProductKey,
      productName: first.productName,
      strainName: first.strainName.trim() || null,
      // "unknown" is the pipeline's null — store real types only (Rule 1.4).
      strainType: first.strainType.trim() && first.strainType !== "unknown" ? first.strainType : null,
      category: first.category.trim() || null,
      inventoryType: first.inventoryType.trim() || null,
      unitWeight: first.unitWeight,
      unitWeightUom: first.unitWeightUom,
      isSample: first.isSample,
      isMedical: first.isMedical,
      receivedQty,
      unit: "each",
      unitCostMinorUnits: unitCost,
      expiresOn,
      receivedOn,
      createdAtIso: receivedOn ? `${receivedOn}T12:00:00.000Z` : null,
      coaPresent,
      vendorLabel: first.vendor.trim() || null,
      brandLabel: first.brand.trim() || null,
      notes: lotNote({ receivedOn, coaPresent, merged: rows.length }),
    });
  }

  // FIFO-friendly insert order: oldest received first, undated last. Undated
  // lots are stamped with the publish run's "now" (resolveLotCreatedAt), which
  // is younger than every real received date, so they stay at the end of the
  // FIFO queue exactly as this ordering intends.
  lots.sort((a, b) => {
    if (a.receivedOn && b.receivedOn) return a.receivedOn.localeCompare(b.receivedOn) || a.ccrsExternalId.localeCompare(b.ccrsExternalId);
    if (a.receivedOn) return -1;
    if (b.receivedOn) return 1;
    return a.ccrsExternalId.localeCompare(b.ccrsExternalId);
  });

  // Mixed-size cards: menu-import sale lines resolve lots by the CARD key, so
  // a card whose variants span different package sizes shares one FIFO pool.
  // Bounded, one-time-migration limitation (intake, the go-forward path,
  // encodes per-lot variant keys) — surfaced so the owner knows which cards to
  // watch in cycle counts while migrated stock sells through.
  const sizesByCard = new Map<string, { name: string; sizes: Set<string> }>();
  for (const src of sources) {
    const entry = sizesByCard.get(src.posProductKey) ?? { name: src.itemName, sizes: new Set<string>() };
    entry.sizes.add(`${src.unitWeight ?? "?"}|${src.unitWeightUom ?? "?"}`);
    sizesByCard.set(src.posProductKey, entry);
  }
  const mixed = [...sizesByCard.values()].filter((e) => e.sizes.size > 1);
  if (mixed.length > 0) {
    diagnostics.push({
      severity: "warning",
      code: "import_lots_mixed_size_cards",
      message: `${mixed.length} card(s) group multiple package sizes; their lots share one first-in-first-out pool keyed to the card. Unit counts per size may drift until migrated stock sells through — verify with cycle counts.`,
      context: { cards: mixed.slice(0, 10).map((e) => e.name), total: mixed.length },
    });
  }

  const summaryContext = {
    sourceRows: sources.length,
    lotsPlanned: lots.length,
    unitsTotal,
    mergedBarcodes,
    skippedZeroUnit,
    missingBarcode,
    coaMissing,
    receivedDateMissing,
    expirationMissing,
    costMissing,
    mixedSizeCards: mixed.length,
  };
  diagnostics.push({
    severity: "info",
    code: "import_lots_planned",
    message: `Planned ${lots.length} compliance inventory lot(s) covering ${unitsTotal} unit(s); lots are created when this version is published.`,
    context: summaryContext,
  });
  if (coaMissing > 0) {
    diagnostics.push({
      severity: "warning",
      code: "import_lots_coa_missing_summary",
      message: `${coaMissing} lot(s) have COA flag N in the POS export — enrichment worklist: obtain and attach their COAs.`,
      context: { coaMissing },
    });
  }
  if (expirationMissing > 0) {
    diagnostics.push({
      severity: "info",
      code: "import_lots_expiration_missing_summary",
      message: `${expirationMissing} lot(s) have no expiration date in the POS export — set expiry dates during enrichment so freshness/expiry controls apply.`,
      context: { expirationMissing },
    });
  }

  return { lots, diagnostics, summary: summaryContext };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runImportLotCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed++;
  };

  const src = (over: Partial<ImportLotSource> = {}): ImportLotSource => ({
    posProductKey: "pos-abc123",
    itemName: "Blue Dream",
    barcode: "GF42802505795142",
    productName: "Acme - Blue Dream - 3.5g",
    category: "Flower",
    inventoryType: "Usable Marijuana",
    strainName: "Blue Dream",
    strainType: "hybrid",
    brand: "Acme",
    vendor: "ACME FARMS",
    units: 10,
    costRaw: "$5.00",
    receivedDateRaw: "06/17/2026",
    expirationDateRaw: "",
    coaRaw: "Y",
    isMedical: false,
    isSample: false,
    unitWeight: 3.5,
    unitWeightUom: "g",
    ...over,
  });

  // Parsers
  ok(costToMinorUnits("$5.00") === 500, "cost $5.00 -> 500 cents");
  ok(costToMinorUnits("1,234.56") === 123456, "comma cost parses");
  ok(costToMinorUnits("") === null && costToMinorUnits("abc") === null, "blank/garbage cost -> null");
  ok(parseUsDate("06/17/2026") === "2026-06-17", "US date parses");
  ok(parseUsDate("2026-06-17") === "2026-06-17", "ISO date accepted");
  ok(parseUsDate("") === null && parseUsDate("13/40/2026") === null, "blank/invalid date -> null");
  ok(coaFlagToBool("Y") && coaFlagToBool("yes") && !coaFlagToBool("N") && !coaFlagToBool(""), "COA flag mapping");

  // Basic lot
  {
    const plan = planImportLots([src()]);
    ok(plan.lots.length === 1, "one source -> one lot");
    const l = plan.lots[0];
    ok(l.lotCode === "GF42802505795142", "lot_code = barcode");
    ok(l.ccrsExternalId === "GF42802505795142", "CCRS id = sanitized barcode");
    ok(l.posProductKey === "pos-abc123", "lot keyed to the menu card (source_item_id)");
    ok(l.receivedQty === 10 && l.unit === "each", "received qty + unit");
    ok(l.unitCostMinorUnits === 500, "cost in minor units (cents)");
    ok(l.receivedOn === "2026-06-17" && l.createdAtIso === "2026-06-17T12:00:00.000Z", "received date drives FIFO created_at");
    ok(l.expiresOn === null, "blank expiration stays null (never invented)");
    ok(l.coaPresent === true, "COA Y -> present");
    ok(l.notes.includes("Cultivera migration"), "provenance note");
    ok(l.strainType === "hybrid", "strain type carried into lot plan (SLICE 54)");
    ok(planImportLots([src({ strainType: "unknown" })]).lots[0].strainType === null, "'unknown' strain type stored as null");
  }

  // Duplicate barcode merge: units summed, earliest received date kept.
  {
    const plan = planImportLots([
      src({ units: 5, receivedDateRaw: "06/17/2026" }),
      src({ units: 7, receivedDateRaw: "05/29/2026" }),
    ]);
    ok(plan.lots.length === 1, "duplicate barcodes merge to one lot (one CCRS record)");
    ok(plan.lots[0].receivedQty === 12, "merged units summed (5+7)");
    ok(plan.lots[0].receivedOn === "2026-05-29", "earliest received date kept");
    ok(plan.diagnostics.some((d) => d.code === "import_lot_barcode_merged"), "merge diagnostic logged");
    ok(plan.summary.mergedBarcodes === 1, "summary counts the merge");
  }

  // Conflicting product names on one barcode -> warning.
  {
    const plan = planImportLots([src(), src({ productName: "Totally Different Product" })]);
    ok(plan.diagnostics.some((d) => d.code === "import_lot_barcode_conflict" && d.severity === "warning"), "name conflict flagged");
  }

  // COA N -> enrichment worklist diagnostics.
  {
    const plan = planImportLots([src({ coaRaw: "N" })]);
    ok(plan.lots[0].coaPresent === false, "COA N -> not present");
    ok(plan.diagnostics.some((d) => d.code === "import_lot_coa_missing"), "per-lot COA diagnostic");
    ok(plan.diagnostics.some((d) => d.code === "import_lots_coa_missing_summary" && d.severity === "warning"), "COA summary warning");
  }

  // Zero units -> skipped, diagnostic only.
  {
    const plan = planImportLots([src({ units: 0 })]);
    ok(plan.lots.length === 0 && plan.summary.skippedZeroUnit === 1, "zero-unit row skipped");
    ok(plan.diagnostics.some((d) => d.code === "import_lot_zero_units"), "zero-unit diagnostic");
  }

  // Missing barcode -> synthetic identity + loud warning (never silently dropped).
  {
    const plan = planImportLots([src({ barcode: "" })]);
    ok(plan.lots.length === 1 && plan.lots[0].lotCode === null, "missing barcode still creates a lot, lot_code null");
    ok(plan.lots[0].ccrsExternalId.includes("NOBARCODE"), "synthetic CCRS identity");
    ok(plan.diagnostics.some((d) => d.code === "import_lot_missing_barcode" && d.severity === "warning"), "missing barcode warned");
  }

  // Missing received date -> null createdAtIso in the PLAN, sorted last. The
  // insert boundary resolves it (see resolveLotCreatedAt cases below) because
  // omitting the column makes postgrest-js write an explicit NULL.
  {
    const plan = planImportLots([
      src({ barcode: "B-NEW", receivedDateRaw: "" }),
      src({ barcode: "B-OLD", receivedDateRaw: "01/02/2026" }),
    ]);
    ok(plan.lots[0].ccrsExternalId === "B-OLD" && plan.lots[1].ccrsExternalId === "B-NEW", "oldest received first; dateless last");
    ok(plan.lots[1].createdAtIso === null, "dateless lot plans a null created_at (resolved at the insert boundary)");
    ok(plan.diagnostics.some((d) => d.code === "import_lot_received_date_missing"), "missing received date logged");
  }

  // -------------------------------------------------------------------------
  // SLICE 1: created_at is NOT NULL — the insert boundary must never omit it.
  // -------------------------------------------------------------------------

  // resolveLotCreatedAt: dated lots keep their FIFO timestamp verbatim.
  {
    const NOW = "2026-09-01T07:00:00.000Z";
    ok(resolveLotCreatedAt("2026-06-17T12:00:00.000Z", NOW) === "2026-06-17T12:00:00.000Z", "dated lot keeps its received-date created_at");
    ok(resolveLotCreatedAt(null, NOW) === NOW, "undated lot falls back to the publish run's now");
    ok(resolveLotCreatedAt("", NOW) === NOW, "empty-string created_at falls back to now");
    ok(resolveLotCreatedAt("   ", NOW) === NOW, "whitespace-only created_at falls back to now");
    let threw = false;
    try {
      resolveLotCreatedAt(null, "");
    } catch {
      threw = true;
    }
    ok(threw, "missing fallback throws rather than emitting a NULL created_at");
  }

  // The resolved value is never null/empty for ANY planned lot, dated or not.
  {
    const NOW = "2026-09-01T07:00:00.000Z";
    const plan = planImportLots([
      src({ barcode: "D1", receivedDateRaw: "01/02/2026" }),
      src({ barcode: "U1", receivedDateRaw: "" }),
      src({ barcode: "D2", receivedDateRaw: "03/04/2026" }),
      src({ barcode: "U2", receivedDateRaw: "" }),
    ]);
    ok(plan.lots.length === 4, "mixed dated/undated batch plans all four lots");
    const resolved = plan.lots.map((l) => resolveLotCreatedAt(l.createdAtIso, NOW));
    ok(resolved.every((v) => typeof v === "string" && v.length > 0), "every lot resolves a non-empty created_at");
    ok(resolved.filter((v) => v === NOW).length === 2, "exactly the two undated lots take the now fallback");
    // FIFO intent survives: undated lots stay youngest, so they sell last.
    ok(
      resolved[0] <= resolved[1] && resolved[1] <= resolved[2] && resolved[2] <= resolved[3],
      "resolved created_at is non-decreasing in plan order (FIFO preserved)",
    );
  }

  // Key-set uniformity guardrail (postgrest-js unions keys across the array).
  {
    ok(insertKeySignature({ b: 1, a: 2 }) === "a,b", "key signature is order-independent");
    ok(findNonUniformInsertRow([]) === null, "empty batch is uniform");
    ok(findNonUniformInsertRow([{ a: 1 }]) === null, "single-row batch is uniform");
    ok(findNonUniformInsertRow([{ a: 1, b: null }, { a: 2, b: 3 }]) === null, "explicit nulls still count as present keys");
    const bad = findNonUniformInsertRow([{ a: 1, created_at: "x" }, { a: 2 }]);
    ok(bad !== null && bad.index === 1 && bad.missing.join() === "created_at", "omitted created_at is detected with its column name");
    const extra = findNonUniformInsertRow([{ a: 1 }, { a: 2, created_at: "x" }]);
    ok(extra !== null && extra.index === 1 && extra.extra.join() === "created_at", "unexpected extra key is detected");
  }

  // assertUniformInsertKeys throws with an actionable message, or stays silent.
  {
    let threw = false;
    let message = "";
    try {
      assertUniformInsertKeys([{ a: 1, created_at: "x" }, { a: 2 }], "inventory_lots batch 1");
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    ok(threw, "ragged batch is rejected before the network call");
    ok(message.includes("inventory_lots batch 1") && message.includes("created_at"), "error names the batch and the offending column");
    let ok2 = true;
    try {
      assertUniformInsertKeys([{ a: 1, created_at: "x" }, { a: 2, created_at: "y" }], "uniform");
    } catch {
      ok2 = false;
    }
    ok(ok2, "uniform batch passes the guardrail");
  }

  // End-to-end shape check: rows built the SLICE 1 way are always uniform, even
  // when dated and undated lots land in the same batch (the real failure mode:
  // 203 blank Received dates in the Cultivera export).
  {
    const NOW = "2026-09-01T07:00:00.000Z";
    const plan = planImportLots([
      src({ barcode: "D1", receivedDateRaw: "01/02/2026" }),
      src({ barcode: "U1", receivedDateRaw: "" }),
      src({ barcode: "D2", receivedDateRaw: "03/04/2026" }),
    ]);
    const rows = plan.lots.map((l) => ({
      ccrs_inventory_external_id: l.ccrsExternalId,
      received_qty: l.receivedQty,
      expires_on: l.expiresOn,
      created_at: resolveLotCreatedAt(l.createdAtIso, NOW),
    }));
    ok(new Set(rows.map(insertKeySignature)).size === 1, "mixed dated/undated batch produces one key signature");
    ok(rows.every((r) => r.created_at !== null && r.created_at !== undefined), "no row carries a null created_at");
    let clean = true;
    try {
      assertUniformInsertKeys(rows, "inventory_lots");
    } catch {
      clean = false;
    }
    ok(clean, "guardrail accepts the SLICE 1 row builder output");
    // The pre-SLICE-1 builder (conditional spread) would have been rejected.
    const legacyRows = plan.lots.map((l) => ({
      ccrs_inventory_external_id: l.ccrsExternalId,
      received_qty: l.receivedQty,
      expires_on: l.expiresOn,
      ...(l.createdAtIso ? { created_at: l.createdAtIso } : {}),
    }));
    ok(findNonUniformInsertRow(legacyRows) !== null, "the old conditional-spread builder is caught by the guardrail");
  }

  // Mixed-size card -> FIFO pool warning.
  {
    const plan = planImportLots([
      src({ barcode: "S1", unitWeight: 3.5, unitWeightUom: "g" }),
      src({ barcode: "S2", unitWeight: 7, unitWeightUom: "g" }),
    ]);
    ok(plan.diagnostics.some((d) => d.code === "import_lots_mixed_size_cards" && d.severity === "warning"), "mixed-size card warned");
    ok(plan.summary.mixedSizeCards === 1, "summary counts mixed-size cards");
  }

  // Sanitization: barcode with unsafe characters gets a CCRS-safe id.
  {
    const plan = planImportLots([src({ barcode: "AB 12/34" })]);
    ok(plan.lots[0].ccrsExternalId === "AB-12-34", "CCRS id sanitized (alphanumerics + hyphens)");
    ok(plan.lots[0].lotCode === "AB 12/34", "lot_code keeps the verbatim barcode");
  }

  // Vendor/brand labels + medical/sample flags carried for resolution.
  {
    const plan = planImportLots([src({ isMedical: true, isSample: false, vendor: " ACME FARMS ", brand: "" })]);
    const l = plan.lots[0];
    ok(l.isMedical === true && l.isSample === false, "flags carried");
    ok(l.vendorLabel === "ACME FARMS" && l.brandLabel === null, "labels trimmed; blank -> null");
  }

  // Plan summary diagnostic always present.
  {
    const plan = planImportLots([src()]);
    ok(plan.diagnostics.some((d) => d.code === "import_lots_planned"), "plan summary diagnostic emitted");
  }

  console.log(`import-lot-core: ${passed} assertions passed`);
}
