/**
 * src/lib/printing/printer-store.ts
 *
 * Server-side store for the Star CloudPRNT receipt-printer integration (Slice 37).
 * Re-exports the pure receipt-core helpers and adds Supabase-backed queue ops.
 *
 * Single-printer design — there is exactly one printer and one settings row
 * (receipt_printer_settings id = 1). No multi-printer abstraction.
 *
 * Used by:
 *   - the CloudPRNT route handler (poll / job / confirm)
 *   - the orders API (queue a receipt when an online order is placed)
 *   - the admin settings page (read/update config, manual test print, queue view)
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  receiptTitle,
  type ReceiptInput,
} from "@/lib/printing/receipt-core";
import {
  formatEscposReceipt,
  type EscposReceiptLine,
} from "@/lib/printing/receipt-escpos-core";
import { type OrderOrigin } from "@/lib/orders/order-origin-core";
import { getPosReceiptConfig } from "@/lib/pos/receipt-config-store";
import {
  MAX_FAILS_PER_CLAIM,
  hasExhaustedPrintAttempts,
  retryCapNote,
} from "@/lib/printing/print-retry-core";

export * from "@/lib/printing/receipt-core";

export type ReceiptJobStatus =
  | "queued"
  | "printing"
  | "printed"
  | "failed"
  | "cancelled";

export type PrinterSettings = {
  id: number;
  poll_token: string | null;
  printer_mac: string | null;
  printer_label: string;
  auto_print_orders: boolean;
  paper_columns: number;
  header_text: string | null;
  footer_text: string | null;
  last_poll_at: string | null;
  last_status_code: string | null;
  created_at: string;
  updated_at: string;
};

export type ReceiptJob = {
  id: string;
  order_id: string | null;
  order_number: string | null;
  body_text: string;
  title: string | null;
  status: ReceiptJobStatus;
  job_token: string | null;
  attempts: number;
  error_note: string | null;
  queued_at: string;
  claimed_at: string | null;
  printed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Read the singleton printer settings row (or null if unconfigured). */
export async function getPrinterSettings(): Promise<PrinterSettings | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("receipt_printer_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return null;
  return data as PrinterSettings;
}

export type PrinterSettingsUpdate = Partial<{
  poll_token: string | null;
  printer_label: string;
  auto_print_orders: boolean;
  paper_columns: number;
  header_text: string | null;
  footer_text: string | null;
}>;

/** Update the singleton printer settings row. Returns the updated row. */
export async function updatePrinterSettings(
  patch: PrinterSettingsUpdate,
): Promise<PrinterSettings | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  // Ensure the singleton exists, then update.
  await admin
    .from("receipt_printer_settings")
    .upsert({ id: 1 }, { onConflict: "id", ignoreDuplicates: true });
  const { data, error } = await admin
    .from("receipt_printer_settings")
    .update(patch)
    .eq("id", 1)
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return data as PrinterSettings;
}

