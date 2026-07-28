/**
 * SLICE 77 — lot detail editing, the LEGAL way.
 *
 * WA I-502 traceability rule of thumb: numbers that CCRS reporting is built on
 * (quantities, lot codes, unit costs, LCB category/inventory type, COA/lab
 * data, dates) are NEVER hand-edited here — they come from manifests, imports
 * and audited adjustments. What IS safe to correct by hand is the descriptive
 * linkage a human got wrong at intake:
 *
 *   - vendor_id     (which licensed vendor supplied the lot)
 *   - brand_id      (which brand the product belongs to)
 *   - strain_name   (free-text strain, e.g. "Blue Dream")
 *   - strain_type   (indica / sativa / hybrid family)
 *
 * This PURE module is the single gatekeeper: it parses a raw form submission
 * into a whitelisted patch, refuses everything else, and builds the
 * plain-English audit summary. The server action validates ids against the
 * real vendors/brands tables on top of this.
 */

/** The ONLY lot columns hand-editing may touch. */
export const EDITABLE_LOT_FIELDS = [
  "vendor_id",
  "brand_id",
  "strain_name",
  "strain_type",
] as const;

export type EditableLotField = (typeof EDITABLE_LOT_FIELDS)[number];

/** Locked columns, documented so the UI can explain WHY they're not editable. */
export const LOCKED_LOT_FIELDS = [
  "lot_code",
  "on_hand_qty",
  "received_qty",
  "unit",
  "unit_cost_minor_units",
  "category",
  "inventory_type",
  "expires_on",
  "lab_result_id",
  "manifest_id",
  "pos_product_key",
] as const;

/** Strain-type values the back office renders (lot-table-core labels). */
export const STRAIN_TYPE_OPTIONS = [
  "indica",
  "sativa",
  "hybrid",
  "indica-hybrid",
  "sativa-hybrid",
  "cbd",
] as const;

export type LotEditPatch = {
  vendor_id: string | null;
  brand_id: string | null;
  strain_name: string | null;
  strain_type: string | null;
};

export type LotEditParse =
  | { ok: true; patch: LotEditPatch }
  | { ok: false; error: string };

const MAX_STRAIN_NAME = 120;

