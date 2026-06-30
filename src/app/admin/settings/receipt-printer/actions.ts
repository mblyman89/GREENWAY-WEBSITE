"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  updatePrinterSettings,
  queueJob,
  cancelJob,
  formatReceipt,
} from "@/lib/printing/printer-store";

const BASE = "/admin/settings/receipt-printer";

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
    redirect(`${BASE}?error=${encodeURIComponent("Could not save — Supabase service role not configured.")}`);
  }

  revalidatePath(BASE);
  redirect(`${BASE}?saved=1`);
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
    redirect(`${BASE}?error=${encodeURIComponent("Could not save token — Supabase service role not configured.")}`);
  }
  revalidatePath(BASE);
  redirect(`${BASE}?token=1`);
}

/** Queue a sample receipt so staff can confirm the printer is wired up. */
export async function testPrintAction(): Promise<void> {
  const session = await requirePermission("settings.manage");

  const body = formatReceipt({
    orderNumber: "TEST-PRINT",
    placedAt: new Date().toISOString(),
    customerName: "Test Receipt",
    lines: [
      { productName: "Sample item A", brand: "Greenway", variantLabel: "1g", quantity: 1, priceMinorUnits: 1000 },
      { productName: "Sample item B", brand: "Greenway", variantLabel: "10pk", quantity: 2, priceMinorUnits: 1500 },
    ],
    subtotalMinorUnits: 4000,
    savingsMinorUnits: 0,
    estimatedTaxMinorUnits: 1480,
    totalMinorUnits: 5480,
    customerNote: "This is a CloudPRNT test print.",
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
    redirect(`${BASE}?error=${encodeURIComponent("Could not queue test print — Supabase service role not configured.")}`);
  }
  revalidatePath(BASE);
  redirect(`${BASE}?test=1`);
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
  revalidatePath(BASE);
  redirect(BASE);
}