/** List recent print jobs (newest first) for the staff queue view. */
export async function listRecentJobs(limit = 50): Promise<ReceiptJob[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("receipt_print_jobs")
    .select("*")
    .order("queued_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as ReceiptJob[];
}

/**
 * Queue a print job. `body_text` must already be plain text. Returns the new
 * job id, or null if Supabase isn't configured (best-effort, never throws).
 */
export async function queueJob(params: {
  bodyText: string;
  title?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
}): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("receipt_print_jobs")
    .insert({
      body_text: params.bodyText,
      title: params.title ?? null,
      order_id: params.orderId ?? null,
      order_number: params.orderNumber ?? null,
      status: "queued",
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/**
 * Enrichment the ORDER already knows but the legacy pickup receipt discarded.
 *
 * Every field is optional: a caller that cannot supply it simply prints less
 * (see receipt-escpos-core). Nothing here is new data collection — the orders
 * API already computes all of it (src/app/api/orders/route.ts) and was
 * throwing it away at this boundary.
 */
export type OrderReceiptLineExtras = {
  regularPriceMinorUnits?: number | null;
  category?: string | null;
  unitGrams?: number | null;
  unitThcMg?: number | null;
  appliedLabel?: string | null;
  /** SLICE L-36 - picker facts + the line's money discount. */
  vendor?: string | null;
  inventoryType?: string | null;
  categoryLabel?: string | null;
  lineDiscountMinorUnits?: number | null;
};

/**
 * Build a receipt from an order and queue it — but only if auto-print is on.
 * Best-effort: never throws, returns the job id or null. Called from the
 * orders API after a successful order insert.
 *
 * VRETTI SLICE: the body is now rendered by formatEscposReceipt, which lays
 * the order out in the SAME style as a register sale (the owner's request:
 * "I want to use the same receipt style format and such used for a sale at the
 * register"). It reuses the register's own detail-line, tax-split and
 * return-policy helpers, and it honours the owner's existing register-receipt
 * settings (header, address, footer, savings/detail/summary/policy toggles and
 * the statutory excise itemization) so BOTH receipts are configured from ONE
 * screen instead of two that can disagree.
 *
 * The printer's paper_columns still wins for width, because that is a property
 * of the paper loaded in the machine, not a style preference.
 */
export async function queueOrderReceipt(input: ReceiptInput & {
  orderId?: string | null;
  itemCount: number;
  /** Per-line enrichment, positionally aligned with `lines`. */
  lineExtras?: (OrderReceiptLineExtras | null)[];
  /**
   * SLICE L-10. Which marketplace the order came from, so the paper that
   * travels with the bag says which one. Optional and defaulting to the
   * website, because every call site that predates Leafly means the website.
   */
  origin?: OrderOrigin;
  /**
   * SLICE L-10. The Leafly acknowledgement deadline, already formatted for
   * the shop's wall clock. Printed under the origin line on arrival tickets.
   */
  urgencyLine?: string | null;
  /** SLICE L-36 - the GWY number when orderNumber is a fun name. */
  orderRef?: string | null;
  /** SLICE L-36 - caller-supplied tax lines (Leafly's components). */
  taxLines?: { label: string; amountMinorUnits: number }[] | null;
}): Promise<string | null> {
  const settings = await getPrinterSettings();
  if (!settings || !settings.auto_print_orders) return null;

  // The owner's register-receipt customization drives the pickup receipt too.
  // A failure here must never cost us the print job, so fall back to the
  // built-in defaults rather than throwing.
  let config: Awaited<ReturnType<typeof getPosReceiptConfig>> | null = null;
  try {
    config = await getPosReceiptConfig();
  } catch {
    config = null;
  }

  const lines: EscposReceiptLine[] = input.lines.map((l, i) => {
    const extra = input.lineExtras?.[i] ?? null;
    return {
      productName: l.productName,
      quantity: l.quantity,
      priceMinorUnits: l.priceMinorUnits,
      brand: l.brand ?? null,
      variantLabel: l.variantLabel ?? null,
      regularPriceMinorUnits: extra?.regularPriceMinorUnits ?? null,
      category: extra?.category ?? null,
      unitGrams: extra?.unitGrams ?? null,
      unitThcMg: extra?.unitThcMg ?? null,
      appliedLabel: extra?.appliedLabel ?? null,
      vendor: extra?.vendor ?? null,
      inventoryType: extra?.inventoryType ?? null,
      categoryLabel: extra?.categoryLabel ?? null,
      lineDiscountMinorUnits: extra?.lineDiscountMinorUnits ?? null,
    };
  });

  const body = formatEscposReceipt(
    {
      orderNumber: input.orderNumber,
      orderRef: input.orderRef ?? null,
      taxLines: input.taxLines ?? null,
      placedAt: input.placedAt,
      customerName: input.customerName,
      customerPhone: input.customerPhone ?? null,
      customerNote: input.customerNote ?? null,
      lines,
      subtotalMinorUnits: input.subtotalMinorUnits,
      savingsMinorUnits: input.savingsMinorUnits,
      estimatedTaxMinorUnits: input.estimatedTaxMinorUnits,
      totalMinorUnits: input.totalMinorUnits,
      // Printer-level overrides win when set (they are the printer's own
      // fields); otherwise the register-receipt settings apply.
      headerText: input.headerText ?? settings.header_text ?? config?.headerText ?? null,
      footerText: input.footerText ?? settings.footer_text ?? config?.footerText ?? null,
      addressText: config?.addressText ?? null,
      origin: input.origin,
      urgencyLine: input.urgencyLine ?? null,
      showSavings: config?.showSavings,
      showTaxBreakdown: config?.showTaxBreakdown,
      showItemDetail: config?.showItemDetail,
      showSaleSummary: config?.showSaleSummary,
      showReturnPolicy: config?.showReturnPolicy,
      returnPolicyText: config?.returnPolicyText ?? null,
    },
    { columns: settings.paper_columns },
  );

  return queueJob({
    bodyText: body,
    title: receiptTitle(input.orderNumber, input.itemCount),
    orderId: input.orderId ?? null,
    orderNumber: input.orderNumber,
  });
}

/**
 * Claim the oldest queued job for the printer to print. Marks it `printing`,
 * assigns a job_token, and returns it. Returns null if nothing is queued.
 *
 * Also re-claims a stale `printing` job (claimed > 2 min ago, no confirmation)
 * so a dropped confirmation doesn't strand the queue.
 *
 * GW-026 retry cap: a job that has already been claimed MAX_PRINT_ATTEMPTS
 * times without ever confirming is marked `failed` (with a human error_note)
 * instead of being re-claimed forever, so one poison job can no longer sit at
 * the head of the queue blocking every receipt behind it. Failed jobs surface
 * on the Equipment page (diagnostics + queue list) where staff can cancel
 * them. The fail-sweep is bounded per poll by MAX_FAILS_PER_CLAIM.
 */
export async function claimNextJob(): Promise<ReceiptJob | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  // Look for the oldest queued job, or a stale printing job to retry. A job
  // over the attempts cap is failed and skipped; loop to the next candidate.
  for (let sweep = 0; sweep <= MAX_FAILS_PER_CLAIM; sweep += 1) {
    const staleCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: candidates } = await admin
      .from("receipt_print_jobs")
      .select("*")
      .or(`status.eq.queued,and(status.eq.printing,claimed_at.lt.${staleCutoff})`)
      .order("queued_at", { ascending: true })
      .limit(1);

    const job = (candidates?.[0] as ReceiptJob | undefined) ?? null;
    if (!job) return null;

    if (hasExhaustedPrintAttempts(job.attempts)) {
      // Out of tries: fail it (status-guarded so a concurrent confirm wins)
      // and move on to the next candidate instead of returning it.
      await admin
        .from("receipt_print_jobs")
        .update({ status: "failed", error_note: retryCapNote(job.attempts) })
        .eq("id", job.id)
        .in("status", ["queued", "printing"]);
      continue;
    }

    const token = job.job_token ?? `job-${job.id}`;
    const { data, error } = await admin
      .from("receipt_print_jobs")
      .update({
        status: "printing",
        job_token: token,
        claimed_at: new Date().toISOString(),
        attempts: job.attempts + 1,
      })
      .eq("id", job.id)
      .select("*")
      .maybeSingle();
    if (error || !data) return null;
    return data as ReceiptJob;
  }
  return null;
}

/** Fetch a printing job by its token (for the GET job-data request). */
export async function getJobByToken(token: string): Promise<ReceiptJob | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("receipt_print_jobs")
    .select("*")
    .eq("job_token", token)
    .maybeSingle();
  if (error || !data) return null;
  return data as ReceiptJob;
}