/** Loose UUID shape check (Supabase ids) — full validation happens in the DB. */
function looksLikeId(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Parse a raw form submission into a safe patch.
 * Empty strings mean "clear the field" (NULL). Unknown strain types and
 * malformed ids are refused with plain-English errors.
 */
export function parseLotEditInput(raw: {
  vendor_id?: string | null;
  brand_id?: string | null;
  strain_name?: string | null;
  strain_type?: string | null;
}): LotEditParse {
  const vendor = String(raw.vendor_id ?? "").trim();
  const brand = String(raw.brand_id ?? "").trim();
  const strainName = String(raw.strain_name ?? "").trim();
  const strainType = String(raw.strain_type ?? "").trim().toLowerCase();

  if (vendor && !looksLikeId(vendor)) {
    return { ok: false, error: "Pick a vendor from the list — that vendor id isn't valid." };
  }
  if (brand && !looksLikeId(brand)) {
    return { ok: false, error: "Pick a brand from the list — that brand id isn't valid." };
  }
  if (strainName.length > MAX_STRAIN_NAME) {
    return { ok: false, error: `Strain name is too long (max ${MAX_STRAIN_NAME} characters).` };
  }
  if (strainType && !(STRAIN_TYPE_OPTIONS as readonly string[]).includes(strainType)) {
    return {
      ok: false,
      error: "Strain type must be indica, sativa, hybrid, indica-hybrid, sativa-hybrid, or CBD.",
    };
  }

  return {
    ok: true,
    patch: {
      vendor_id: vendor || null,
      brand_id: brand || null,
      strain_name: strainName || null,
      strain_type: strainType || null,
    },
  };
}

/**
 * Vendor⇄brand consistency: a brand that belongs to a vendor may only be
 * paired with THAT vendor. Brands without a vendor link pair with anyone.
 */
export function brandMatchesVendor(
  brand: { vendor_id: string | null } | null,
  vendorId: string | null,
): boolean {
  if (!brand || !brand.vendor_id) return true;
  if (!vendorId) return true; // brand keeps its own vendor linkage; lot vendor cleared
  return brand.vendor_id === vendorId;
}

/**
 * Plain-English audit summary: which of the four fields actually changed,
 * "old → new" per line. Names (not raw ids) are passed in by the action so
 * the audit trail reads like a sentence.
 */
export function buildLotEditSummary(
  before: { vendor: string | null; brand: string | null; strain_name: string | null; strain_type: string | null },
  after: { vendor: string | null; brand: string | null; strain_name: string | null; strain_type: string | null },
): string[] {
  const lines: string[] = [];
  const row = (label: string, a: string | null, b: string | null) => {
    const from = (a ?? "").trim() || "(empty)";
    const to = (b ?? "").trim() || "(empty)";
    if (from !== to) lines.push(`${label}: ${from} \u2192 ${to}`);
  };
  row("Vendor", before.vendor, after.vendor);
  row("Brand", before.brand, after.brand);
  row("Strain", before.strain_name, after.strain_name);
  row("Strain type", before.strain_type, after.strain_type);
  return lines;
}

// ---------------------------------------------------------------------------
// self-tests (pure, deterministic) — registered in the pure runner
// ---------------------------------------------------------------------------

export function __runLotEditCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL lot-edit-core: " + msg);
    passed += 1;
  };

  const ID_A = "11111111-2222-3333-4444-555555555555";
  const ID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  // Whitelist is EXACTLY the four legal fields — no quantities, ever.
  ok(EDITABLE_LOT_FIELDS.length === 4, "exactly 4 editable fields");
  ok(!EDITABLE_LOT_FIELDS.includes("on_hand_qty" as EditableLotField), "on_hand_qty NOT editable");
  ok(!EDITABLE_LOT_FIELDS.includes("lot_code" as EditableLotField), "lot_code NOT editable");
  ok((LOCKED_LOT_FIELDS as readonly string[]).includes("on_hand_qty"), "on_hand_qty documented locked");
  ok((LOCKED_LOT_FIELDS as readonly string[]).includes("lot_code"), "lot_code documented locked");
  // No overlap between the two lists.
  ok(
    EDITABLE_LOT_FIELDS.every((f) => !(LOCKED_LOT_FIELDS as readonly string[]).includes(f)),
    "editable and locked lists don't overlap",
  );

  // Happy path — everything provided.
  const full = parseLotEditInput({
    vendor_id: ID_A,
    brand_id: ID_B,
    strain_name: "  Blue Dream  ",
    strain_type: "Hybrid",
  });
  ok(full.ok, "full input parses");
  if (full.ok) {
    ok(full.patch.vendor_id === ID_A, "vendor id kept");
    ok(full.patch.brand_id === ID_B, "brand id kept");
    ok(full.patch.strain_name === "Blue Dream", "strain trimmed");
    ok(full.patch.strain_type === "hybrid", "strain type lower-cased");
  }

  // Empty strings clear to NULL.
  const empty = parseLotEditInput({ vendor_id: "", brand_id: "", strain_name: "", strain_type: "" });
  ok(empty.ok, "empty input parses");
  if (empty.ok) {
    ok(empty.patch.vendor_id === null, "empty vendor -> null");
    ok(empty.patch.brand_id === null, "empty brand -> null");
    ok(empty.patch.strain_name === null, "empty strain -> null");
    ok(empty.patch.strain_type === null, "empty strain type -> null");
  }

  // Refusals — bad id, junk strain type, too-long strain.
  ok(!parseLotEditInput({ vendor_id: "not-an-id" }).ok, "junk vendor id refused");
  ok(!parseLotEditInput({ brand_id: "DROP TABLE" }).ok, "junk brand id refused");
  ok(!parseLotEditInput({ strain_type: "energetic" }).ok, "unknown strain type refused");
  ok(!parseLotEditInput({ strain_name: "x".repeat(121) }).ok, "over-long strain refused");
  ok(parseLotEditInput({ strain_name: "x".repeat(120) }).ok, "120-char strain allowed");
  // All six display strain types accepted.
  for (const t of STRAIN_TYPE_OPTIONS) {
    ok(parseLotEditInput({ strain_type: t }).ok, `strain type ${t} allowed`);
  }

  // Vendor⇄brand consistency.
  ok(brandMatchesVendor(null, ID_A), "no brand always matches");
  ok(brandMatchesVendor({ vendor_id: null }, ID_A), "unlinked brand matches any vendor");
  ok(brandMatchesVendor({ vendor_id: ID_A }, ID_A), "linked brand matches its vendor");
  ok(!brandMatchesVendor({ vendor_id: ID_A }, ID_B), "linked brand refuses another vendor");
  ok(brandMatchesVendor({ vendor_id: ID_A }, null), "linked brand ok when lot vendor cleared");

  // Audit summary — only changed rows, plain English, (empty) placeholder.
  const summary = buildLotEditSummary(
    { vendor: "Old Farm", brand: null, strain_name: "GDP", strain_type: "indica" },
    { vendor: "New Farm", brand: "House Brand", strain_name: "GDP", strain_type: "indica" },
  );
  ok(summary.length === 2, "two changed rows summarized");
  ok(summary[0] === "Vendor: Old Farm \u2192 New Farm", "vendor line reads plainly");
  ok(summary[1] === "Brand: (empty) \u2192 House Brand", "brand line shows (empty) for null");
  ok(
    buildLotEditSummary(
      { vendor: "A", brand: "B", strain_name: "C", strain_type: "hybrid" },
      { vendor: "A", brand: "B", strain_name: "C", strain_type: "hybrid" },
    ).length === 0,
    "no-op edit produces empty summary",
  );

  return { passed };
}
