#!/usr/bin/env tsx
/**
 * scripts/pos/transform_pos_data.ts
 *
 * CLI wrapper around the reusable transform pipeline in src/lib/pos/transform.ts.
 *
 * This script owns ONLY the filesystem concerns:
 *   - locating the raw workbooks under pos-data/raw/
 *   - reading them into buffers
 *   - calling transformWorkbooks() (the single source of truth)
 *   - writing the generated JSON, diagnostics, summary, and review spreadsheet
 *
 * All transform logic lives in src/lib/pos/transform.ts so the EXACT same
 * behaviour runs in the Supabase-backed admin import flow (Slice 2).
 *
 * Run: npm run transform:pos
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import {
  transformWorkbooks,
  type GreenwayMenuItem,
  type ReviewRow,
  type VendorEntry,
  type Diagnostic,
} from "../../src/lib/pos/transform";

const ROOT = process.cwd();
const POS_ROOT = path.join(ROOT, "pos-data");
const RAW_DIR = path.join(POS_ROOT, "raw");
const GENERATED_DIR = path.join(POS_ROOT, "generated");
const PRODUCTS_PATH = path.join(RAW_DIR, "PRODUCTS.xlsx");
const INVENTORIES_PATH = path.join(RAW_DIR, "INVENTORIES.xlsx");
const OUT_FULL = path.join(ROOT, "src", "data", "pos-menu-preview.json");
const OUT_SAMPLE = path.join(ROOT, "src", "data", "pos-menu-sample-preview.json");
const OUT_VENDORS = path.join(ROOT, "src", "data", "vendors.json");

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath: string, data: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeReviewSpreadsheet(rows: ReviewRow[], filePath: string) {
  if (rows.length === 0) {
    console.log("No hidden items to write to review spreadsheet.");
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 18 }, { wch: 40 }, { wch: 20 }, { wch: 16 }, { wch: 28 }, { wch: 20 },
    { wch: 10 }, { wch: 24 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 30 },
    { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 60 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hidden Items Review");
  XLSX.writeFile(wb, filePath);
  console.log(`Wrote ${rows.length} hidden items to review spreadsheet: ${path.relative(ROOT, filePath)}`);
}

function rawWorkbooksAvailable() {
  return fs.existsSync(PRODUCTS_PATH) && fs.existsSync(INVENTORIES_PATH);
}

function main() {
  ensureDir(GENERATED_DIR);

  if (!rawWorkbooksAvailable()) {
    const missing = [
      fs.existsSync(PRODUCTS_PATH) ? null : path.relative(ROOT, PRODUCTS_PATH),
      fs.existsSync(INVENTORIES_PATH) ? null : path.relative(ROOT, INVENTORIES_PATH),
    ].filter(Boolean);
    if (fs.existsSync(OUT_FULL)) {
      console.log(`POS raw workbook(s) missing (${missing.join(", ")}); using committed ${path.relative(ROOT, OUT_FULL)} without regenerating.`);
      return;
    }
    throw new Error(`Required POS workbook(s) not found: ${missing.join(", ")}. Add raw files locally under pos-data/raw/ or commit generated menu JSON before building.`);
  }

  const productsBuffer = fs.readFileSync(PRODUCTS_PATH);
  const inventoriesBuffer = fs.readFileSync(INVENTORIES_PATH);

  const result = transformWorkbooks({
    productsBuffer,
    inventoriesBuffer,
    productsSheet: "Sheet1",
    inventoriesSheet: "Inventories",
  });

  writeJson(path.join(GENERATED_DIR, "anomaly-report.json"), result.diagnostics);
  writeJson(path.join(GENERATED_DIR, "transform-summary.json"), result.summary);
  writeReviewSpreadsheet(result.reviewRows, path.join(GENERATED_DIR, "hidden-items-review.xlsx"));

  if (!result.ok) {
    const errors = result.diagnostics.filter((d: Diagnostic) => d.severity === "error");
    console.error(`Transformer found ${errors.length} error(s). See pos-data/generated/anomaly-report.json.`);
    process.exit(1);
  }

  writeJson(OUT_FULL, result.items);
  writeJson(OUT_SAMPLE, result.sampleItems);
  writeJson(OUT_VENDORS, result.vendors);

  const totalVariants = result.items.reduce((sum: number, item: GreenwayMenuItem) => sum + item.variants.length, 0);
  const hiddenCount = result.items.filter((i: GreenwayMenuItem) => i.hidden).length;
  const vendorCount = (result.vendors as VendorEntry[]).length;
  console.log(`Wrote ${vendorCount} distinct vendors to ${path.relative(ROOT, OUT_VENDORS)}.`);
  console.log(`Generated ${result.items.length} menu items with ${totalVariants} variants (${hiddenCount} hidden).`);
  console.log(`Diagnostics: ${result.diagnosticCounts.total} total (${result.diagnosticCounts.warnings} warnings, ${result.diagnosticCounts.info} info).`);
}

main();
