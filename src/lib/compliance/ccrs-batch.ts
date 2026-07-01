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
import {
  assembleCcrsFile,
  ccrsDate,
  ccrsFileName,
  CCRS_UPLOAD_ORDER,
  uploadGroupOf,
  normalizeStrainType,
  validateProductClassification,
  clampText,
  classifyWarning,
  CCRS_PRODUCT_NAME_MAX,
  CCRS_PRODUCT_DESCRIPTION_MAX,
  type CcrsRetailerFileType,
} from "@/lib/compliance/ccrs-batch-core";
import { deriveInventoryExternalId, validateExternalId, sanitizeExternalId } from "@/lib/compliance/ccrs-identifiers";
import { getCcrsLicenseSettings, buildCcrsSaleCsv } from "@/lib/compliance/ccrs-sales";
import { buildCcrsInventoryAdjustmentCsv } from "@/lib/compliance/ccrs-inventory-adjustment";

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
};

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
};

// ---------------------------------------------------------------------------
// Per-file generators for the master-data files (Strain / Area / Product /
// Inventory). Adjustment + Sale reuse the existing mature builders.
// ---------------------------------------------------------------------------

/** grams from a unit_weight + uom (g default). Returns "" when unknown. */
function toGrams(weight: number | null, uom: string | null): string {
  if (weight == null || !Number.isFinite(weight)) return "";
  const u = (uom ?? "g").toLowerCase();
  const g = u === "mg" ? weight / 1000 : u === "oz" ? weight * 28.3495 : weight;
  return (Math.round(g * 1000) / 1000).toString();
}

