/**
 * src/lib/compliance/ccrs-batch.ts  (Slice 54)
 *
 * Server-only CCRS BATCH generator for a WA RETAILER. Produces the full,
 * correctly-ordered set of files a retailer must report (Table 1 of the CCRS
 * Upload User Guide): Strain, Area, Product, Inventory, InventoryAdjustment,
 * InventoryTransfer, Sale — plus a data-integrity ("sync") analysis that flags
 * out-of-sync data BEFORE upload (since CCRS notifies of failures only by email).
 *
 * Everything factual about the file format lives in ccrs-batch-core.ts (pure,
 * unit-tested). This module only reads the database and maps real columns into
 * the spec. It reuses the mature Sale.csv and InventoryAdjustment.csv builders.
 *
 * DRAFTS-ONLY: this is generated output an employee validates before upload.
 * We never invent data — every row comes from a real DB column.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AVOIRDUPOIS_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";
import {
  assembleCcrsFile,
  ccrsDate,
  ccrsFileName,
  CCRS_UPLOAD_ORDER,
  uploadGroupOf,
  normalizeStrainType,
  deriveCcrsClassificationFromType,
  clampText,
  classifyWarning,
  verifySaleNumericColumns,
  splitCsvLine,
  withholdUnencodableRows,
  unencodableMessage,
  freeTextRewriteMessage,
  CCRS_UNENCODABLE_CODE,
  CCRS_FREE_TEXT_COLUMNS,
  CCRS_COLUMNS,
  CCRS_PRODUCT_NAME_MAX,
  CCRS_PRODUCT_DESCRIPTION_MAX,
  type CcrsRetailerFileType,
} from "@/lib/compliance/ccrs-batch-core";
import {
  assignedInventoryExternalId,
  validatePassThroughExternalId,
  sanitizeExternalId,
} from "@/lib/compliance/ccrs-identifiers";
import {
  inventoryRowVerdict,
  productRowIssues,
  isReservedStrainName,
  specPinFor,
  type CcrsIssueCode,
  type CcrsIssueRow,
} from "@/lib/compliance/ccrs-preflight-core";
import { ccrsInventoryCreatedDate } from "@/lib/inventory/received-date-core";
import { pagedAll } from "@/lib/supabase/chunked-in";
import { validateName, suggestName, type Cannabinoid } from "@/lib/naming/convention-core";
import { composeCcrsProductName, disambiguateCcrsName } from "@/lib/compliance/ccrs-product-name-core";
import { getCcrsLicenseSettings, buildCcrsSaleCsv } from "@/lib/compliance/ccrs-sales";
import { buildCcrsInventoryAdjustmentCsv } from "@/lib/compliance/ccrs-inventory-adjustment";
import { NO_PRODUCT_ID_REASON, applyProductPlan, planLedgerBatch, type LedgerEnv, type LedgerPlan, type LedgerView } from "@/lib/compliance/ccrs-ledger-core";
import { loadLedgerForBatch } from "@/lib/compliance/ccrs-ledger-store";

export type CcrsFile = {
  type: CcrsRetailerFileType;
  group: number;
  fileName: string;
  csv: string;
  recordCount: number;
  skipped: number;
  warnings: string[];
  /** True when this file has zero data rows (nothing to report for the range). */
  empty: boolean;
};

export type CcrsSyncIssue = {
  severity: "error" | "warning";
  file: CcrsRetailerFileType | "General";
  message: string;
  count?: number;
  /**
   * S-02: stable machine id for the check that fired, e.g. "E7_TOTALCOST_ZERO".
   * Optional so the many legacy warnings keep compiling; every issue raised by
   * a bible-grounded check MUST set it (Part 08 §C).
   */
  code?: CcrsIssueCode;
  /** The verbatim LCB pin behind the check, e.g. "[G L0614]". */
  specPin?: string;
  /** Every offending row — NEVER capped; a capped list hides the blocker. */
  rows?: CcrsIssueRow[];
};

export type CcrsBatch = {
  licenseNumber: string;
  submittedBy: string;
  fromISO: string;
  toISO: string;
  files: CcrsFile[];
  syncIssues: CcrsSyncIssue[];
  totalRecords: number;
  generatedAt: string;
  /**
   * S-12b: what the rows were routed against. `view` null = legacy routing
   * (every row Insert, our ids) because the 0248 migration is not applied or
   * the production seed is not finalized yet (ccrs-ledger-store-core).
   */
  ledger: {
    env: LedgerEnv;
    view: LedgerView | null;
    /** why there is no view (null when loaded). */
    absentReason: "migration-not-applied" | "seed-not-finalized" | "not-configured" | null;
    /** greatest file stamp already stored in this env (ISO), null = none. */
    lastStamp: string | null;
    /**
     * Product keys withheld ONLY because no GWP- id is assigned yet (sorted).
     * The owner assigns them with one audited action (ccrs_assign_product_ids);
     * the export never assigns on its own (D-01a: ids are minted deliberately).
     */
    unassignedProductKeys: string[];
  };
};

// ---------------------------------------------------------------------------
// Helpers to read the published menu snapshot + inventory lots
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function getPublishedVersionId(admin: Admin): Promise<string | null> {
  const { data } = await admin
    .from("menu_versions")
    .select("id")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

type MenuItemRow = {
  source_item_id: string;
  name: string;
  strain_name: string | null;
  strain_type: string | null;
  pos_inventory_type: string | null;
  pos_inventory_category: string | null;
  description: string | null;
  // SLICE 53 (two-layer naming): fields the CCRS Product.Name composer uses.
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  total_thc_json: unknown;
  total_cbd_json: unknown;
  compounds_json: unknown;
};

/** Parse a stored cannabinoid JSON blob (same shape live-menu.ts reads). */
function jsonToCannabinoid(json: unknown): Cannabinoid | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.type !== "string" || typeof o.unit !== "string") return null;
  return {
    type: o.type as Cannabinoid["type"],
    value: typeof o.value === "string" || typeof o.value === "number" ? o.value : null,
    unit: o.unit as Cannabinoid["unit"],
  };
}

