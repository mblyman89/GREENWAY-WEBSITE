/**
 * src/lib/inventory/manifest-kb-bridge-core.ts — Slice H11a (Manifest → KB
 * bridge, PURE core).
 *
 * The owner is uploading 12+ months of vendor transfer JSONs (WCIA schema) so
 * the Knowledge Base gets a ground-truth skeleton of every product we have
 * ever been shipped: verified name, strain, category, vendor and COA-backed
 * potency straight from the legal transfer document. This core maps one
 * staged inventory lot (a manifest line) into the `WritebackFacts` shape the
 * existing KB write-back merge engine (src/lib/ai/kb/writeback.ts) consumes.
 *
 * Guarantees (standing rules):
 *   • PURE — no I/O, no Supabase, fully unit-testable.
 *   • DRAFTS-ONLY downstream — writeBackProductFacts lands kb_products rows as
 *     status='draft', active=false; nothing here can publish.
 *   • NEVER GUESS — a lot with no product name or no usable product key is
 *     skipped (never fabricate identity). Brand is only passed when actually
 *     known (WCIA carries vendor at the document level, NOT brand per line);
 *     absent brands fall to the writeback's explicit "unknown-brand" bucket
 *     for a human validator to fix.
 *   • NON-DESTRUCTIVE vendor gap-fill — the license patch helper only fills an
 *     EMPTY vendors.license_number; a populated value is never overwritten.
 *
 * KB promotion is about product FACTS, not stock: it is safe for lots we
 * refused at the dock to be EXCLUDED (refused product may have failed QA), and
 * safe for still-quarantined/pending lots to be INCLUDED (the signed transfer
 * document is real regardless of whether we accepted the delivery). Inventory
 * activation stays behind the Slice-107 gate — this bridge never touches it.
 */

/** The lot fields the bridge needs (subset of an inventory_lots row). */
export type ManifestLotFacts = {
  product_name: string | null;
  strain_name: string | null;
  /** RAW LCB classification as stored (e.g. WCIA inventory_category). */
  category: string | null;
  /** RAW LCB inventory type (e.g. "Usable Marijuana") — more descriptive. */
  inventory_type: string | null;
  pos_product_key: string | null;
  lot_code: string | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  /** Resolved brand display name when the brand is actually known. */
  brand_name?: string | null;
  brand_id?: string | null;
  vendor_id?: string | null;
  status?: string | null;
  disposition?: string | null;
};

/**
 * The facts payload consumed by writeBackProductFacts. Structurally identical
 * to WritebackFacts (src/lib/ai/kb/writeback.ts) — declared here so this core
 * stays pure (writeback.ts is a server-only module).
 */
export type ManifestWritebackFacts = {
  posProductKey: string;
  productName: string;
  brandName?: string | null;
  category?: string | null;
  brandId?: string | null;
  vendorId?: string | null;
  strainName?: string | null;
  variantLabel?: string | null;
  confidence?: number | null;
  source?: string;
};

/** Manifest lines come from a signed legal transfer document — high confidence. */
export const MANIFEST_FACT_CONFIDENCE = 0.95;

/** Provenance stamp for KB rows created by this bridge. */
export const MANIFEST_FACT_SOURCE = "manifest";

/**
 * Clean a strain name: trim (the WCIA feed has a known trailing-space bug,
 * e.g. "Golden Pineapple ") and collapse internal whitespace. Null when empty.
 */
export function cleanStrainName(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  return s || null;
}

/**
 * Variant label from the per-unit weight (e.g. 3.5 + "g" → "3.5 g"). Trailing
 * zeros are trimmed ("1.0" → "1"). Null when weight is missing/zero so the KB
 * natural key falls back to the empty variant.
 */
export function deriveVariantLabel(
  unitWeight: number | null | undefined,
  uom: string | null | undefined,
): string | null {
  if (unitWeight == null || !Number.isFinite(unitWeight) || unitWeight <= 0) return null;
  // Up to 2 decimals, trailing zeros trimmed.
  const num = String(Number(unitWeight.toFixed(2)));
  const unit = String(uom ?? "").trim();
  return unit ? `${num} ${unit}` : num;
}