function buildStrainFile(
  items: MenuItemRow[],
  license: string,
  submittedBy: string,
  createdBy: string,
  createdDate: string,
): { rows: string[][]; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const rows: string[][] = [];
  const defaulted: string[] = [];
  for (const it of items) {
    const strain = (it.strain_name ?? "").trim();
    if (!strain) continue;
    const key = strain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
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
  return { rows, warnings };
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
): { rows: string[][]; warnings: string[] } {
  const rows: string[][] = [];
  rows.push([license, "Sales Floor", "FALSE", "AREA-SALES-FLOOR", createdBy, createdDate, "", "", "Insert"]);
  if (hasQuarantine) {
    rows.push([license, "Quarantine", "TRUE", "AREA-QUARANTINE", createdBy, createdDate, "", "", "Insert"]);
  }
  return { rows, warnings: [] };
}

function buildProductFile(
  items: MenuItemRow[],
  lots: LotRow[],
  license: string,
  createdBy: string,
  createdDate: string,
): { rows: string[][]; warnings: string[] } {
  const warnings: string[] = [];
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
  const rows: string[][] = [];
  for (const it of items) {
    const key = (it.source_item_id ?? "").trim();
    if (!key) continue;
    const ext = sanitizeExternalId(key);
    if (!ext || seen.has(ext)) continue;
    seen.add(ext);
    const rawCategory = (it.pos_inventory_category ?? "").trim();
    const rawType = (it.pos_inventory_type ?? "").trim();
    const grams = weightByKey.get(key) ?? "";
    const productName = (it.name ?? "").trim();

    // C1: validate the category/type against the CCRS enum. DRAFTS-ONLY policy —
    // we KEEP the POS-supplied values (canonicalized when valid) and never invent
    // a value. Invalid pairs raise an ERROR-level warning so the employee fixes
    // the mapping before submitting.
    const cls = validateProductClassification(rawCategory, rawType);
    let category = rawCategory;
    let type = rawType;
    if (cls.ok) {
      category = cls.category;
      type = cls.type;
    } else {
      warnings.push(`ERROR — Product "${productName || ext}": ${cls.error} Fix the CCRS mapping (Inventory types) before submitting.`);
    }

    // C2: clamp Name (75) and Description (250); flag truncation (don't silently cut).
    const nameClamp = clampText(productName, CCRS_PRODUCT_NAME_MAX);
    if (nameClamp.truncated) {
      warnings.push(`Product "${productName.slice(0, 40)}…": Name exceeds ${CCRS_PRODUCT_NAME_MAX} chars and was truncated — shorten it in the source.`);
    }
    const descClamp = clampText(it.description, CCRS_PRODUCT_DESCRIPTION_MAX);
    if (descClamp.truncated) {
      warnings.push(`Product "${productName || ext}": Description exceeds ${CCRS_PRODUCT_DESCRIPTION_MAX} chars and was truncated — shorten it in the source.`);
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
  }
  if (rows.length === 0) warnings.push("No products found in the published menu.");
  // Cap the warning noise (errors first so critical mapping issues aren't buried).
  const unique = [...new Set(warnings)];
  const errorsFirst = [
    ...unique.filter((w) => w.startsWith("ERROR")),
    ...unique.filter((w) => !w.startsWith("ERROR")),
  ];
  const dedupWarnings = errorsFirst.slice(0, 30);
  return { rows, warnings: dedupWarnings };
}

function buildInventoryFile(
  lots: LotRow[],
  itemsByKey: Map<string, MenuItemRow>,
  license: string,
  createdBy: string,
): { rows: string[][]; warnings: string[] } {
  const warnings: string[] = [];
  const rows: string[][] = [];
  for (const l of lots) {
    const ext = deriveInventoryExternalId({
      ccrs_inventory_external_id: l.ccrs_inventory_external_id,
      lot_code: l.lot_code,
      pos_product_key: l.pos_product_key,
      id: l.id,
    });
    if (!ext) {
      warnings.push(`Lot ${l.id} has no usable external identifier and was skipped.`);
      continue;
    }
    const item = l.pos_product_key ? itemsByKey.get(l.pos_product_key.trim()) : undefined;
    const strain = (item?.strain_name ?? "").trim();
    const productExt = sanitizeExternalId((l.pos_product_key ?? "").trim());
    const area = l.status === "quarantine" || l.status === "recalled" ? "Quarantine" : "Sales Floor";
    const totalCostMinor = (l.unit_cost_minor_units ?? 0) * (l.received_qty ?? 0);
    rows.push([
      license,
      strain,
      area,
      productExt,
      String(l.received_qty ?? 0),
      String(l.on_hand_qty ?? 0),
      (Math.max(0, totalCostMinor) / 100).toFixed(2),
      "FALSE", // IsMedical — medical exemptions are tracked per-sale, not per-lot
      ext,
      createdBy,
      ccrsDate(l.created_at),
      "",
      "",
      "Insert",
    ]);
    const idErrs = validateExternalId(ext);
    if (idErrs.length) warnings.push(`Inventory id "${ext}" ${idErrs.join(", ")}.`);
  }
  if (rows.length === 0) warnings.push("No inventory lots found to report.");
  return { rows, warnings: [...new Set(warnings)].slice(0, 25) };
}

// ---------------------------------------------------------------------------
// The full batch
// ---------------------------------------------------------------------------

export async function buildCcrsBatch(fromISO: string, toISO: string): Promise<CcrsBatch> {
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
        "source_item_id, name, strain_name, strain_type, pos_inventory_type, pos_inventory_category, description",
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

  const { data: lotData } = await admin
    .from("inventory_lots")
    .select(
      "id, lot_code, pos_product_key, product_name, ccrs_inventory_external_id, received_qty, on_hand_qty, unit_cost_minor_units, unit_weight, unit_weight_uom, status, created_at",
    )
    .neq("status", "destroyed")
    .limit(5000);
  const lots = (lotData as LotRow[] | null) ?? [];
  const hasQuarantine = lots.some((l) => l.status === "quarantine" || l.status === "recalled");

  // --- Build each master-data file ------------------------------------------
  const strain = buildStrainFile(items, license.licenseNumber, submittedBy, createdBy, createdDate);
  const area = buildAreaFile(hasQuarantine, license.licenseNumber, createdBy, createdDate);
  const product = buildProductFile(items, lots, license.licenseNumber, createdBy, createdDate);
  const inventory = buildInventoryFile(lots, itemsByKey, license.licenseNumber, createdBy);

  // --- Reuse mature builders for Adjustment + Sale --------------------------
  const [adj, sale] = await Promise.all([
    buildCcrsInventoryAdjustmentCsv(fromISO, toISO),
    buildCcrsSaleCsv(fromISO, toISO),
  ]);

  const files: CcrsFile[] = [];
  const push = (
    type: CcrsRetailerFileType,
    rows: string[][],
    warnings: string[],
    skipped = 0,
  ) => {
    files.push({
      type,
      group: uploadGroupOf(type),
      fileName: ccrsFileName(type, license.licenseNumber, now),
      csv: assembleCcrsFile({ type, submittedBy, submittedDate: now, rows }),
      recordCount: rows.length,
      skipped,
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
  const lotsMissingId = lots.filter(
    (l) =>
      !deriveInventoryExternalId({
        ccrs_inventory_external_id: l.ccrs_inventory_external_id,
        lot_code: l.lot_code,
        pos_product_key: l.pos_product_key,
        id: l.id,
      }),
  ).length;
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

  // Carry each file's own warnings up as sync issues with HONEST severity
  // (Slice 93). Batch-blocking messages (invalid enum, missing id, etc.) become
  // `error` and are NEVER dropped by the cap; advisory notes stay `warning` and
  // are capped per file to avoid noise.
  const WARNING_CAP_PER_FILE = 5;
  for (const f of files) {
    let warningCount = 0;
    for (const w of f.warnings) {
      const severity = classifyWarning(w);
      if (severity === "error") {
        // Always surface blocking errors — no cap.
        syncIssues.push({ severity: "error", file: f.type, message: w });
      } else if (warningCount < WARNING_CAP_PER_FILE) {
        syncIssues.push({ severity: "warning", file: f.type, message: w });
        warningCount += 1;
      }
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
  };
}
