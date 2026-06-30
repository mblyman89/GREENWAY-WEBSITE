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