/** Mark a job printed (confirmation DELETE/GET from the printer). */
export async function confirmJob(token: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("receipt_print_jobs")
    .update({ status: "printed", printed_at: new Date().toISOString() })
    .eq("job_token", token)
    .eq("status", "printing");
}

/** Cancel a queued job from the staff UI. */
export async function cancelJob(id: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("receipt_print_jobs")
    .update({ status: "cancelled" })
    .eq("id", id)
    .in("status", ["queued", "failed"]);
}

/**
 * Re-queue a failed job from the staff UI (GW-026): fresh attempt counter,
 * cleared error note and token, back of the normal retry flow. Status-guarded
 * to `failed` only, so it can't resurrect printed/cancelled jobs.
 */
export async function requeueJob(id: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin
    .from("receipt_print_jobs")
    .update({
      status: "queued",
      attempts: 0,
      error_note: null,
      job_token: null,
      claimed_at: null,
    })
    .eq("id", id)
    .eq("status", "failed");
}

/** Record a printer heartbeat (poll) — last seen + decoded status code. */
/**
 * Compute whether the printer has polled recently (heartbeat within 90s).
 * Computed here (not during component render) to satisfy the react-hooks
 * purity rule about Date.now() in server components.
 */
export function isPrinterOnline(lastPollAt: string | null): boolean {
  if (!lastPollAt) return false;
  const t = new Date(lastPollAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 90 * 1000;
}

export async function recordHeartbeat(params: {
  printerMac?: string | null;
  statusCode?: string | null;
}): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = {
    id: 1,
    last_poll_at: new Date().toISOString(),
  };
  if (params.statusCode) patch.last_status_code = params.statusCode;
  if (params.printerMac) patch.printer_mac = params.printerMac;
  await admin
    .from("receipt_printer_settings")
    .upsert(patch, { onConflict: "id" });
}
