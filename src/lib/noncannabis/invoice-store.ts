/**
 * src/lib/noncannabis/invoice-store.ts
 *
 * Server store for non-cannabis paper invoices (Task N, migration 0112).
 * The paper invoice keyed in on the non-cannabis inventory page is the payable
 * SOURCE DOCUMENT for the Accounts Payable page — the merch parallel of an
 * accepted inbound manifest. Money is CENTS end to end. Server-only.
 *
 * Payments live in the UNIFIED ledger vendor_manifest_payments: rows for these
 * invoices set noncannabis_invoice_id (manifest_id null). The 0112 CHECK
 * enforces exactly one source document per payment row.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  invoiceTotalMinorUnits,
  type NonCannabisInvoiceDraft,
  type NonCannabisInvoicePayable,
} from "@/lib/noncannabis/invoice-core";
import {
  createNonCannabisAdjustment,
  createNonCannabisProduct,
} from "@/lib/noncannabis/store";
import type { PaymentMethod } from "@/lib/payments/vendor-payables-store";

/** A saved invoice header row (DB shape). */
export type NonCannabisInvoice = {
  id: string;
  invoice_number: string;
  vendor_id: string | null;
  vendor_name: string;
  invoice_date: string;
  total_minor_units: number;
  status: "open" | "paid";
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Payable view + display extras for pickers/tables. */
export type NonCannabisInvoicePayableRow = NonCannabisInvoicePayable & {
  invoiceDate: string;
  lineCount: number;
  createdAt: string;
};

export type CreateInvoiceResult =
  | {
      ok: true;
      id: string;
      invoiceNumber: string;
      totalMinorUnits: number;
      /** New catalog drafts staged from "new" lines. */
      stagedProducts: number;
      /** Existing products restocked via +received adjustments. */
      restockedProducts: number;
    }
  | { ok: false; error: string };

/**
 * Persist a validated paper invoice: header + lines, then apply each line to
 * stock ("new" stages a draft product; "existing" posts a +received
 * adjustment). The caller MUST run validateNonCannabisInvoice first — this is
 * the persistence step, mirroring recordManifestPayment's contract.
 */
export async function createNonCannabisInvoice(
  draft: NonCannabisInvoiceDraft,
  actorId: string | null,
): Promise<CreateInvoiceResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "supabase-not-configured" };
  const admin = createSupabaseAdminClient();

  const vendorName = draft.vendorName.trim();
  const invoiceNumber = draft.invoiceNumber.trim();
  const total = invoiceTotalMinorUnits(draft.lines);

  // Best-effort vendor link: exact (case-insensitive) display-name match only —
  // never guess a fuzzy match on a payment source document.
  let vendorId: string | null = null;
  const { data: vendorRows } = await admin
    .from("vendors")
    .select("id, display_name")
    .ilike("display_name", vendorName)
    .limit(2);
  const vmatches = (vendorRows as { id: string; display_name: string }[] | null) ?? [];
  if (vmatches.length === 1) vendorId = vmatches[0].id;

  // 1) Header. The unique index (vendor_name, invoice_number) catches dupes.
  const { data: header, error: headErr } = await admin
    .from("noncannabis_invoices")
    .insert({
      invoice_number: invoiceNumber,
      vendor_id: vendorId,
      vendor_name: vendorName,
      invoice_date: draft.invoiceDate,
      total_minor_units: total,
      status: "open",
      note: (draft.note ?? "").trim() || null,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (headErr || !header) {
    const msg = headErr?.message ?? "insert failed";
    if (/duplicate key|unique/i.test(msg)) {
      return {
        ok: false,
        error: `Invoice #${invoiceNumber} from ${vendorName} is already entered. Each paper invoice is entered once.`,
      };
    }
    if (/relation .* does not exist|schema cache/i.test(msg)) {
      return { ok: false, error: "Migration 0112 has not been applied yet — apply it in the Supabase SQL editor first." };
    }
    return { ok: false, error: msg };
  }
  const invoiceId = (header as { id: string }).id;

  // 2) Lines + stock effects. If anything fails mid-way we delete the header
  // (cascade removes saved lines) so a broken half-invoice never becomes a
  // payable source document.
  let stagedProducts = 0;
  let restockedProducts = 0;
  const rollback = async (why: string): Promise<CreateInvoiceResult> => {
    await admin.from("noncannabis_invoices").delete().eq("id", invoiceId);
    return { ok: false, error: why };
  };

  for (let i = 0; i < draft.lines.length; i++) {
    const line = draft.lines[i];
    const n = i + 1;
    let productId: string | null = null;

    if (line.kind === "new") {
      const created = await createNonCannabisProduct(
        {
          type: (line.productType ?? "other").trim() || "other",
          nameOverride: line.description.trim(),
          qty_on_hand: line.qty,
          cost_minor_units: line.unitCostMinorUnits,
          price_minor_units: Math.max(0, Math.round(line.priceMinorUnits ?? 0)),
          notes: `From vendor invoice #${invoiceNumber} (${vendorName})`,
        },
        actorId,
        "draft",
      );
      if (!created.ok) return rollback(`Line ${n}: could not stage the product — ${created.error}`);
      productId = created.id;
      stagedProducts += 1;
    } else {
      productId = (line.productId ?? "").trim() || null;
      if (!productId) return rollback(`Line ${n}: missing the existing product to restock.`);
      const adjusted = await createNonCannabisAdjustment(
        {
          productId,
          qtyDelta: line.qty,
          reason: "received",
          note: `Vendor invoice #${invoiceNumber} (${vendorName})`,
        },
        actorId,
      );
      if (!adjusted.ok) return rollback(`Line ${n}: could not restock — ${adjusted.error}`);
      restockedProducts += 1;
    }

    const { error: lineErr } = await admin.from("noncannabis_invoice_lines").insert({
      invoice_id: invoiceId,
      product_id: productId,
      description: line.description.trim(),
      qty: line.qty,
      unit_cost_minor_units: line.unitCostMinorUnits,
    });
    if (lineErr) return rollback(`Line ${n}: could not save — ${lineErr.message}`);
  }

  return { ok: true, id: invoiceId, invoiceNumber, totalMinorUnits: total, stagedProducts, restockedProducts };
}

/**
 * List paper invoices as payables (total / paid from the unified ledger).
 * Newest invoice date first. Never throws; [] when the DB isn't configured or
 * migration 0112 isn't applied yet.
 */
export async function listNonCannabisInvoicePayables(opts?: {
  /** Include invoices already fully paid (default false). */
  includePaid?: boolean;
  limit?: number;
}): Promise<NonCannabisInvoicePayableRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();

  const { data: invoices, error } = await admin
    .from("noncannabis_invoices")
    .select("id, invoice_number, vendor_id, vendor_name, invoice_date, total_minor_units, status, created_at")
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 300);
  if (error) return []; // pre-0112: table missing → degrade gracefully
  const rows =
    (invoices as
      | {
          id: string;
          invoice_number: string;
          vendor_id: string | null;
          vendor_name: string;
          invoice_date: string;
          total_minor_units: number;
          status: string;
          created_at: string;
        }[]
      | null) ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  // Paid = SUM(amount) over unified-ledger rows pointing at these invoices.
  const { data: payments } = await admin
    .from("vendor_manifest_payments")
    .select("noncannabis_invoice_id, amount_minor_units")
    .in("noncannabis_invoice_id", ids);
  const paidByInvoice = new Map<string, number>();
  for (const p of (payments as { noncannabis_invoice_id: string | null; amount_minor_units: number | null }[] | null) ?? []) {
    if (!p.noncannabis_invoice_id) continue;
    paidByInvoice.set(
      p.noncannabis_invoice_id,
      (paidByInvoice.get(p.noncannabis_invoice_id) ?? 0) + (Number(p.amount_minor_units) || 0),
    );
  }

  // Line counts for display (parallel to the manifest lotCount).
  const { data: lines } = await admin
    .from("noncannabis_invoice_lines")
    .select("invoice_id")
    .in("invoice_id", ids);
  const lineCountByInvoice = new Map<string, number>();
  for (const l of (lines as { invoice_id: string }[] | null) ?? []) {
    lineCountByInvoice.set(l.invoice_id, (lineCountByInvoice.get(l.invoice_id) ?? 0) + 1);
  }

  const payables: NonCannabisInvoicePayableRow[] = rows.map((r) => ({
    invoiceId: r.id,
    invoiceNumber: r.invoice_number,
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    status: r.status,
    totalMinorUnits: r.total_minor_units ?? 0,
    paidMinorUnits: paidByInvoice.get(r.id) ?? 0,
    invoiceDate: r.invoice_date,
    lineCount: lineCountByInvoice.get(r.id) ?? 0,
    createdAt: r.created_at,
  }));

  return opts?.includePaid
    ? payables
    : payables.filter((p) => p.totalMinorUnits - p.paidMinorUnits > 0);
}