function jsonToCompounds(json: unknown): Cannabinoid[] {
  if (!Array.isArray(json)) return [];
  return json.map(jsonToCannabinoid).filter((c): c is Cannabinoid => c != null);
}

type LotRow = {
  id: string;
  lot_code: string | null;
  pos_product_key: string | null;
  product_name: string | null;
  ccrs_inventory_external_id: string | null;
  received_qty: number;
  on_hand_qty: number;
  unit_cost_minor_units: number | null;
  unit_weight: number | null;
  unit_weight_uom: string | null;
  status: string;
  created_at: string;
  /**
   * SLICE 2 (migration 0214) — the evidenced day the lot was received.
   * NULL means unknown; see ccrsInventoryCreatedDate() for how that is
   * handled when filling Inventory.CreatedDate.
   */
  received_on: string | null;
  /**
   * S-02 / E7: a vendor TRADE SAMPLE (migration 0024 L32,
   * `is_sample boolean not null default false`). It has no purchase value, but
   * CCRS still requires a positive TotalCost and the FAQ dictates exactly
   * $0.01 [FAQ L0035]. Selected explicitly so the E7 check can tell a sample
   * apart from a lot whose cost was never entered.
   */
  is_sample: boolean | null;
};

// ---------------------------------------------------------------------------
// Per-file generators for the master-data files (Strain / Area / Product /
// Inventory). Adjustment + Sale reuse the existing mature builders.
// ---------------------------------------------------------------------------

/** grams from a unit_weight + uom (g default). Returns "" when unknown. */
function toGrams(weight: number | null, uom: string | null): string {
  if (weight == null || !Number.isFinite(weight)) return "";
  const u = (uom ?? "g").toLowerCase();
  const g = u === "mg" ? weight / 1000 : u === "oz" ? weight * AVOIRDUPOIS_GRAMS_PER_OUNCE : weight;
  return (Math.round(g * 1000) / 1000).toString();
}

function buildStrainFile(
  items: MenuItemRow[],
  license: string,
  submittedBy: string,
  createdBy: string,
  createdDate: string,
  plan: LedgerPlan,
): { rows: string[][]; warnings: string[]; issues: CcrsSyncIssue[] } {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const rows: string[][] = [];
  const defaulted: string[] = [];
  const reserved: CcrsIssueRow[] = [];
  for (const it of items) {
    const raw = (it.strain_name ?? "").trim();
    if (!raw) continue;
    // S-11: the plan decides. A strain already on file in ANY casing is never
    // re-sent (Strain has no Operation [G L0319-L0320]); a case variant of a
    // filed or already-emitted strain is never sent at all [BRIAN A16].
    const strain = plan.strainCanonical.get(raw) ?? raw;
    if (!plan.strainEmit.has(strain)) continue;
    if (seen.has(strain)) continue;
    seen.add(strain);
    // E11 [G L0358] "Strain name is invalid, cannot be Unknown, THC, or Other."
    // Exact match only — "Other Kush" is a real strain and must still ship.
    if (isReservedStrainName(strain)) {
      reserved.push({
        id: (it.source_item_id ?? strain).trim(),
        label: strain,
        detail: `"${strain}" is a reserved CCRS strain name`,
      });
      continue;
    }
    // B2: StrainType MUST be one of Indica/Sativa/Hybrid. Normalize the POS
    // label; when it can't be resolved we default to Hybrid (safe superset) and
    // flag the strain so an employee can correct it (drafts-only).
    const st = normalizeStrainType(it.strain_type);
    if (st.defaulted) defaulted.push(strain);
    rows.push([license, strain, st.value, createdBy, createdDate]);
  }
  if (defaulted.length > 0) {
    warnings.push(
      `${defaulted.length} strain(s) had no recognizable Indica/Sativa/Hybrid type and were defaulted to "Hybrid" — set the correct StrainType before uploading: ${defaulted
        .slice(0, 15)
        .join(", ")}${defaulted.length > 15 ? "…" : ""}.`,
    );
  }
  if (rows.length === 0) warnings.push("No named strains found in the published menu.");
  const issues: CcrsSyncIssue[] = [];
  if (plan.strainCaseVariants.length > 0) {
    issues.push({
      severity: "warning",
      file: "Strain",
      code: "E39_STRAIN_CASE_VARIANT",
      specPin: specPinFor("E39_STRAIN_CASE_VARIANT"),
      count: plan.strainCaseVariants.length,
      rows: plan.strainCaseVariants.map((v) => ({
        id: v.ours,
        label: v.ours,
        detail: `written as "${v.value}" (${v.source === "ledger" ? "the spelling already filed in CCRS" : "the first spelling in this batch"})`,
      })),
      message: `${plan.strainCaseVariants.length} strain name(s) differ from another only by capital letters. CCRS must never receive the same strain with a different capitalization (LCB Service Desk: "Dutch Treat vs Dutch treat"), so each was written with one spelling everywhere and no extra Strain row was sent. Fix the spelling on the product to match, so this warning goes away.`,
    });
  }
  if (reserved.length > 0) {
    issues.push({
      severity: "error",
      file: "Strain",
      code: "E11_STRAIN_NAME_RESERVED",
      specPin: specPinFor("E11_STRAIN_NAME_RESERVED"),
      count: reserved.length,
      rows: reserved,
      message: `${reserved.length} product(s) use a strain name CCRS reserves — "Strain name is invalid, cannot be Unknown, THC, or Other." [G L0358]. Set the real strain name (or leave it blank for a non-strain product) and rebuild.`,
    });
  }
  return { rows, warnings, issues };
}

