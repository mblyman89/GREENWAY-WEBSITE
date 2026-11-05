/**
 * D177 S5 — server reads for the Label Studio's OTHER-INVENTORY batch page
 * (/admin/inventory/noncannabis/labels).
 *
 * Three ways in, all ending in one list of products:
 *   ?ids=a,b,c       the items staff ticked / just staged
 *   ?invoice=<uuid>  every product on one keyed-in vendor invoice (0112), with
 *                    copies = the pieces received on that invoice
 *   ?drafts=1        every staged draft (the "just received, not yet on sale" set)
 *
 * Every read is paged + checked (SLICE 5C: never `.limit(N>=1000)`; a failed
 * page is reported, never shown as "nothing to label") and returns the DB
 * error code so the page can explain it with labelLoadErrorText.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked, chunkedIn } from "@/lib/supabase/chunked-in";

export type NcLabelRow = Record<string, unknown> & { id: string; qty_on_hand?: number | null };

export type BatchRead<T> = { ok: true; rows: T[] } | { ok: false; code: string | null; message: string };

type DbErr = { code?: string | null; message?: string | null } | null;

/** Products by id (chunked IN, every chunk checked). Order follows `ids`. */
export async function listNcProductsForLabels(ids: readonly string[]): Promise<BatchRead<NcLabelRow>> {
  if (!isSupabaseServiceConfigured || ids.length === 0) return { ok: true, rows: [] };
  const admin = createSupabaseAdminClient();
  let failure: DbErr = null;
  const rows = await chunkedIn<string, NcLabelRow>(ids, async (chunk, from, to) => {
    const { data, error } = await admin
      .from("noncannabis_products")
      .select("*")
      .in("id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) failure = error;
    return (data as NcLabelRow[] | null) ?? [];
  });
  if (failure) {
    const f = failure as NonNullable<DbErr>;
    return { ok: false, code: f.code ?? null, message: f.message ?? "" };
  }
  const byId = new Map(rows.map((r) => [String(r.id).toLowerCase(), r]));
  return { ok: true, rows: ids.map((id) => byId.get(id)).filter((r): r is NcLabelRow => !!r) };
}

/** Every staged draft (newest received goods), name order. */
export async function listNcDraftsForLabels(): Promise<BatchRead<NcLabelRow>> {
  if (!isSupabaseServiceConfigured) return { ok: true, rows: [] };
  const admin = createSupabaseAdminClient();
  let failure: DbErr = null;
  const { rows, verdict } = await pagedAllChecked<NcLabelRow>(async (from, to) => {
    const { data, error } = await admin
      .from("noncannabis_products")
      .select("*")
      .eq("status", "draft")
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) failure = error;
    return { rows: (data as NcLabelRow[] | null) ?? [], ok: !error };
  });
  if (!verdict.complete) {
    const f = (failure ?? {}) as NonNullable<DbErr>;
    return { ok: false, code: f.code ?? null, message: f.message || verdict.message };
  }
  return { ok: true, rows };
}

export type InvoiceForLabels = {
  invoiceNumber: string;
  vendorName: string;
  invoiceDate: string | null;
  lines: { product_id: string | null; qty: number }[];
};

/** One vendor invoice header + its lines (the product ids and pieces received). */
export async function getNcInvoiceForLabels(
  invoiceId: string,
): Promise<{ ok: true; invoice: InvoiceForLabels | null } | { ok: false; code: string | null; message: string }> {
  if (!isSupabaseServiceConfigured) return { ok: true, invoice: null };
  const admin = createSupabaseAdminClient();
  const { data: head, error: headErr } = await admin
    .from("noncannabis_invoices")
    .select("id, invoice_number, vendor_name, invoice_date")
    .eq("id", invoiceId)
    .maybeSingle();
  if (headErr) return { ok: false, code: headErr.code ?? null, message: headErr.message ?? "" };
  if (!head) return { ok: true, invoice: null };

  let failure: DbErr = null;
  const { rows, verdict } = await pagedAllChecked<{ product_id: string | null; qty: number }>(async (from, to) => {
    const { data, error } = await admin
      .from("noncannabis_invoice_lines")
      .select("id, product_id, qty")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) failure = error;
    return { rows: (data as { product_id: string | null; qty: number }[] | null) ?? [], ok: !error };
  });
  if (!verdict.complete) {
    const f = (failure ?? {}) as NonNullable<DbErr>;
    return { ok: false, code: f.code ?? null, message: f.message || verdict.message };
  }
  const h = head as { invoice_number?: string | null; vendor_name?: string | null; invoice_date?: string | null };
  return {
    ok: true,
    invoice: {
      invoiceNumber: h.invoice_number ?? "",
      vendorName: h.vendor_name ?? "",
      invoiceDate: h.invoice_date ?? null,
      lines: rows,
    },
  };
}
