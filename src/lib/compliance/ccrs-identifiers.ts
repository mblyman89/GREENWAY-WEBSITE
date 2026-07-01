/**
 * src/lib/compliance/ccrs-identifiers.ts  (Run 5 / Slice 22)
 *
 * CCRS external-identifier hardening.
 *
 * Authoritative rules (WSLCB CCRS Upload User Guide):
 *  • "ExternalIdentifier ... is an alpha-numeric identification assigned by the
 *    licensee (or integrator)." It is Text(100), required on Insert/Update/Delete.
 *  • The SAME identifier is reused across files: an item's
 *    Inventory.ExternalIdentifier must equal the InventoryExternalIdentifier on
 *    LabTest.csv, Sale.csv, Transfer.csv, and InventoryAdjustment.csv.
 *  • For a Sale, InventoryExternalIdentifier must reference an inventory record
 *    ALREADY reported in an Inventory.csv, and that inventory must NOT be in a
 *    quarantine area.
 *
 * Design
 * ------
 * Every inventory lot in our system gets ONE canonical CCRS inventory external
 * identifier. We persist it on inventory_lots.ccrs_inventory_external_id so it's
 * stable forever (CCRS keys records by it; it must never drift). When it's
 * absent we DERIVE a deterministic candidate from the lot's natural keys, but we
 * always prefer the stored/explicit value.
 *
 * The derived form is sanitized to CCRS-safe characters and clamped to 100 chars.
 *
 * Everything here is PURE (no I/O), so it's unit-testable and importable anywhere.
 */

export const CCRS_EXTERNAL_ID_MAX = 100;

/**
 * Sanitize an arbitrary string into a CCRS-safe external identifier:
 *  • keep alphanumerics; map any other run to a single hyphen
 *  • trim leading/trailing hyphens
 *  • clamp to 100 chars
 *
 * CCRS says "alpha-numeric"; in practice hyphens are widely accepted and used by
 * integrators for readable ids, so we allow a single hyphen as a separator but
 * never anything else.
 */
