import "server-only";

/**
 * src/lib/accounting/sage-exports.ts
 *
 * Server-side Sage 50 export pipeline. Loads back-office data (orders, lots,
 * manifests, vendor payments, adjustments, vendors) plus the owner-editable
 * Sage mapping (migration 0091) and feeds the PURE builders in
 * sage-exports-core.ts. Everything is degrade-safe: before migration 0091 is
 * applied the loaders return seeded defaults/empty sets and the UI shows
 * warnings instead of crashing.
 *
 * Scope rule (owner's directive): only data the back office actually holds
 * becomes a Sage upload. Payroll is intentionally NOT exported as PAYROLL.CSV —
 * a true payroll import needs per-pay-field amounts/accounts (fields 1–100)
 * that the back office does not capture. See docs/sage50-knowledge.md.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAll, pagedAllChecked } from "@/lib/supabase/chunked-in";
import { getTaxSettings, getCannabisCategorySet, isCannabisCategory, applyBps } from "@/lib/reports/tax";
import { preTaxLineBaseMinor } from "@/lib/reports/tax-base-core";
import { pacificDayKey } from "@/lib/reports/timezone";
import {
  type SageBucket,
  type SageCategoryAccount,
  type SageExportSettings,
  type DayBucketSales,
  type PurchaseInvoice,
  type VendorPaymentRow,
  type AdjustmentGjEntry,
  type SageVendorListRow,
  type SageCsvResult,
  DEFAULT_SAGE_EXPORT_SETTINGS,
  isSageBucket,
  isValidBucketKey,
  normalizeBucketKey,
  normalizeCategory,
  buildCashReceiptsCsv,
  buildPurchasesCsv,
  buildPaymentsCsv,
  buildAdjustmentsGjCsv,
  buildVendorListCsv,
} from "@/lib/accounting/sage-exports-core";

/**
 * SLICE 5C — memory ceiling for full-table scans in the Sage exports. NOT a row
 * cap: reaching it is REPORTED as an incomplete read (the export then warns),
 * never silently accepted — the mistake the old `.limit(20000)` made.
 */
const SAGE_SCAN_MAX_ROWS = 100_000;

export type { SageCsvResult };

export const SAGE_EXPORT_KINDS = [
  { value: "receipts", label: "Cash Receipts (daily sales + COGS)" },
  { value: "purchases", label: "Purchases (vendor invoices from manifests)" },
  { value: "payments", label: "Payments (vendor manifest payments)" },
  { value: "adjustments", label: "Inventory adjustments (General Journal)" },
  { value: "vendors", label: "Vendor list (vendors with a Sage ID)" },
] as const;
export type SageExportKind = (typeof SAGE_EXPORT_KINDS)[number]["value"];

export function isSageExportKind(v: string): v is SageExportKind {
  return SAGE_EXPORT_KINDS.some((k) => k.value === v);
}

// ---------------------------------------------------------------------------
// Loaders (degrade-safe pre-0091)
// ---------------------------------------------------------------------------