/**
 * Category for the KB row: prefer the descriptive LCB inventory_type
 * ("Usable Marijuana", "Concentrate for Inhalation") over the coarse WCIA
 * inventory_category ("EndProduct"). Passed through RAW — the writeback's
 * category-id resolution is best-effort and the text is gap-fill only.
 */
export function chooseKbCategory(
  category: string | null | undefined,
  inventoryType: string | null | undefined,
): string | null {
  const type = String(inventoryType ?? "").trim();
  if (type) return type;
  const cat = String(category ?? "").trim();
  return cat || null;
}

/**
 * Should this lot's facts be promoted to the KB? Everything EXCEPT refused /
 * destroyed product qualifies — including quarantined or pending lots, because
 * the transfer document's facts are real regardless of delivery acceptance.
 */
export function isPromotableLot(
  status: string | null | undefined,
  disposition: string | null | undefined,
): boolean {
  if ((disposition ?? "") === "rejected_at_dock") return false;
  const s = (status ?? "").toLowerCase();
  return s !== "rejected" && s !== "destroyed";
}

/**
 * Map one manifest lot to KB write-back facts. Returns null (skip) when the
 * lot has no product name or no usable product key — we never fabricate
 * identity. pos_product_key falls back to lot_code (mirrors intake staging).
 */
export function lotToWritebackFacts(lot: ManifestLotFacts): ManifestWritebackFacts | null {
  const name = String(lot.product_name ?? "").trim();
  const key = String(lot.pos_product_key ?? lot.lot_code ?? "").trim();
  if (!name || !key) return null;
  const brandName = String(lot.brand_name ?? "").trim();
  return {
    posProductKey: key,
    productName: name,
    // Only pass a brand when it is actually known — never guess vendor=brand.
    brandName: brandName || null,
    category: chooseKbCategory(lot.category, lot.inventory_type),
    brandId: lot.brand_id ?? null,
    vendorId: lot.vendor_id ?? null,
    strainName: cleanStrainName(lot.strain_name),
    variantLabel: deriveVariantLabel(lot.unit_weight, lot.unit_weight_uom),
    confidence: MANIFEST_FACT_CONFIDENCE,
    source: MANIFEST_FACT_SOURCE,
  };
}

/**
 * Pull the sending licensee's license number out of a stored raw manifest
 * payload (WCIA `from_license_number`; generic `vendor_license`). Tolerates a
 * JSON string or an already-parsed object; returns null for anything else
 * (e.g. the CCRS CSV text payload). Case-insensitive key lookup. PURE.
 */
export function extractVendorLicense(rawPayload: unknown): string | null {
  let obj: unknown = rawPayload;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const record = obj as Record<string, unknown>;
  const lower = new Map<string, unknown>();
  for (const k of Object.keys(record)) lower.set(k.toLowerCase(), record[k]);
  for (const key of ["from_license_number", "vendor_license"]) {
    const v = lower.get(key);
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/**
 * Non-destructive vendors.license_number gap-fill: returns the value to write
 * only when the existing column is EMPTY and the manifest carries a license.
 * A populated license is never overwritten (returns null = no patch).
 */
export function vendorLicensePatch(
  existingLicense: string | null | undefined,
  manifestLicense: string | null | undefined,
): string | null {
  const incoming = String(manifestLicense ?? "").trim();
  if (!incoming) return null;
  const current = String(existingLicense ?? "").trim();
  if (current) return null;
  return incoming;
}

/** Outcome counters for one manifest's promotion run. */
export type BridgeOutcome = {
  promoted: number;
  skipped: number;
  strainsEnriched: number;
  vendorLicenseFilled: boolean;
};

/** Human-readable audit note for the manifest timeline. PURE. */
export function summarizeBridgeOutcome(o: BridgeOutcome): string {
  const parts = [
    `KB write-back: ${o.promoted} product fact${o.promoted === 1 ? "" : "s"} promoted as KB drafts`,
  ];
  if (o.strainsEnriched > 0) parts.push(`${o.strainsEnriched} strain(s) gap-filled`);
  if (o.skipped > 0) parts.push(`${o.skipped} line(s) skipped (no name/key or refused)`);
  if (o.vendorLicenseFilled) parts.push("vendor license number captured");
  return `${parts.join("; ")}. Drafts-only — nothing published.`;
}
