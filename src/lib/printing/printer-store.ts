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
  formatReceipt,
  receiptTitle,
  type ReceiptInput,
} from "@/lib/printing/receipt-core";

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
 * Build a receipt from an order and queue it — but only if auto-print is on.
 * Best-effort: never throws, returns the job id or null. Called from the
 * orders API after a successful order insert.
 */
export async function queueOrderReceipt(input: ReceiptInput & {
  orderId?: string | null;
  itemCount: number;
}): Promise<string | null> {
  const settings = await getPrinterSettings();
  if (!settings || !settings.auto_print_orders) return null;
  const body = formatReceipt(
    {
      ...input,
      headerText: input.headerText ?? settings.header_text,
      footerText: input.footerText ?? settings.footer_text,
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
 */
export async function claimNextJob(): Promise<ReceiptJob | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();

  // Look for the oldest queued job, or a stale printing job to retry.
  const staleCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: candidates } = await admin
    .from("receipt_print_jobs")
    .select("*")
    .or(`status.eq.queued,and(status.eq.printing,claimed_at.lt.${staleCutoff})`)
    .order("queued_at", { ascending: true })
    .limit(1);

  const job = (candidates?.[0] as ReceiptJob | undefined) ?? null;
  if (!job) return null;

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