/** Load the per-bucket Sage mapping. Empty map when 0091 isn't applied yet. */
export async function getSageCategoryAccounts(): Promise<Partial<Record<SageBucket, SageCategoryAccount>>> {
  if (!isSupabaseServiceConfigured) return {};
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("sage_category_accounts")
      .select("bucket, label, sales_customer_id, cogs_customer_id, gl_sales, gl_cogs, gl_inventory, is_cannabis, active");
    if (error || !data) return {};
    const out: Partial<Record<SageBucket, SageCategoryAccount>> = {};
    for (const r of data as {
      bucket: string;
      label: string;
      sales_customer_id: string;
      cogs_customer_id: string;
      gl_sales: string;
      gl_cogs: string;
      gl_inventory: string;
      is_cannabis: boolean;
      active: boolean;
    }[]) {
      if (!r.active || !isSageBucket(r.bucket)) continue;
      out[r.bucket] = {
        bucket: r.bucket,
        label: r.label ?? "",
        salesCustomerId: r.sales_customer_id ?? "",
        cogsCustomerId: r.cogs_customer_id ?? "",
        glSales: r.gl_sales ?? "",
        glCogs: r.gl_cogs ?? "",
        glInventory: r.gl_inventory ?? "",
        isCannabis: Boolean(r.is_cannabis),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Load normalized menu category → bucket map. Empty pre-0091. */
export async function getSageCategoryMap(): Promise<Map<string, SageBucket>> {
  const map = new Map<string, SageBucket>();
  if (!isSupabaseServiceConfigured) return map;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("sage_category_map").select("source_category, bucket, active");
    if (error || !data) return map;
    for (const r of data as { source_category: string; bucket: string; active: boolean }[]) {
      if (!r.active || !isValidBucketKey(r.bucket)) continue;
      map.set(normalizeCategory(r.source_category), r.bucket);
    }
    return map;
  } catch {
    return map;
  }
}

/** Load the store-wide Sage export settings (accounting_settings, 0091 columns). */
export async function getSageExportSettings(): Promise<SageExportSettings> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_SAGE_EXPORT_SETTINGS };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("accounting_settings")
      .select(
        "gl_ap_account, gl_bank_account, gl_purchases_default, gl_cash_on_hand, gl_excise_tax_payable, gl_sales_tax_payable, sales_tax_id_cannabis, sales_tax_id_other, gl_discounts",
      )
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return { ...DEFAULT_SAGE_EXPORT_SETTINGS };
    return {
      glApAccount: data.gl_ap_account ?? "",
      glBankAccount: data.gl_bank_account ?? "",
      glPurchasesDefault: data.gl_purchases_default ?? "",
      glCashOnHand: data.gl_cash_on_hand ?? "",
      glExciseTaxPayable: data.gl_excise_tax_payable ?? "",
      glSalesTaxPayable: data.gl_sales_tax_payable ?? "",
      salesTaxIdCannabis: data.sales_tax_id_cannabis ?? "",
      salesTaxIdOther: data.sales_tax_id_other ?? "",
      glSalesDiscounts: (data as { gl_discounts?: string | null }).gl_discounts ?? "",
    };
  } catch {
    return { ...DEFAULT_SAGE_EXPORT_SETTINGS };
  }
}

/** True once migration 0091's tables/columns are reachable. */
export async function isSageMappingReady(): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("sage_category_accounts").select("bucket").limit(1);
    return !error;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** menu source_item_id → category (newest wins), same pattern as sage50.ts. */
async function buildCategoryLookup(admin: Admin): Promise<Map<string, string>> {
  const catLookup = new Map<string, string>();
  // S-7: page past the PostgREST per-response row cap.
  type MenuRow = { source_item_id: string; category: string | null };
  const rows = await pagedAll<MenuRow>(async (from, to) => {
    const { data } = await admin
      .from("menu_items")
      .select("source_item_id, category, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    return (data as MenuRow[] | null) ?? [];
  });
  for (const r of rows) {
    if (!r.source_item_id || catLookup.has(r.source_item_id)) continue;
    catLookup.set(r.source_item_id, r.category?.trim() || "");
  }
  return catLookup;
}

/** pos_product_key → weighted-average unit cost (minor units). */
async function buildCostLookup(admin: Admin): Promise<Map<string, number>> {
  // S-7: page past the PostgREST per-response row cap.
  type LotCostRow = { pos_product_key: string | null; received_qty: number | null; unit_cost_minor_units: number | null };
  const lotRows = await pagedAll<LotCostRow>(async (from, to) => {
    const { data } = await admin
      .from("inventory_lots")
      .select("pos_product_key, received_qty, unit_cost_minor_units, id")
      .order("id", { ascending: true })
      .range(from, to);
    return (data as LotCostRow[] | null) ?? [];
  });
  const num = new Map<string, number>();
  const den = new Map<string, number>();
  const simpleSum = new Map<string, number>();
  const simpleCount = new Map<string, number>();
  for (const l of lotRows) {
    const key = l.pos_product_key;
    if (!key || l.unit_cost_minor_units == null) continue;
    const qty = Number(l.received_qty ?? 0);
    if (qty > 0) {
      num.set(key, (num.get(key) ?? 0) + l.unit_cost_minor_units * qty);
      den.set(key, (den.get(key) ?? 0) + qty);
    }
    simpleSum.set(key, (simpleSum.get(key) ?? 0) + l.unit_cost_minor_units);
    simpleCount.set(key, (simpleCount.get(key) ?? 0) + 1);
  }
  const out = new Map<string, number>();
  for (const key of simpleSum.keys()) {
    const d = den.get(key) ?? 0;
    if (d > 0) out.set(key, Math.round((num.get(key) ?? 0) / d));
    else out.set(key, Math.round((simpleSum.get(key) ?? 0) / (simpleCount.get(key) || 1)));
  }
  return out;
}

/** vendor uuid → sage_vendor_id (degrade-safe pre-0091). */
async function buildVendorSageIdLookup(admin: Admin): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data, error } = await admin.from("vendors").select("id, sage_vendor_id").not("sage_vendor_id", "is", null);
    if (error || !data) return map;
    for (const v of data as { id: string; sage_vendor_id: string | null }[]) {
      if (v.sage_vendor_id?.trim()) map.set(v.id, v.sage_vendor_id.trim());
    }
    return map;
  } catch {
    return map;
  }
}

