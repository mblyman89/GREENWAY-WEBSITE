/**
 * src/lib/inventory/pdf-growflow-invoice-core.ts  (Fix Phase 3.3, PURE)
 *
 * Owner (Fix 3.3, verbatim): "please go through the materials i have given
 * you and try and fix once and for all this pesky intake issue".
 *
 * The GrowFlow invoice that rides every GrowFlow delivery email
 * (`Invoice_<timestamp>.pdf`, "Powered By - growflow.com") prints the PRICE
 * of every line - and no parser read it: it is not a manifest layout, so the
 * staged lines had no unit cost although the vendor printed one. Verified on
 * the real Canna Processing invoice (tests/fixtures/growflow-canna/
 * 03-Invoice.unpdf.txt):
 *
 *   "Product Strain ID# Qty Pkg Wgt. Unit Price Total
 *    GOLD - Banana Cake Medical - Banana Cake GF4191890 5566988 50 1g $4.00 $200.00
 *    HTE HONEY - Blue Dream Medical - Blue Dream GF4191890 5566980 50 .7g $2.26 $113.00 ..."
 *
 * The ID# column wraps, so the text layer splits the 16-character GrowFlow
 * inventory id in two ("GF4191890 5566988" = GF41918905566988, the manifest
 * line's lot id). This reader returns a price-only ParsedManifest (lot id +
 * unit cost in integer cents) for mergeInvoicePricesByLot, which fills ONLY an
 * empty unit cost by exact lot id. A row is used only when the printed
 * arithmetic holds (qty x unit price = line total, to the cent) - a misread
 * row is skipped, never guessed.
 */

import type { ParsedLine, ParsedManifest } from "./intake-parser";

export type GrowFlowInvoiceRow = {
  lot_code: string;
  product_name: string | null;
  qty: number;
  unit_cost_minor_units: number;
  line_total_minor_units: number;
};

export type GrowFlowInvoice = {
  invoiceNumber: string | null;
  orderNumber: string | null;
  vendorName: string | null;
  vendorLicense: string | null;
  rows: GrowFlowInvoiceRow[];
  /** Rows whose printed arithmetic did not hold (skipped, said). */
  skipped: string[];
  subtotalMinorUnits: number | null;
};