/**
 * Area.csv — CCRS requires the physical/logical areas that hold inventory. We do
 * not model named rooms in the DB, so we report the two areas our inventory
 * lifecycle actually uses: the default sales-floor area and a Quarantine area
 * (recalled/quarantine lots). This keeps Inventory.Area references valid.
 */
function buildAreaFile(
  hasQuarantine: boolean,
  license: string,
  createdBy: string,
  createdDate: string,
  ledger: LedgerView | null = null,
): { rows: string[][]; warnings: string[] } {
  const rows: string[][] = [];
  const wanted: [string, string, string][] = [["Sales Floor", "FALSE", "AREA-SALES-FLOOR"]];
  if (hasQuarantine) wanted.push(["Quarantine", "TRUE", "AREA-QUARANTINE"]);
  // S-12b: with a ledger, an Area NAME CCRS already holds is never Inserted
  // again under a new id. Inventory.Area joins by name to the most recently
  // ingested record [BRIAN A12], so a new "Sales Floor" record would silently
  // become the join target (gap E23). The full ledger-driven Area file
  // (Delete/Update of the filed set, D-03, no Quarantine area N-01) is S-13.
  const held = new Set<string>();
  if (ledger) {
    for (const e of ledger.entries.values()) {
      if (e.fileType === "Area" && e.filedName && (e.state === "seed" || e.state === "filed" || e.state === "confirmed")) held.add(e.filedName);
    }
  }
  for (const [name, quarantine, id] of wanted) {
    if (held.has(name)) continue;
    rows.push([license, name, quarantine, id, createdBy, createdDate, "", "", "Insert"]);
  }
  return { rows, warnings: [] };
}