export function sanitizeExternalId(raw: string): string {
  const cleaned = (raw ?? "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, CCRS_EXTERNAL_ID_MAX);
}

/**
 * Validate a CCRS external identifier. Returns the list of problems (empty =
 * valid). Used to surface precise warnings before an upload.
 */
export function validateExternalId(value: string | null | undefined): string[] {
  const errs: string[] = [];
  const v = (value ?? "").trim();
  if (!v) {
    errs.push("missing");
    return errs;
  }
  if (v.length > CCRS_EXTERNAL_ID_MAX) errs.push(`exceeds ${CCRS_EXTERNAL_ID_MAX} characters`);
  if (!/^[A-Za-z0-9-]+$/.test(v)) errs.push("contains characters other than letters, digits, or hyphen");
  if (/^-|-$/.test(v)) errs.push("starts or ends with a hyphen");
  return errs;
}

/**
 * Validate a WA cannabis LICENSE number for CCRS. Per the CCRS Upload User Guide
 * the retail/producer/processor `LicenseNumber` is a SIX-DIGIT numeric id (labs
 * use a 10-digit id). Returns the list of problems (empty = valid). PURE.
 *
 * We accept the 6-digit retail form by default and optionally allow the 10-digit
 * lab form; a retailer back office should only ever use the 6-digit form, so the
 * default is strict-6.
 */
export function validateLicenseNumber(
  value: string | null | undefined,
  opts?: { allowLab10?: boolean },
): string[] {
  const errs: string[] = [];
  const v = (value ?? "").trim();
  if (!v) {
    errs.push("missing");
    return errs;
  }
  if (!/^\d+$/.test(v)) {
    errs.push("must be numeric (digits only)");
    return errs;
  }
  const okLengths = opts?.allowLab10 ? [6, 10] : [6];
  if (!okLengths.includes(v.length)) {
    errs.push(
      opts?.allowLab10
        ? "must be a 6-digit licensee number (or 10-digit lab number)"
        : "must be a 6-digit licensee number",
    );
  }
  return errs;
}

export type ExternalIdCollision = {
  externalId: string;
  /** The distinct owner keys (lot ids) that resolved to the same identifier. */
  owners: string[];
};

/**
 * Detect COLLISIONS where two or more DISTINCT owners (e.g. inventory lots)
 * resolve to the SAME CCRS external identifier. CCRS keys records by the
 * identifier, so a collision silently merges/overwrites two different items —
 * a data-integrity violation. PURE.
 *
 * @param items list of { owner, externalId } — owner is the stable source key
 *              (lot id); externalId is the resolved CCRS id. Empty ids ignored.
 */
export function findExternalIdCollisions(
  items: { owner: string; externalId: string | null | undefined }[],
): ExternalIdCollision[] {
  const byId = new Map<string, Set<string>>();
  for (const it of items) {
    const id = (it.externalId ?? "").trim();
    if (!id || !it.owner) continue;
    if (!byId.has(id)) byId.set(id, new Set());
    byId.get(id)!.add(it.owner);
  }
  const out: ExternalIdCollision[] = [];
  for (const [externalId, owners] of byId) {
    if (owners.size > 1) out.push({ externalId, owners: Array.from(owners).sort() });
  }
  return out.sort((a, b) => a.externalId.localeCompare(b.externalId));
}

export type SaleIdProblem = {
  code: "duplicate_sale_detail" | "sale_type_mismatch" | "sale_date_mismatch";
  saleExternalId: string;
  detail: string;
};

/**
 * Enforce the CCRS Sale.csv identifier rules (Upload User Guide):
 *   • Records within ONE sale share the same SaleExternalIdentifier;
 *   • Records with the same SaleExternalIdentifier must share SaleType + SaleDate;
 *   • Every record's SaleDetailExternalIdentifier must be UNIQUE within its sale
 *     (a duplicate detail id = "Duplicate Sale detail item for Licensee").
 * PURE. Returns the list of violations (empty = clean).
 */
export function checkSaleIdentifierIntegrity(
  lines: {
    saleExternalId: string;
    saleDetailExternalId: string;
    saleType?: string | null;
    saleDate?: string | null;
  }[],
): SaleIdProblem[] {
  const problems: SaleIdProblem[] = [];
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    const key = (l.saleExternalId ?? "").trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  for (const [saleExternalId, group] of groups) {
    // Detail id uniqueness within the sale.
    const seen = new Set<string>();
    for (const l of group) {
      const d = (l.saleDetailExternalId ?? "").trim();
      if (!d) continue;
      if (seen.has(d)) {
        problems.push({
          code: "duplicate_sale_detail",
          saleExternalId,
          detail: `SaleDetailExternalIdentifier "${d}" appears more than once in this sale`,
        });
      }
      seen.add(d);
    }
    // SaleType / SaleDate consistency across the sale.
    const types = new Set(group.map((l) => (l.saleType ?? "").trim()).filter(Boolean));
    if (types.size > 1) {
      problems.push({
        code: "sale_type_mismatch",
        saleExternalId,
        detail: `mixed SaleType values in one sale: ${Array.from(types).join(", ")}`,
      });
    }
    const dates = new Set(group.map((l) => (l.saleDate ?? "").trim()).filter(Boolean));
    if (dates.size > 1) {
      problems.push({
        code: "sale_date_mismatch",
        saleExternalId,
        detail: `mixed SaleDate values in one sale: ${Array.from(dates).join(", ")}`,
      });
    }
  }
  return problems;
}

export type LotIdentitySource = {
  /** Persisted canonical id, if we've already assigned one. Always preferred. */
  ccrs_inventory_external_id?: string | null;
  /** The POS product key (= menu_items.source_item_id = order_lines.product_id). */
  pos_product_key?: string | null;
  /** Vendor/manifest lot code. */
  lot_code?: string | null;
  /** Stable DB primary key as a last resort. */
  id?: string | null;
};

/**
 * Derive the canonical CCRS inventory external identifier for a lot.
 *
 * Preference order (first usable wins):
 *   1. An already-assigned ccrs_inventory_external_id (sanitized) — NEVER drift.
 *   2. lot_code (vendor/CCRS-aligned lot code) — most likely to match the
 *      Inventory.csv the licensee already filed.
 *   3. pos_product_key.
 *   4. the DB id (prefixed) as a guaranteed-unique fallback.
 *
 * Returns null only if nothing usable exists.
 */
export function deriveInventoryExternalId(src: LotIdentitySource): string | null {
  const explicit = sanitizeExternalId(src.ccrs_inventory_external_id ?? "");
  if (explicit) return explicit;

  const fromLot = sanitizeExternalId(src.lot_code ?? "");
  if (fromLot) return fromLot;

  const fromKey = sanitizeExternalId(src.pos_product_key ?? "");
  if (fromKey) return fromKey;

  const fromId = sanitizeExternalId(src.id ? `LOT-${src.id}` : "");
  if (fromId) return fromId;

  return null;
}

/**
 * Resolve the InventoryExternalIdentifier to put on a Sale.csv line.
 *
 * Preference order:
 *   1. The line's own ccrs_inventory_external_id (explicit per-sale override).
 *   2. The canonical id derived from the matched inventory lot.
 *   3. A sanitized pos_product_key as a degraded fallback (with a warning upstream).
 */
export function resolveSaleInventoryExternalId(opts: {
  lineExplicit?: string | null;
  lotCanonical?: string | null;
  posProductKey?: string | null;
}): { value: string; source: "line" | "lot" | "product_key" | "none" } {
  const line = sanitizeExternalId(opts.lineExplicit ?? "");
  if (line) return { value: line, source: "line" };

  const lot = sanitizeExternalId(opts.lotCanonical ?? "");
  if (lot) return { value: lot, source: "lot" };

  const key = sanitizeExternalId(opts.posProductKey ?? "");
  if (key) return { value: key, source: "product_key" };

  return { value: "", source: "none" };
}

// ── Self-tests (tsx) ─────────────────────────────────────────────────────────

export function __runCcrsIdentifierTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${msg}`);
    }
  };

  // sanitizeExternalId
  ok(sanitizeExternalId("Blue Dream #3.5!") === "Blue-Dream-3-5", "sanitize collapses to hyphens");
  ok(sanitizeExternalId("--x--") === "x", "sanitize trims edge hyphens");
  ok(sanitizeExternalId("a".repeat(200)).length === CCRS_EXTERNAL_ID_MAX, "sanitize clamps to 100");

  // validateExternalId
  ok(validateExternalId("").includes("missing"), "empty id → missing");
  ok(validateExternalId("GOOD-ID-01").length === 0, "clean id valid");
  ok(validateExternalId("bad id").some((e) => /characters/.test(e)), "space id invalid");
  ok(validateExternalId("-lead").some((e) => /hyphen/.test(e)), "leading hyphen invalid");
  ok(validateExternalId("x".repeat(101)).some((e) => /exceeds/.test(e)), "too long invalid");

  // validateLicenseNumber
  ok(validateLicenseNumber("412345").length === 0, "6-digit license valid");
  ok(validateLicenseNumber("").includes("missing"), "empty license missing");
  ok(validateLicenseNumber("41234").some((e) => /6-digit/.test(e)), "5-digit license invalid");
  ok(validateLicenseNumber("4123456").some((e) => /6-digit/.test(e)), "7-digit license invalid");
  ok(validateLicenseNumber("41234a").some((e) => /numeric/.test(e)), "non-numeric license invalid");
  ok(validateLicenseNumber("1234567890", { allowLab10: true }).length === 0, "10-digit lab valid when allowed");
  ok(validateLicenseNumber("1234567890").some((e) => /6-digit/.test(e)), "10-digit rejected by default");

  // findExternalIdCollisions
  {
    const c = findExternalIdCollisions([
      { owner: "lotA", externalId: "DUPE-1" },
      { owner: "lotB", externalId: "DUPE-1" },
      { owner: "lotC", externalId: "UNIQUE-1" },
      { owner: "lotA", externalId: "DUPE-1" }, // same owner repeat → not a collision
      { owner: "lotD", externalId: "  " }, // empty ignored
    ]);
    ok(c.length === 1, "one collision found");
    ok(c[0].externalId === "DUPE-1" && c[0].owners.length === 2, "collision has two distinct owners");
    ok(c[0].owners.includes("lotA") && c[0].owners.includes("lotB"), "collision owners correct");
  }
  ok(findExternalIdCollisions([{ owner: "x", externalId: "A" }]).length === 0, "no collision for singletons");

  // checkSaleIdentifierIntegrity
  {
    const clean = checkSaleIdentifierIntegrity([
      { saleExternalId: "S1", saleDetailExternalId: "D1", saleType: "RecreationalRetail", saleDate: "06/01/2024" },
      { saleExternalId: "S1", saleDetailExternalId: "D2", saleType: "RecreationalRetail", saleDate: "06/01/2024" },
    ]);
    ok(clean.length === 0, "consistent sale is clean");
  }
  {
    const dupDetail = checkSaleIdentifierIntegrity([
      { saleExternalId: "S1", saleDetailExternalId: "D1" },
      { saleExternalId: "S1", saleDetailExternalId: "D1" },
    ]);
    ok(dupDetail.some((p) => p.code === "duplicate_sale_detail"), "duplicate detail id flagged");
  }
  {
    const mismatch = checkSaleIdentifierIntegrity([
      { saleExternalId: "S1", saleDetailExternalId: "D1", saleType: "RecreationalRetail", saleDate: "06/01/2024" },
      { saleExternalId: "S1", saleDetailExternalId: "D2", saleType: "RecreationalMedical", saleDate: "06/02/2024" },
    ]);
    ok(mismatch.some((p) => p.code === "sale_type_mismatch"), "mixed sale type flagged");
    ok(mismatch.some((p) => p.code === "sale_date_mismatch"), "mixed sale date flagged");
  }

  // deriveInventoryExternalId preference order
  ok(
    deriveInventoryExternalId({ ccrs_inventory_external_id: "CANON-1", lot_code: "LC" }) === "CANON-1",
    "derive prefers canonical",
  );
  ok(deriveInventoryExternalId({ lot_code: "LOT 9" }) === "LOT-9", "derive falls to sanitized lot_code");
  ok(deriveInventoryExternalId({ id: "abc" }) === "LOT-abc", "derive last-resort uses id");
  ok(deriveInventoryExternalId({}) === null, "derive returns null when nothing usable");

  if (failed === 0) console.log(`ccrs-identifiers: all ${passed} tests passed`);
  return { passed, failed };
}