/** Resolve a menu category to a Sage bucket; collects unmapped categories. */
function resolveBucket(
  category: string,
  categoryMap: Map<string, SageBucket>,
  cannabisSet: Set<string> | null,
  unmapped: Set<string>,
  knownBuckets?: Set<string>,
): SageBucket | null {
  const norm = normalizeCategory(category);
  const mapped = categoryMap.get(norm);
  if (mapped) return mapped;
  // Identity match: a category whose slug IS a configured bucket key (covers
  // both the seven standard buckets and owner-added detailed buckets).
  const slug = normalizeBucketKey(norm);
  if (slug && (knownBuckets ? knownBuckets.has(slug) : isSageBucket(slug))) return slug;
  // Never guess a cannabis bucket. Non-cannabis is safe only when the tax
  // engine also says the category is non-cannabis.
  if (norm && !isCannabisCategory(category, cannabisSet)) {
    unmapped.add(category || "(blank)");
    return "non_cannabis";
  }
  unmapped.add(category || "(blank)");
  return null;
}

// ---------------------------------------------------------------------------
// 1) Cash Receipts export — daily category sales + tax + COGS receipts.
// ---------------------------------------------------------------------------

export async function buildSageReceiptsExport(fromISO: string, toISO: string): Promise<SageCsvResult> {
  const accounts = await getSageCategoryAccounts();
  const settings = await getSageExportSettings();
  const empty: SageCsvResult = {
    csv: "",
    fileName: "Sage50_Receipts.csv",
    transactionCount: 0,
    rowCount: 0,
    warnings: [],
  };
  if (!isSupabaseServiceConfigured) {
    return { ...buildCashReceiptsCsv([], accounts, settings), warnings: ["Supabase is not configured."] };
  }
  if (Object.keys(accounts).length === 0) {
    empty.warnings.push("Sage category mapping is empty — apply migration 0091 and configure the buckets first.");
    return empty;
  }

  const admin = createSupabaseAdminClient();
  const [tax, cannabisSet, categoryMap, catLookup, costLookup] = await Promise.all([
    getTaxSettings(),
    getCannabisCategorySet(),
    getSageCategoryMap(),
    buildCategoryLookup(admin),
    buildCostLookup(admin),
  ]);

  // S-7: paged so busy ranges post completely.
  type SageOrderRow = { id: string; status: string; placed_at: string; completed_at: string | null };
  const ordersAll = await pagedAll<SageOrderRow>(async (from, to) => {
    const { data } = await admin
      .from("orders")
      .select("id, status, placed_at, completed_at")
      .gte("placed_at", fromISO)
      .lte("placed_at", toISO)
      .order("id", { ascending: true })
      .range(from, to);
    return (data as SageOrderRow[] | null) ?? [];
  });
  const completed = ordersAll.filter((o) => o.status === "completed");
  if (completed.length === 0) {
    empty.warnings.push("No completed orders in the selected range.");
    return empty;
  }
  const dayByOrder = new Map<string, string>();
  for (const o of completed) dayByOrder.set(o.id, pacificDayKey(o.completed_at ?? o.placed_at));

  // S-7: chunked + paginated — the receipts journal must include every line.
  type SageLineRow = {
    order_id: string;
    product_id: string | null;
    quantity: number;
    price_minor_units: number;
    regular_price_minor_units: number | null;
  };
  const lines = await chunkedIn<string, SageLineRow>(
    completed.map((o) => o.id),
    async (chunk, from, to) => {
      const { data } = await admin
        .from("order_lines")
        .select("order_id, product_id, quantity, price_minor_units, regular_price_minor_units")
        .in("order_id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      return (data as SageLineRow[] | null) ?? [];
    },
  );

  const unmapped = new Set<string>();
  const knownBuckets = new Set(Object.keys(accounts));
  const byKey = new Map<string, DayBucketSales>(); // `${date}|${bucket}`
  for (const l of lines) {
    const ymd = dayByOrder.get(l.order_id);
    if (!ymd) continue;
    const qty = l.quantity ?? 0;
    if (qty <= 0) continue;
    const soldUnit = l.price_minor_units ?? 0; // tax-INCLUSIVE out-the-door unit
    if (soldUnit * qty <= 0) continue;
    const regular = l.regular_price_minor_units ?? soldUnit; // tax-INCLUSIVE

    const category = (l.product_id ? catLookup.get(l.product_id) : "") || "";
    const bucket = resolveBucket(category, categoryMap, cannabisSet, unmapped, knownBuckets);
    if (!bucket) continue;

    const acct = accounts[bucket];
    const isCannabis = acct ? acct.isCannabis : isCannabisCategory(category, cannabisSet);
    // GW-010: stored prices are tax-inclusive (migration 0007 /
    // order-pricing-core.ts) — receipts rows book the PRE-TAX base and taxes
    // computed ON that base.
    const combinedBps = tax.stateSalesRateBps + tax.localSalesRateBps;
    const base = preTaxLineBaseMinor({
      unitPriceMinorUnits: soldUnit,
      quantity: qty,
      isCannabis,
      combinedSalesRateBps: combinedBps,
      exciseRateBps: tax.exciseRateBps,
    });
    if (base <= 0) continue;
    // Discount in pre-tax terms (regular pre-tax − sold pre-tax).
    const regularBase = preTaxLineBaseMinor({
      unitPriceMinorUnits: regular,
      quantity: qty,
      isCannabis,
      combinedSalesRateBps: combinedBps,
      exciseRateBps: tax.exciseRateBps,
    });
    const discount = Math.max(0, regularBase - base);
    const excise = isCannabis ? applyBps(base, tax.exciseRateBps) : 0;
    const stateTax = applyBps(base, tax.stateSalesRateBps);
    const localTax = applyBps(base, tax.localSalesRateBps);
    const unitCost = l.product_id ? costLookup.get(l.product_id) ?? 0 : 0;

    const key = `${ymd}|${bucket}`;
    let row = byKey.get(key);
    if (!row) {
      row = { date: ymd, bucket, units: 0, salesMinor: 0, exciseMinor: 0, stateTaxMinor: 0, localTaxMinor: 0, cogsMinor: 0, discountMinor: 0 };
      byKey.set(key, row);
    }
    row.units += qty;
    row.salesMinor += base;
    row.exciseMinor += excise;
    row.stateTaxMinor += stateTax;
    row.localTaxMinor += localTax;
    row.cogsMinor += unitCost * qty;
    row.discountMinor += discount;
  }

  const result = buildCashReceiptsCsv([...byKey.values()], accounts, settings);
  if (unmapped.size > 0) {
    result.warnings.push(
      `Categories not mapped to a Sage bucket (excluded or defaulted): ${[...unmapped].sort().join(", ")}. Add them to the Sage category map.`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// 2) Purchases export — accepted inbound manifests as vendor invoices.
//    Lines are booked at the store's default purchases G/L account, matching
//    the owner's real books (every manifest line at 20009-GRNWY).
// ---------------------------------------------------------------------------

export async function buildSagePurchasesExport(fromISO: string, toISO: string): Promise<SageCsvResult> {
  const settings = await getSageExportSettings();
  const empty: SageCsvResult = { csv: "", fileName: "Sage50_Purchases.csv", transactionCount: 0, rowCount: 0, warnings: [] };
  if (!isSupabaseServiceConfigured) {
    empty.warnings.push("Supabase is not configured.");
    return empty;
  }
  const admin = createSupabaseAdminClient();
  const vendorSageIds = await buildVendorSageIdLookup(admin);

  // S-13 (GAP M-10): include BOTH accepted and partially_accepted manifests so
  // this export agrees with vendor payables (PAYABLE_MANIFEST_STATUSES in
  // vendor-ach-core.ts). For partially-accepted manifests the invoice is built
  // from the ACCEPTED lots only — rejected-at-dock lots were never received and
  // must not be booked as cost.
  // S-7: paged past the PostgREST per-response row cap.
  type ManifestRow = {
    id: string;
    manifest_number: string | null;
    vendor_id: string | null;
    vendor_label: string | null;
    transfer_date: string | null;
    status: string;
    created_at: string;
  };
  const manifests = await pagedAll<ManifestRow>(async (from, to) => {
    const { data } = await admin
      .from("inbound_manifests")
      .select("id, manifest_number, vendor_id, vendor_label, transfer_date, status, created_at")
      .in("status", ["accepted", "partially_accepted"])
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return (data as ManifestRow[] | null) ?? [];
  });
  if (manifests.length === 0) {
    empty.warnings.push("No accepted or partially-accepted manifests in the selected range.");
    return empty;
  }

  // S-7: chunked + paginated — every manifest's lots are costed.
  type ManifestLotRow = { manifest_id: string | null; product_name: string | null; received_qty: number | null; unit_cost_minor_units: number | null; disposition: string | null; status: string | null };
  const lotsData = await chunkedIn<string, ManifestLotRow>(
    manifests.map((m) => m.id),
    async (chunk, from, to) => {
      const { data } = await admin
        .from("inventory_lots")
        .select("manifest_id, product_name, received_qty, unit_cost_minor_units, disposition, status, id")
        .in("manifest_id", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      return (data as ManifestLotRow[] | null) ?? [];
    },
  );
  const lotsByManifest = new Map<string, { product_name: string | null; received_qty: number | null; unit_cost_minor_units: number | null }[]>();
  for (const l of lotsData) {
    if (!l.manifest_id) continue;
    // Accepted-lots-only cost basis: skip lots rejected at the dock (their
    // product went back on the truck — no cost was incurred).
    if (l.disposition === "rejected_at_dock" || l.status === "rejected") continue;
    const arr = lotsByManifest.get(l.manifest_id) ?? [];
    arr.push(l);
    lotsByManifest.set(l.manifest_id, arr);
  }

  const glLine = settings.glPurchasesDefault;
  const missingVendor = new Set<string>();
  const missingCost = new Set<string>();
  const invoices: PurchaseInvoice[] = [];
  for (const m of manifests) {
    const sageId = m.vendor_id ? vendorSageIds.get(m.vendor_id) : undefined;
    if (!sageId) {
      missingVendor.add(m.vendor_label || m.manifest_number || m.id.slice(0, 8));
      continue;
    }
    const lots = lotsByManifest.get(m.id) ?? [];
    const lines = lots
      .map((l) => {
        const qty = Number(l.received_qty ?? 0);
        const cost = l.unit_cost_minor_units;
        if (qty <= 0 || cost == null) {
          if (cost == null) missingCost.add(`${m.manifest_number ?? m.id.slice(0, 8)}: ${l.product_name ?? "(unnamed)"}`);
          return null;
        }
        return {
          qty,
          description: l.product_name ?? "",
          glAccount: glLine,
          unitCostMinor: cost,
          amountMinor: Math.round(cost * qty),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (lines.length === 0) continue;
    invoices.push({
      vendorSageId: sageId,
      invoiceNumber: m.manifest_number || m.id.slice(0, 8),
      date: m.transfer_date || pacificDayKey(m.created_at),
      lines,
    });
  }

  const result = buildPurchasesCsv(invoices, settings);
  if (missingVendor.size > 0) {
    result.warnings.push(
      `Manifests skipped — vendor has no Sage Vendor ID: ${[...missingVendor].sort().join(", ")}. Set it on the vendor's admin page.`,
    );
  }
  if (missingCost.size > 0) {
    result.warnings.push(`Lot lines skipped (no unit cost): ${[...missingCost].sort().slice(0, 10).join("; ")}.`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3) Payments export — vendor manifest payments applied to invoices.
// ---------------------------------------------------------------------------

export async function buildSagePaymentsExport(fromISO: string, toISO: string): Promise<SageCsvResult> {
  const settings = await getSageExportSettings();
  const empty: SageCsvResult = { csv: "", fileName: "Sage50_Payments.csv", transactionCount: 0, rowCount: 0, warnings: [] };
  if (!isSupabaseServiceConfigured) {
    empty.warnings.push("Supabase is not configured.");
    return empty;
  }
  const admin = createSupabaseAdminClient();
  const vendorSageIds = await buildVendorSageIdLookup(admin);

  // S-7: paged past the PostgREST per-response row cap.
  type PaymentRow = {
    vendor_id: string | null;
    vendor_name: string;
    manifest_number: string;
    amount_minor_units: number;
    ach_batch_ref: string | null;
    note: string | null;
    created_at: string;
  };
  const rows = await pagedAll<PaymentRow>(async (from, to) => {
    const { data } = await admin
      .from("vendor_manifest_payments")
      .select("vendor_id, vendor_name, manifest_number, amount_minor_units, ach_batch_ref, note, created_at, id")
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return (data as PaymentRow[] | null) ?? [];
  });
  if (rows.length === 0) {
    empty.warnings.push("No vendor payments in the selected range.");
    return empty;
  }

  const missingVendor = new Set<string>();
  const payments: VendorPaymentRow[] = [];
  for (const r of rows) {
    const sageId = r.vendor_id ? vendorSageIds.get(r.vendor_id) : undefined;
    if (!sageId) {
      missingVendor.add(r.vendor_name || r.manifest_number);
      continue;
    }
    payments.push({
      vendorSageId: sageId,
      checkNumber: r.ach_batch_ref ?? "",
      date: pacificDayKey(r.created_at),
      memo: r.note || `Manifest ${r.manifest_number}`,
      invoiceNumber: r.manifest_number,
      amountMinor: r.amount_minor_units,
      // ACH batch = Electronic; anything without a batch was still paid from
      // the bank account, so Electronic is the verified-safe method here.
      paymentMethod: "Electronic",
    });
  }

  const result = buildPaymentsCsv(payments, settings);
  if (missingVendor.size > 0) {
    result.warnings.push(
      `Payments skipped — vendor has no Sage Vendor ID: ${[...missingVendor].sort().join(", ")}. Set it on the vendor's admin page.`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// 4) Inventory adjustments export — balanced General Journal entries.
//    'receive' adjustments are excluded (those enter via the Purchases file).
// ---------------------------------------------------------------------------

export async function buildSageAdjustmentsExport(fromISO: string, toISO: string): Promise<SageCsvResult> {
  const accounts = await getSageCategoryAccounts();
  const empty: SageCsvResult = { csv: "", fileName: "Sage50_InventoryAdjustments_GJ.csv", transactionCount: 0, rowCount: 0, warnings: [] };
  if (!isSupabaseServiceConfigured) {
    empty.warnings.push("Supabase is not configured.");
    return empty;
  }
  if (Object.keys(accounts).length === 0) {
    empty.warnings.push("Sage category mapping is empty — apply migration 0091 and configure the buckets first.");
    return empty;
  }
  const admin = createSupabaseAdminClient();
  const [cannabisSet, categoryMap, catLookup] = await Promise.all([
    getCannabisCategorySet(),
    getSageCategoryMap(),
    buildCategoryLookup(admin),
  ]);

  // S-7: paged past the PostgREST per-response row cap.
  type AdjRow = { lot_id: string; qty_delta: number; reason: string; note: string | null; created_at: string };
  const adjustments = await pagedAll<AdjRow>(async (from, to) => {
    const { data } = await admin
      .from("inventory_adjustments")
      .select("lot_id, qty_delta, reason, note, created_at, id")
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      .neq("reason", "receive")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return (data as AdjRow[] | null) ?? [];
  });
  if (adjustments.length === 0) {
    empty.warnings.push("No inventory adjustments (excluding receives) in the selected range.");
    return empty;
  }

  // S-7: chunked + paginated — every adjusted lot resolves its cost.
  const lotIds = [...new Set(adjustments.map((a) => a.lot_id))];
  type AdjLotRow = { id: string; pos_product_key: string | null; product_name: string | null; unit_cost_minor_units: number | null };
  const lotsData = await chunkedIn<string, AdjLotRow>(lotIds, async (chunk, from, to) => {
    const { data } = await admin
      .from("inventory_lots")
      .select("id, pos_product_key, product_name, unit_cost_minor_units")
      .in("id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    return (data as AdjLotRow[] | null) ?? [];
  });
  const lotById = new Map(lotsData.map((l) => [l.id, l]));

  const unmapped = new Set<string>();
  const noCost = new Set<string>();
  const entries: AdjustmentGjEntry[] = [];
  for (const a of adjustments) {
    const lot = lotById.get(a.lot_id);
    if (!lot) continue;
    if (lot.unit_cost_minor_units == null) {
      noCost.add(lot.product_name ?? a.lot_id.slice(0, 8));
      continue;
    }
    const category = (lot.pos_product_key ? catLookup.get(lot.pos_product_key) : "") || "";
    const bucket = resolveBucket(category, categoryMap, cannabisSet, unmapped, new Set(Object.keys(accounts)));
    const acct = bucket ? accounts[bucket] : undefined;
    if (!acct || !acct.glCogs || !acct.glInventory) continue;
    const valueMinor = Math.round(Math.abs(a.qty_delta) * lot.unit_cost_minor_units);
    if (valueMinor <= 0) continue;
    entries.push({
      date: pacificDayKey(a.created_at),
      reference: `ADJ-${a.reason}`.toUpperCase().slice(0, 20),
      description: `${a.reason}: ${lot.product_name ?? ""} (${a.qty_delta > 0 ? "+" : ""}${a.qty_delta})${a.note ? ` — ${a.note}` : ""}`,
      glSource: acct.glCogs,
      glInventory: acct.glInventory,
      valueMinor,
      qtyDelta: a.qty_delta,
    });
  }

  const result = buildAdjustmentsGjCsv(entries);
  if (unmapped.size > 0) {
    result.warnings.push(`Adjustment categories not mapped to a Sage bucket: ${[...unmapped].sort().join(", ")}.`);
  }
  if (noCost.size > 0) {
    result.warnings.push(`Adjustments skipped (lot has no unit cost): ${[...noCost].sort().slice(0, 10).join("; ")}.`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 5) Vendor list export — only vendors with a Sage Vendor ID set.
// ---------------------------------------------------------------------------

export async function buildSageVendorListExport(): Promise<SageCsvResult> {
  const empty: SageCsvResult = { csv: "", fileName: "Sage50_VendorList.csv", transactionCount: 0, rowCount: 0, warnings: [] };
  if (!isSupabaseServiceConfigured) {
    empty.warnings.push("Supabase is not configured.");
    return empty;
  }
  try {
    const admin = createSupabaseAdminClient();
    // SLICE 5C — `.limit(2000)` cannot exceed the 1,000-row server cap
    // (chunked-in.ts:13-14), and the vendors table is documented at 1,775 rows
    // (docs/ROADMAP_VENDORS_AND_KB_ENRICHMENT.md:30), so this export was
    // already capable of silently omitting vendors from a file the owner hands
    // to his bookkeeper. Paged completely; an unprovable read WARNS rather than
    // shipping a quietly short CSV as if it were the whole list.
    const { rows: vendorRows, verdict } = await pagedAllChecked<Record<string, unknown>>(
      async (from, to) => {
        const { data, error } = await admin
          .from("vendors")
          .select(
            "sage_vendor_id, display_name, legal_name, email, phone, website, billing_address1, billing_address2, billing_city, billing_state, billing_zip",
          )
          .not("sage_vendor_id", "is", null)
          .order("sage_vendor_id", { ascending: true })
          // Unique tiebreak: sage_vendor_id is not guaranteed unique.
          .order("id", { ascending: true })
          .range(from, to);
        if (error) return { rows: [], ok: false };
        return { rows: (data as Record<string, unknown>[] | null) ?? [], ok: true };
      },
      { maxRows: SAGE_SCAN_MAX_ROWS },
    );
    if (!verdict.complete && vendorRows.length === 0) {
      empty.warnings.push("Vendor Sage IDs are unavailable — apply migration 0091 first.");
      return empty;
    }
    const data = vendorRows;
    const rows: SageVendorListRow[] = ((data as {
      sage_vendor_id: string | null;
      display_name: string;
      legal_name: string | null;
      email: string | null;
      phone: string | null;
      website: string | null;
      billing_address1: string | null;
      billing_address2: string | null;
      billing_city: string | null;
      billing_state: string | null;
      billing_zip: string | null;
    }[] | null) ?? [])
      .filter((v) => v.sage_vendor_id?.trim())
      .map((v) => ({
        sageVendorId: v.sage_vendor_id!.trim(),
        name: v.legal_name || v.display_name,
        contact: "",
        address1: v.billing_address1 ?? "",
        address2: v.billing_address2 ?? "",
        city: v.billing_city ?? "",
        state: v.billing_state ?? "",
        zip: v.billing_zip ?? "",
        phone: v.phone ?? "",
        email: v.email ?? "",
        website: v.website ?? "",
      }));
    const result = buildVendorListCsv(rows);
    if (rows.length === 0) {
      result.warnings.push("No vendors have a Sage Vendor ID yet — set them on each vendor's admin page.");
    }
    // SLICE 5C — never hand over a bookkeeping file that is quietly short.
    if (!verdict.complete) {
      result.warnings.push(
        `This vendor list may be INCOMPLETE — ${verdict.message} Re-run the export before sending it to your bookkeeper.`,
      );
    }
    return result;
  } catch {
    empty.warnings.push("Vendor lookup failed.");
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Mapping overview for the admin page
// ---------------------------------------------------------------------------

/** Distinct menu categories that don't resolve to a Sage bucket yet. */
export async function listUnmappedCategories(): Promise<string[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    // SLICE 5C — `.limit(20000)` on `menu_items` cannot exceed PostgREST's
    // 1,000-row cap (chunked-in.ts:13-14). The owner's own POS import stages
    // 3,333 menu items (measured, SLICE6B_DIAGNOSIS.md), so this read was
    // ALREADY truncated in production: any category that happened to appear
    // only past row 1,000 was invisible here, and an unmapped category that
    // never surfaces is revenue landing in the wrong Sage account with nothing
    // on screen to reveal it. Paged completely.
    const [categoryMap, accounts, { rows: categoryRows }] = await Promise.all([
      getSageCategoryMap(),
      getSageCategoryAccounts(),
      pagedAllChecked<{ category: string | null }>(
        async (from, to) => {
          const { data, error } = await admin
            .from("menu_items")
            .select("category")
            // Stable UNIQUE ordering — REQUIRED for deterministic paging.
            .order("id", { ascending: true })
            .range(from, to);
          if (error) return { rows: [], ok: false };
          return { rows: (data as { category: string | null }[] | null) ?? [], ok: true };
        },
        { maxRows: SAGE_SCAN_MAX_ROWS },
      ),
    ]);
    const data = categoryRows;
    const knownBuckets = new Set(Object.keys(accounts));
    const seen = new Map<string, string>(); // normalized → original casing
    for (const r of (data as { category: string | null }[] | null) ?? []) {
      const cat = r.category?.trim();
      if (!cat) continue;
      const norm = normalizeCategory(cat);
      if (categoryMap.has(norm) || knownBuckets.has(normalizeBucketKey(norm)) || isSageBucket(norm)) continue;
      if (!seen.has(norm)) seen.set(norm, cat);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** Category map entries for the admin page. */
export async function listSageCategoryMapEntries(): Promise<{ source: string; bucket: SageBucket }[]> {
  const map = await getSageCategoryMap();
  return [...map.entries()].map(([source, bucket]) => ({ source, bucket })).sort((a, b) => a.source.localeCompare(b.source));
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function buildSageExport(kind: SageExportKind, fromISO: string, toISO: string): Promise<SageCsvResult> {
  switch (kind) {
    case "receipts":
      return buildSageReceiptsExport(fromISO, toISO);
    case "purchases":
      return buildSagePurchasesExport(fromISO, toISO);
    case "payments":
      return buildSagePaymentsExport(fromISO, toISO);
    case "adjustments":
      return buildSageAdjustmentsExport(fromISO, toISO);
    case "vendors":
      return buildSageVendorListExport();
  }
}