function buildProductFile(
  items: MenuItemRow[],
  lots: LotRow[],
  license: string,
  createdBy: string,
  createdDate: string,
): {
  rows: string[][];
  warnings: string[];
  nameByProductKey: Map<string, string>;
  /** S-11: the product key behind each row in `rows`, same order. */
  keys: string[];
  issues: CcrsSyncIssue[];
} {
  const warnings: string[] = [];
  const e9Rows: CcrsIssueRow[] = [];
  const e10Rows: CcrsIssueRow[] = [];
  // CCRS joins Inventory.Product -> Product.Name by the EXACT name string. We
  // record the final (clamped) Name we wrote for each raw product key so the
  // Inventory file can reference the IDENTICAL string. See
  // docs/CCRS_PRODUCT_NAMING_RESEARCH.md (the Inventory.Product join bug).
  const nameByProductKey = new Map<string, string>();
  // Weight per product key from lots (first non-null wins).
  const weightByKey = new Map<string, string>();
  for (const l of lots) {
    const key = (l.pos_product_key ?? "").trim();
    if (!key) continue;
    if (!weightByKey.has(key)) {
      const g = toGrams(l.unit_weight, l.unit_weight_uom);
      if (g) weightByKey.set(key, g);
    }
  }
  const seen = new Set<string>();
  const usedNamesLower = new Set<string>();
  const rows: string[][] = [];
  const keys: string[] = [];
  for (const it of items) {
    const key = (it.source_item_id ?? "").trim();
    if (!key) continue;
    const ext = sanitizeExternalId(key);
    if (!ext || seen.has(ext)) continue;
    seen.add(ext);
    const rawCategory = (it.pos_inventory_category ?? "").trim();
    const rawType = (it.pos_inventory_type ?? "").trim();
    const grams = weightByKey.get(key) ?? "";

    // SLICE 53 (two-layer naming, owner-approved): the CCRS Product.Name is
    // AUTO-COMPOSED from stored fields — short vendor + brand + display name +
    // measured cannabinoid tag + type + size ("Downtown Space OG Flower 1g").
    // The human-facing menu_items.name is untouched; the composed name lives
    // only in these files. Falls back to the display name when composition is
    // impossible (never guesses).
    const composed = composeCcrsProductName({
      name: (it.name ?? "").trim(),
      vendor: it.vendor_name,
      brand: it.brand_name,
      posInventoryCategory: it.pos_inventory_category,
      category: it.category,
      unitWeightGrams: grams || null,
      totalThc: jsonToCannabinoid(it.total_thc_json),
      totalCbd: jsonToCannabinoid(it.total_cbd_json),
      compounds: jsonToCompounds(it.compounds_json),
    });
    // CCRS joins Inventory.Product -> Product.Name by EXACT string, so two
    // DIFFERENT products must never share one Name. Deterministic suffix from
    // the product's own external id on collision (stable batch after batch).
    const disamb = disambiguateCcrsName(composed.name, ext, usedNamesLower);
    if (disamb.disambiguated) {
      warnings.push(
        `Product "${composed.name.slice(0, 40)}…": composed CCRS name collided with another product — suffixed to "${disamb.name.slice(0, 60)}" to keep the Inventory→Product join unambiguous.`,
      );
    }
    const productName = disamb.name;

    // C1 (Slice 55, owner-confirmed): the CCRS (InventoryCategory, InventoryType)
    // is derived from the vendor-set LCB TYPE alone (pos_inventory_type). The
    // house/merchandising label (pos_inventory_category, e.g. "Pre-roll",
    // "Gummies") is a STOREFRONT concept and is NOT used as a CCRS category — it
    // only feeds the composed Name above. Deriving the category from the type
    // (an inversion of the CCRS enum) is deterministic and never guesses; a
    // blank/unknown type still raises the pre-existing ERROR safety net so a
    // human fixes the source. NEVER-INVENT policy preserved.
    const cls = deriveCcrsClassificationFromType(rawType);
    let category = rawCategory;
    let type = rawType;
    if (cls.ok) {
      category = cls.category;
      type = cls.type;
      // Advisory (never blocks): a legacy 2021-vocabulary value ("Usable
      // Marijuana", inhalation concentrate under IntermediateProduct) was
      // canonicalized to the current Table 2 spelling/category. Surface it so
      // staff see what was translated.
      if (cls.aliased && cls.aliasNote) {
        warnings.push(`Product "${productName || ext}": ${cls.aliasNote}`);
      }
    } else {
      warnings.push(`ERROR — Product "${productName || ext}": ${cls.error} Fix the CCRS mapping (Inventory types) before submitting.`);
    }

    // C2: clamp Name (75) and Description (250); flag truncation (don't silently cut).
    const nameClamp = clampText(productName, CCRS_PRODUCT_NAME_MAX);
    if (nameClamp.truncated) {
      warnings.push(`Product "${productName.slice(0, 40)}…": Name exceeds ${CCRS_PRODUCT_NAME_MAX} chars and was truncated — shorten it in the source.`);
    }
    // Naming-convention check (drafts-only, surfaced as a warning): if the Name
    // violates the house convention (leading symbol, disallowed char, casing),
    // flag it so staff fix the source. Does NOT alter the value written here.
    const nameCheck = validateName(nameClamp.value);
    if (!nameCheck.ok) {
      warnings.push(
        `Product "${nameClamp.value.slice(0, 40)}…": name convention issues — ${nameCheck.issues.map((i) => i.message).join(" ")} Suggested: "${suggestName(nameClamp.value)}".`,
      );
    }
    // Record the exact Name for the Inventory.Product join (keyed by raw key).
    nameByProductKey.set(key, nameClamp.value);
    const descClamp = clampText(it.description, CCRS_PRODUCT_DESCRIPTION_MAX);
    if (descClamp.truncated) {
      warnings.push(`Product "${productName || ext}": Description exceeds ${CCRS_PRODUCT_DESCRIPTION_MAX} chars and was truncated — shorten it in the source.`);
    }

    // E9 / E10 — for Usable Cannabis and Cannabis Mix Packaged ONLY, the guide
    // makes UnitWeightGrams and Description mandatory:
    //   [G L0489-L0490] "required when InventoryType = Useable cannabis, or
    //                    Cannabis Mix Packaged All other product types weight
    //                    can be reported as 0"
    //   [G L0482-L0483] the same note for Description
    //   [G L0434] "If Useable Cannabis is selected, Unit Weight Gram cannot be 0"
    // `type` is the CANONICAL Table 2 value resolved above, so we compare that
    // rather than the raw vendor string.
    for (const found of productRowIssues({
      id: ext,
      label: nameClamp.value || ext,
      inventoryType: type,
      unitWeightGrams: grams,
      description: descClamp.value,
    })) {
      if (found.code === "E9_UNITWEIGHT_ZERO_USABLE") e9Rows.push(found.row);
      else e10Rows.push(found.row);
    }

    rows.push([
      license,
      category,
      type,
      nameClamp.value,
      descClamp.value,
      grams,
      ext,
      createdBy,
      createdDate,
      "",
      "",
      "Insert",
    ]);
    keys.push(key);
  }
  if (rows.length === 0) warnings.push("No products found in the published menu.");
  // Cap the warning noise (errors first so critical mapping issues aren't buried).
  const unique = [...new Set(warnings)];
  const errorsFirst = [
    ...unique.filter((w) => w.startsWith("ERROR")),
    ...unique.filter((w) => !w.startsWith("ERROR")),
  ];
  const dedupWarnings = errorsFirst.slice(0, 30);
  const issues: CcrsSyncIssue[] = [];
  if (e9Rows.length > 0) {
    issues.push({
      severity: "error",
      file: "Product",
      code: "E9_UNITWEIGHT_ZERO_USABLE",
      specPin: specPinFor("E9_UNITWEIGHT_ZERO_USABLE"),
      count: e9Rows.length,
      rows: e9Rows,
      message: `${e9Rows.length} Usable Cannabis / Cannabis Mix Packaged product(s) have no unit weight. CCRS rejects the Product file — "If Useable Cannabis is selected, Unit Weight Gram cannot be 0" [G L0434]. Set the gram weight on each product and rebuild.`,
    });
  }
  if (e10Rows.length > 0) {
    issues.push({
      severity: "error",
      file: "Product",
      code: "E10_DESCRIPTION_REQUIRED",
      specPin: specPinFor("E10_DESCRIPTION_REQUIRED"),
      count: e10Rows.length,
      rows: e10Rows,
      message: `${e10Rows.length} Usable Cannabis / Cannabis Mix Packaged product(s) have no Description, which CCRS requires for those two types [G L0482-L0483]. Add a short product description (250 characters max) and rebuild.`,
    });
  }
  return { rows, warnings: dedupWarnings, nameByProductKey, keys, issues };
}

