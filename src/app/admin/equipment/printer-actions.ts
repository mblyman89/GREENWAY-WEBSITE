"use server";

/**
 * Receipt-printer server actions.
 *
 * These used to live under /admin/settings/receipt-printer. The printer UI now
 * lives inside the Equipment page as its own tab (/admin/equipment?tab=printer)
 * so all hardware management is in one place, so these actions redirect/
 * revalidate back to that tab.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  updatePrinterSettings,
  getPrinterSettings,
  queueJob,
  cancelJob,
  requeueJob,
} from "@/lib/printing/printer-store";
import { buildTestPrintBody } from "@/lib/printing/receipt-escpos-core";
import { getPosReceiptConfig } from "@/lib/pos/receipt-config-store";

// Revalidate the equipment route; redirect back to the printer tab.
const REVALIDATE = "/admin/equipment";
const BASE = "/admin/equipment?tab=printer";

function str(formData: FormData, key: string): string | null {
  const v = ((formData.get(key) as string | null) ?? "").trim();
  return v.length === 0 ? null : v;
}

/** Save the printer configuration (label, paper width, header/footer, auto-print). */
export async function savePrinterSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const paperRaw = Number(str(formData, "paper_columns") ?? "48");
  const paperColumns = paperRaw === 32 ? 32 : 48;

  const patch = {
    printer_label: str(formData, "printer_label") ?? "Front counter receipt printer",
    auto_print_orders: (formData.get("auto_print_orders") as string | null) === "on",
    paper_columns: paperColumns,
    header_text: str(formData, "header_text"),
    footer_text: str(formData, "footer_text"),
  };

  const updated = await updatePrinterSettings(patch);

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "receipt_printer.settings_update",
    entityType: "receipt_printer_settings",
    entityId: "1",
    after: patch,
  });

  if (!updated) {
    redirect(`${BASE}&error=${encodeURIComponent("Could not save \u2014 Supabase service role not configured.")}`);
  }

  revalidatePath(REVALIDATE);
  redirect(`${BASE}&saved=1`);
}

/** Generate (or rotate) the shared poll token the printer authenticates with. */
export async function rotatePollTokenAction(): Promise<void> {
  const session = await requirePermission("settings.manage");
  const token = randomBytes(18).toString("hex");
  const updated = await updatePrinterSettings({ poll_token: token });

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "receipt_printer.token_rotate",
    entityType: "receipt_printer_settings",
    entityId: "1",
  });

  if (!updated) {
    redirect(`${BASE}&error=${encodeURIComponent("Could not save token \u2014 Supabase service role not configured.")}`);
  }
  revalidatePath(REVALIDATE);
  redirect(`${BASE}&token=1`);
}

/** Queue a sample receipt so staff can confirm the printer is wired up. */
export async function testPrintAction(): Promise<void> {
  const session = await requirePermission("settings.manage");

  // The test print goes through the SAME renderer a real order does, using the
  // owner's real header/footer/address and the real paper width, so "the test
  // print looked right" is genuine evidence that receipts will look right.
  const settings = await getPrinterSettings();
  let config: Awaited<ReturnType<typeof getPosReceiptConfig>> | null = null;
  try {
    config = await getPosReceiptConfig();
  } catch {
    config = null;
  }
  const body = buildTestPrintBody({
    columns: settings?.paper_columns,
    headerText: settings?.header_text ?? config?.headerText ?? null,
    footerText: settings?.footer_text ?? config?.footerText ?? null,
    addressText: config?.addressText ?? null,
  });

  const id = await queueJob({ bodyText: body, title: "Test print" });

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "receipt_printer.test_print",
    entityType: "receipt_print_jobs",
    entityId: id ?? "n/a",
  });

  if (!id) {
    redirect(`${BASE}&error=${encodeURIComponent("Could not queue test print \u2014 Supabase service role not configured.")}`);
  }
  revalidatePath(REVALIDATE);
  redirect(`${BASE}&test=1`);
}

/** Cancel a queued/failed job from the queue table. */
export async function cancelJobAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = str(formData, "job_id");
  if (id) {
    await cancelJob(id);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "receipt_printer.cancel_job",
      entityType: "receipt_print_jobs",
      entityId: id,
    });
  }
  revalidatePath(REVALIDATE);
  redirect(BASE);
}

/** Re-queue a failed job (GW-026): fresh attempts, back into the print queue. */
export async function requeueJobAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const id = str(formData, "job_id");
  if (id) {
    await requeueJob(id);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "receipt_printer.requeue_job",
      entityType: "receipt_print_jobs",
      entityId: id,
    });
  }
  revalidatePath(REVALIDATE);
  redirect(BASE);
}