/** Fetch one invoice payable by id (fresh total/paid). Null if not found. */
export async function getNonCannabisInvoicePayable(
  invoiceId: string,
): Promise<NonCannabisInvoicePayableRow | null> {
  const all = await listNonCannabisInvoicePayables({ includePaid: true, limit: 1000 });
  return all.find((r) => r.invoiceId === invoiceId) ?? null;
}

/** Input for recording a payment against a paper invoice (CENTS). */
export type RecordInvoicePaymentInput = {
  invoiceId: string;
  vendorId: string | null;
  vendorName: string;
  invoiceNumber: string;
  amountMinorUnits: number;
  owedMinorUnits: number;
  isPartial: boolean;
  achBatchRef?: string | null;
  note?: string | null;
  createdBy?: string | null;
  paymentMethod?: PaymentMethod;
  reference?: string | null;
};

/**
 * Insert a unified-ledger payment row for a paper invoice and stamp the
 * invoice 'paid' when the recorded payments now cover the total. Guardrails
 * (checkNonCannabisInvoicePayment) must run BEFORE calling — this is the
 * persistence step. manifest_number carries the invoice number so the Sage 50
 * vendor-payment export labels these rows correctly with zero changes.
 */
export async function recordNonCannabisInvoicePayment(
  input: RecordInvoicePaymentInput,
): Promise<{ id: string } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("vendor_manifest_payments")
    .insert({
      manifest_id: null,
      noncannabis_invoice_id: input.invoiceId,
      vendor_id: input.vendorId,
      vendor_name: input.vendorName,
      manifest_number: input.invoiceNumber,
      amount_minor_units: input.amountMinorUnits,
      owed_minor_units: input.owedMinorUnits,
      is_partial: input.isPartial,
      ach_batch_ref: input.achBatchRef ?? null,
      note: input.note ?? null,
      created_by: input.createdBy ?? null,
      payment_method: input.paymentMethod ?? "ach",
      reference: input.reference ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return null;

  // Stamp 'paid' when settled (fast filter only — remaining math always
  // derives from the ledger). Best-effort; never blocks the payment record.
  const fresh = await getNonCannabisInvoicePayable(input.invoiceId);
  if (fresh && fresh.paidMinorUnits >= fresh.totalMinorUnits && fresh.status !== "paid") {
    await admin
      .from("noncannabis_invoices")
      .update({ status: "paid" })
      .eq("id", input.invoiceId);
  }

  return { id: (data as { id: string }).id };
}