function buildInventoryFile(
  lots: LotRow[],
  license: string,
  createdBy: string,
  plan: LedgerPlan,
): { rows: string[][]; warnings: string[]; issues: CcrsSyncIssue[] } {
  const warnings: string[] = [];
  const rows: string[][] = [];
  // S-02 coded pre-flight errors. Rows are collected, never capped.
  const e7Rows: CcrsIssueRow[] = [];
  const e8Rows: CcrsIssueRow[] = [];
  // S-10: a lot with NO assigned ccrs_inventory_external_id is withheld, never
  // given an id invented at export time (standing rule 3). Every receiving-
  // intake and Cultivera-import lot is assigned one when it is created, so this
  // only fires on an anomaly — exactly the lot an employee must look at.
  const e3Rows: CcrsIssueRow[] = [];
  // S-11: lots the ledger routing refuses (uncertain / deleted / unknown id, or
  // a filed lot whose filed product cannot be proven) — never guessed at.
  const e41Rows: CcrsIssueRow[] = [];
  for (const l of lots) {
    const ext = assignedInventoryExternalId(l);
    if (!ext) {
      e3Rows.push({
        id: l.id,
        label: l.lot_code ?? l.product_name ?? l.id,
        detail: "No CCRS inventory identifier is assigned to this lot.",
      });
      continue;
    }
    const key = (l.pos_product_key ?? "").trim();
    const planned = plan.lots.get(l.id);
    if (!planned) throw new Error(`S-11 invariant: lot ${l.id} has no ledger plan`);
    if (planned.action === "withhold") {
      e41Rows.push({ id: l.id, label: l.lot_code ?? ext, detail: planned.reason });
      continue;
    }
    // S-11: the Strain cell carries the ONE spelling the plan chose (the filed
    // casing when CCRS has it) — Valid Values: Strain.Strain [G L0552].
    const strain = planned.strain;
    // CCRS joins Inventory.Product -> Product.Name by the EXACT name string
    // (NOT by ExternalIdentifier) [G L0580-L0583]. For a lot CCRS already
    // holds, that is the name its FILED product carries; otherwise the Name
    // buildProductFile wrote. See docs/CCRS_PRODUCT_NAMING_RESEARCH.md.
    const productName = planned.productName;
    if (!productName) {
      warnings.push(
        `Lot ${l.id}: no matching Product.Name for key "${key}" — Inventory.Product would be blank/invalid. Ensure the product is in the published menu.`,
      );
    }
    const area = l.status === "quarantine" || l.status === "recalled" ? "Quarantine" : "Sales Floor";
    const totalCostMinor = (l.unit_cost_minor_units ?? 0) * (l.received_qty ?? 0);

    // E7 [G L0614] / E8 [G L0597]. The decision lives in the pure core so it is
    // unit-tested directly; a failing row is WITHHELD because CCRS rejects
    // that row, tells us only by email [FAQ L0102], and every later row that
    // references it fails too (CCRS accepts row-by-row: U-17 CLOSED FALSE,
    // PREprod P20261005A/P20261006A, Brian A24).
    const initialQty = l.received_qty ?? 0;
    const onHandQty = l.on_hand_qty ?? 0;
    const verdict = inventoryRowVerdict({
      id: l.id,
      label: l.lot_code ?? ext,
      initialQty,
      onHandQty,
      totalCostMinorUnits: totalCostMinor,
      isSample: l.is_sample === true,
    });
    if (!verdict.emit) {
      if (verdict.code === "E8_ONHAND_GT_INITIAL") e8Rows.push(verdict.row);
      else e7Rows.push(verdict.row);
      continue;
    }

    rows.push([
      license,
      strain,
      area,
      productName,
      String(l.received_qty ?? 0),
      String(l.on_hand_qty ?? 0),
      verdict.totalCost,
      "FALSE", // IsMedical — medical exemptions are tracked per-sale, not per-lot
      ext,
      createdBy,
      // SLICE 2 — report the day the lot was ACTUALLY received when we can
      // evidence it. This used to be `ccrsDate(l.created_at)` unconditionally;
      // for a lot whose POS export had a blank Received date, created_at is
      // the instant the migration ran, so the LCB was being told the lot was
      // created on import day. ccrsInventoryCreatedDate() prefers the
      // evidenced received_on and falls back to created_at only when the date
      // is genuinely unknown — and those lots are flagged for the owner rather
      // than quietly given a manufactured date.
      //
      // This is a no-op for the ~3,977 lots that DID carry a received date:
      // SLICE 1 already set their created_at to noon UTC on that same day, so
      // the emitted MM/DD/YYYY is byte-identical.
      ccrsDate(ccrsInventoryCreatedDate(l)),
      "",
      "",
      planned.op,
    ]);
    // S-10: filed ids carry dots (4,295 in the LCB delivery) and are legal
    // [G L0224]; only CSV-breaking characters and > 100 chars are flagged.
    const idErrs = validatePassThroughExternalId(ext);
    if (idErrs.length) warnings.push(`Inventory id "${ext}" ${idErrs.join(", ")}.`);
  }
  if (rows.length === 0) warnings.push("No inventory lots found to report.");
  const issues: CcrsSyncIssue[] = [];
  if (e3Rows.length > 0) {
    issues.push({
      severity: "error",
      file: "Inventory",
      code: "E3_EXTERNAL_ID_UNASSIGNED",
      specPin: specPinFor("E3_EXTERNAL_ID_UNASSIGNED"),
      count: e3Rows.length,
      rows: e3Rows,
      message: `${e3Rows.length} lot(s) have no CCRS inventory identifier assigned, so they were left out of Inventory.csv. ExternalIdentifier is required on every row [G L0224-L0225]. Open each lot and enter the identifier it was filed under in CCRS (for stock Cultivera reported, that is the barcode exactly as printed), then rebuild.`,
    });
  }
  if (e41Rows.length > 0) {
    issues.push({
      severity: "error",
      file: "Inventory",
      code: "E41_LEDGER_WITHHELD",
      specPin: specPinFor("E41_LEDGER_WITHHELD"),
      count: e41Rows.length,
      rows: e41Rows,
      message: `${e41Rows.length} lot(s) were left out of Inventory.csv because we cannot prove what CCRS holds for them. Insert creates a record and Update alters "an existing record indicated by external identifier" [G L0246-L0248], so sending either on a guess risks a rejected file. Each row says why; reconcile it, then rebuild.`,
    });
  }
  if (e8Rows.length > 0) {
    issues.push({
      severity: "error",
      file: "Inventory",
      code: "E8_ONHAND_GT_INITIAL",
      specPin: specPinFor("E8_ONHAND_GT_INITIAL"),
      count: e8Rows.length,
      rows: e8Rows,
      message: `${e8Rows.length} lot(s) report more on hand than were ever received. CCRS rejects the Inventory file with "QuanityOnHand is greater than InitialQuantity" [G L0597]. Recount the lot or correct the received quantity, then rebuild.`,
    });
  }
  if (e7Rows.length > 0) {
    issues.push({
      severity: "error",
      file: "Inventory",
      code: "E7_TOTALCOST_ZERO",
      specPin: specPinFor("E7_TOTALCOST_ZERO"),
      count: e7Rows.length,
      rows: e7Rows,
      message: `${e7Rows.length} lot(s) have no cost, so TotalCost would be 0 and CCRS rejects the Inventory file ("TotalCost cannot equal 0" [G L0614]). Enter the unit cost on each lot. A vendor TRADE SAMPLE should be marked as a sample instead — it reports $0.01 [FAQ L0035].`,
    });
  }
  return { rows, warnings: [...new Set(warnings)], issues };
}

