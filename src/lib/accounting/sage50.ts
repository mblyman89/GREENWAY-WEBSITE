import "server-only";

/**
 * src/lib/accounting/sage50.ts  (Run 4 / Slice 18)
 *
 * Builds a Sage 50 (US) **General Journal** import CSV of daily summarized
 * entries. Sage 50 has no desktop API; it imports CSV templates. A journal
 * entry is one or more distribution lines sharing a Transaction Number; debits
 * are positive, credits negative, and each entry must balance to zero.
 *
 * Per business day (Pacific time) we emit one balanced entry:
 *   DR  Cash/Card clearing              = total collected (base + sales tax + excise)
 *   CR  Sales – cannabis (pre-tax)
 *   CR  Sales – non-cannabis (pre-tax)
 *   CR  Sales Tax Payable (9.3%)
 *   CR  Cannabis Excise Tax Payable (37%)
 *   DR  Sales discounts (contra-revenue)   [optional, if mapped]
 *   DR  COGS
 *   CR  Inventory asset
 *
 * GL account ids come from accounting_settings (editable mapping). Money in
 * minor units internally; emitted as decimal dollars. Descriptions are stripped
 * of double quotes per Sage 50 guidance.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getTaxSettings, getCannabisCategorySet, isCannabisCategory, applyBps } from "@/lib/reports/tax";
import { pacificDayKey } from "@/lib/reports/timezone";
import {
  type AccountingSettings,
  type JournalLine,
  type DayJournalSummary,
  type Sage50BuildResult,
  DEFAULT_ACCOUNTING_SETTINGS,
  mmddyyyy,
  clean,
  makeFileName,
  assembleCsv,
  rebalance,
} from "@/lib/accounting/sage50-core";

// Re-export the pure types/helpers so existing importers keep working.
export type { AccountingSettings, JournalLine, DayJournalSummary, Sage50BuildResult };
export {
  DEFAULT_ACCOUNTING_SETTINGS,
  dollars,
  mmddyyyy,
  clean,
  csvCell,
  makeFileName,
  assembleCsv,
  rebalance,
  missingGlAccounts,
} from "@/lib/accounting/sage50-core";

// ---------------------------------------------------------------------------
// Settings loader
// ---------------------------------------------------------------------------

export async function getAccountingSettings(): Promise<AccountingSettings> {
  if (!isSupabaseServiceConfigured) return { ...DEFAULT_ACCOUNTING_SETTINGS };
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("accounting_settings")
      .select(
        "gl_cash_clearing, gl_sales_cannabis, gl_sales_non_cannabis, gl_sales_tax_payable, gl_excise_tax_payable, gl_cogs, gl_inventory, gl_discounts, journal_ref_prefix",
      )
      .eq("id", true)
      .maybeSingle();
    if (!data) return { ...DEFAULT_ACCOUNTING_SETTINGS };
    return {
      glCashClearing: data.gl_cash_clearing ?? "",
      glSalesCannabis: data.gl_sales_cannabis ?? "",
      glSalesNonCannabis: data.gl_sales_non_cannabis ?? "",
      glSalesTaxPayable: data.gl_sales_tax_payable ?? "",
      glExciseTaxPayable: data.gl_excise_tax_payable ?? "",
      glCogs: data.gl_cogs ?? "",
      glInventory: data.gl_inventory ?? "",
      glDiscounts: data.gl_discounts ?? "",
      journalRefPrefix: data.journal_ref_prefix ?? "GW",
    };
  } catch {
    return { ...DEFAULT_ACCOUNTING_SETTINGS };
  }
}

// ---------------------------------------------------------------------------
// Helpers (pure formatting helpers now live in sage50-core.ts)
// ---------------------------------------------------------------------------

async function buildCategoryAndCostLookup(admin: ReturnType<typeof createSupabaseAdminClient>) {
  // category lookup
  const catLookup = new Map<string, string>();
  const { data: menuData } = await admin
    .from("menu_items")
    .select("source_item_id, category, created_at")
    .order("created_at", { ascending: false })
    .limit(20000);
  for (const r of (menuData as { source_item_id: string; category: string | null }[] | null) ?? []) {
    if (!r.source_item_id || catLookup.has(r.source_item_id)) continue;
    catLookup.set(r.source_item_id, r.category?.trim() || "");
  }
  // weighted-avg cost lookup
  const { data: lotData } = await admin
    .from("inventory_lots")
    .select("pos_product_key, received_qty, unit_cost_minor_units")
    .limit(50000);
  const num = new Map<string, number>();
  const den = new Map<string, number>();
  const simpleSum = new Map<string, number>();
  const simpleCount = new Map<string, number>();
  for (const l of (lotData as { pos_product_key: string | null; received_qty: number | null; unit_cost_minor_units: number | null }[] | null) ?? []) {
    const key = l.pos_product_key;
    if (!key || l.unit_cost_minor_units == null) continue;
    const cost = l.unit_cost_minor_units;
    const qty = Number(l.received_qty ?? 0);
    if (qty > 0) {
      num.set(key, (num.get(key) ?? 0) + cost * qty);
      den.set(key, (den.get(key) ?? 0) + qty);
    }
    simpleSum.set(key, (simpleSum.get(key) ?? 0) + cost);
    simpleCount.set(key, (simpleCount.get(key) ?? 0) + 1);
  }
  const costLookup = new Map<string, number>();
  for (const key of simpleSum.keys()) {
    const d = den.get(key) ?? 0;
    if (d > 0) costLookup.set(key, Math.round((num.get(key) ?? 0) / d));
    else costLookup.set(key, Math.round((simpleSum.get(key) ?? 0) / (simpleCount.get(key) || 1)));
  }
  return { catLookup, costLookup };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildSage50Journal(fromISO: string, toISO: string): Promise<Sage50BuildResult> {
  const settings = await getAccountingSettings();
  const warnings: string[] = [];

  const result: Sage50BuildResult = {
    csv: "",
    fileName: makeFileName(),
    lineCount: 0,
    days: 0,
    warnings,
    summaries: [],
  };

  // Warn about unmapped accounts.
  const required: [keyof AccountingSettings, string][] = [
    ["glCashClearing", "Cash/Card clearing"],
    ["glSalesCannabis", "Sales – cannabis"],
    ["glSalesTaxPayable", "Sales Tax Payable"],
    ["glExciseTaxPayable", "Excise Tax Payable"],
    ["glCogs", "COGS"],
    ["glInventory", "Inventory"],
  ];
  const missing = required.filter(([k]) => !settings[k]).map(([, label]) => label);
  if (missing.length) {
    warnings.push(`Map these GL accounts in Accounting settings before importing to Sage 50: ${missing.join(", ")}.`);
  }

  if (!isSupabaseServiceConfigured) {
    result.csv = assembleCsv([]);
    return result;
  }

  const admin = createSupabaseAdminClient();
  const [tax, cannabisSet, lookups] = await Promise.all([
    getTaxSettings(),
    getCannabisCategorySet(),
    buildCategoryAndCostLookup(admin),
  ]);
  const combinedSalesBps = tax.stateSalesRateBps + tax.localSalesRateBps;

  // Completed orders in range.
  const { data: ordersData } = await admin
    .from("orders")
    .select("id, status, placed_at, completed_at")
    .gte("placed_at", fromISO)
    .lte("placed_at", toISO);
  const orders =
    (ordersData as { id: string; status: string; placed_at: string; completed_at: string | null }[] | null) ?? [];
  const completed = orders.filter((o) => o.status === "completed");
  if (completed.length === 0) {
    warnings.push("No completed orders in the selected range.");
    result.csv = assembleCsv([]);
    return result;
  }

  const dayByOrder = new Map<string, string>();
  for (const o of completed) {
    const ymd = pacificDayKey(o.completed_at ?? o.placed_at);
    dayByOrder.set(o.id, ymd);
  }
  const orderIds = completed.map((o) => o.id);

  const { data: linesData } = await admin
    .from("order_lines")
    .select("order_id, product_id, quantity, price_minor_units, regular_price_minor_units")
    .in("order_id", orderIds.slice(0, 2000));
  const lines =
    (linesData as
      | { order_id: string; product_id: string | null; quantity: number; price_minor_units: number; regular_price_minor_units: number | null }[]
      | null) ?? [];

  // Accumulate per day.
  const byDay = new Map<string, DayJournalSummary>();
  function dayRow(ymd: string): DayJournalSummary {
    let r = byDay.get(ymd);
    if (!r) {
      r = {
        date: ymd,
        cannabisSalesMinor: 0,
        nonCannabisSalesMinor: 0,
        salesTaxMinor: 0,
        exciseMinor: 0,
        cogsMinor: 0,
        discountsMinor: 0,
        cashCollectedMinor: 0,
      };
      byDay.set(ymd, r);
    }
    return r;
  }

  for (const l of lines) {
    const ymd = dayByOrder.get(l.order_id);
    if (!ymd) continue;
    const qty = l.quantity ?? 0;
    if (qty <= 0) continue;
    const soldUnit = l.price_minor_units ?? 0;
    const base = soldUnit * qty; // post-discount, pre-tax
    if (base <= 0) continue;
    const regularUnit = l.regular_price_minor_units ?? soldUnit;
    const discount = Math.max(0, (regularUnit - soldUnit) * qty);

    const category = (l.product_id ? lookups.catLookup.get(l.product_id) : "") || "";
    const isCannabis = isCannabisCategory(category, cannabisSet);
    const salesTax = applyBps(base, combinedSalesBps);
    const excise = isCannabis ? applyBps(base, tax.exciseRateBps) : 0;
    const unitCost = l.product_id ? lookups.costLookup.get(l.product_id) ?? 0 : 0;
    const cogs = unitCost * qty;

    const row = dayRow(ymd);
    if (isCannabis) row.cannabisSalesMinor += base;
    else row.nonCannabisSalesMinor += base;
    row.salesTaxMinor += salesTax;
    row.exciseMinor += excise;
    row.cogsMinor += cogs;
    row.discountsMinor += discount;
    row.cashCollectedMinor += base + salesTax + excise;
  }

  const summaries = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  result.summaries = summaries;
  result.days = summaries.length;

  // Build journal lines.
  const journalLines: JournalLine[] = [];
  let txn = 1;
  for (const s of summaries) {
    const date = mmddyyyy(s.date);
    const ref = `${settings.journalRefPrefix}${s.date.replace(/-/g, "")}`;
    const push = (gl: string, desc: string, amountMinor: number) => {
      if (amountMinor === 0 || !gl) return;
      journalLines.push({
        date,
        reference: ref,
        transactionNumber: txn,
        glAccountId: gl,
        description: clean(desc),
        amountMinor,
      });
    };

    // Debits (positive)
    push(settings.glCashClearing, `Daily sales deposit ${s.date}`, s.cashCollectedMinor);
    push(settings.glDiscounts, `Sales discounts ${s.date}`, s.discountsMinor);
    push(settings.glCogs, `Cost of goods sold ${s.date}`, s.cogsMinor);
    // Credits (negative)
    push(settings.glSalesCannabis, `Cannabis sales ${s.date}`, -s.cannabisSalesMinor);
    push(settings.glSalesNonCannabis, `Non-cannabis sales ${s.date}`, -s.nonCannabisSalesMinor);
    push(settings.glSalesTaxPayable, `Sales tax payable ${s.date}`, -s.salesTaxMinor);
    push(settings.glExciseTaxPayable, `Cannabis excise payable ${s.date}`, -s.exciseMinor);
    push(settings.glInventory, `Inventory relief ${s.date}`, -s.cogsMinor);

    // Discounts increase the credited sales side; to keep the entry balanced we
    // book discounts as a debit AND gross-up sales by the same amount is NOT
    // done here — instead cash already equals net base + taxes, and sales are
    // booked at net. The discount debit must therefore be offset by reducing the
    // sales credit... To keep it simple and balanced, we DROP the standalone
    // discount line when it would unbalance, and only include it informationally.
    txn += 1;
  }

  // Balance verification per transaction; if a day doesn't balance (e.g. due to
  // the discount handling above), drop the discount line for that txn so the
  // entry balances. We recompute net.
  rebalance(journalLines, settings, warnings);

  result.csv = assembleCsv(journalLines);
  result.lineCount = journalLines.length;
  return result;
}

/**
 * Ensure each transaction's debits == credits. Our base/tax/cogs lines balance
 * by construction (cash = base + taxes; sales+tax credits = cash; cogs debit =
 * inventory credit). The discount line is purely informational and would
 * unbalance the entry, so we remove discount lines here (kept out of the GL but
 * surfaced in the preview summaries).
 */