function flat(raw: string): string {
  return (typeof raw === "string" ? raw : "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/** "$1,504.00" / "1504.00" -> 150400 (integer cents). Null when unreadable. */
export function dollarsToCents(v: string | null | undefined): number | null {
  if (typeof v !== "string") return null;
  const m = v.replace(/[$,\s]/g, "").match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/** True for a GrowFlow invoice (never a manifest, never a COA). */
export function looksLikeGrowFlowInvoice(raw: string): boolean {
  const t = flat(raw);
  return /\bInvoice\b/.test(t) && /Invoice\s*#:\s*INV-/i.test(t) && /Product\s+Strain\s+ID#\s+Qty\s+Pkg\s+Wgt\.?\s+Unit\s+Price\s+Total/i.test(t);
}

// "<GF id, maybe split in two> <qty> <pkg wgt> $<unit> $<total>"
const ROW = /\b(GF\d{3,16})(?:\s+(\d{1,13}))?\s+(\d+(?:\.\d+)?)\s+(\S{1,12})\s+\$\s?([\d,]+\.\d{2})\s+\$\s?([\d,]+\.\d{2})/g;

/** Read a GrowFlow invoice's lines. Null when the text is not one. PURE. */
export function parseGrowFlowInvoice(raw: string): GrowFlowInvoice | null {
  if (!looksLikeGrowFlowInvoice(raw)) return null;
  const t = flat(raw);
  const head = t.search(/Product\s+Strain\s+ID#\s+Qty\s+Pkg\s+Wgt\.?\s+Unit\s+Price\s+Total/i);
  const body = t.slice(head).replace(/^Product\s+Strain\s+ID#\s+Qty\s+Pkg\s+Wgt\.?\s+Unit\s+Price\s+Total/i, " ");
  const rows: GrowFlowInvoiceRow[] = [];
  const skipped: string[] = [];
  let prevEnd = 0;
  for (const m of body.matchAll(ROW)) {
    const id = (m[1] + (m[2] ?? "")).toUpperCase();
    const name = body.slice(prevEnd, m.index ?? 0).trim().replace(/\s+/g, " ") || null;
    prevEnd = (m.index ?? 0) + m[0].length;
    if (!/^GF\d{14}$/.test(id)) {
      skipped.push(`${id}: not a 16-character GrowFlow id`);
      continue;
    }
    const qty = Number(m[3]);
    const unit = dollarsToCents(m[5]);
    const total = dollarsToCents(m[6]);
    if (unit === null || total === null || !Number.isFinite(qty) || qty <= 0 || Math.round(qty * unit) !== total) {
      skipped.push(`${id}: ${m[3]} x $${m[5]} does not equal the printed $${m[6]}`);
      continue;
    }
    rows.push({ lot_code: id, product_name: name, qty, unit_cost_minor_units: unit, line_total_minor_units: total });
  }
  return {
    invoiceNumber: t.match(/Invoice\s*#:\s*(INV-[A-Z0-9-]+)/i)?.[1] ?? null,
    orderNumber: t.match(/Order\s*#:\s*([A-Z0-9-]+)/i)?.[1] ?? null,
    vendorName: t.match(/Invoice From:\s*(.+?)\s+\d{2,6}\s/i)?.[1]?.trim() ?? null,
    vendorLicense: t.match(/Invoice From:.*?License:\s*(\d{5,})/i)?.[1] ?? null,
    rows,
    skipped,
    subtotalMinorUnits: dollarsToCents(t.match(/Sub\s*Total\s*:\s*\$\s?([\d,]+\.\d{2})/i)?.[1] ?? null),
  };
}

/** A price-only ParsedManifest for mergeInvoicePricesByLot (fill-only-empty, exact lot). PURE. */
export function growFlowInvoiceAsPriceDonor(inv: GrowFlowInvoice): ParsedManifest {
  const lines: ParsedLine[] = inv.rows.map((r) => ({
    product_name: null, // the invoice's product text is wrapped across columns - never a name source
    lot_code: r.lot_code,
    pos_product_key: null,
    brand_name: null,
    category: null,
    strain_name: null,
    strain_type: null,
    received_qty: r.qty,
    unit: "each",
    unit_cost_minor_units: r.unit_cost_minor_units,
    unit_weight: null,
    unit_weight_uom: null,
    is_sample: false,
    is_medical: false,
    inventory_type: null,
    expires_on: null,
    low_thc_liquid: null,
    unit_thc_mg: null,
    otherwise_taken: null,
    units_per_package: null,
    lab: null,
    warnings: [],
    raw: { source: "growflow-invoice", invoice: inv.invoiceNumber },
  }));
  return {
    manifest_number: null,
    vendor_label: inv.vendorName,
    vendor_license: inv.vendorLicense,
    transfer_date: null,
    source_format: "pdf-manifest",
    lines,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runGrowFlowInvoiceTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL growflow-invoice: ${m}`);
    }
  };
  const text =
    "Invoice Order #: 1010497 Invoice #: INV-1010497 Order Date: 06/02/2026 Invoice From: Canna Processing 2835 Ocean Ave Ste B Raymond, WA 98577 " +
    "License: 419189 UBI: 6034772160010001 Bill To: Greenway Marijuana License: 413541 Product Strain ID# Qty Pkg Wgt. Unit Price Total " +
    "GOLD - Banana Cake Medical - Banana Cake GF4191890 5566988 50 1g $4.00 $200.00 " +
    "HTE HONEY - Blue Dream Medical - Blue Dream GF4191890 5566980 50 .7g $2.26 $113.00 " +
    "BAD - Row GF4191890 5566999 50 1g $4.00 $201.00 Sub Total : $1,504.00";
  const inv = parseGrowFlowInvoice(text);
  ok(inv !== null, "GrowFlow invoice recognised");
  ok(inv?.rows.length === 2, `two rows read (got ${inv?.rows.length})`);
  ok(inv?.rows[0]?.lot_code === "GF41918905566988", "split id rejoined");
  ok(inv?.rows[0]?.unit_cost_minor_units === 400, "$4.00 -> 400 cents");
  ok(inv?.rows[1]?.unit_cost_minor_units === 226, "$2.26 -> 226 cents");
  ok(inv?.skipped.length === 1, "a row whose arithmetic fails is skipped, said");
  ok(inv?.invoiceNumber === "INV-1010497" && inv?.vendorLicense === "419189", "header read");
  ok(inv?.subtotalMinorUnits === 150400, "subtotal in cents");
  ok(parseGrowFlowInvoice("Manifest ID: 1 Transported Items") === null, "not an invoice -> null");
  ok(dollarsToCents("$1,504.00") === 150400 && dollarsToCents("x") === null, "dollarsToCents");
  const donor = inv ? growFlowInvoiceAsPriceDonor(inv) : null;
  ok(donor?.lines[0]?.unit_cost_minor_units === 400 && donor?.lines[0]?.product_name === null, "price donor carries price only");
  return { passed, failed };
}