// ---------------------------------------------------------------------------
// The full batch
// ---------------------------------------------------------------------------

export async function buildCcrsBatch(
  fromISO: string,
  toISO: string,
  opts: { env?: LedgerEnv } = {},
): Promise<CcrsBatch> {
  const env: LedgerEnv = opts.env ?? "prod";
  const license = await getCcrsLicenseSettings();
  const submittedBy = license.submittedBy || "Greenway";
  const createdBy = submittedBy;
  const now = new Date();
  const createdDate = ccrsDate(now);
  const syncIssues: CcrsSyncIssue[] = [];

  const emptyBatch = (): CcrsBatch => ({
    licenseNumber: license.licenseNumber,
    submittedBy,
    fromISO,
    toISO,
    files: [],
    syncIssues,
    totalRecords: 0,
    generatedAt: now.toISOString(),
    ledger: { env, view: null, absentReason: "not-configured", lastStamp: null, unassignedProductKeys: [] },
  });

  if (!license.licenseNumber) {
    syncIssues.push({
      severity: "error",
      file: "General",
      message: "License number is not set. Add it in Compliance settings before generating a batch.",
    });
  }

  if (!isSupabaseServiceConfigured) {
    syncIssues.push({ severity: "error", file: "General", message: "Supabase is not configured." });
    return emptyBatch();
  }

  const admin = createSupabaseAdminClient();

  // --- Master data (published menu + inventory lots) ------------------------
  const versionId = await getPublishedVersionId(admin);
  let items: MenuItemRow[] = [];
  if (versionId) {
    const { data } = await admin
      .from("menu_items")
      .select(
        "source_item_id, name, strain_name, strain_type, pos_inventory_type, pos_inventory_category, description, brand_name, vendor_name, category, total_thc_json, total_cbd_json, compounds_json",
      )
      .eq("menu_version_id", versionId)
      .eq("hidden", false);
    items = (data as MenuItemRow[] | null) ?? [];
  } else {
    syncIssues.push({
      severity: "warning",
      file: "Product",
      message: "No published menu version — Strain/Product files will be empty.",
    });
  }
  const itemsByKey = new Map(items.map((i) => [i.source_item_id.trim(), i]));

  // SLICE 2: paged. `.limit(5000)` did NOT raise the PostgREST 1,000-row cap,
  // so with 4,179 lots the Inventory.csv filed with the WA LCB contained the
  // first 1,000 lots and silently omitted the rest. That is an incomplete
  // state traceability filing, which is why this is fixed in the same slice
  // as the received date. (Selecting `received_on` for CreatedDate.)
  const lots = await pagedAll<LotRow>(async (from, to) => {
    const { data } = await admin
      .from("inventory_lots")
      .select(
        "id, lot_code, pos_product_key, product_name, ccrs_inventory_external_id, received_qty, on_hand_qty, unit_cost_minor_units, unit_weight, unit_weight_uom, status, created_at, received_on, is_sample",
      )
      .neq("status", "destroyed")
      .order("id", { ascending: true })
      .range(from, to);
    return (data as LotRow[] | null) ?? [];
  });
  const hasQuarantine = lots.some((l) => l.status === "quarantine" || l.status === "recalled");

  // --- Build each master-data file ------------------------------------------
  // S-11: one pure plan routes every Strain/Product/Inventory row against the
  // ledger (what CCRS already holds). S-12b loads it: ccrs_ledger_slice returns
  // the entries for exactly these lots and product names (Part 03 §D.3). While
  // the 0248 migration is not applied or the seed is not finalized the slice
  // is "absent", `ledger` is null and the plan reproduces the pre-S-11 rows
  // (every row Insert, our ids). Any other failure THROWS: routing against a
  // partial ledger could turn an Update into an Insert.
  const productBuild = buildProductFile(items, lots, license.licenseNumber, createdBy, createdDate);
  const slice = await loadLedgerForBatch(
    admin,
    env,
    lots.map((l) => assignedInventoryExternalId(l)).filter((x): x is string => !!x),
    [...productBuild.nameByProductKey.values()],
  );
  const ledger: LedgerView | null = slice.kind === "loaded" ? slice.ledger.view : null;
  if (slice.kind === "loaded" && slice.ledger.duplicates.length > 0) {
    syncIssues.push({
      severity: "error",
      file: "General",
      message: `The CCRS ledger holds ${slice.ledger.duplicates.length} duplicate record(s). Routing cannot prove which one CCRS holds; reconcile the ledger before exporting.`,
      count: slice.ledger.duplicates.length,
      rows: slice.ledger.duplicates.map((d) => ({ id: d, label: d, detail: "duplicate ledger record" })),
    });
  }
  const plan = planLedgerBatch({
    view: ledger,
    lots: lots
      .map((l) => ({ l, ext: assignedInventoryExternalId(l) }))
      .filter((x): x is { l: LotRow; ext: string } => !!x.ext)
      .map(({ l, ext }) => {
        const key = (l.pos_product_key ?? "").trim();
        return {
          lotId: l.id,
          label: l.lot_code ?? ext,
          inventoryExternalId: ext,
          productKey: key,
          strain: ((key ? itemsByKey.get(key) : undefined)?.strain_name ?? "").trim(),
        };
      }),
    products: productBuild.keys.map((key, i) => ({
      key,
      legacyId: productBuild.rows[i][CCRS_COLUMNS.Product.indexOf("ExternalIdentifier")],
      ourName: productBuild.nameByProductKey.get(key) ?? "",
    })),
    strains: items.map((it) => (it.strain_name ?? "").trim()).filter(Boolean),
  });
  const strain = buildStrainFile(items, license.licenseNumber, submittedBy, createdBy, createdDate, plan);
  const area = buildAreaFile(hasQuarantine, license.licenseNumber, createdBy, createdDate, ledger);
  const product = { ...productBuild, ...applyProductPlan(productBuild.rows, productBuild.keys, plan) };
  const inventory = buildInventoryFile(lots, license.licenseNumber, createdBy, plan);
  if (product.withheld.length > 0) {
    syncIssues.push({
      severity: "error",
      file: "Product",
      code: "E41_LEDGER_WITHHELD",
      specPin: specPinFor("E41_LEDGER_WITHHELD"),
      count: product.withheld.length,
      rows: product.withheld.map((w) => ({ id: w.key, label: w.label, detail: w.reason })),
      message: `${product.withheld.length} product(s) were left out of Product.csv because no CCRS Product id is assigned or its CCRS status is unproven [G L0246-L0248]. Lots of these products are withheld from Inventory.csv too.`,
    });
  }
  if (plan.nameFromLedger.length > 0) {
    syncIssues.push({
      severity: "warning",
      file: "Inventory",
      code: "E40_PRODUCT_NAME_FROM_LEDGER",
      specPin: specPinFor("E40_PRODUCT_NAME_FROM_LEDGER"),
      count: plan.nameFromLedger.length,
      rows: plan.nameFromLedger.map((n) => ({ id: n.lotId, label: n.label, detail: `ours "${n.ours}" → filed "${n.filed}"` })),
      message: `${plan.nameFromLedger.length} lot(s) are already filed in CCRS under a product whose name differs from ours. Inventory must name the product "in the same format and spelling as previously submitted" [G L0580-L0583], so the filed name was used. To change the name in CCRS, choose Rename for that product.`,
    });
  }

  // S-02: coded, pinned pre-flight errors from the master-data builders. These
  // are BLOCKING — the submit gate refuses to build the zip while any remain,
  // because CCRS rejects each bad row (row-by-row acceptance, U-17 CLOSED
  // FALSE), tells us only by email [FAQ L0102], and dependent rows then fail.
  syncIssues.push(...strain.issues, ...product.issues, ...inventory.issues);

  // --- Reuse mature builders for Adjustment + Sale --------------------------
  const [adj, sale] = await Promise.all([
    buildCcrsInventoryAdjustmentCsv(fromISO, toISO),
    buildCcrsSaleCsv(fromISO, toISO),
  ]);

  const files: CcrsFile[] = [];
  const push = (
    type: CcrsRetailerFileType,
    rawRows: string[][],
    warnings: string[],
    skipped = 0,
  ) => {
    // S-09 E38 / S-09b E42-E44: CCRS splits every row on every comma and does
    // not honour quoting (PREprod P20261005A). Free-text columns are rewritten
    // (`,`→`;`, `"`→`'`, reported); a line break, or a comma/quote in any other
    // column, withholds the row (never silently dropped, never sent shifted).
    // A product withheld for its Name also withholds its lots: the same Name
    // sits in Inventory.Product, so those rows are caught here too.
    const e38 = withholdUnencodableRows(
      rawRows,
      CCRS_COLUMNS[type],
      (r, i) => {
        const ext = CCRS_COLUMNS[type].indexOf("ExternalIdentifier");
        const name = CCRS_COLUMNS[type].indexOf(type === "Strain" ? "Strain" : type === "Area" ? "Area" : "Name");
        return (ext >= 0 && r[ext]) || (name >= 0 && r[name]) || `row ${i + 1}`;
      },
      CCRS_FREE_TEXT_COLUMNS[type] ?? [],
    );
    const rows = e38.rows;
    for (const reason of ["line break", "comma"] as const) {
      const these = e38.withheld.filter((w) => w.reason === reason);
      if (these.length === 0) continue;
      const code = CCRS_UNENCODABLE_CODE[reason];
      syncIssues.push({
        severity: "error",
        file: type,
        code,
        specPin: specPinFor(code),
        count: these.length,
        rows: these.map((w) => ({ id: w.label, label: w.label, detail: `${w.column} contains a ${reason}` })),
        message: unencodableMessage(type, these),
      });
    }
    if (e38.rewritten.length > 0) {
      syncIssues.push({
        severity: "warning",
        file: type,
        code: "E44_FREE_TEXT_REWRITTEN",
        specPin: specPinFor("E44_FREE_TEXT_REWRITTEN"),
        count: e38.rewritten.length,
        rows: e38.rewritten.map((w) => ({ id: w.label, label: w.label, detail: `${w.column}: "${w.before}" → "${w.after}"` })),
        message: freeTextRewriteMessage(type, e38.rewritten),
      });
    }
    files.push({
      type,
      group: uploadGroupOf(type),
      fileName: ccrsFileName(type, license.licenseNumber, now),
      csv: assembleCcrsFile({ type, submittedBy, submittedDate: now, rows }),
      recordCount: rows.length,
      skipped: skipped + e38.withheld.length,
      warnings,
      empty: rows.length === 0,
    });
  };

  push("Strain", strain.rows, strain.warnings);
  push("Area", area.rows, area.warnings);
  push("Product", product.rows, product.warnings);
  push("Inventory", inventory.rows, inventory.warnings);

  // Adjustment + Sale come pre-assembled by their own builders; adopt their CSV.
  files.push({
    type: "InventoryAdjustment",
    group: uploadGroupOf("InventoryAdjustment"),
    fileName: adj.fileName,
    csv: adj.csv,
    recordCount: adj.recordCount,
    skipped: adj.skipped,
    warnings: adj.warnings,
    empty: adj.recordCount === 0,
  });
  // InventoryTransfer: only the RECEIVING licensee submits it; retail intake is
  // reported via Inventory.csv. We emit an empty, correctly-shaped file and note
  // it so staff know it is intentionally empty for a retailer.
  push("InventoryTransfer", [], [
    "InventoryTransfer is submitted by the receiving licensee; retail intake is reported via Inventory.csv. This file is intentionally empty.",
  ]);
  files.push({
    type: "Sale",
    group: uploadGroupOf("Sale"),
    fileName: sale.fileName,
    csv: sale.csv,
    recordCount: sale.recordCount,
    skipped: sale.skipped,
    warnings: sale.warnings,
    empty: sale.recordCount === 0,
  });

  // Order files by upload group (1 → 2 → 3), preserving intra-group order.
  const order = new Map(CCRS_UPLOAD_ORDER.map((t, i) => [t, i]));
  files.sort((a, b) => (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99));

  // --- Sync / data-integrity analysis (flag out-of-sync BEFORE upload) ------
  // S-10: same rule as buildInventoryFile's E3 — an unassigned id is missing,
  // whatever could be minted for it.
  const lotsMissingId = lots.filter((l) => !assignedInventoryExternalId(l)).length;
  if (lotsMissingId > 0) {
    syncIssues.push({
      severity: "error",
      file: "Inventory",
      message: "Inventory lots have no usable CCRS external identifier and cannot be reported.",
      count: lotsMissingId,
    });
  }

  // Products referenced by lots but absent from the published menu (Product.csv
  // won't contain them → Inventory.Product reference would be invalid).
  const productExtInFile = new Set(product.rows.map((r) => r[6]));
  const orphanLotProducts = new Set<string>();
  for (const l of lots) {
    const ext = sanitizeExternalId((l.pos_product_key ?? "").trim());
    if (ext && !productExtInFile.has(ext)) orphanLotProducts.add(ext);
  }
  if (orphanLotProducts.size > 0) {
    syncIssues.push({
      severity: "warning",
      file: "Product",
      message: "Inventory lots reference products not present in the published menu (Product.csv).",
      count: orphanLotProducts.size,
    });
  }

  // Slice 96: numeric-column safety on the EMITTED Sale rows. Parse the assembled
  // Sale csv's data rows (skip the 3-row header + column row) and flag any
  // negative/NaN/mis-formatted Quantity or money value. Defense-in-depth — the
  // builder already skips bad lines, but this guarantees the file the LCB sees is
  // numerically sound. Never rewrites values.
  const saleFile = files.find((f) => f.type === "Sale");
  if (saleFile && saleFile.recordCount > 0) {
    const saleLines = saleFile.csv.replace(/\r\n$/, "").split("\r\n").slice(4);
    const saleRows = saleLines.map((l) => splitCsvLine(l));
    for (const p of verifySaleNumericColumns(saleRows)) {
      syncIssues.push({ severity: p.severity, file: "Sale", message: p.message });
    }
  }

  // Carry each file's own warnings up as sync issues with HONEST severity
  // (Slice 93). S-12b: no cap — "no caps; every finding is recorded" (Part 05
  // §H). A capped list hides findings from the operator and from the issues
  // stored with the emitted file (ccrs_file_issues).
  for (const f of files) {
    for (const w of f.warnings) {
      syncIssues.push({ severity: classifyWarning(w), file: f.type, message: w });
    }
  }

  const totalRecords = files.reduce((a, f) => a + f.recordCount, 0);

  return {
    licenseNumber: license.licenseNumber,
    submittedBy,
    fromISO,
    toISO,
    files,
    syncIssues,
    totalRecords,
    generatedAt: now.toISOString(),
    ledger: {
      env,
      view: ledger,
      absentReason: slice.kind === "loaded" ? null : slice.reason,
      lastStamp: slice.kind === "loaded" && slice.ledger.lastStamp ? slice.ledger.lastStamp.toISOString() : null,
      unassignedProductKeys: [...plan.products]
        .filter(([, pp]) => pp.action === "withhold" && pp.reason === NO_PRODUCT_ID_REASON)
        .map(([k]) => k)
        .sort(),
    },
  };
}
