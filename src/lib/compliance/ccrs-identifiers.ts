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
 * S-10 (bible v2 Part 03 §C, 2026-10-05) — TWO JOBS, TWO FUNCTIONS:
 *  • PASS-THROUGH. An id that is already on the CCRS record (every lot Cultivera
 *    filed; 62,744 ids in the LCB's 2026-09-18 delivery, 4,295 of them dotted
 *    like "WAR413541.IN132IB0") is returned BYTE-FOR-BYTE (trim only). The LCB
 *    examiner: periods are "your choice" and ids are text up to 100 [G L0224].
 *    Rewriting "." to "-" produces an id CCRS has never seen, and every Sale
 *    row against it fails "Invalid InventoryExternalIdentifier".
 *  • MINTING. Only a brand-new lot that has never been filed gets a minted id
 *    (`mintExternalId`, Greenway's [A-Za-z0-9-] convention).
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
export function mintExternalId(raw: string): string {
  const cleaned = (raw ?? "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, CCRS_EXTERNAL_ID_MAX);
}

/**
 * @deprecated S-10: use `mintExternalId` for NEW ids only. Never call this on an
 * id that is already on the CCRS record (that is `passThroughExternalId`).
 */
export const sanitizeExternalId = mintExternalId;

/**
 * Return an already-filed CCRS identifier exactly as filed: trimmed, nothing
 * else. "" when blank. Dots, leading zeros, case — all preserved [G L0224].
 */
export function passThroughExternalId(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

/**
 * Validate an identifier that is (or will be) on the CCRS record WITHOUT
 * imposing Greenway's minting alphabet. CCRS defines ExternalIdentifier as
 * Text (100), required on Insert/Update/Delete [G L0224-L0225]. We additionally
 * refuse the four characters a CSV cell cannot carry without quoting/breaking a
 * row (CR, LF, comma, double quote) — none occurs in any filed id (measured over
 * the 62,744-row delivery: only "." ×4,295 and "-" ×3 are non-alphanumeric).
 * Empty result = valid.
 */
export function validatePassThroughExternalId(value: string | null | undefined): string[] {
  const errs: string[] = [];
  const v = (value ?? "").trim();
  if (!v) {
    errs.push("missing");
    return errs;
  }
  if (v.length > CCRS_EXTERNAL_ID_MAX) errs.push(`exceeds ${CCRS_EXTERNAL_ID_MAX} characters`);
  if (/[\r\n,"]/.test(v)) errs.push("contains a line break, comma, or double quote");
  return errs;
}

/**
 * Validate a MINTED Greenway identifier against our own [A-Za-z0-9-] convention.
 * Not a CCRS rule: never apply it to an already-filed id (use
 * `validatePassThroughExternalId`). Empty result = valid.
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
 * S-10: the id ASSIGNED to a lot, or null. Never mints.
 *
 * Every CCRS file that names an existing lot (Inventory.csv, Sale.csv,
 * InventoryAdjustment.csv) must carry the id that lot was filed under, so an
 * export may only READ the stored id. Returns null when none is stored; the
 * caller withholds the row (E3_EXTERNAL_ID_UNASSIGNED) rather than inventing
 * an id CCRS has never seen.
 */
export function assignedInventoryExternalId(
  src: Pick<LotIdentitySource, "ccrs_inventory_external_id">,
): string | null {
  const v = passThroughExternalId(src.ccrs_inventory_external_id);
  return v ? v : null;
}

/**
 * Derive the canonical CCRS inventory external identifier for a lot.
 *
 * S-10: a lot that already HAS an assigned ccrs_inventory_external_id returns it
 * byte-for-byte (trim only) — NEVER re-sanitized, never drifted. Only a lot with
 * no assigned id falls through to `mintInventoryExternalId` (lot_code →
 * pos_product_key → LOT-<id>, minted). Every caller that reads a lot from the
 * database MUST select and pass `ccrs_inventory_external_id`, otherwise it is
 * minting a second identity for a lot that already has one.
 *
 * Returns null only if nothing usable exists.
 */
export function deriveInventoryExternalId(src: LotIdentitySource): string | null {
  const assigned = passThroughExternalId(src.ccrs_inventory_external_id);
  if (assigned) return assigned;
  return mintInventoryExternalId(src);
}

/**
 * Mint an id for a lot that has NEVER been filed (a new receiving-intake lot).
 * Greenway convention: lot_code → pos_product_key → LOT-<db id>, each minted to
 * [A-Za-z0-9-]. Do not call this for a lot that already carries an id.
 */
export function mintInventoryExternalId(src: LotIdentitySource): string | null {
  const fromLot = mintExternalId(src.lot_code ?? "");
  if (fromLot) return fromLot;

  const fromKey = mintExternalId(src.pos_product_key ?? "");
  if (fromKey) return fromKey;

  const fromId = mintExternalId(src.id ? `LOT-${src.id}` : "");
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
  // S-10: both are ids already assigned to a filed lot — pass through, never
  // re-sanitize (a dotted filed id must reach Sale.csv with its dot).
  const line = passThroughExternalId(opts.lineExplicit);
  if (line) return { value: line, source: "line" };

  const lot = passThroughExternalId(opts.lotCanonical);
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

  // S-10 pass-through: an assigned, filed id is returned byte-for-byte.
  ok(
    deriveInventoryExternalId({ ccrs_inventory_external_id: " WAR413541.IN132IB0 ", lot_code: "x" }) ===
      "WAR413541.IN132IB0",
    "S-10: assigned dotted id passes through, trim only",
  );
  ok(
    deriveInventoryExternalId({ ccrs_inventory_external_id: "000123" }) === "000123",
    "S-10: leading zeros preserved",
  );
  ok(
    resolveSaleInventoryExternalId({ lotCanonical: "I65303102101603WAR413541.IN132IB0" }).value ===
      "I65303102101603WAR413541.IN132IB0",
    "S-10: Sale line keeps the dotted lot id",
  );
  ok(
    resolveSaleInventoryExternalId({ lineExplicit: "WAR413541.INX" }).value === "WAR413541.INX",
    "S-10: Sale line explicit keeps its dot",
  );
  ok(validatePassThroughExternalId("WAR413541.IN132IB0").length === 0, "S-10: dotted id valid for pass-through");
  ok(validatePassThroughExternalId("44557481674921553-1").length === 0, "S-10: filed hyphen id valid");
  ok(validatePassThroughExternalId("").includes("missing"), "S-10: blank pass-through missing");
  ok(validatePassThroughExternalId("a,b").some((e) => /comma/.test(e)), "S-10: comma refused");
  ok(validatePassThroughExternalId('a"b').length === 1, "S-10: quote refused");
  ok(validatePassThroughExternalId("a\nb").length === 1, "S-10: newline refused");
  ok(validatePassThroughExternalId("x".repeat(101)).some((e) => /exceeds/.test(e)), "S-10: 101 chars refused");
  ok(validatePassThroughExternalId("x".repeat(100)).length === 0, "S-10: 100 chars allowed");
  ok(mintInventoryExternalId({ lot_code: "LOT 9.5" }) === "LOT-9-5", "S-10: minting still sanitizes new lots");
  ok(sanitizeExternalId === mintExternalId, "S-10: deprecated alias is the minting function");
  ok(assignedInventoryExternalId({ ccrs_inventory_external_id: " WA1.X " }) === "WA1.X", "S-10: assigned id trimmed, dot kept");
  ok(assignedInventoryExternalId({ ccrs_inventory_external_id: "   " }) === null, "S-10: blank assigned id is null (never minted)");
  ok(assignedInventoryExternalId({ ccrs_inventory_external_id: null }) === null, "S-10: missing assigned id is null");
  ok(
    assignedInventoryExternalId({ lot_code: "LOT1", ccrs_inventory_external_id: null } as never) === null,
    "S-10: assigned id ignores lot_code (no fallback minting at export)",
  );

  if (failed === 0) console.log(`ccrs-identifiers: all ${passed} tests passed`);
  return { passed, failed };
}
